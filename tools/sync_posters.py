#!/usr/bin/env python3
"""把 `assets/videos/poster/` 重新對齊目前的 `assets/videos/mobile/` 影片。

**為什麼需要這支工具**：poster 是切入層在影片變成可播之前顯示的那張圖，
所以它必須是**該支影片現在的首幀**。但 `recompress_videos.py` 只換影片、
不碰 poster —— 2026-09-11（v1.101）整庫重壓 CRF 32 之後，45 張 poster 全部
還是 2026-08-13 從舊編碼抽出來的，於是：

  ① 每一張 poster 都跟影片首幀對不上，載入時會看到一下跳格；
  ② 更糟的是「分享結果」卡片直接畫 `poster/victory/<id>.jpg` 當主圖，
     dark_mage／paladin／princess 三支剛好抽到**閉眼**的那一格，
     睿哥拿到的分享圖角色是閉著眼睛的。

參數跟 `replace_hero_videos.py` / `upgrade_from_source.py` 的 `make_poster()`
**必須完全一致**（`-ss 0.1`、`scale=400:-2`、`-q:v 4`），不然每次跑都會
無謂地改動所有檔案。

用法：

    python3 tools/sync_posters.py              # 全部對齊
    python3 tools/sync_posters.py --kinds victory final
    python3 tools/sync_posters.py --check      # 只檢查，有落差就 exit 1（給 CI／收工前用）
"""

from __future__ import annotations

import argparse
import hashlib
import pathlib
import subprocess
import sys
import tempfile

import imageio_ffmpeg

ROOT = pathlib.Path(__file__).resolve().parents[1]
MOBILE = ROOT / "assets" / "videos" / "mobile"
POSTER = ROOT / "assets" / "videos" / "poster"
# 這幾類在影片載入前會先顯示 poster 首幀（跟 upgrade_from_source.py 同一份名單）
POSTER_KINDS = {"attack", "final", "victory", "boss", "order", "teams"}
POSTER_WIDTH = 400
SEEK = "0.1"


def ff() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def render(video: pathlib.Path, dst: pathlib.Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [ff(), "-y", "-loglevel", "error", "-ss", SEEK, "-i", str(video),
         "-frames:v", "1", "-vf", f"scale={POSTER_WIDTH}:-2", "-q:v", "4", str(dst)],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not dst.exists():
        raise SystemExit(f"poster 產生失敗：{video}\n{r.stderr[-800:]}")


def digest(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kinds", nargs="*", help=f"只處理這幾類，預設全部：{sorted(POSTER_KINDS)}")
    ap.add_argument("--check", action="store_true", help="只比對不寫檔；有落差 exit 1")
    args = ap.parse_args()

    kinds = set(args.kinds) if args.kinds else POSTER_KINDS
    bad = kinds - POSTER_KINDS
    if bad:
        raise SystemExit(f"這幾類不需要 poster：{sorted(bad)}")

    videos = [v for v in sorted(MOBILE.glob("**/*.mp4")) if v.parent.name in kinds]
    if not videos:
        raise SystemExit("找不到影片")

    changed: list[str] = []
    missing: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        for v in videos:
            rel = v.relative_to(MOBILE).with_suffix(".jpg")
            dst = POSTER / rel
            if args.check:
                if not dst.exists():
                    missing.append(str(rel))
                    continue
                tmp = pathlib.Path(td) / "probe.jpg"
                render(v, tmp)
                if digest(tmp) != digest(dst):
                    changed.append(str(rel))
            else:
                before = digest(dst) if dst.exists() else None
                render(v, dst)
                if before is None:
                    missing.append(str(rel))
                elif digest(dst) != before:
                    changed.append(str(rel))

    for rel in missing:
        print(f"  新增 {rel}")
    for rel in changed:
        print(f"  {'落差' if args.check else '重製'} {rel}")

    total = len(videos)
    if args.check:
        if changed or missing:
            print(f"\n✗ {len(changed) + len(missing)}/{total} 張 poster 跟影片對不上。"
                  "\n  跑 `python3 tools/sync_posters.py` 修正。")
            sys.exit(1)
        print(f"✓ {total} 張 poster 都跟影片一致")
        return

    if changed or missing:
        print(f"\n{len(changed) + len(missing)}/{total} 張已更新。"
              "\n記得跑：python3 tools/gen_asset_versions.py，並把版本印記 +1、跑 tools/sync_build.py")
    else:
        print(f"✓ {total} 張 poster 本來就跟影片一致，沒有動到任何檔案")


if __name__ == "__main__":
    main()
