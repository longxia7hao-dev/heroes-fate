#!/usr/bin/env python3
"""把 `assets/videos/mobile/` 底下的影片整批重壓，換取更小的體積。

**為什麼**：一場 4 人魔王討伐要抓約 9.7MB 影片，睿哥是弱訊號 4G。
影片快取這條路已經封死（專案鐵則第 6 條：iOS Safari 上 `<video>` 走
Service Worker 會整個播不動），所以「把檔案變小」是目前唯一安全的手段。

**⚠️ 這是二次壓縮。** 現行檔案本身已經是 CRF 29 壓過的，再壓一次畫質會比
「從 Drive 原片直接壓」差。真的在意畫質就回本機用 `replace_hero_videos.py`
從原片重做。

**保護機制**：壓完比原本大就丟掉、保留原檔（粒子多的片子有可能發生）。

用法：

    python3 tools/recompress_videos.py --crf 32           # 全部
    python3 tools/recompress_videos.py --crf 32 --kinds wait confirm
    python3 tools/recompress_videos.py --crf 32 --dry-run # 只估，不動檔案
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
MOBILE = ROOT / "assets" / "videos" / "mobile"


def ff() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def info(path: pathlib.Path) -> tuple[int, int, float, bool]:
    err = subprocess.run([ff(), "-i", str(path)], capture_output=True, text=True).stderr
    dim = re.search(r", (\d{2,5})x(\d{2,5})", err)
    dur = re.search(r"Duration: \d+:(\d+):([\d.]+)", err)
    secs = int(dur.group(1)) * 60 + float(dur.group(2)) if dur else 0.0
    w, h = (int(dim.group(1)), int(dim.group(2))) if dim else (0, 0)
    return w, h, secs, "Audio:" in err


def recompress(src: pathlib.Path, crf: str) -> tuple[int, int, str]:
    """回傳 (舊大小, 新大小, 說明)。壓不贏就保留原檔。"""
    before = src.stat().st_size
    w, _h, _s, has_audio = info(src)
    tmp = src.with_suffix(".recomp.mp4")
    cmd = [
        ff(), "-y", "-i", str(src),
        "-map", "0:v:0",
    ]
    if has_audio:
        cmd += ["-map", "0:a:0"]
    cmd += [
        "-c:v", "libx264", "-crf", crf, "-preset", "slow",
        "-profile:v", "main", "-pix_fmt", "yuv420p",
    ]
    # 已經是 720 寬就不要再 scale —— 多做一次縮放只會多糊一層，什麼都不會省
    if w and w != 720:
        cmd += ["-vf", "scale=720:-2"]
    if has_audio:
        cmd += ["-c:a", "aac", "-b:a", "64k", "-ac", "2"]
    else:
        cmd += ["-an"]
    cmd += ["-movflags", "+faststart", str(tmp)]

    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        return before, before, "轉檔失敗，保留原檔"
    after = tmp.stat().st_size
    if after >= before:
        tmp.unlink(missing_ok=True)
        return before, before, "壓不贏，保留原檔"
    # 完整解碼驗一次再換上去，免得換進一個壞檔
    chk = subprocess.run([ff(), "-v", "error", "-i", str(tmp), "-f", "null", "-"],
                         capture_output=True, text=True)
    if chk.stderr.strip():
        tmp.unlink(missing_ok=True)
        return before, before, "新檔解碼有問題，保留原檔"
    shutil.move(str(tmp), str(src))
    return before, after, ""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--crf", default="32")
    ap.add_argument("--kinds", nargs="*", default=None, help="只處理這幾類（預設全部）")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    files = sorted(MOBILE.glob("**/*.mp4"))
    if args.kinds:
        files = [f for f in files if f.parent.name in args.kinds]
    if not files:
        raise SystemExit("找不到影片")

    print(f"CRF {args.crf}，共 {len(files)} 支\n")
    tot_b = tot_a = 0
    kept = 0
    for f in files:
        rel = f.relative_to(MOBILE)
        if args.dry_run:
            tot_b += f.stat().st_size
            print(f"  {str(rel):<32}{f.stat().st_size/1024:>8.0f}K")
            continue
        b, a, note = recompress(f, args.crf)
        tot_b += b
        tot_a += a
        if note:
            kept += 1
            print(f"  {str(rel):<32}{b/1024:>8.0f}K  → {note}")
        else:
            print(f"  {str(rel):<32}{b/1024:>8.0f}K → {a/1024:>7.0f}K  −{(1-a/b)*100:.0f}%")
    if args.dry_run:
        print(f"\n目前合計 {tot_b/1048576:.1f}MB")
        return
    print(f"\n合計 {tot_b/1048576:.1f}MB → {tot_a/1048576:.1f}MB（−{(1-tot_a/tot_b)*100:.0f}%）"
          + (f"，其中 {kept} 支保留原檔" if kept else ""))
    print("\n記得跑：python3 tools/gen_asset_versions.py，並把 MEDIA_VERSION 與版本印記 +1")


if __name__ == "__main__":
    main()
