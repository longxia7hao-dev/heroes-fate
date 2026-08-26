#!/usr/bin/env python3
"""把 assets/heroes/*.png 轉成選角卡面用的 WebP。

**為什麼需要這支**：那批 PNG 是 512×512、無透明的 RGB，一張就 293KB。
選角的翻牌卡面是**每點一個角色就換一次**的熱路徑 —— 睿哥 2026-08-26 的
螢幕錄影裡 6 秒內點過六隻，等於硬拉了近 2MB，量到 81% 的畫面是靜止的、
最長一次凍結 1.7 秒。

同一張圖轉 WebP（quality 82）只要約 27KB，**少 91%**，並排比對看不出差別
（平均像素差 1.54/255）。尺寸不動：卡面在手機上最多顯示到約 780 實體像素，
512 已經是在放大，再縮只會更糊。

原本的 PNG **不要刪** —— `victoryFilm.js`／`spritePlayer.js`／
`characterStage.js`／`frameAnimator.js` 還在用它們（那幾條路徑不是熱路徑）。

用法：

    python3 tools/gen_hero_cards.py

改完記得跑 `python3 tools/gen_asset_versions.py`。
"""

from __future__ import annotations

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "heroes"
OUT = SRC / "card"
QUALITY = 82


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    old = new = 0
    for png in sorted(SRC.glob("*.png")):
        dst = OUT / f"{png.stem}.webp"
        Image.open(png).convert("RGB").save(dst, "WEBP", quality=QUALITY, method=6)
        old += png.stat().st_size
        new += dst.stat().st_size
        print(f"{png.stem:<16}{png.stat().st_size/1024:6.0f} KB → {dst.stat().st_size/1024:5.0f} KB")
    print(f"\n合計 {old/1024/1024:.2f} MB → {new/1024:.0f} KB（{(new-old)/old*100:+.0f}%）")


if __name__ == "__main__":
    main()
