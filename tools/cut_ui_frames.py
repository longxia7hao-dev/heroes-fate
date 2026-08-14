#!/usr/bin/env python3
"""從睿哥的視覺稿裡把「框」摳出來，存成 CSS `border-image` 用的九宮格素材。

為什麼要這支：稿子那種金框是**手繪級的金屬立體感**（斜面、亮邊、裂紋、
四角的托架與飾釘），純 CSS 只能做出「一條金線 + 一顆菱形」的近似版。
睿哥看過之後說「跟這個還是有點差異，能用圖片套疊的方式嗎？」——
所以改成直接用稿子的像素。

九宮格（`border-image`）的好處是**四個角不會被拉扁**：只有上下左右四條
邊會沿著單一方向拉伸，角落永遠是原始比例。面板高矮隨內容變也不會走樣。

做法：
  1. 從稿子裁出框的外框範圍（四邊各留一點 bleed，讓上緣的飾釘能凸出去）。
  2. 用「幾何遮罩 ∩ 亮度去背」產生 alpha：
     - 幾何遮罩：只留外框到內框之間那一圈，四角用大圓角保留托架的長臂；
       另外把上緣兩顆飾釘的圓形整個保留（它們凸出框外）。
     - 亮度去背：圈內剩下的深色（面板底色、背景）淡出成透明，
       只留金屬本身與它的光暈。這樣貼到任何底色上都不會出現一圈深色框。
  3. **左右對稱化**：稿子是 AI 畫的，左右邊差了兩三個像素。直接把左半
     鏡射到右半，貼到畫面上才不會一邊粗一邊細。

按鈕是另一種切法：切角矩形（八角形）+ `fill`，中間那塊金屬材質會被拉伸，
所以裂紋紋理能跟著按鈕變寬。

用法（稿子檔名以實際傳來的為準）：

    python3 tools/cut_ui_frames.py --src ~/Downloads/IMG_2468.jpeg

稿子本身不進版控（它是 1:1 的設計稿，不是遊戲素材），只留產物
`assets/ui/*.png`。**產完記得跑 `tools/gen_asset_versions.py`。**
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

OUT_DIR = Path(__file__).resolve().parent.parent / "assets" / "ui"

# 稿子（944×2096）裡量到的座標。換稿子就要重量一次。
# 外框金線的**外緣**。上緣要抓得剛剛好：稿子裡金線正上方就是那群 Q 版英雄，
# 多留兩三個像素，去背後就會沿著上緣黏著一條膚色／盔甲色的雜訊。
PANEL_BOX = (29, 584, 915, 1663)
PANEL_BLEED = (26, 26, 26, 26)        # 左上右下各往外留多少（飾釘要凸出去）
PANEL_RAIL = 34                       # 金線那一圈的厚度
PANEL_CORNER_R = 132                  # 內側挖空區的圓角；越大保留越多角落托架
MEDALS = [(122, 600, 44)]             # 上緣飾釘：圓心 x, y, 半徑（右邊那顆用鏡射）

BTN_GOLD = (355, 1427, 865, 1588)
BTN_PURPLE = (80, 1430, 341, 1584)
BTN_CHAMFER = 26                      # 切角大小


def smoothstep(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def mirror_left_to_right(rgba: np.ndarray) -> np.ndarray:
    """把左半鏡射到右半。稿子是 AI 畫的，左右本來就差幾個像素。"""
    w = rgba.shape[1]
    half = w // 2
    out = rgba.copy()
    out[:, w - half:] = rgba[:, :half][:, ::-1]
    return out


def rounded_rect_mask(shape: tuple[int, int], box, radius: float) -> np.ndarray:
    """回傳「在圓角矩形內」的布林遮罩（用距離場，邊緣是硬的就夠了）。"""
    h, w = shape
    x0, y0, x1, y1 = box
    ys = np.arange(h)[:, None]
    xs = np.arange(w)[None, :]
    # 到圓角矩形中心區的距離（標準 SDF 寫法）
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    hx, hy = (x1 - x0) / 2.0 - radius, (y1 - y0) / 2.0 - radius
    dx = np.abs(xs - cx) - hx
    dy = np.abs(ys - cy) - hy
    d = np.hypot(np.maximum(dx, 0), np.maximum(dy, 0)) + np.minimum(np.maximum(dx, dy), 0)
    return d <= radius


def cut_panel(src: Image.Image, scale: float) -> Image.Image:
    bl, bt, br, bb = PANEL_BLEED
    x0, y0, x1, y1 = PANEL_BOX
    crop = (x0 - bl, y0 - bt, x1 + br, y1 + bb)
    a = np.asarray(src.crop(crop).convert("RGB")).astype(np.float64)
    h, w = a.shape[:2]

    # 幾何遮罩 ── 外框以內。上緣不留鬆份（正上方就是背景美術），其餘留 2px 接光暈
    inside = rounded_rect_mask((h, w), (bl - 2, bt, w - br + 2, h - bb + 2), 26)
    # 幾何遮罩 ── 內框以外（大圓角，四角的托架長臂才不會被切掉）
    hollow = rounded_rect_mask(
        (h, w),
        (bl + PANEL_RAIL, bt + PANEL_RAIL, w - br - PANEL_RAIL, h - bb - PANEL_RAIL),
        PANEL_CORNER_R,
    )
    band = inside & ~hollow

    # 飾釘：凸到框外，所以獨立保留整個圓（含內部的深色底，那是設計的一部分）
    ys = np.arange(h)[:, None]
    xs = np.arange(w)[None, :]
    medal = np.zeros((h, w), bool)
    for mx, my, r in MEDALS:
        for cx in (mx - crop[0], w - 1 - (mx - crop[0])):
            medal |= (xs - cx) ** 2 + (ys - (my - crop[1])) ** 2 <= r * r

    # 亮度去背：圈內的深色（面板底、背景）淡掉，只留金屬與它的光
    v = a.max(2)
    alpha = smoothstep(v, 42.0, 132.0)
    alpha = np.where(band, alpha, 0.0)
    alpha = np.maximum(alpha, medal.astype(np.float64))

    # 飾釘凸出框外的那半圓，背後是那群 Q 版英雄。直接留會在飾釘裡看到一塊膚色，
    # 所以把「不是金、又不夠暗」的像素拉回飾釘自己的深紫底色。
    #
    # 判準用 **G−B** 而不是 R−B：金的最亮處接近白（255,239,201），R−B 只有 +54，
    # 跟膚色的 +44 分不開；但金的 G−B 有 +38，膚色是 −2（膚色的 G 和 B 幾乎相等）。
    # 另外把「本來就很暗」的像素排除在外——那是飾釘自己的底，不用動。
    keep = np.maximum(
        smoothstep(a[..., 1] - a[..., 2], 5.0, 24.0),
        1.0 - smoothstep(a.max(2), 95.0, 150.0),
    )[..., None]
    dark = np.array([26.0, 12.0, 51.0])
    a = np.where(medal[..., None], a * keep + dark * (1.0 - keep), a)

    rgba = np.dstack([a, alpha * 255.0]).astype(np.uint8)
    rgba = mirror_left_to_right(rgba)
    out = Image.fromarray(rgba, "RGBA")
    return out.resize((round(w * scale), round(h * scale)), Image.LANCZOS)


def cut_button(src: Image.Image, box, clean_x: int, scale: float) -> Image.Image:
    """把按鈕重組成九宮格用的窄長條。

    **不能直接裁整顆按鈕**：稿子上的按鈕印著「進入英雄殿堂」，整顆拿去當
    `border-image` 素材，中央那塊會連字一起被拉伸（左右鏡射之後會變成
    「進入英英人斑」這種鬼東西）。

    所以重組成三段：[左端 SLICE 寬] + [一小條沒有字的內部材質] + [左端鏡射]。
    中央那條在 `border-image` 裡只會被**橫向**拉伸，直向仍照原樣對應，
    所以金屬由上而下的漸層會完整保留，字則根本不在素材裡。
    """
    a = np.asarray(src.crop(box).convert("RGB")).astype(np.float64)
    h = a.shape[0]
    s = BTN_CHAMFER + 18            # 切片寬度：切角 + 斜面 + 一點內部
    mid = a[:, clean_x:clean_x + 8]  # 沒有字的那一小條
    left = a[:, :s]
    a = np.concatenate([left, mid, left[:, ::-1]], axis=1)

    w = a.shape[1]
    ys = np.arange(h)[:, None].astype(np.float64)
    xs = np.arange(w)[None, :].astype(np.float64)
    c = float(BTN_CHAMFER)
    # 八角形：四個角各切掉一個 45° 的三角形，邊緣留 1.2px 做抗鋸齒
    dx = np.minimum(xs, w - 1 - xs)
    dy = np.minimum(ys, h - 1 - ys)
    alpha = smoothstep(dx + dy, c - 1.2, c + 1.2)
    alpha = np.minimum(alpha, smoothstep(dx, -0.6, 0.9))
    alpha = np.minimum(alpha, smoothstep(dy, -0.6, 0.9))

    out = Image.fromarray(np.dstack([a, alpha * 255.0]).astype(np.uint8), "RGBA")
    return out.resize((round(w * scale), round(h * scale)), Image.LANCZOS)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="STEP 01 那張視覺稿（944×2096）")
    ap.add_argument("--scale", type=float, default=0.62,
                    help="輸出縮放。稿子是 2.4x 的手機畫面，0.62 約等於 1.5x 螢幕")
    args = ap.parse_args()

    src = Image.open(args.src)
    if src.size != (944, 2096):
        print(f"⚠️ 稿子尺寸是 {src.size}，座標是照 944×2096 量的，可能要重量")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    jobs = [
        ("frame_panel", cut_panel(src, args.scale)),
        # clean_x：按鈕左緣往右數幾個像素是「沒有字」的乾淨材質
        ("btn_gold", cut_button(src, BTN_GOLD, 46, args.scale)),
        ("btn_purple", cut_button(src, BTN_PURPLE, 40, args.scale)),
    ]
    # 輸出 WebP：睿哥是 4G 手機在玩，同樣畫質下比 PNG 小四倍。
    # 專案本來就有 .webp 素材（assets/deco），iOS Safari 14 起支援。
    for name, img in jobs:
        p = OUT_DIR / f"{name}.webp"
        img.save(p, quality=92, method=6)
        print(f"{p.name:<18} {img.size[0]}×{img.size[1]}  {p.stat().st_size / 1024:6.1f} KB")

    sc = args.scale
    print("\nborder-image-slice 建議值（已含 scale）：")
    print(f"  面板：外緣 bleed {round(PANEL_BLEED[0] * sc)}px；角落切片約 "
          f"{round(175 * sc)} × {round(150 * sc)}")
    print(f"  按鈕：切片 {round((BTN_CHAMFER + 18) * sc)}")


if __name__ == "__main__":
    main()
