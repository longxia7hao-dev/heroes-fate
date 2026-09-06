#!/usr/bin/env python3
"""換掉某個角色的影片，並把所有跟著要動的東西一次做完。

**為什麼要有這支工具**：換角色影片不是「複製檔案過去」就好，這個專案有四層
會一起壞掉（CLAUDE.md「三個最常踩的坑」記過前兩層）：

  1. 原片碼率／尺寸跟現行不一致 → 手機上變更慢
  2. **poster 沒重製** → 影片載入前會先閃一張舊角色的圖
  3. `assets/versions` 沒重算 → 手機吃到舊快取，看到的還是舊影片
  4. `MEDIA_VERSION`／版本印記沒 +1 → 同上

用法（來源檔名要含 kind，或用 --map 指定）：

    python3 tools/replace_hero_videos.py monk \
        --wait ~/新的/待機.mp4 --confirm ~/新的/確認.mp4 \
        --attack ~/新的/攻擊.mp4 --final ~/新的/final.mp4 \
        --victory ~/新的/勝利.mp4

只換其中幾支也可以，沒給的就不動。跑完會印出「還要手動做什麼」。

編碼參數是**照現行檔案量出來的**，不是憑空定的：
  - 直式片 720×1270 前後、約 3.04s、H.264 main / yuv420p、AAC 64k、faststart
  - final 約 10s
  - CRF 29（v1.36 定的行動版基準；實測 CRF 32 只再小三成但會賠畫質）
"""

from __future__ import annotations

import argparse
import pathlib
import re
import shutil
import subprocess
import sys

import imageio_ffmpeg

ROOT = pathlib.Path(__file__).resolve().parents[1]
KINDS = ["wait", "confirm", "attack", "final", "victory"]
# 只有這三種在演出中會先顯示 poster（切入層在影片載入前的首幀）
POSTER_KINDS = {"attack", "final", "victory"}
CRF = "29"
POSTER_WIDTH = 400


def ff() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def probe(path: pathlib.Path) -> str:
    err = subprocess.run([ff(), "-i", str(path)], capture_output=True, text=True).stderr
    dim = re.search(r", (\d{2,4})x(\d{2,4})", err)
    dur = re.search(r"Duration: \d+:(\d+):([\d.]+)", err)
    secs = int(dur.group(1)) * 60 + float(dur.group(2)) if dur else 0
    return f"{dim.group(0)[2:] if dim else '?'}  {secs:.2f}s"


def encode(src: pathlib.Path, dst: pathlib.Path) -> None:
    """轉成跟現行行動版一致的規格。寬度統一 720，高度維持原比例（-2 保證偶數）。"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".tmp.mp4")
    cmd = [
        ff(), "-y", "-i", str(src),
        "-c:v", "libx264", "-crf", CRF, "-preset", "slow",
        "-profile:v", "main", "-pix_fmt", "yuv420p",
        "-vf", "scale=720:-2",
        "-c:a", "aac", "-b:a", "64k", "-ac", "2",
        "-movflags", "+faststart",
        str(tmp),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"轉檔失敗：{src}\n{r.stderr[-1500:]}")
    shutil.move(str(tmp), str(dst))


def make_poster(video: pathlib.Path, dst: pathlib.Path) -> None:
    """重製首幀 poster。**忘了做就會在影片出現前先閃一張舊角色圖。**"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [ff(), "-y", "-ss", "0.1", "-i", str(video), "-frames:v", "1",
         "-vf", f"scale={POSTER_WIDTH}:-2", "-q:v", "4", str(dst)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise SystemExit(f"poster 產生失敗：{video}\n{r.stderr[-800:]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("hero", help="角色 id，例如 monk")
    for k in KINDS:
        ap.add_argument(f"--{k}", type=pathlib.Path, help=f"{k} 的來源影片")
    args = ap.parse_args()

    jobs = [(k, getattr(args, k)) for k in KINDS if getattr(args, k)]
    if not jobs:
        raise SystemExit("至少要給一支影片（--wait / --confirm / --attack / --final / --victory）")
    for _, src in jobs:
        if not src.exists():
            raise SystemExit(f"找不到來源檔：{src}")

    print(f"角色：{args.hero}\n")
    for kind, src in jobs:
        dst = ROOT / f"assets/videos/mobile/{kind}/{args.hero}.mp4"
        before = probe(dst) + f"  {dst.stat().st_size/1024:.0f}K" if dst.exists() else "(原本沒有)"
        print(f"[{kind}] 來源 {probe(src)}  {src.stat().st_size/1024/1024:.1f}M")
        encode(src, dst)
        print(f"        舊：{before}")
        print(f"        新：{probe(dst)}  {dst.stat().st_size/1024:.0f}K")
        if kind in POSTER_KINDS:
            poster = ROOT / f"assets/videos/poster/{kind}/{args.hero}.jpg"
            make_poster(dst, poster)
            print(f"        poster 已重製：{poster.relative_to(ROOT)}  {poster.stat().st_size/1024:.0f}K")
        print()

    print("重算逐檔雜湊表…")
    subprocess.run([sys.executable, str(ROOT / "tools/gen_asset_versions.py")], check=True)

    print("\n── 還要手動做的 ──")
    print("  1. js/videoPlayer.js 的 MEDIA_VERSION +1")
    print("  2. index.html 的 .build-stamp 換新版本號")
    print("  3. python3 tools/sync_build.py")
    print("  4. git add -A && git commit && git push（不 push 手機看不到）")
    if any(k in ("attack", "victory") for k, _ in jobs):
        print("  5. 音效若也要跟著換：python3 tools/extract_sora_audio.py（attack／victory 的音軌）")


if __name__ == "__main__":
    main()
