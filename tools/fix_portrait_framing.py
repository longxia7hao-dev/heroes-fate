#!/usr/bin/env python3
"""重新取景選角頭像，讓每張的頭大小與高低一致。

睿哥 2026-08-15：「聖騎士的頭明顯比大家小，放大一點盡量與其他的頭比例一致；
大魔導士頭的位置太低了；龍騎士頭的位置太高了。」

**怎麼量的**：把 14 張頭像排成montage，在 y=210 畫一條基準線，
再逐張看瞳孔中心的 x 距離（瞳距是頭部大小最穩的代理值，不受髮型與盔甲干擾）。
量出來：

    基準（多數人）  瞳距 60–64px，眼線 y ≈ 205–218
    paladin        瞳距 **44**（＝別人的 0.7），眼線 205  → 頭明顯小
    dragon_knight  眼線 **150**（比別人高 60px）        → 頭明顯高
    archmage       眼線 207（本身還好），但頭頂上方留白比別人多 → 看起來偏低

⚠️ **一定要從 `_orig/` 讀，不要從輸出檔讀。** 這支會覆蓋
`assets/heroes/portraits/<id>.jpg`；如果來源就是輸出檔，重跑一次就會**再縮放一次**，
跑幾次頭就爆掉。專案已經被同類陷阱咬過兩次（`generate_audio.py`、`gen_sfx_v2.py`），
所以這裡把原圖另存一份在 `_orig/`，本檔永遠只讀那裡 —— 重跑幾次結果都一樣。

用法：

    python3 tools/fix_portrait_framing.py          # 套用下面 ADJUST 的設定
    python3 tools/fix_portrait_framing.py --check  # 只印出會怎麼裁，不寫檔

改完記得跑 `python3 tools/gen_asset_versions.py`。
"""

from __future__ import annotations

import argparse
import math
import shutil
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
PORTRAITS = ROOT / "assets" / "heroes" / "portraits"
ORIG = PORTRAITS / "_orig"
SIZE = (240, 322)

# zoom：>1 放大（頭變大）。dy：正值把畫面內容**往上**移（頭上移），負值往下。
# 兩個值都是以原圖 322px 高為單位。
ADJUST = {
    # 瞳距 44 → 目標約 60，所以放大 1.30；順便把眼線壓回 210 附近
    "paladin": {"zoom": 1.30, "dy": 6},
    # 眼線本來就在 207，問題是頭頂留白太多 —— 往上收一點並略放大
    "archmage": {"zoom": 1.10, "dy": 14},
    # 眼線 150 太高，要把頭往下移。它的髮梢已經頂到上緣，
    # 所以裁切框得伸到畫面外，上方不足的部分用鏡射＋模糊補
    #（那一帶是暗色天空與城堡剪影，補完看不出來）。
    "dragon_knight": {"zoom": 1.10, "dy": -46},
}


def extend_top(img: Image.Image, pad: int) -> Image.Image:
    """在上緣補 `pad` 像素：取頂端同高的一條鏡射後重模糊，接縫看不出來。"""
    if pad <= 0:
        return img
    strip = img.crop((0, 0, img.width, min(pad, img.height)))
    strip = strip.transpose(Image.FLIP_TOP_BOTTOM).filter(ImageFilter.GaussianBlur(6))
    if strip.height < pad:
        strip = strip.resize((img.width, pad), Image.LANCZOS)
    out = Image.new("RGB", (img.width, img.height + pad))
    out.paste(strip, (0, 0))
    out.paste(img, (0, pad))
    return out


def reframe(src: Image.Image, zoom: float, dy: float) -> tuple[Image.Image, str]:
    w, h = SIZE
    cw, ch = w / zoom, h / zoom
    cx, cy = src.width / 2, src.height / 2 + dy
    top = cy - ch / 2
    # 用 ceil 不用 round：四捨五入會少補一個像素，top 就會剩下 -0.4，
    # PIL 的 resize(box=...) 不吃負的偏移，直接 ValueError。
    pad = max(0, math.ceil(-top))
    work = extend_top(src, pad)
    top += pad
    left = cx - cw / 2
    box = (left, top, left + cw, top + ch)
    note = f"zoom {zoom:.2f} dy {dy:+.0f} 裁切 {tuple(round(v) for v in box)}"
    if pad:
        note += f" · 上緣補 {pad}px"
    return work.resize(SIZE, Image.LANCZOS, box=box), note


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只印出會怎麼裁，不寫檔")
    args = ap.parse_args()

    ORIG.mkdir(parents=True, exist_ok=True)
    for hero, adj in ADJUST.items():
        live = PORTRAITS / f"{hero}.jpg"
        keep = ORIG / f"{hero}.jpg"
        # 第一次執行時把原圖存起來；之後永遠以它為來源
        if not keep.exists():
            shutil.copy2(live, keep)
            print(f"{hero}: 原圖已備份到 _orig/")
        out, note = reframe(Image.open(keep).convert("RGB"), adj["zoom"], adj["dy"])
        print(f"{hero:<15}{note}")
        if not args.check:
            out.save(live, quality=88, subsampling=1, optimize=True)


if __name__ == "__main__":
    main()
