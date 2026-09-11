#!/usr/bin/env python3
"""從**原始素材**重做高畫質行動版影片（1080 寬）。**必須在睿哥的 Mac 上跑。**

## 為什麼需要這支工具

`tools/recompress_videos.py` 只會把 `assets/videos/mobile/` 裡的檔案壓得更小，
**它救不了畫質** —— 重壓一個已經壓過的檔案不會還原任何細節，只會變大。

2026-09-11 量到的真正瓶頸（`BRAIN.md` 地雷區 ㉒）：

    所有素材都只有 720 寬，而睿哥的 iPhone 約 1170 實體像素
    → 影片一直被放大 1.6 倍，加碼率救不了放大造成的糊

唯一的解法是**用原始素材重編成 1080 寬**。原始檔只在睿哥的 Mac／Google Drive
（repo 裡只有壓好的 `mobile/` 與 `poster/`），所以**雲端 session 做不到這件事**。

## 怎麼用

    # 單支
    python3 tools/upgrade_from_source.py --src ~/Downloads/arrival_原片.mp4 \
                                         --dest boss/arrival

    # 整個資料夾（檔名要跟目標一致，例如 paladin.mp4 → final/paladin）
    python3 tools/upgrade_from_source.py --src ~/Drive/最後一擊 --kind final

    # 先看會做什麼，不真的動檔案
    python3 tools/upgrade_from_source.py --src ... --kind final --dry-run

做完會自動：重製 poster（該類需要的話）、跑 `gen_asset_versions.py` 與
`sync_build.py`。**接著還要自己做兩件事**：把 `index.html` 的 `.build-stamp`
往上跳一版，然後 `git push`（沒 push 睿哥手機看不到）。

## 幾個不能省的參數

- `-map 0:v:0`：Sora 原片常夾一軌 mjpeg 封面圖，不指定的話 ffmpeg 可能挑錯軌
  （v1.55 被咬過）。
- `-profile:v high`：1080 寬用 high profile 比 main 省，iOS 完全支援。
- `+faststart`：moov 放前面，邊下載邊播才不會等整支。
- **不放大**：來源若小於目標寬度就維持原寬。把 720 的素材拉成 1080 只會更糊更大。
"""

import argparse
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
MOBILE = ROOT / "assets" / "videos" / "mobile"
POSTER = ROOT / "assets" / "videos" / "poster"
# 這幾類在影片載入前會先顯示 poster 首幀，換片就一定要重製
POSTER_KINDS = {"attack", "final", "victory", "boss", "order", "teams"}
POSTER_WIDTH = 400
TARGET_WIDTH = 1080
CRF = "21"          # 1080 寬的視覺無損區間；720 用 29〜32 是因為要遷就 4G


def ff() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg") or "ffmpeg"


def probe(path: pathlib.Path):
    err = subprocess.run([ff(), "-i", str(path)], capture_output=True, text=True).stderr
    dim = re.search(r", (\d{2,5})x(\d{2,5})", err)
    br = re.search(r"bitrate: (\d+) kb/s", err)
    dur = re.search(r"Duration: \d+:(\d+):([\d.]+)", err)
    secs = int(dur.group(1)) * 60 + float(dur.group(2)) if dur else 0.0
    w = int(dim.group(1)) if dim else 0
    h = int(dim.group(2)) if dim else 0
    return w, h, secs, int(br.group(1)) if br else 0


def encode(src: pathlib.Path, dst: pathlib.Path, width: int, crf: str) -> None:
    sw, _, _, _ = probe(src)
    # ⚠️ 來源比目標窄就不要放大 —— 放大只會更糊、檔案還更大
    target = min(width, sw) if sw else width
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".tmp.mp4")
    cmd = [
        ff(), "-y", "-i", str(src),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-c:v", "libx264", "-crf", crf, "-preset", "slow",
        "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-vf", f"scale={target}:-2",
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
    dst.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [ff(), "-y", "-ss", "0.1", "-i", str(video), "-frames:v", "1",
         "-vf", f"scale={POSTER_WIDTH}:-2", "-q:v", "4", str(dst)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise SystemExit(f"poster 產生失敗：{video}\n{r.stderr[-800:]}")


def jobs_from_args(a) -> list:
    """回傳 [(來源檔, 'kind/name')]。"""
    src = pathlib.Path(a.src).expanduser()
    if not src.exists():
        raise SystemExit(f"找不到來源：{src}")
    if src.is_file():
        if not a.dest:
            raise SystemExit("單檔模式要用 --dest 指定目標，例如 --dest boss/arrival")
        return [(src, a.dest)]
    if not a.kind:
        raise SystemExit("資料夾模式要用 --kind 指定片型，例如 --kind final")
    out = []
    for f in sorted(src.iterdir()):
        if f.suffix.lower() in (".mp4", ".mov", ".m4v", ".webm"):
            out.append((f, f"{a.kind}/{f.stem}"))
    if not out:
        raise SystemExit(f"{src} 裡沒有影片檔")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="從原始素材重做 1080 寬的高畫質行動版")
    ap.add_argument("--src", required=True, help="原始影片檔，或裝著原始影片的資料夾")
    ap.add_argument("--dest", help="單檔模式的目標，格式 kind/name（例：boss/arrival）")
    ap.add_argument("--kind", help="資料夾模式的片型（wait/confirm/attack/final/victory/boss/order/teams）")
    ap.add_argument("--width", type=int, default=TARGET_WIDTH, help=f"目標寬度（預設 {TARGET_WIDTH}）")
    ap.add_argument("--crf", default=CRF, help=f"畫質，越小越好（預設 {CRF}）")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    jobs = jobs_from_args(a)
    print(f"目標寬度 {a.width}、CRF {a.crf}，共 {len(jobs)} 支\n")
    changed = []
    for src, dest in jobs:
        dst = MOBILE / f"{dest}.mp4"
        sw, sh, ssec, sbr = probe(src)
        old = f"{dst.stat().st_size // 1024} KB" if dst.exists() else "（新檔）"
        ow, oh, _, obr = probe(dst) if dst.exists() else (0, 0, 0, 0)
        print(f"  {dest}")
        print(f"    來源 {sw}x{sh} {sbr} kb/s {ssec:.2f}s")
        print(f"    現況 {ow}x{oh} {obr} kb/s {old}")
        if sw and sw < a.width:
            print(f"    ⚠️ 來源只有 {sw} 寬，比目標窄 —— 維持 {sw}，不放大")
        if a.dry_run:
            print("    （dry-run，未寫入）\n")
            continue
        encode(src, dst, a.width, a.crf)
        nw, nh, _, nbr = probe(dst)
        print(f"    完成 {nw}x{nh} {nbr} kb/s {dst.stat().st_size // 1024} KB")
        kind = dest.split("/")[0]
        if kind in POSTER_KINDS:
            p = POSTER / f"{dest}.jpg"
            make_poster(dst, p)
            print(f"    poster 已重製 {p.relative_to(ROOT)}")
        changed.append(dest)
        print()

    if a.dry_run or not changed:
        return
    for tool in ("gen_asset_versions.py", "sync_build.py"):
        print(f"→ {tool}")
        subprocess.run([sys.executable, str(ROOT / "tools" / tool)], check=True)
    print("\n還要自己做：①把 index.html 的 .build-stamp 往上跳一版 ②git push")


if __name__ == "__main__":
    main()
