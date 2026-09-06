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
import datetime
import os
import pathlib
import re
import shutil
import subprocess
import sys

import imageio_ffmpeg

ROOT = pathlib.Path(__file__).resolve().parents[1]
KINDS = ["wait", "confirm", "attack", "final", "victory"]

# Drive「角色圖」底下的子夾名稱 →  專案裡的 kind。
# 名稱是從 tools/extract_sora_audio.py 與 PROJECT_NOTES 的歷次紀錄挖出來的。
DRIVE_FOLDERS = {
    "wait": "角色等待選擇動畫",
    "confirm": "角色確定選擇動畫",
    "attack": "攻擊魔王動畫",
    "final": "最終戰勝者對戰動畫",
    "victory": "角色勝利動畫",
}
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


def encode(src: pathlib.Path, dst: pathlib.Path, crf: str = CRF) -> None:
    """轉成跟現行行動版一致的規格。寬度統一 720，高度維持原比例（-2 保證偶數）。

    `-map 0:v:0` 不能省：Sora 的原片常夾一軌 mjpeg 封面圖，不指定的話
    ffmpeg 的預設選片規則（挑解析度最高的，同分才取索引小的）會變成
    「剛好沒出事」而不是「保證正確」。v1.55 就被這個咬過。
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".tmp.mp4")
    cmd = [
        ff(), "-y", "-i", str(src),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-c:v", "libx264", "-crf", crf, "-preset", "slow",
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


def extract_sfx(src: pathlib.Path, hero: str, kind: str) -> pathlib.Path | None:
    """從新影片的音軌重抽招式／勝利音效。

    參數跟 `tools/extract_sora_audio.py` **必須完全一致**，否則這一支的音量
    會跟其他角色對不上：`atempo=1.3`（演出就是 1.3 倍速播）＋
    `loudnorm=I=-18:LRA=7:TP=-1.5`，mp3 96k / 32kHz。
    實測 14 支都會落在 -18.4〜-18.2 LUFS。
    """
    if kind not in ("attack", "victory"):
        return None
    dst = ROOT / f"assets/audio/heroes/{kind}/{hero}.mp3"
    r = subprocess.run(
        [ff(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
         "-map", "0:a:0", "-vn",
         "-af", "atempo=1.3,loudnorm=I=-18:LRA=7:TP=-1.5",
         "-codec:a", "libmp3lame", "-b:a", "96k", "-ar", "32000", str(dst)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"        ⚠️ 音效抽取失敗（來源可能沒有音軌）：{r.stderr[-200:].strip()}")
        return None
    return dst


def finish(stamp: str | None) -> None:
    """把「換完影片一定要做、忘了手機就看不到」那幾件事做完。

    這三層在 CLAUDE.md 都有記，而且各自都足以讓玩家看到舊影片：
      - `MEDIA_VERSION`（videoPlayer.js）
      - `index.html` 裡 videoPlayer.js 的 `?v=`
      - 版本印記 ＋ `build.txt`（沒同步就不會跳「有新版本」）
    """
    vp = ROOT / "js/videoPlayer.js"
    txt = vp.read_text(encoding="utf-8")
    m = re.search(r'const MEDIA_VERSION = "(\d+)";', txt)
    if not m:
        raise SystemExit("找不到 MEDIA_VERSION，請手動處理")
    new_media = str(int(m.group(1)) + 1)
    vp.write_text(txt.replace(m.group(0), f'const MEDIA_VERSION = "{new_media}";'), encoding="utf-8")
    print(f"  MEDIA_VERSION {m.group(1)} → {new_media}")

    html = ROOT / "index.html"
    h = html.read_text(encoding="utf-8")
    mv = re.search(r"js/videoPlayer\.js\?v=(\d+)", h)
    if mv:
        h = h.replace(mv.group(0), f"js/videoPlayer.js?v={int(mv.group(1)) + 1}")
        print(f"  videoPlayer.js?v={mv.group(1)} → {int(mv.group(1)) + 1}")

    ms = re.search(r'(<p class="build-stamp" id="build-stamp">)v(\d+)\.(\d+)[^<]*(</p>)', h)
    if ms:
        if stamp:
            new_stamp = stamp
        else:
            new_stamp = (f"v{ms.group(2)}.{int(ms.group(3)) + 1} · "
                         + datetime.datetime.now().strftime("%m%d-%H%M"))
        h = h.replace(ms.group(0), f"{ms.group(1)}{new_stamp}{ms.group(4)}")
        print(f"  版本印記 → {new_stamp}")
    html.write_text(h, encoding="utf-8")

    subprocess.run([sys.executable, str(ROOT / "tools/gen_asset_versions.py")], check=True)
    subprocess.run([sys.executable, str(ROOT / "tools/sync_build.py")], check=True)


def drive_root() -> pathlib.Path:
    """Drive 素材夾位置。跟 tools/extract_sora_audio.py 用同一套尋找邏輯。

    刻意不寫死帳號路徑（本專案是公開 repo，不放個人信箱）。
    """
    env = os.environ.get("HF_DRIVE_ROOT")
    if env:
        return pathlib.Path(env)
    for mount in sorted(pathlib.Path.home().glob("Library/CloudStorage/GoogleDrive-*/我的雲端硬碟")):
        for folder in ("英雄命運抽（heroes fate)", "英雄旅途"):
            candidate = mount / folder / "角色圖"
            if candidate.is_dir():
                return candidate
    raise SystemExit(
        "找不到素材夾。請設環境變數 HF_DRIVE_ROOT 指向 Google Drive 的「角色圖」資料夾。"
    )


def scan(out_dir: pathlib.Path) -> None:
    """列出 Drive 五個子夾的內容（新到舊），並抽一張首幀方便辨識是哪個角色。

    **為什麼需要這步**：Drive 裡的檔名是 Sora 產生的 UUID，看不出是誰。
    歷次換素材都得先抽幀用眼睛認（PROJECT_NOTES 有紀錄）。這裡一次做完。
    """
    root = drive_root()
    print(f"素材夾：{root}\n")
    out_dir.mkdir(parents=True, exist_ok=True)
    for kind, folder in DRIVE_FOLDERS.items():
        d = root / folder
        if not d.is_dir():
            print(f"[{kind}] 找不到 {folder}")
            continue
        vids = sorted(
            [f for f in d.iterdir() if f.suffix.lower() in (".mp4", ".mov")],
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        print(f"[{kind}] {folder}　共 {len(vids)} 支（新到舊）")
        for i, f in enumerate(vids[:6]):
            thumb = out_dir / f"{kind}_{i}_{f.stem[:16]}.jpg"
            subprocess.run(
                [ff(), "-y", "-ss", "1", "-i", str(f), "-frames:v", "1",
                 "-vf", "scale=240:-2", str(thumb)],
                capture_output=True,
            )
            import datetime
            when = datetime.datetime.fromtimestamp(f.stat().st_mtime).strftime("%m-%d %H:%M")
            print(f"    {when}  {f.stat().st_size/1048576:6.1f}M  {probe(f):<20} {f.name}")
            print(f"              首幀 → {thumb}")
        print()
    print(f"首幀圖都在 {out_dir}／打開來看是哪個角色，再用 --wait/--confirm/... 指定檔案。")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("hero", nargs="?", help="角色 id，例如 monk")
    ap.add_argument("--scan", action="store_true",
                    help="只列出 Drive 五個子夾的內容並抽首幀，不做任何轉檔")
    ap.add_argument("--scan-out", type=pathlib.Path, default=pathlib.Path("/tmp/hf_scan"),
                    help="--scan 的首幀輸出目錄（預設 /tmp/hf_scan）")
    ap.add_argument("--sfx", action="store_true",
                    help="順便從新影片的音軌重抽 attack／victory 音效")
    ap.add_argument("--finish", action="store_true",
                    help="轉完直接把 MEDIA_VERSION、?v=、版本印記、build.txt 一起處理掉")
    ap.add_argument("--stamp", help="--finish 要寫的版本印記，例如 'v1.75 · 0906-0400'。不給就自動 +1")
    ap.add_argument("--crf", default=CRF,
                    help=f"畫質參數，預設 {CRF}（v1.36 的行動版基準）。"
                         "粒子多的片子 CRF 29 會爆體積，可調到 31～32 換回檔案大小")
    for k in KINDS:
        ap.add_argument(f"--{k}", type=pathlib.Path, help=f"{k} 的來源影片")
    args = ap.parse_args()

    if args.scan:
        scan(args.scan_out)
        return
    if not args.hero:
        raise SystemExit("要指定角色 id（例如 monk），或加 --scan 先看 Drive 裡有什麼")

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
        print(f"[{kind}] 來源 {probe(src)}  {src.stat().st_size/1024/1024:.1f}M  (CRF {args.crf})")
        encode(src, dst, args.crf)
        print(f"        舊：{before}")
        print(f"        新：{probe(dst)}  {dst.stat().st_size/1024:.0f}K")
        if kind in POSTER_KINDS:
            poster = ROOT / f"assets/videos/poster/{kind}/{args.hero}.jpg"
            make_poster(dst, poster)
            print(f"        poster 已重製：{poster.relative_to(ROOT)}  {poster.stat().st_size/1024:.0f}K")
        if args.sfx:
            sfx = extract_sfx(src, args.hero, kind)
            if sfx:
                print(f"        音效已重抽：{sfx.relative_to(ROOT)}  {sfx.stat().st_size/1024:.0f}K")
        print()

    if args.finish:
        print("收尾（版本號與 build.txt）…")
        finish(args.stamp)
        print("\n✅ 全部做完了。剩下最後一步：")
        print("     git add -A && git commit -m '換 %s 的影片' && git push" % args.hero)
        print("   （不 push 手機看不到）")
    else:
        print("重算逐檔雜湊表…")
        subprocess.run([sys.executable, str(ROOT / "tools/gen_asset_versions.py")], check=True)
        print("\n── 還要手動做的（或下次直接加 --finish）──")
        print("  1. js/videoPlayer.js 的 MEDIA_VERSION +1")
        print("  2. index.html 的 videoPlayer.js?v= 與 .build-stamp +1")
        print("  3. python3 tools/sync_build.py")
        print("  4. git add -A && git commit && git push（不 push 手機看不到）")


if __name__ == "__main__":
    main()
