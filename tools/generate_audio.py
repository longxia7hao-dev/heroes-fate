#!/usr/bin/env python3
"""Generate the original Heroes' Fate music and shared sound effects.

The game deliberately keeps these sounds reproducible and self-contained: no
third-party sample packs are required.  Character-specific Sora audio is
extracted separately from the user's source videos.
"""

from __future__ import annotations

import argparse
import math
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np


SR = 32_000
RNG = np.random.default_rng(0x4846_4154)


def midi(note: float) -> float:
    return 440.0 * (2.0 ** ((note - 69.0) / 12.0))


def envelope(length: int, attack: float = 0.02, release: float = 0.12) -> np.ndarray:
    env = np.ones(length, dtype=np.float64)
    a = min(length, max(1, int(attack * SR)))
    r = min(length, max(1, int(release * SR)))
    env[:a] = np.linspace(0.0, 1.0, a, endpoint=False)
    env[-r:] *= np.linspace(1.0, 0.0, r)
    return env


def oscillator(freq: float | np.ndarray, t: np.ndarray, kind: str = "sine", phase: float = 0.0) -> np.ndarray:
    p = np.mod(np.asarray(freq) * t + phase, 1.0)
    if kind == "triangle":
        return 2.0 * np.abs(2.0 * p - 1.0) - 1.0
    if kind == "saw":
        return 2.0 * p - 1.0
    if kind == "square":
        return np.where(p < 0.5, 1.0, -1.0)
    return np.sin(2.0 * np.pi * p)


class Mix:
    def __init__(self, seconds: float):
        self.audio = np.zeros((max(1, int(seconds * SR)), 2), dtype=np.float64)

    def add(self, mono: np.ndarray, start: float, gain: float = 1.0, pan: float = 0.0) -> None:
        pos = max(0, int(start * SR))
        if pos >= len(self.audio):
            return
        mono = mono[: len(self.audio) - pos] * gain
        # Constant-power pan.
        angle = (np.clip(pan, -1.0, 1.0) + 1.0) * math.pi / 4.0
        self.audio[pos : pos + len(mono), 0] += mono * math.cos(angle)
        self.audio[pos : pos + len(mono), 1] += mono * math.sin(angle)

    def tone(
        self,
        note: float,
        start: float,
        duration: float,
        gain: float,
        kind: str = "sine",
        pan: float = 0.0,
        attack: float = 0.02,
        release: float = 0.12,
        vibrato: float = 0.0,
    ) -> None:
        n = max(1, int(duration * SR))
        t = np.arange(n) / SR
        freq = midi(note) * (1.0 + vibrato * np.sin(2 * np.pi * 5.1 * t))
        sig = oscillator(freq, t, kind)
        if kind in {"saw", "square"}:
            sig = 0.72 * sig + 0.28 * np.sin(2 * np.pi * midi(note) * t)
        self.add(sig * envelope(n, attack, release), start, gain, pan)

    def pluck(self, note: float, start: float, duration: float, gain: float, pan: float = 0.0) -> None:
        n = max(1, int(duration * SR))
        t = np.arange(n) / SR
        f = midi(note)
        sig = (
            np.sin(2 * np.pi * f * t)
            + 0.48 * np.sin(2 * np.pi * f * 2.0 * t + 0.2)
            + 0.22 * np.sin(2 * np.pi * f * 3.0 * t + 0.7)
            + 0.11 * np.sin(2 * np.pi * f * 5.0 * t)
        ) / 1.7
        sig *= np.exp(-5.2 * t / max(duration, 0.05))
        sig *= envelope(n, 0.004, min(0.1, duration * 0.3))
        self.add(sig, start, gain, pan)

    def bell(self, note: float, start: float, duration: float, gain: float, pan: float = 0.0) -> None:
        n = max(1, int(duration * SR))
        t = np.arange(n) / SR
        f = midi(note)
        sig = (
            np.sin(2 * np.pi * f * t)
            + 0.44 * np.sin(2 * np.pi * f * 2.01 * t)
            + 0.25 * np.sin(2 * np.pi * f * 3.98 * t)
            + 0.12 * np.sin(2 * np.pi * f * 6.03 * t)
        ) / 1.55
        sig *= np.exp(-4.4 * t / max(duration, 0.05))
        sig *= envelope(n, 0.003, min(0.16, duration * 0.4))
        self.add(sig, start, gain, pan)

    def noise(self, start: float, duration: float, gain: float, color: str = "white", pan: float = 0.0) -> None:
        n = max(1, int(duration * SR))
        sig = RNG.standard_normal(n)
        if color == "low":
            width = max(2, int(0.006 * SR))
            sig = np.convolve(sig, np.ones(width) / width, mode="same")
            sig /= max(np.max(np.abs(sig)), 1e-9)
        elif color == "pink":
            # A compact deterministic approximation that is ample for whooshes.
            sig = np.cumsum(sig)
            sig -= np.linspace(sig[0], sig[-1], n)
            sig /= max(np.max(np.abs(sig)), 1e-9)
        self.add(sig * envelope(n, 0.008, min(0.2, duration * 0.5)), start, gain, pan)

    def kick(self, start: float, gain: float = 0.25, pitch: float = 55.0) -> None:
        d = 0.38
        n = int(d * SR)
        t = np.arange(n) / SR
        freq = pitch + 95.0 * np.exp(-22.0 * t)
        phase = np.cumsum(freq) / SR
        sig = np.sin(2 * np.pi * phase) * np.exp(-10.0 * t)
        self.add(sig, start, gain)

    def taiko(self, start: float, gain: float = 0.32, pitch: float = 47.0) -> None:
        d = 0.7
        n = int(d * SR)
        t = np.arange(n) / SR
        freq = pitch + 34.0 * np.exp(-8.0 * t)
        phase = np.cumsum(freq) / SR
        body = np.sin(2 * np.pi * phase) + 0.35 * np.sin(4 * np.pi * phase)
        noise = RNG.standard_normal(n) * np.exp(-28.0 * t)
        self.add((0.76 * body * np.exp(-6.0 * t) + 0.16 * noise) * envelope(n, 0.003, 0.2), start, gain)


def finalize(mix: Mix, fade: float = 0.05) -> np.ndarray:
    audio = mix.audio
    if fade:
        n = min(len(audio) // 2, int(fade * SR))
        audio[:n] *= np.linspace(0.0, 1.0, n)[:, None]
        audio[-n:] *= np.linspace(1.0, 0.0, n)[:, None]
    peak = float(np.max(np.abs(audio))) or 1.0
    return np.clip(audio * (0.88 / peak), -1.0, 1.0)


def bgm_home() -> np.ndarray:
    bpm, bars = 80.0, 8
    beat = 60.0 / bpm
    mix = Mix(bars * 4 * beat)
    chords = [(50, 53, 57), (46, 50, 53), (41, 45, 48), (48, 52, 55)] * 2
    melody = [69, 72, 74, 72, 67, 69, 65, 64, 65, 69, 72, 69, 67, 64, 62, 64]
    for bar, chord in enumerate(chords):
        t0 = bar * 4 * beat
        for n in chord:
            mix.tone(n, t0, 4 * beat, 0.055, "sine", pan=(n - chord[1]) * 0.15, attack=0.3, release=0.5)
            mix.tone(n - 12, t0, 4 * beat, 0.025, "triangle", attack=0.25, release=0.4)
        arp = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12] * 2
        for step, n in enumerate(arp):
            mix.pluck(n, t0 + step * beat / 2, beat * 0.72, 0.12, pan=(-0.35 if step % 2 == 0 else 0.35))
        mix.kick(t0, 0.07, 46)
        mix.kick(t0 + 2 * beat, 0.045, 42)
    for i, n in enumerate(melody):
        start = i * 2 * beat
        mix.tone(n, start, beat * 1.55, 0.085, "sine", pan=0.12, attack=0.08, release=0.32, vibrato=0.003)
    for bar in (1, 3, 5, 7):
        mix.bell(81 if bar % 4 == 1 else 84, bar * 4 * beat + 3 * beat, beat * 1.2, 0.07, 0.35)
    return finalize(mix, 0.03)


def bgm_pick() -> np.ndarray:
    bpm, bars = 96.0, 8
    beat = 60.0 / bpm
    mix = Mix(bars * 4 * beat)
    chords = [(52, 55, 59), (48, 52, 55), (55, 59, 62), (50, 54, 57)] * 2
    melody = [71, 74, 76, 74, 71, 69, 67, 69, 71, 74, 79, 76, 74, 71, 69, 66]
    for bar, chord in enumerate(chords):
        t0 = bar * 4 * beat
        for n in chord:
            mix.tone(n, t0, 4 * beat, 0.038, "sine", pan=(n - chord[1]) * 0.18, attack=0.22, release=0.45)
        for step in range(16):
            n = chord[(step * 2 + step // 4) % 3] + 12 + (12 if step in {7, 15} else 0)
            mix.pluck(n, t0 + step * beat / 4, beat * 0.34, 0.085, pan=(-0.48 + (step % 4) * 0.32))
        for b in range(4):
            mix.kick(t0 + b * beat, 0.035 if b else 0.06, 52)
            mix.noise(t0 + b * beat + beat * 0.5, 0.055, 0.014, "white", pan=0.4 if b % 2 else -0.4)
    for i, n in enumerate(melody):
        mix.bell(n, i * 2 * beat, beat * 1.25, 0.08, pan=0.15 if i % 2 else -0.12)
    return finalize(mix, 0.03)


def bgm_battle() -> np.ndarray:
    bpm, bars = 128.0, 8
    beat = 60.0 / bpm
    mix = Mix(bars * 4 * beat)
    roots = [38, 38, 34, 36, 38, 41, 36, 37]
    brass = [(62, 65, 69), (62, 67, 70), (58, 62, 65), (60, 64, 67)] * 2
    for bar, root in enumerate(roots):
        t0 = bar * 4 * beat
        for step in range(8):
            n = root + (0 if step % 4 else 12)
            mix.tone(n, t0 + step * beat / 2, beat * 0.43, 0.095, "saw", pan=-0.16, attack=0.008, release=0.07)
        for n in brass[bar]:
            mix.tone(n, t0, 3.8 * beat, 0.055, "saw", pan=(n - brass[bar][1]) * 0.14, attack=0.12, release=0.28, vibrato=0.002)
        mix.taiko(t0, 0.23, 44)
        mix.taiko(t0 + 2 * beat, 0.18, 49)
        mix.kick(t0 + beat, 0.11, 52)
        mix.kick(t0 + 3 * beat, 0.12, 48)
        for b in (1, 3):
            mix.noise(t0 + b * beat, 0.13, 0.052, "white", pan=0.25 if b == 3 else -0.25)
    lead = [69, 69, 72, 74, 77, 76, 74, 72, 69, 72, 74, 77, 81, 79, 77, 76]
    for i, n in enumerate(lead):
        mix.tone(n, i * 2 * beat, beat * 1.55, 0.062, "triangle", pan=0.22, attack=0.025, release=0.16, vibrato=0.004)
    return finalize(mix, 0.025)


def sfx_ui_click() -> np.ndarray:
    mix = Mix(0.16)
    mix.pluck(79, 0.0, 0.14, 0.6, 0.05)
    mix.pluck(86, 0.028, 0.1, 0.33, -0.05)
    return finalize(mix, 0.005)


def sfx_ui_lock() -> np.ndarray:
    mix = Mix(0.72)
    mix.taiko(0.0, 0.32, 68)
    for i, n in enumerate((67, 74, 79)):
        mix.bell(n, 0.05 + i * 0.065, 0.54, 0.22, pan=(-0.25 + i * 0.25))
    return finalize(mix, 0.015)


def sfx_ui_whoosh() -> np.ndarray:
    mix = Mix(0.48)
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    noise = RNG.standard_normal(n)
    sig = noise * np.sin(np.pi * np.clip(t / 0.45, 0, 1)) ** 1.7
    sig *= 0.35 + 0.65 * np.sin(2 * np.pi * (180 * t + 1050 * t * t))
    mix.add(sig, 0.0, 0.28, 0.2)
    mix.tone(74, 0.21, 0.24, 0.14, "triangle", 0.25, 0.01, 0.12)
    return finalize(mix, 0.01)


def sfx_wheel_hit() -> np.ndarray:
    mix = Mix(0.52)
    mix.taiko(0.0, 0.5, 55)
    mix.bell(57, 0.015, 0.46, 0.22)
    mix.noise(0.0, 0.12, 0.12, "white")
    return finalize(mix, 0.02)


def sfx_smoke() -> np.ndarray:
    mix = Mix(0.82)
    n = int(0.78 * SR)
    t = np.arange(n) / SR
    noise = RNG.standard_normal(n)
    sweep = np.sin(2 * np.pi * (80 * t + 640 * t * t))
    sig = noise * (0.2 + 0.8 * sweep * sweep) * np.sin(np.pi * t / 0.78)
    mix.add(sig, 0.0, 0.34)
    mix.tone(38, 0.02, 0.65, 0.18, "saw", attack=0.03, release=0.3)
    return finalize(mix, 0.02)


def sfx_reveal() -> np.ndarray:
    mix = Mix(1.42)
    for i, n in enumerate((67, 74, 79, 83)):
        mix.bell(n, i * 0.11, 1.25 - i * 0.1, 0.33 - i * 0.025, pan=(-0.42 + i * 0.28))
    mix.tone(55, 0.0, 0.8, 0.09, "sine", attack=0.02, release=0.35)
    return finalize(mix, 0.03)


def sfx_boss_stinger() -> np.ndarray:
    mix = Mix(2.75)
    mix.taiko(0.02, 0.5, 36)
    for n in (38, 39, 45):
        mix.tone(n, 0.02, 2.55, 0.16, "saw", pan=(n - 39) * 0.14, attack=0.12, release=0.6, vibrato=0.006)
    mix.noise(0.0, 1.3, 0.13, "low")
    mix.bell(50, 0.18, 2.1, 0.12)
    return finalize(mix, 0.04)


def sfx_boss_roar() -> np.ndarray:
    mix = Mix(2.0)
    n = int(1.9 * SR)
    t = np.arange(n) / SR
    carrier = (
        np.sin(2 * np.pi * (58 - 12 * t) * t)
        + 0.45 * np.sin(2 * np.pi * (91 - 17 * t) * t)
        + 0.3 * np.sin(2 * np.pi * (131 - 22 * t) * t)
    )
    grit = RNG.standard_normal(n)
    width = max(2, int(0.0022 * SR))
    grit = np.convolve(grit, np.ones(width) / width, mode="same")
    trem = 0.62 + 0.38 * np.sin(2 * np.pi * (7.0 + 3.5 * t) * t) ** 2
    env = np.sin(np.pi * np.clip(t / 1.9, 0, 1)) ** 0.55
    mix.add((0.65 * carrier + 0.7 * grit) * trem * env, 0.02, 0.36)
    mix.taiko(0.0, 0.25, 32)
    return finalize(mix, 0.03)


def sfx_boss_defeat() -> np.ndarray:
    mix = Mix(2.8)
    mix.taiko(0.0, 0.55, 38)
    mix.taiko(0.28, 0.33, 32)
    for i, n in enumerate((48, 43, 38, 31)):
        mix.tone(n, i * 0.34, 1.35, 0.18, "saw", pan=(-0.25 + i * 0.16), attack=0.02, release=0.55, vibrato=0.004)
    mix.noise(0.05, 1.9, 0.18, "low")
    mix.noise(0.0, 0.24, 0.2, "white")
    return finalize(mix, 0.05)


def sfx_victory() -> np.ndarray:
    mix = Mix(3.35)
    phrases = [(60, 64, 67), (65, 69, 72), (67, 71, 74), (72, 76, 79)]
    for i, chord in enumerate(phrases):
        start = i * 0.48
        for j, n in enumerate(chord):
            mix.tone(n, start, 0.52 if i < 3 else 1.45, 0.13, "saw", pan=(-0.32 + j * 0.32), attack=0.025, release=0.23)
            mix.bell(n + 12, start + 0.02, 0.65 if i < 3 else 1.35, 0.08, pan=(0.28 - j * 0.28))
        mix.taiko(start, 0.14 if i < 3 else 0.24, 54 if i < 3 else 46)
    return finalize(mix, 0.04)


def sfx_attack(kind: str) -> np.ndarray:
    durations = {"sword": 0.72, "heavy": 0.9, "arrow": 0.72, "magic": 1.1, "holy": 1.25}
    mix = Mix(durations[kind])
    if kind == "sword":
        mix.noise(0.0, 0.28, 0.32, "pink", -0.25)
        mix.bell(83, 0.17, 0.43, 0.24, 0.3)
        mix.taiko(0.23, 0.18, 72)
    elif kind == "heavy":
        mix.noise(0.0, 0.36, 0.28, "pink", -0.18)
        mix.taiko(0.28, 0.58, 42)
        mix.noise(0.29, 0.18, 0.2, "white", 0.2)
    elif kind == "arrow":
        mix.pluck(50, 0.0, 0.22, 0.42, -0.3)
        mix.tone(91, 0.07, 0.36, 0.17, "sine", 0.35, 0.005, 0.12)
        mix.noise(0.08, 0.24, 0.12, "pink", 0.35)
        mix.taiko(0.38, 0.12, 78)
    elif kind == "magic":
        for i, n in enumerate((72, 79, 84, 91)):
            mix.bell(n, i * 0.08, 0.72, 0.18, -0.45 + i * 0.3)
        mix.noise(0.16, 0.6, 0.17, "pink")
        mix.taiko(0.52, 0.18, 64)
    else:
        for i, n in enumerate((67, 74, 79, 86)):
            mix.bell(n, i * 0.12, 1.0, 0.22, -0.4 + i * 0.27)
        mix.tone(55, 0.0, 1.0, 0.1, "sine", attack=0.08, release=0.45)
        mix.noise(0.35, 0.45, 0.08, "pink")
    return finalize(mix, 0.015)


def write_wav(path: Path, audio: np.ndarray) -> None:
    pcm = (np.clip(audio, -1, 1) * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(SR)
        out.writeframes(pcm.tobytes())


def encode_mp3(audio: np.ndarray, target: Path, bitrate: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="hf-audio-") as tmp:
        wav_path = Path(tmp) / "source.wav"
        write_wav(wav_path, audio)
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(wav_path), "-codec:a", "libmp3lame", "-b:a", bitrate,
                "-ar", str(SR), str(target),
            ],
            check=True,
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "assets" / "audio")
    args = parser.parse_args()
    jobs = {
        "bgm/home.mp3": (bgm_home, "112k"),
        "bgm/pick.mp3": (bgm_pick, "112k"),
        "bgm/battle.mp3": (bgm_battle, "128k"),
        "sfx/ui_click.mp3": (sfx_ui_click, "64k"),
        "sfx/ui_lock.mp3": (sfx_ui_lock, "80k"),
        "sfx/ui_whoosh.mp3": (sfx_ui_whoosh, "80k"),
        "sfx/wheel_hit.mp3": (sfx_wheel_hit, "80k"),
        "sfx/smoke_burst.mp3": (sfx_smoke, "80k"),
        "sfx/reveal_chime.mp3": (sfx_reveal, "96k"),
        "sfx/boss_stinger.mp3": (sfx_boss_stinger, "96k"),
        "sfx/boss_roar.mp3": (sfx_boss_roar, "96k"),
        "sfx/boss_defeat.mp3": (sfx_boss_defeat, "96k"),
        "sfx/victory_fanfare.mp3": (sfx_victory, "112k"),
        "sfx/attack_sword.mp3": (lambda: sfx_attack("sword"), "80k"),
        "sfx/attack_heavy.mp3": (lambda: sfx_attack("heavy"), "80k"),
        "sfx/attack_arrow.mp3": (lambda: sfx_attack("arrow"), "80k"),
        "sfx/attack_magic.mp3": (lambda: sfx_attack("magic"), "80k"),
        "sfx/attack_holy.mp3": (lambda: sfx_attack("holy"), "80k"),
    }
    for rel, (build, bitrate) in jobs.items():
        target = args.output / rel
        encode_mp3(build(), target, bitrate)
        print(f"generated {target.relative_to(args.output)}")


if __name__ == "__main__":
    main()
