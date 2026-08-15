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
    # 2026-08-15 第二輪：睿哥要「每個角色比例大小、位置高低盡量一致」。
    # 量法見上面；把同一段 y 帶（150–285）並排、每 20px 畫格線，直接比瞳距。
    # 讀出來的瞳距中位數約 58px，眼線目標 y≈210。
    #
    # ⚠️ 第一輪把 archmage 放大 1.10 是**放錯方向** —— 它本來就是全場最大的一張
    #（瞳距約 70）。這一輪改回接近原尺寸，只保留「往上移」那部分。
    "amazon": {"zoom": 1.22, "dy": 6},          # 瞳距約 44，全場最小
    "archmage": {"zoom": 1.02, "dy": 12},       # 瞳距約 70，全場最大：只上移不放大
    "dark_fighter": {"zoom": 1.08, "dy": 4},    # 瞳距約 52，眼線 216 偏低
    "dragon_knight": {"zoom": 1.16, "dy": -44}, # 瞳距約 50；眼線原本 150 太高
    "paladin": {"zoom": 1.24, "dy": 4},         # 瞳距原本 44，第一輪 1.30 稍過頭

    # 2026-08-15 第三輪：睿哥圈出這四張說「頭有比較小一點，可以稍微等比例放大」。
    # 共通點是**頭周圍的東西多**（斗篷、毛領、僧袍、皇冠），臉相對就顯得小 ——
    # 瞳距量起來其實沒差很多，但視覺上就是小一號，以他看到的為準。
    # 四張統一 1.14×，dy 各自算回眼線 y≈210：dy = eye − 161 − 49/zoom。
    "axeman": {"zoom": 1.14, "dy": 6},          # 眼線 210
    "dark_elf": {"zoom": 1.14, "dy": 4},        # 眼線 208
    "monk": {"zoom": 1.14, "dy": 6},            # 眼線 210
    "princess": {"zoom": 1.14, "dy": 0},        # 眼線 204
}


def extend(img: Image.Image, top: int, bottom: int) -> Image.Image:
    """上／下緣各補一段：取該端同高的一條鏡射後重模糊，接縫看不出來。

    縮放小於 1（幾乎不放大）又要平移時，裁切框會同時超出上下兩端，
    所以兩邊都要能補 —— 只做上緣的話 PIL 會丟 "box can't exceed original image size"。
    """
    top, bottom = max(0, top), max(0, bottom)
    if not top and not bottom:
        return img
    out = Image.new("RGB", (img.width, img.height + top + bottom))
    if top:
        s = img.crop((0, 0, img.width, min(top, img.height)))
        s = s.transpose(Image.FLIP_TOP_BOTTOM).filter(ImageFilter.GaussianBlur(6))
        if s.height < top:
            s = s.resize((img.width, top), Image.LANCZOS)
        out.paste(s, (0, 0))
    out.paste(img, (0, top))
    if bottom:
        s = img.crop((0, max(0, img.height - bottom), img.width, img.height))
        s = s.transpose(Image.FLIP_TOP_BOTTOM).filter(ImageFilter.GaussianBlur(6))
        if s.height < bottom:
            s = s.resize((img.width, bottom), Image.LANCZOS)
        out.paste(s, (0, top + img.height))
    return out


def reframe(src: Image.Image, zoom: float, dy: float) -> tuple[Image.Image, str]:
    w, h = SIZE
    cw, ch = w / zoom, h / zoom
    cx, cy = src.width / 2, src.height / 2 + dy
    top = cy - ch / 2
    # 用 ceil 不用 round：四捨五入會少補一個像素，top 就會剩下 -0.4，
    # PIL 的 resize(box=...) 不吃負的偏移，直接 ValueError。
    pad_t = max(0, math.ceil(-top))
    pad_b = max(0, math.ceil(top + ch - src.height))
    work = extend(src, pad_t, pad_b)
    top += pad_t
    left = cx - cw / 2
    box = (left, top, left + cw, top + ch)
    note = f"zoom {zoom:.2f} dy {dy:+.0f} 裁切 {tuple(round(v) for v in box)}"
    if pad_t or pad_b:
        note += f" · 補邊 上{pad_t} 下{pad_b}px"
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
