#!/usr/bin/env python3
"""把睿哥給的「金色圖案配黑底」素材，切成可以直接疊在遊戲上的透明 PNG／WebP。

睿哥 2026-09-05 給了兩張：遊戲徽記（六芒星魔法陣）與四角紋飾。

**為什麼一定要去背，不能直接用原圖**：兩張都是黑底。直接當背景圖貼上去，
四個角會出現**黑色方塊**（v1.56～v1.61 就是這樣 —— 當時拿面板框
`frame_panel.webp` 頂替角落紋飾，那張自帶深色底，睿哥看到的就是黑方框）。

**去背方法：亮度當 alpha ＋ 反預乘。**
金色圖案在黑底上，亮度幾乎等同覆蓋率，所以 `alpha = (亮度 - lo) / (hi - lo)`。
亮度取**三通道的最大值**而不是加權平均 —— 金色的藍通道很低，用平均會低估、
把細金線吃掉。算完再把顏色除以 alpha（反預乘），邊緣才不會糊成一圈暗邊。

**徽記的圓圈內不去背**（睿哥 2026-09-05：「金色圓圈內不要去背」）——
圈內那片紫色星雲亮度不高，純亮度去背會把它吃掉、變成一顆懸空的星星。
所以圓內 alpha 直接吃滿、完全保留原圖，只有圓外才去背。見 `keep_disc`。

**兩張的門檻不一樣，這是有原因的**：
  - 徽記 lo=0.06：底是乾淨的純黑，門檻可以壓很低，保留星芒的微光。
  - 角落 lo=0.20：原圖背景**不是純黑**，隱約看得到教堂與吊燈。門檻拉低的話
    會留下一塊灰霧（實測 lo=0.06 時中央有明顯霧塊）。0.20 剛好把背景壓掉、
    金色紋飾完全保留。

**角落素材輸出時就先翻成「左上角」方向。** 原圖的轉角在右上；先在這裡翻好，
`css/aaa.css` 既有的 `.nw/.ne/.sw/.se` 翻轉規則就完全不用改。

App 圖示也一起產生：iOS 的主畫面圖示要**不透明**，所以把徽記疊在深紫放射漸層
底上；而且**不預先切圓角** —— iOS 會自己遮成 squircle，來源再切一次會變雙重圓角。

用法：

    python3 tools/gen_ui_art.py

改完記得跑 `python3 tools/gen_asset_versions.py`，
並且**手動把 `css/aaa.css` 裡那幾個 `?v=` +1**（CSS 的 url() 吃不到版本表）。
"""

from __future__ import annotations

import argparse
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
UI = ROOT / "assets" / "ui"
ICONS = ROOT / "assets" / "icons"

# App 圖示底色，沿用 favicon.svg 的放射漸層
C_HI, C_LO = (0x63, 0x3E, 0x85), (0x14, 0x08, 0x22)
G_CX, G_CY, G_R = 0.35, 0.28, 0.78


def knockout(
    path: pathlib.Path, lo: float, hi: float = 0.42, keep_disc: float | None = None
) -> Image.Image:
    """黑底轉透明。回傳已裁到圖案邊界的 RGBA。

    `keep_disc`：中心圓的半徑（以圖寬的一半為 1）。**圓內完全保留原圖、不去背**，
    只有圓外才做亮度去背。

    睿哥 2026-09-05：「Logo 圓圈內完全比照！金色圓圈內不要去背。」
    徽記那圈符文環裡面是紫色星雲，亮度不高 —— 純亮度去背會把它一起吃掉，
    變成一顆懸空的星星，跟原圖差很多。這個參數就是為了留住那片星雲。

    半徑是**量出來的**：沿半徑掃「金色度」，符文環在 r≈0.85 達到高峰，
    到 r=0.903 掉到負值，所以外緣取 **0.90**。
    """
    src = np.asarray(Image.open(path).convert("RGB")).astype(np.float32) / 255
    lum = src.max(axis=2)  # 取最大通道：金色的藍通道低，用平均會吃掉細金線
    alpha = np.clip((lum - lo) / (hi - lo), 0, 1)

    if keep_disc is not None:
        h, w = lum.shape
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        r = np.hypot(xx - w / 2, yy - h / 2) / (w / 2)
        feather = 0.012  # 邊緣羽化一點點，免得圓周出現鋸齒硬邊
        disc = np.clip((keep_disc + feather - r) / (2 * feather), 0, 1)
        # 圓內 alpha 直接吃滿；圓外仍用亮度去背，外圈的微光才不會被硬切掉
        alpha = np.maximum(alpha, disc)

    # 反預乘。圓內 alpha=1，這一步等於沒動，顏色就是原圖。
    rgb = np.clip(src / np.maximum(alpha, 1e-3)[..., None], 0, 1)
    img = Image.fromarray(
        (np.dstack([rgb, alpha[..., None]]) * 255).round().astype(np.uint8), "RGBA"
    )
    ys, xs = np.nonzero(alpha > 0.10)
    return img.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def radial_bg(size: int) -> Image.Image:
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    t = np.clip(np.hypot(x - G_CX, y - G_CY) / G_R, 0, 1)[..., None]
    rgb = np.array(C_HI, np.float32) * (1 - t) + np.array(C_LO, np.float32) * t
    return Image.fromarray(rgb.round().astype(np.uint8), "RGB")


def app_icon(crest: Image.Image, size: int, inset: float) -> Image.Image:
    """徽記疊在漸層底上。inset 是圖案往內縮的比例（maskable 的安全區）。"""
    bg = radial_bg(size)
    span = round(size * (1 - inset))
    art = crest.resize((span, span), Image.LANCZOS)
    off = (size - span) // 2
    bg.paste(art, (off, off), art)
    return bg


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--crest", required=True, help="徽記原圖")
    ap.add_argument("--corner", required=True, help="四角紋飾原圖")
    args = ap.parse_args()

    UI.mkdir(parents=True, exist_ok=True)
    ICONS.mkdir(parents=True, exist_ok=True)

    full = knockout(pathlib.Path(args.crest), lo=0.06, keep_disc=0.90).resize(
        (512, 512), Image.LANCZOS
    )
    # 網頁上只顯示到約 131 CSS px（2 倍螢幕 ＝ 262 實體像素），384 已經綽綽有餘。
    # 512／q90 要 240KB，384／q84 只要 130KB，在手機上看不出差別。
    crest = full.resize((384, 384), Image.LANCZOS)
    crest.save(UI / "crest.webp", "WEBP", quality=84, method=6)
    print(f"crest.webp     384×384  {(UI / 'crest.webp').stat().st_size/1024:5.1f} KB")

    # 原圖轉角在右上；先翻成左上，CSS 的 .nw/.ne/.sw/.se 就不用動
    corner = knockout(pathlib.Path(args.corner), lo=0.20)
    corner = corner.transpose(Image.FLIP_LEFT_RIGHT).resize((440, 440), Image.LANCZOS)
    corner.save(UI / "corner.webp", "WEBP", quality=88, method=6)
    print(f"corner.webp    440×440  {(UI / 'corner.webp').stat().st_size/1024:5.1f} KB")

    for name, size, inset in [
        ("icon-180.png", 180, 0.06),   # iOS apple-touch-icon
        ("icon-192.png", 192, 0.06),
        ("icon-512.png", 512, 0.06),
        ("icon-maskable-512.png", 512, 0.28),  # Android 遮罩安全區
    ]:
        # App 圖示用完整解析度的徽記；PNG 無損太肥（512 要 324KB），
        # 轉 256 色調色盤後只剩約 127KB，圖示尺寸下看不出色階。
        icon = app_icon(full, size, inset)
        icon.quantize(colors=256, dither=Image.FLOYDSTEINBERG).save(
            ICONS / name, "PNG", optimize=True
        )
        print(f"{name:<22}{size}×{size}  {(ICONS / name).stat().st_size/1024:5.1f} KB")


if __name__ == "__main__":
    main()
