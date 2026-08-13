#!/usr/bin/env python3
"""重做 Heroes' Fate 的 15 個共用音效（取代 generate_audio.py 的 sfx 段）。

為什麼要重做：舊版是 sine／saw／square 振盪器 + 簡單包絡，本質上是 8-bit
合成器，睿哥聽到的「電子音」就是它。真實感差別不在「用不用合成」，而在
三件事——**噪音瞬態、共振（modal）而非純音、還有空間殘響**。這支腳本就是
照這三點重寫：

  1. 每個撞擊都由「噪音瞬態 + 音高下墜的低頻 body + 飽和」疊成，沒有裸的正弦。
  2. 金屬／鈴聲用 modal 共振器組（非諧波比例、各自不同衰減），不是單一頻率。
  3. 全部走卷積殘響（IR 由衰減噪音合成），這是「像真的」與「像嗶聲」最大的分水嶺。

用法（會直接覆寫 assets/audio/sfx/*.mp3）：

    python3 tools/gen_sfx_v2.py            # 全部
    python3 tools/gen_sfx_v2.py ui_click   # 只做指定幾個
    python3 tools/gen_sfx_v2.py --out /tmp/preview   # 產到別的地方，不動遊戲素材

需要 numpy / scipy / lameenc（`pip install numpy scipy lameenc`）；
不需要 ffmpeg —— MP3 由 lameenc 直接編碼。
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import lameenc
import numpy as np
from scipy import signal

SR = 32_000
RNG = np.random.default_rng(0x5346_5832)
ROOT = Path(__file__).resolve().parents[1]


# ── 基本素材 ────────────────────────────────────────────────────────────────

def n_of(seconds: float) -> int:
    return max(1, int(seconds * SR))


def noise(seconds: float) -> np.ndarray:
    return RNG.standard_normal(n_of(seconds))


def pink(seconds: float) -> np.ndarray:
    """粉紅噪音：比白噪音低頻多，撞擊與風聲的底料。"""
    white = noise(seconds)
    # Voss-McCartney 的簡化版：疊幾層不同更新率的階梯噪音
    out = np.zeros_like(white)
    for octave in range(6):
        step = 2 ** octave
        rough = RNG.standard_normal(len(white) // step + 1)
        out += np.repeat(rough, step)[: len(white)] / (octave + 1)
    return 0.6 * out + 0.4 * white


def env_ad(seconds: float, attack: float, decay: float, curve: float = 2.0) -> np.ndarray:
    """瞬態用的 attack/decay 包絡；curve 越大衰減越快（越像敲擊）。"""
    n = n_of(seconds)
    t = np.arange(n) / SR
    a = np.clip(t / max(1e-4, attack), 0, 1)
    d = np.exp(-curve * np.clip((t - attack) / max(1e-4, decay), 0, None))
    return a * d


def saturate(x: np.ndarray, drive: float = 2.0) -> np.ndarray:
    """軟飽和：加諧波、把「乾淨到不真實」的合成音弄髒一點。"""
    return np.tanh(x * drive) / np.tanh(drive)


def sos_filter(x: np.ndarray, kind: str, f0: float, q: float = 0.707, order: int = 2) -> np.ndarray:
    f0 = float(np.clip(f0, 20.0, SR * 0.45))
    if kind == "bandpass":
        bw = f0 / max(0.3, q)
        lo = max(20.0, f0 - bw / 2)
        hi = min(SR * 0.45, f0 + bw / 2)
        sos = signal.butter(order, [lo, hi], btype="bandpass", fs=SR, output="sos")
    else:
        sos = signal.butter(order, f0, btype=kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def sweep_lowpass(x: np.ndarray, f_start: float, f_end: float, resonance: float = 0.6) -> np.ndarray:
    """時變低通（state-variable filter）。掃頻是「有東西在動」的關鍵聽感，
    固定濾波聽起來就是死的。"""
    n = len(x)
    f = np.geomspace(max(30.0, f_start), max(30.0, f_end), n)
    g = np.tan(np.pi * np.clip(f, 20, SR * 0.45) / SR)
    k = 2.0 - 2.0 * np.clip(resonance, 0.0, 0.95)
    out = np.zeros(n)
    ic1 = ic2 = 0.0
    for i in range(n):
        gi = g[i]
        a1 = 1.0 / (1.0 + gi * (gi + k))
        a2 = gi * a1
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + gi * v1
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        out[i] = v2
    return out


def modal(seconds: float, freqs, decays, amps, exciter: np.ndarray | None = None) -> np.ndarray:
    """Modal（共振）合成：一組非諧波共振峰各自衰減。
    金屬、鈴、木頭的「音色」就是這組比例 —— 用單一正弦永遠做不出來。"""
    n = n_of(seconds)
    t = np.arange(n) / SR
    if exciter is None:
        exciter = np.zeros(n)
        strike = n_of(0.004)
        exciter[:strike] = RNG.standard_normal(strike)
    out = np.zeros(n)
    for f, d, a in zip(freqs, decays, amps):
        ring = np.sin(2 * np.pi * f * t + RNG.uniform(0, 2 * np.pi)) * np.exp(-t / max(1e-3, d))
        # 用敲擊噪音去「激發」共振，而不是直接播正弦
        out += a * signal.fftconvolve(exciter, ring)[:n]
    peak = np.max(np.abs(out)) or 1.0
    return out / peak


def impulse_response(seconds: float, decay: float, damp_hz: float, predelay: float = 0.01) -> np.ndarray:
    """合成殘響 IR：衰減噪音 + 隨時間變暗的低通。"""
    n = n_of(seconds)
    t = np.arange(n) / SR
    ir = RNG.standard_normal(n) * np.exp(-t / decay)
    ir = sweep_lowpass(ir, damp_hz, damp_hz * 0.25, 0.2)
    pre = n_of(predelay)
    ir = np.concatenate([np.zeros(pre), ir])
    ir[:pre] = 0.0
    return ir / (np.max(np.abs(ir)) or 1.0)


HALL = None
ROOM = None


def reverb(x: np.ndarray, kind: str = "hall", wet: float = 0.3) -> np.ndarray:
    global HALL, ROOM
    if HALL is None:
        HALL = impulse_response(1.9, 0.45, 5200, 0.018)
        ROOM = impulse_response(0.42, 0.10, 7000, 0.006)
    ir = HALL if kind == "hall" else ROOM
    wet_sig = signal.fftconvolve(x, ir)[: len(x)]
    wet_sig /= np.max(np.abs(wet_sig)) or 1.0
    return (1.0 - wet) * x + wet * wet_sig


def stereo(mono: np.ndarray, width: float = 0.35) -> np.ndarray:
    """用極短的左右延遲做出寬度；單聲道聽起來會很「貼耳」很假。"""
    d = n_of(0.006 * width)
    left = mono
    right = np.concatenate([np.zeros(d), mono])[: len(mono)] if d else mono
    return np.stack([left, right], axis=1)


def finish(mono: np.ndarray, peak: float = 0.89, fade_out: float = 0.03) -> np.ndarray:
    mono = np.nan_to_num(mono)
    f = n_of(fade_out)
    if f < len(mono):
        mono[-f:] *= np.linspace(1.0, 0.0, f)
    mono[: n_of(0.002)] *= np.linspace(0.0, 1.0, n_of(0.002))
    mono /= np.max(np.abs(mono)) or 1.0
    return stereo(mono * peak)


# ── 15 個音效 ──────────────────────────────────────────────────────────────

def ui_click() -> np.ndarray:
    """紙／木頭的輕點，不是電子嗶。"""
    body = modal(0.16, [420, 980, 1730, 2610], [0.030, 0.018, 0.010, 0.006],
                 [1.0, 0.5, 0.28, 0.14])
    tick = sos_filter(noise(0.16), "highpass", 2600) * env_ad(0.16, 0.0008, 0.012, 5.0)
    mix = 0.75 * body + 0.5 * tick
    return finish(reverb(mix, "room", 0.16), 0.62)


def ui_lock() -> np.ndarray:
    """木扣扣合（睿哥從四個方案選的 A）。

    第一版是金屬扣環，金屬共振衰減到 220ms，變成拖尾的「噹」——睿哥回
    「不好聽」。這顆聲音**不只「決定」在用**：選模式、命運排序揭曉、分組
    揭曉都是同一顆（見 audioDirector 的 pick.lock／mode.select／order.rank／
    team.reveal），一場下來會聽很多次，拖尾越聽越煩。

    改成木頭共振：時長 0.55s→0.30s，最長衰減 220ms→55ms，泛音只留四段
    且全在 1.2kHz 以下，完全沒有金屬尾。
    """
    body = modal(0.30, [196, 431, 742, 1180], [0.055, 0.034, 0.020, 0.012],
                 [1.0, 0.55, 0.28, 0.14])
    t = np.arange(n_of(0.30)) / SR
    thunk = np.sin(2 * np.pi * np.cumsum(104 * np.exp(-20 * t)) / SR) * env_ad(0.30, 0.001, 0.055, 3.4)
    tick = sos_filter(noise(0.30), "bandpass", 2200, 0.9) * env_ad(0.30, 0.0006, 0.010, 6.0)
    return finish(reverb(saturate(0.9 * body + 0.85 * thunk + 0.28 * tick, 1.5), "room", 0.18), 0.78)


def ui_whoosh() -> np.ndarray:
    """空氣掃過：帶通掃頻噪音 + 一點都卜勒。"""
    air = pink(0.42)
    swept = sweep_lowpass(air, 400, 4200, 0.55) - sweep_lowpass(air, 180, 900, 0.4)
    shape = np.sin(np.pi * np.linspace(0, 1, len(swept))) ** 1.6
    return finish(reverb(swept * shape, "room", 0.3), 0.62)


def wheel_hit() -> np.ndarray:
    """卡榫過位的木質喀噠。"""
    wood = modal(0.13, [610, 1310, 2180], [0.020, 0.011, 0.006], [1.0, 0.42, 0.2])
    click = sos_filter(noise(0.13), "bandpass", 3400, 1.1) * env_ad(0.13, 0.0006, 0.008, 6.0)
    return finish(reverb(0.8 * wood + 0.55 * click, "room", 0.18), 0.66)


def attack_sword() -> np.ndarray:
    """揮空的風聲 → 金屬鏘。"""
    air = pink(0.7)
    swing = sweep_lowpass(air, 600, 5200, 0.6) * env_ad(0.7, 0.02, 0.10, 2.4)
    clang = modal(0.7, [1180, 2093, 3271, 4517, 6133],
                  [0.30, 0.22, 0.15, 0.10, 0.06], [1.0, 0.72, 0.5, 0.32, 0.18])
    clang = np.concatenate([np.zeros(n_of(0.11)), clang])[: n_of(0.7)]
    return finish(reverb(saturate(0.55 * swing + 0.95 * clang, 1.4), "hall", 0.28), 0.86)


def attack_heavy() -> np.ndarray:
    """重擊：音高下墜的 body + 碎裂噪音。"""
    n = n_of(0.85)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(74 * np.exp(-9.0 * t) + 38) / SR)
    boom *= env_ad(0.85, 0.002, 0.22, 2.6)
    crack = sos_filter(noise(0.85), "bandpass", 1200, 0.7) * env_ad(0.85, 0.0008, 0.030, 5.5)
    # 碎屑要壓在低中頻，否則整個音變成「嘶」的一聲，重量感全失
    debris = sos_filter(pink(0.85), "bandpass", 420, 0.5) * env_ad(0.85, 0.01, 0.26, 3.6) * 0.5
    return finish(reverb(saturate(1.35 * boom + 0.32 * crack + debris, 2.1), "hall", 0.3), 0.9)


def attack_arrow() -> np.ndarray:
    """弓弦彈放 + 箭矢破空。"""
    string = modal(0.5, [196, 392, 587], [0.05, 0.03, 0.02], [1.0, 0.4, 0.2])
    air = pink(0.5)
    flight = sweep_lowpass(air, 900, 3800, 0.7) * env_ad(0.5, 0.03, 0.10, 2.2)
    flight = np.concatenate([np.zeros(n_of(0.05)), flight])[: n_of(0.5)]
    return finish(reverb(0.7 * string + 0.8 * flight, "room", 0.24), 0.78)


def attack_magic() -> np.ndarray:
    """法術：上行的濾波噪音 + 閃爍共振，刻意不用純音。"""
    air = pink(1.0)
    rise = sweep_lowpass(air, 260, 6000, 0.8) * np.linspace(0.15, 1.0, n_of(1.0)) ** 2
    shimmer = modal(1.0, [1567, 2349, 3136, 4181, 5274],
                    [0.35, 0.28, 0.2, 0.14, 0.1], [0.7, 0.9, 0.6, 0.4, 0.25])
    shimmer = np.concatenate([np.zeros(n_of(0.42)), shimmer])[: n_of(1.0)]
    tail = env_ad(1.0, 0.4, 0.35, 1.8)
    return finish(reverb((0.65 * rise + 0.9 * shimmer) * tail, "hall", 0.42), 0.84)


def attack_holy() -> np.ndarray:
    """聖光：非諧波鐘組 + 空氣感，長殘響。"""
    bell = modal(1.4, [523, 1047, 1580, 2093, 3141, 4186],
                 [0.9, 0.7, 0.5, 0.38, 0.25, 0.16],
                 [1.0, 0.62, 0.4, 0.5, 0.28, 0.16])
    air = sos_filter(pink(1.4), "highpass", 3500) * env_ad(1.4, 0.12, 0.5, 1.6) * 0.3
    return finish(reverb(bell + air, "hall", 0.5), 0.86)


def boss_roar() -> np.ndarray:
    """魔王怒吼：低頻噪音 + 共振腔（formant）+ 失真，不是低音正弦。"""
    n = n_of(2.2)
    t = np.arange(n) / SR
    src = pink(2.2)
    growl = 0.55 + 0.45 * np.sin(2 * np.pi * (5.5 + 4.0 * t) * t) ** 2
    src = src * growl
    # 三個 formant 疊出「喉嚨」的感覺
    body = (sos_filter(src, "bandpass", 110, 1.4)
            + 0.8 * sos_filter(src, "bandpass", 340, 1.1)
            + 0.45 * sos_filter(src, "bandpass", 820, 0.9))
    sub = np.sin(2 * np.pi * np.cumsum(52 * np.exp(-1.2 * t) + 30) / SR) * 0.6
    env = np.sin(np.pi * np.clip(t / 2.2, 0, 1)) ** 0.6
    mix = saturate((body + sub) * env, 2.6)
    return finish(reverb(mix, "hall", 0.42), 0.92)


def boss_stinger() -> np.ndarray:
    """降臨重音（braam）：一堆失諧的鋸齒被壓在低頻 + 大殘響。"""
    n = n_of(2.4)
    t = np.arange(n) / SR
    stack = np.zeros(n)
    for detune in (-14, -7, 0, 6, 13):
        f = 55.0 * (2 ** (detune / 1200.0))
        ph = np.cumsum(f * (1.0 + 0.25 * np.exp(-2.5 * t))) / SR
        stack += signal.sawtooth(2 * np.pi * ph)
    stack /= 5.0
    stack = sweep_lowpass(stack, 260, 900, 0.7)
    rumble = sos_filter(pink(2.4), "lowpass", 140) * 0.8
    env = env_ad(2.4, 0.06, 1.1, 1.5)
    return finish(reverb(saturate((stack + rumble) * env, 2.2), "hall", 0.46), 0.94)


def boss_defeat() -> np.ndarray:
    """崩塌：低頻轟然 + 碎石 + 下墜的金屬共振。"""
    n = n_of(2.6)
    t = np.arange(n) / SR
    quake = np.sin(2 * np.pi * np.cumsum(46 * np.exp(-1.6 * t) + 24) / SR)
    quake *= env_ad(2.6, 0.01, 0.9, 1.6)
    rubble = sos_filter(pink(2.6), "bandpass", 900, 0.5)
    rubble *= (RNG.random(n) < 0.0022) * 1.0
    rubble = signal.fftconvolve(rubble, np.exp(-np.arange(n_of(0.08)) / (0.02 * SR)))[:n]
    metal = modal(2.6, [214, 389, 622, 941], [1.1, 0.8, 0.55, 0.35], [1.0, 0.6, 0.35, 0.2])
    return finish(reverb(saturate(quake + 0.5 * rubble + 0.45 * metal, 1.8), "hall", 0.44), 0.92)


def smoke_burst() -> np.ndarray:
    """煙霧噴發：寬頻噪音急速轉暗 + 低頻鼓動。"""
    air = pink(1.3)
    burst = sweep_lowpass(air, 6500, 300, 0.35) * env_ad(1.3, 0.004, 0.42, 2.0)
    thump = np.sin(2 * np.pi * np.cumsum(64 * np.exp(-7 * np.arange(n_of(1.3)) / SR) + 32) / SR)
    thump *= env_ad(1.3, 0.003, 0.16, 3.0) * 0.7
    return finish(reverb(1.4 * burst + thump, "hall", 0.34), 0.88)


def reveal_chime() -> np.ndarray:
    """揭曉的重音。非諧波鐘（真實鐘的泛音就是非整數比），但**尾巴要短**。

    第一版是 2 秒、頻譜重心 4926Hz 的長鳴鐘。它在命運一擊完成後只隔 6ms
    就響（`reveal.winner` 緊接在 `strike.release` 之後），於是變成睿哥說的
    「魔法陣結束還在噹」—— 圓陣都收了，鐘還在響。

    收短到 1.1 秒、最長衰減砍掉一半以上，並拿掉最高的兩段泛音（3520／4692）
    ——「噹」的刺耳感主要來自那裡。它仍然是鐘，只是變成一記重音而不是長鳴。
    """
    bell = modal(1.1, [587, 1174, 1466, 1760, 2637],
                 [0.50, 0.40, 0.30, 0.26, 0.16],
                 [1.0, 0.55, 0.42, 0.55, 0.22])
    sparkle = sos_filter(noise(1.1), "highpass", 4200) * env_ad(1.1, 0.004, 0.055, 5.0) * 0.16
    return finish(reverb(bell + sparkle, "hall", 0.42), 0.84)


def victory_fanfare() -> np.ndarray:
    """勝利號角：濾波鋸齒當銅管（含吹奏噪音與抖音）+ 太鼓 + 大廳殘響。"""
    total = 3.2
    n = n_of(total)
    out = np.zeros(n)
    beat = 0.34

    def brass(note_hz: float, start: float, dur: float, gain: float) -> None:
        m = n_of(dur)
        t = np.arange(m) / SR
        vib = 1.0 + 0.004 * np.sin(2 * np.pi * 5.4 * t) * np.clip(t / 0.25, 0, 1)
        stack = np.zeros(m)
        for det in (-8, 0, 7):
            f = note_hz * (2 ** (det / 1200.0)) * vib
            stack += signal.sawtooth(2 * np.pi * np.cumsum(f) / SR)
        stack /= 3.0
        # 銅管的亮度隨力度上升，再加一點吹奏氣音
        stack = sweep_lowpass(stack, note_hz * 2.2, note_hz * 6.0, 0.5)
        breath = sos_filter(noise(dur), "bandpass", note_hz * 4, 0.6) * 0.12
        env = env_ad(dur, 0.045, dur * 0.85, 1.1)
        seg = (stack + breath) * env * gain
        pos = n_of(start)
        out[pos: pos + len(seg)] += seg[: max(0, n - pos)]

    def taiko(start: float, gain: float, pitch: float = 58.0) -> None:
        m = n_of(0.7)
        t = np.arange(m) / SR
        body = np.sin(2 * np.pi * np.cumsum(pitch + 40 * np.exp(-14 * t)) / SR)
        skin = sos_filter(noise(0.7), "bandpass", 1100, 0.6) * np.exp(-26 * t)
        seg = saturate(body * np.exp(-6.5 * t) + 0.3 * skin, 1.8) * gain
        pos = n_of(start)
        out[pos: pos + len(seg)] += seg[: max(0, n - pos)]

    # I – V – I 的簡短號角動機（C 大調）
    for start, notes, gain in [
        (0.00, (261.63, 329.63, 392.00), 0.30),
        (beat, (261.63, 329.63, 392.00), 0.30),
        (2 * beat, (392.00, 523.25), 0.34),
        (3.2 * beat, (523.25, 659.25, 784.00), 0.40),
    ]:
        for i, hz in enumerate(notes):
            brass(hz, start, 0.55 if start < 3 * beat else 1.5, gain * (1.0 - 0.12 * i))
    for i, s in enumerate([0.0, beat, 2 * beat, 3.2 * beat]):
        taiko(s, 0.34 + 0.05 * i)
    return finish(reverb(out, "hall", 0.4), 0.9)


def fate_strike() -> np.ndarray:
    """命運一擊落下（魔法陣四個符文全亮的那一刻）。

    原本這裡用的是 `reveal_chime`，而 0.6 秒後的揭曉又是同一顆鐘 ——
    兩記 2 秒的鐘聲疊在一起，就是睿哥說的「魔法陣結束還在噹」。
    這裡要的是**一擊**不是鈴聲，所以刻意不放任何長衰減的共振：
    低頻轟落 + 瞬態 + 由亮轉暗的下墜掃頻，尾巴全靠殘響收掉。
    """
    dur = 1.6
    n = n_of(dur)
    t = np.arange(n) / SR
    # 低頻轟落：90Hz 掉到 38Hz
    boom = np.sin(2 * np.pi * np.cumsum(52 * np.exp(-7.5 * t) + 38) / SR)
    boom *= env_ad(dur, 0.003, 0.34, 2.2)
    # 撞擊瞬態
    hit = sos_filter(noise(dur), "bandpass", 900, 0.6) * env_ad(dur, 0.0008, 0.030, 5.5)
    # 「命運落下」的下墜掃頻：由亮轉暗，這段給魔法感又不會變成鈴聲
    fall = sweep_lowpass(pink(dur), 5200, 380, 0.55) * env_ad(dur, 0.008, 0.30, 2.6) * 0.55
    return finish(reverb(saturate(1.25 * boom + 0.55 * hit + fall, 2.0), "hall", 0.46), 0.92)


def party_horn() -> np.ndarray:
    """全隊到齊的召集號角（睿哥指定：最後一位選完要「號角響起」）。

    真號角有三個特徵，少一個就會變回合成器的鋸齒：起音會從偏低滑上去、
    越吹越亮（亮度隨力度走，所以用掃頻低通而不是固定濾波）、以及全程都在的
    吹奏氣音。這裡是低音起、揚上五度的雙聲呼喚 —— 典型的召集號。
    """
    def note(hz, dur, gain=1.0):
        n = n_of(dur)
        t = np.arange(n) / SR
        bend = 1.0 - 0.035 * np.exp(-14.0 * t)              # 起音上滑
        vib = 1.0 + 0.006 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.28) / 0.4, 0, 1)
        f = hz * bend * vib
        stack = np.zeros(n)
        for det in (-9, 0, 8):
            stack += signal.sawtooth(2 * np.pi * np.cumsum(f * (2 ** (det / 1200.0))) / SR)
        stack /= 3.0
        stack = sweep_lowpass(stack, hz * 1.8, hz * 5.2, 0.45)
        breath = sos_filter(noise(dur), "bandpass", hz * 5, 0.55) * 0.14
        return (stack + breath) * env_ad(dur, 0.055, dur * 0.72, 1.25) * gain

    out = np.zeros(n_of(2.4))

    def place(seg, start):
        i = n_of(start)
        m = min(len(seg), len(out) - i)
        if m > 0:
            out[i:i + m] += seg[:m]

    place(note(196.00, 0.72, 0.95), 0.0)    # G3
    place(note(98.00, 0.72, 0.40), 0.0)     # 低八度加厚
    place(note(293.66, 1.50, 1.00), 0.62)   # 揚上五度 D4
    place(note(146.83, 1.50, 0.42), 0.62)
    return finish(reverb(saturate(out, 1.5), "hall", 0.44), 0.9)


SOUNDS = {
    "ui_click": (ui_click, 96),
    "ui_lock": (ui_lock, 112),
    "ui_whoosh": (ui_whoosh, 112),
    "wheel_hit": (wheel_hit, 96),
    "attack_sword": (attack_sword, 128),
    "attack_heavy": (attack_heavy, 128),
    "attack_arrow": (attack_arrow, 112),
    "attack_magic": (attack_magic, 128),
    "attack_holy": (attack_holy, 128),
    "boss_roar": (boss_roar, 128),
    "boss_stinger": (boss_stinger, 128),
    "boss_defeat": (boss_defeat, 128),
    "smoke_burst": (smoke_burst, 112),
    "reveal_chime": (reveal_chime, 128),
    "fate_strike": (fate_strike, 128),
}

# ⚠️ 這兩個**已經改用睿哥提供的真實錄音**，故意不放進 SOUNDS：
#
#   victory_fanfare  ← 影片 6e652590 的 4.02–7.22s（v1.22）
#   party_horn       ← 影片 bae80648 的完整 3.0s（v1.23）
#
# 兩者都由 `tools/import_scene_bgm.py` 從影片音軌匯入。下面的
# `victory_fanfare()` 與 `party_horn()` 只留作歷史參考 ——
# **不要把它們接回 SOUNDS**，一旦重跑 `python3 tools/gen_sfx_v2.py`
# 就會把真實錄音蓋回合成版。（`tools/generate_audio.py` 已經因為同樣的
# 原因把 15 個 sfx 全部移出 jobs，見 2026-08-14 v1.16。）


def encode_mp3(stereo_audio: np.ndarray, target: Path, bitrate: int) -> None:
    pcm = np.clip(stereo_audio, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")
    enc = lameenc.Encoder()
    enc.set_bit_rate(bitrate)
    enc.set_in_sample_rate(SR)
    enc.set_channels(2)
    enc.set_quality(2)
    data = enc.encode(pcm.tobytes()) + enc.flush()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(bytes(data))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("only", nargs="*", help="只產生這幾個（不給就全部）")
    ap.add_argument("--out", default=str(ROOT / "assets" / "audio" / "sfx"))
    args = ap.parse_args()

    out_dir = Path(args.out)
    names = args.only or list(SOUNDS)
    total = 0
    for name in names:
        if name not in SOUNDS:
            raise SystemExit(f"未知音效：{name}（可用：{', '.join(SOUNDS)}）")
        fn, br = SOUNDS[name]
        target = out_dir / f"{name}.mp3"
        encode_mp3(fn(), target, br)
        size = target.stat().st_size
        total += size
        print(f"  {name:<16} {size / 1024:6.1f} KB")
    print(f"共 {len(names)} 個，{total / 1024:.1f} KB → {out_dir}")


if __name__ == "__main__":
    main()
