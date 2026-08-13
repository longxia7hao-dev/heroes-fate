#!/usr/bin/env python3
"""把睿哥提供的場景配樂匯入成遊戲用的 MP3。

為什麼需要這支：`js/audioDirector.js` 的 `crossfadeMusic()` 是
**`source.loop = true` 的硬循環，接縫沒有任何交叉淡化** —— 直接丟一首
30 秒的曲子進去，每次循環到尾端都會「啪」一聲跳回開頭。所以匯入時要先
把尾巴摺回開頭做成無縫循環，順便對齊響度。

三件事：

  1. **無縫循環**：取末尾 `--crossfade` 秒淡出，疊回開頭同長度的淡入段，
     再把重疊掉的尾巴切掉。循環點因此聽不出接縫。
  2. **響度對齊**：以 RMS dBFS 為準（不是真 LUFS，但這批素材夠用）。
     選角曲要對齊 **14 首角色 BGM 的 -18 dBFS** —— 點角色時是它們互相
     交叉淡化，不對齊會「一點角色音樂就變小聲」。
  3. **輸出 MP3**：由 lameenc 直接編碼，不需要 ffmpeg（雲端 session 沒有）。

用法：

    python3 tools/import_scene_bgm.py \\
        --src 來源.mp3 --out assets/audio/bgm/pick.mp3 --target-db -18

    # 只取其中一段（魔王降臨那段只有 7 秒左右，不必整首）
    python3 tools/import_scene_bgm.py --src 來源.mp3 --out ... --start 0 --length 14

需要 numpy / miniaudio / lameenc。**匯入後記得跑 `tools/gen_asset_versions.py`**，
否則手機會吃到舊快取。
"""

from __future__ import annotations

import argparse
from pathlib import Path

import lameenc
import miniaudio
import numpy as np


def load(path: Path) -> tuple[np.ndarray, int]:
    d = miniaudio.decode_file(str(path))
    audio = np.array(d.samples, dtype=np.float32).reshape(-1, d.nchannels) / 32768.0
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)
    return audio.astype(np.float64), d.sample_rate


def dbfs(x: np.ndarray) -> float:
    return 20.0 * np.log10(np.sqrt((x ** 2).mean()) + 1e-12)


def seamless_loop(audio: np.ndarray, sr: int, seconds: float) -> np.ndarray:
    """把尾巴摺回開頭，讓 `loop = true` 的硬循環聽不出接縫。"""
    x = int(seconds * sr)
    if x <= 0 or len(audio) <= 2 * x:
        return audio
    fade = np.linspace(0.0, 1.0, x)[:, None]
    head = audio[:x] * fade + audio[-x:] * (1.0 - fade)
    return np.concatenate([head, audio[x:-x]])


def normalize(audio: np.ndarray, target_db: float, ceiling: float = 0.95) -> np.ndarray:
    audio = audio * (10.0 ** ((target_db - dbfs(audio)) / 20.0))
    peak = np.max(np.abs(audio))
    if peak > ceiling:
        # 峰值超標時整體壓下來，寧可比目標小聲，也不要削頂失真
        audio = audio * (ceiling / peak)
    return audio


def encode_mp3(audio: np.ndarray, target: Path, bitrate: int, sr: int) -> None:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
    enc = lameenc.Encoder()
    enc.set_bit_rate(bitrate)
    enc.set_in_sample_rate(sr)
    enc.set_channels(2)
    enc.set_quality(2)
    data = enc.encode(pcm.tobytes()) + enc.flush()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(bytes(data))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--start", type=float, default=0.0, help="從第幾秒開始取")
    ap.add_argument("--length", type=float, default=0.0, help="取幾秒（0＝到結尾）")
    ap.add_argument("--target-db", type=float, default=-16.5)
    ap.add_argument("--crossfade", type=float, default=2.0,
                    help="無縫循環的重疊秒數；一次性音效請給 0")
    ap.add_argument("--fade-out", type=float, default=0.0,
                    help="結尾淡出秒數。一次性音效（例如勝利號）用得到 —— "
                         "從樂句中間切斷會很突兀，循環用的曲子則不需要")
    ap.add_argument("--bitrate", type=int, default=112)
    args = ap.parse_args()

    audio, sr = load(Path(args.src))
    original = len(audio) / sr

    a = int(args.start * sr)
    b = len(audio) if args.length <= 0 else min(len(audio), a + int(args.length * sr))
    audio = audio[a:b]

    before_db = dbfs(audio)
    audio = seamless_loop(audio, sr, args.crossfade)
    if args.fade_out > 0:
        f = min(len(audio), int(args.fade_out * sr))
        audio[-f:] *= np.linspace(1.0, 0.0, f)[:, None]
    audio = normalize(audio, args.target_db)

    out = Path(args.out)
    encode_mp3(audio, out, args.bitrate, sr)
    print(
        f"{out.name:<20} 原曲 {original:5.1f}s → {len(audio) / sr:5.1f}s"
        f"  {before_db:6.1f} → {dbfs(audio):6.1f} dBFS"
        f"  峰值 {np.max(np.abs(audio)):.2f}"
        f"  {out.stat().st_size / 1024:6.1f} KB"
    )


if __name__ == "__main__":
    main()
