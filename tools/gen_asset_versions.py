#!/usr/bin/env python3
"""產生每個素材檔各自的內容雜湊版本號。

為什麼要這個：以前所有影片共用一個 `MEDIA_VERSION`、所有圖共用一個
`ART_VERSION`，只要換掉一支影片就得把常數 +1，手機上**全部 70 支影片與
所有圖都會變成新網址而重新下載**（4G 上就是幾十 MB）。改成逐檔雜湊之後，
沒動到的檔案網址不變，瀏覽器直接用快取，只有真的換過的檔才會重抓。

用法（換過任何素材後都要跑一次，然後才 commit）：

    python3 tools/gen_asset_versions.py

它會寫出 `js/assetVersions.js`，並把 `index.html` 裡該檔的 `?v=` 更新成它自己
的雜湊，確保 index.html 一被重新驗證就會指到正確的版本表。
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

# 要納入版本表的素材（相對專案根目錄）
PATTERNS = [
    "assets/videos/mobile/**/*.mp4",
    "assets/videos/poster/**/*.jpg",
    "assets/heroes/*.png",
    "assets/heroes/portraits/*.jpg",
    # 音檔：換掉幾個音效時，其餘 40 幾支（含 4MB 的角色 BGM）網址不變、不重抓
    "assets/audio/**/*.mp3",
    "assets/boss_model_v*.png",
    "assets/boss_model_v*.webp",
    "assets/bg_battle_arena_v2.jpg",
    "assets/ref_battle_mobile.mp4",
]

OUT_JS = ROOT / "js" / "assetVersions.js"
INDEX = ROOT / "index.html"


def digest(path: pathlib.Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:10]


def main() -> int:
    table: dict[str, str] = {}
    for pattern in PATTERNS:
        for f in sorted(ROOT.glob(pattern)):
            if f.is_file():
                table[f.relative_to(ROOT).as_posix()] = digest(f)

    if not table:
        print("找不到任何素材，請確認執行目錄", file=sys.stderr)
        return 1

    body = json.dumps(table, ensure_ascii=False, indent=0, separators=(",", ":"))
    OUT_JS.write_text(
        "/* 由 tools/gen_asset_versions.py 產生，請勿手改。\n"
        "   逐檔內容雜湊：沒動到的素材網址不變，手機就不會整包重抓。 */\n"
        f"window.HF_ASSET_V = {body};\n",
        encoding="utf-8",
    )

    # index.html 指向這份版本表時，用它自己的雜湊當查詢字串
    self_hash = digest(OUT_JS)
    html = INDEX.read_text(encoding="utf-8")
    new_html, n = re.subn(
        r'(<script src="js/assetVersions\.js)(\?v=[^"]*)?(")',
        rf'\1?v={self_hash}\3',
        html,
    )
    if n == 0:
        print(
            "⚠️ index.html 找不到 assetVersions.js 的 <script>，請先加上：\n"
            '   <script src="js/assetVersions.js"></script>（放在 data.js 之前）',
            file=sys.stderr,
        )
    else:
        INDEX.write_text(new_html, encoding="utf-8")

    print(f"✅ {len(table)} 個素材寫入 {OUT_JS.relative_to(ROOT)}（版本表雜湊 {self_hash}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
