#!/usr/bin/env python3
"""產生「加到主畫面」用的 App 圖示。

**為什麼不是直接用 `assets/favicon.svg`**：iOS 的主畫面圖示只吃 PNG，
`apple-touch-icon` 不支援 SVG；Android 的 manifest 也要 192／512 的點陣圖。

**為什麼不預先切圓角**：iOS 會自己把圖示遮成圓角方形（squircle）。
來源如果自己先切一次圓角，裝到主畫面會變成**雙重圓角**、四角露出底色。
所以這裡畫的是**滿版方形、不透明**的圖，圓角交給系統。

設計沿用 `assets/favicon.svg`（放射漸層底 ＋ 四角星 ＋ 中心亮點），
只是改用像素重畫，數值一一對應原檔的 viewBox 64 座標。

用法：

    python3 tools/gen_pwa_icons.py

改完記得跑 `python3 tools/gen_asset_versions.py`。
"""

from __future__ import annotations

import pathlib

import numpy as np
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "icons"

# 全部照 favicon.svg 的 viewBox 64 座標
STAR = [(32, 7), (38, 25), (57, 32), (38, 39), (32, 57), (25, 39), (7, 32), (25, 25)]
INNER = ((32, 32), 6)
C_HI, C_LO = (0x63, 0x3E, 0x85), (0x14, 0x08, 0x22)
C_STAR, C_DOT = (0xFF, 0xE3, 0x9A), (0xFF, 0xF5, 0xCD)
# 放射漸層：中心 35%/28%、半徑 78%
G_CX, G_CY, G_R = 0.35, 0.28, 0.78


def background(size: int) -> Image.Image:
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    d = np.hypot(x - G_CX, y - G_CY) / G_R
    t = np.clip(d, 0, 1)[..., None]
    rgb = np.array(C_HI, np.float32) * (1 - t) + np.array(C_LO, np.float32) * t
    return Image.fromarray(rgb.round().astype(np.uint8), "RGB")


def draw(size: int, inset: float = 0.0) -> Image.Image:
    """inset：圖案往內縮的比例，給 maskable 圖示留安全區用。"""
    SS = 4  # 超取樣，邊緣才不會鋸齒
    im = background(size).resize((size * SS, size * SS), Image.BILINEAR)
    d = ImageDraw.Draw(im)
    span = size * SS
    scale = span / 64 * (1 - inset)
    off = span * inset / 2

    def pt(p):
        return (p[0] * scale + off, p[1] * scale + off)

    d.polygon([pt(p) for p in STAR], fill=C_STAR)
    (cx, cy), r = INNER
    c, rr = pt((cx, cy)), r * scale
    d.ellipse([c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr], fill=C_DOT)
    return im.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [
        ("icon-180.png", 180, 0.0),   # iOS apple-touch-icon
        ("icon-192.png", 192, 0.0),
        ("icon-512.png", 512, 0.0),
        ("icon-maskable-512.png", 512, 0.22),  # Android 遮罩安全區
    ]
    for name, size, inset in jobs:
        p = OUT / name
        draw(size, inset).save(p, "PNG", optimize=True)
        print(f"{name:<24}{size}×{size}  {p.stat().st_size/1024:5.1f} KB")


if __name__ == "__main__":
    main()
