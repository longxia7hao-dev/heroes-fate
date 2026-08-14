#!/usr/bin/env python3
"""把 index.html 的版本印記同步到 build.txt。

為什麼需要：手機上「改了卻看到舊的」在這個專案發生過很多次 —— GitHub Pages
給 HTML 的是 `max-age=600`，而且**分頁只要一直開著不重新整理，index.html
根本不會再被抓一次**，於是所有 `?v=` 都失效。

`js/game.js` 開場會抓 `build.txt`（`cache: "no-store"`，繞過快取），
和頁面內嵌的印記比對，不一樣就跳出「有新版本」讓玩家點一下更新。
但那要 **build.txt 與 index.html 的印記一致**才準，所以每次改版都要跑這支。

用法（改完 index.html 的 .build-stamp 之後）：

    python3 tools/sync_build.py
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
index = (ROOT / "index.html").read_text(encoding="utf-8")

# 容許 class 之後還有其他屬性（例如 id="build-stamp"）
m = re.search(r'<p class="build-stamp"[^>]*>([^<]+)</p>', index)
if not m:
    sys.exit("在 index.html 找不到 .build-stamp，無法同步")

stamp = m.group(1).strip()
(ROOT / "build.txt").write_text(stamp + "\n", encoding="utf-8")
print(f"build.txt ← {stamp}")
