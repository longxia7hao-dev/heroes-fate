/**
 * Heroes' Fate — Service Worker（PWA 第一階段）
 *
 * 目的：讓「加到主畫面」之後，第二次以後開啟幾乎是瞬間 ——
 * 介面、字型、圖片、音效都從手機本機讀，不再走 4G。
 *
 * ⚠️ 這個檔案是**再多一層快取**，而這個專案已經被「改了東西但手機看到舊的」
 * 咬過四次以上（見 CLAUDE.md）。所以下面每一條「不碰」的規則都是刻意的，
 * 改之前請先讀完理由。
 *
 * ── 絕對不攔截的三種請求 ──────────────────────────────────
 *
 * 1. **`build.txt`** —— `game.js` 的 `watchForNewBuild()` 靠它比對版本，
 *    比對不出來就永遠不會跳「有新版本 · 點一下更新」。它已經帶時間戳＋
 *    `no-store`，這裡再明確放行一次，確保任何情況下都拿得到真正的線上值。
 *
 * 2. **`.mp4`** —— 影片是 `<video>.src` 在放，**Safari 會送 Range 請求**。
 *    Service Worker 若把完整的 200 回應丟給 Range 請求，iOS 上會出問題；
 *    這個專案在 v1.2.1 就因為「Range 被回 200 而不是 206」讓音訊整個播不出來
 *    （CLAUDE.md 有記）。影片快取要等**第二階段**做成 range-aware 才安全，
 *    在那之前寧可不快取，也不要冒「影片完全播不出來」的風險。
 *
 *    ⚠️ 音效（`.mp3`）則相反，**可以安全快取** —— `audioDirector.js` 是用
 *    `fetch()` ＋ `decodeAudioData()` 抓的，不是 `<audio>` 元素，不會送 Range。
 *    那 4.4MB 的角色 BGM 與音效因此全部進得了快取。
 *
 * 3. **任何帶 `Range` 標頭的請求** —— 同上，一律放行給瀏覽器自己處理。
 *
 * ── 兩個獨立的快取，這點很重要 ────────────────────────────
 *
 *   `hf-shell-*`  程式碼與頁面（HTML／CSS／JS）
 *   `hf-media-*`  `assets/` 底下的圖與音
 *
 * 分開的理由：**改版時不能把 40MB 的素材一起沖掉**。素材的網址帶內容雜湊
 *（`?v=<sha1>`，由 tools/gen_asset_versions.py 產生），內容變了網址就變、
 * 自然會重抓；沒變的就永遠命中快取。所以 media 這個桶子**不隨版本清空**。
 *
 * ── 為什麼 CSS／JS 可以放心用 cache-first ────────────────
 *
 * 它們的網址都帶 `?v=N`（`index.html` 裡手動 +1）。版本一升網址就變成新的，
 * 快取自然不會命中。**但 `index.html` 自己沒有版本號**，所以它走 network-first，
 * 這樣重新整理一定拿得到最新的頁面（離線才退回快取）。
 */

const SHELL = "hf-shell-v2";
const MEDIA = "hf-media-v2";
const KEEP = new Set([SHELL, MEDIA]);

self.addEventListener("install", () => {
  // 不預先下載任何東西：睿哥是弱訊號 4G，安裝當下再去搶頻寬只會讓第一次更慢。
  // 改成「用到什麼就存什麼」，第二次開啟就已經是本機讀取了。
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 只清掉這支 SW 自己的舊桶子，別動到別人的
      for (const key of await caches.keys()) {
        if (key.startsWith("hf-") && !KEEP.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

/** `assets/` 底下的圖與音進 media 桶，其餘（HTML／CSS／JS）進 shell 桶。 */
function bucketFor(url) {
  return url.pathname.includes("/assets/") ? MEDIA : SHELL;
}

/**
 * 這個回應可以存進快取嗎？
 *
 * 只存正常的同源回應；206／opaque 一律不存，避免存進半截的東西。
 *
 * ⚠️ **JSON 要多驗一步。** 弱訊號 4G 上被截斷的回應**一樣是 HTTP 200**，
 * 存進去之後（media 桶不隨版本清空）就是**永久壞掉**：往後每次都命中那份
 * 半截的快取、`JSON.parse` 每次都失敗。影片清單一旦這樣壞掉，全部影片都會
 * 消失 —— 睿哥 2026-09-05 遇到的就是這個。存之前先確認真的 parse 得動。
 */
async function safeToCache(res) {
  if (!res || res.status !== 200 || res.type !== "basic") return false;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("json") || new URL(res.url || "http://x/").pathname.endsWith(".json")) {
    try {
      await res.clone().json();
    } catch (_) {
      return false;
    }
  }
  return true;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (await safeToCache(res)) {
    cache.put(request, res.clone()).catch(() => {});
  }
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (await safeToCache(res)) {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    // 離線：先找這個網址，再退回首頁（PWA 從主畫面開啟時就是導向 start_url）
    const hit = (await cache.match(request)) || (await cache.match("./")) ||
      (await cache.match("index.html"));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  // Range 請求（影片）一律不碰 —— 理由見檔頭
  if (request.headers.has("range")) return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }

  // 跨網域（Google Fonts 等）交給瀏覽器自己的 HTTP 快取。
  // 不攔的原因：跨網域樣式表拿到的是 opaque 回應，存進 Cache Storage 會以
  // 「補白」的方式吃掉大量配額，換來的好處卻很有限。
  if (url.origin !== self.location.origin) return;

  // 版本探針與影片：永遠走網路
  if (url.pathname.endsWith("/build.txt") || url.pathname.endsWith(".mp4")) return;

  // **影片清單絕對不能 cache-first。**
  // `assets/videos/manifest.json` 落在 `/assets/` 底下，會被分到 media 桶 ——
  // 而 media 桶是**刻意不隨版本清空**的（不想每次改版都重抓 40MB 素材）。
  // 於是只要有一次存進半截的內容，往後每次都命中那份壞掉的快取，
  // `videoUrl()` 對每個角色都回 null，**所有影片永久消失**。
  // 它只有 4KB，走 network-first 完全不心疼；離線才退回快取。
  // 根目錄那支 PWA `manifest.json` 一起適用，一樣不該被鎖住。
  if (url.pathname.endsWith("manifest.json")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(
    cacheFirst(request, bucketFor(url)).catch(() => fetch(request))
  );
});
