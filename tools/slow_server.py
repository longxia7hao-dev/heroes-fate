#!/usr/bin/env python3
"""像 GitHub Pages 一樣回 206 的伺服器，但把影片限速到睿哥的實際連線。

**為什麼不能用 `python3 -m http.server`**：它對 Range 請求回 200 不是 206
（CLAUDE.md 記過這條），媒體行為整個不一樣，測出來的結論不能用。

兩個測試用的特殊行為：
  - `--kbps`：只對 .mp4／.webm 限速（其餘全速），模擬 120〜150KB/s 的 4G
  - `--webm-dir`：把 `wait/<id>.mp4` 換成同名的 .webm 回應。
    headless Chromium 解不了 H.264（CLAUDE.md），要驗「影片播放」只能用替身。
"""

import argparse
import os
import pathlib
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIME = {
    ".html": "text/html; charset=utf-8", ".js": "application/javascript",
    ".css": "text/css", ".json": "application/json", ".mp4": "video/mp4",
    ".webm": "video/webm", ".jpg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".mp3": "audio/mpeg", ".txt": "text/plain",
    ".svg": "image/svg+xml", ".ico": "image/x-icon",
}
CFG = {"kbps": 0, "webm": None, "no_store": False}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _resolve(self, path):
        path = path.split("?")[0].split("#")[0]
        if path == "/":
            path = "/index.html"
        target = (ROOT / path.lstrip("/")).resolve()
        if not str(target).startswith(str(ROOT)):
            return None
        # wait 片改用 WebM 替身（Chromium 解不了 H.264）
        if CFG["webm"] and re.search(r"/wait/([a-z_]+)\.mp4$", path):
            stem = re.search(r"/wait/([a-z_]+)\.mp4$", path).group(1)
            alt = pathlib.Path(CFG["webm"]) / f"{stem}.webm"
            if alt.is_file():
                return alt
        return target if target.is_file() else None

    def do_GET(self, head=False):
        target = self._resolve(self.path)
        if not target:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        data = target.read_bytes()
        total = len(data)
        ctype = MIME.get(target.suffix.lower(), "application/octet-stream")
        is_media = target.suffix.lower() in (".mp4", ".webm")

        start, end = 0, total - 1
        rng = self.headers.get("Range")
        partial = False
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng.strip())
            if m:
                g1, g2 = m.group(1), m.group(2)
                if g1 == "" and g2:                      # bytes=-500 → 最後 500 bytes
                    start, end = max(0, total - int(g2)), total - 1
                elif g1:
                    start = int(g1)
                    end = int(g2) if g2 else total - 1
                if start >= total:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{total}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                end = min(end, total - 1)
                partial = True

        body = data[start:end + 1]
        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(len(body)))
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{total}")
        # index.html／build.txt 不快取，其餘比照 Pages 的 max-age=600
        if CFG["no_store"] or target.name in ("index.html", "build.txt"):
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_header("Cache-Control", "max-age=600")
        self.end_headers()
        if head:
            return

        rate = CFG["kbps"] * 1024
        if is_media and rate > 0:
            chunk = max(1024, rate // 20)          # 每 50ms 送一塊
            for i in range(0, len(body), chunk):
                try:
                    self.wfile.write(body[i:i + chunk])
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    return
                time.sleep(chunk / rate)
        else:
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                return

    def do_HEAD(self):
        self.do_GET(head=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--kbps", type=int, default=0, help="影片限速 KB/s，0 = 不限")
    ap.add_argument("--webm-dir", help="wait 片的 WebM 替身目錄")
    ap.add_argument("--no-store", action="store_true",
                    help="全部回 no-store —— 模擬「每個角色都是第一次看」")
    a = ap.parse_args()
    CFG["kbps"] = a.kbps
    CFG["webm"] = a.webm_dir
    CFG["no_store"] = a.no_store
    print(f"http://127.0.0.1:{a.port}/  影片限速 {a.kbps or '不限'} KB/s  webm={a.webm_dir}")
    ThreadingHTTPServer(("127.0.0.1", a.port), Handler).serve_forever()
