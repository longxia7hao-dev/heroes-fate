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
 * 2. **任何帶 `Range` 標頭、而且不是影片的請求** —— 放行給瀏覽器自己處理。
 *
 *    ⚠️ 音效（`.mp3`）可以安全快取 —— `audioDirector.js` 是用 `fetch()` ＋
 *    `decodeAudioData()` 抓的，不是 `<audio>` 元素，不會送 Range。
 *    那 4.4MB 的角色 BGM 與音效因此全部進得了快取。
 *
 * ── 影片：v1.69 起改成 range-aware 快取（原本完全不快取）────────────
 *
 * **為什麼一開始不敢碰**：影片是 `<video>.src` 在放，**Safari 會送 Range 請求**。
 * Service Worker 若把完整的 200 回應丟給 Range 請求，iOS 上會出問題 ——
 * 這個專案在 v1.2.1 就因為「Range 被回 200 而不是 206」讓音訊整個播不出來
 *（CLAUDE.md 有記）。所以 v1.62 先整個放行，把 range-aware 留到第二階段。
 *
 * **為什麼現在非做不可**：一場 4 人魔王討伐要抓約 **9.7MB** 影片
 *（選角 4×398K ＋ 確認 4×511K ＋ 魔王降臨 1.4M ＋ 攻擊 4×626K ＋ final 1.8M ＋ 勝利 581K），
 * 而且**每一場都重抓一次**。睿哥是弱訊號 4G，這就是「影片載入超慢」的根因。
 * 重壓碼率只省得到約 30%（實測 final 只小 6%），差得遠。
 *
 * **做法**：快取裡永遠存**完整的 200**（用不帶 Range 的請求去抓），
 * 要回應 Range 時**自己切出 206 ＋ 正確的 `Content-Range`／`Accept-Ranges`** ——
 * v1.2.1 的災情是「Range 被回 200」，這裡回的是貨真價實的 206，正是 iOS 要的。
 *
 * **第一次播不會變慢**：快取沒中時**直接放行走網路**（維持漸進播放），
 * 只在背景補快取，而且背景那次用 `cache: "force-cache"` 優先吃瀏覽器自己的
 * HTTP 快取 —— 檔案幾秒前才剛下載過，幾乎不會真的多花流量。
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
const VIDEO = "hf-video-v1";
const KEEP = new Set([SHELL, MEDIA, VIDEO]);

// 影片桶最多留幾支。`cache.keys()` 回傳的是**插入順序**，超過就從最舊的開始砍。
// 45 支混著算平均約 30MB（等待／確認／攻擊約 0.4〜0.6MB，final 約 1.8MB）。
const VIDEO_KEEP = 45;

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

// 最近一支影片的完整 buffer。只留一支：播放時本來就是連續要同一支影片的不同段。
let lastBuf = { url: null, buf: null };

/** 把 Range 標頭拿掉之後的請求 —— 快取一律用這個當 key，存的永遠是完整檔案。 */
function fullKey(url) {
  return new Request(url, { headers: {}, mode: "same-origin", credentials: "omit" });
}

/**
 * 把一支影片完整存進快取。**只在 `warm` 訊息（主選單閒著時）被呼叫**，
 * 絕對不要在播放中做 —— 見下面 fetch handler 的說明。
 *
 * ⚠️ **不要用 `cache: "force-cache"` 想省流量。** v1.69 我這樣寫過，以為
 * 「檔案幾秒前才串流過，HTTP 快取裡一定有」—— 錯了：`<video>` 是用 Range 抓的，
 * GitHub Pages 正確回 **206**，瀏覽器的 HTTP 快取裡只有半截，`force-cache` 命不中，
 * 還是會整支重抓。（本機 `python3 -m http.server` 對 Range 回的是 200，
 * 所以本機測起來「只抓一次」是假象 —— 一定要用會回 206 的伺服器測。）
 */
async function fillVideoCache(url) {
  const cache = await caches.open(VIDEO);
  if (await cache.match(fullKey(url))) return;
  try {
    const res = await fetch(fullKey(url));
    if (!res || res.status !== 200 || res.type !== "basic") return;
    await cache.put(fullKey(url), res.clone());
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - VIDEO_KEEP; i++) await cache.delete(keys[i]);
  } catch (_) {
    /* 抓不到就算了，下次再說 */
  }
}

/**
 * 影片回應。**這裡是整個 SW 最需要小心的地方。**
 *
 * 快取裡存的永遠是完整的 200。Safari 會對 `<video>` 送 Range 請求，
 * 這時**必須自己切出 206**，附上正確的 `Content-Range` 與 `Accept-Ranges` ——
 * 直接把完整的 200 丟回去正是 v1.2.1 讓 iOS 音訊全滅的那個 bug，不要重蹈。
 *
 * 快取沒中時**不攔**（回 null，交給瀏覽器直接走網路），第一次播維持漸進播放、
 * 速度跟以前一模一樣；同時在背景把完整檔案補進快取，第二次以後就是本機讀取。
 */
async function videoResponse(request) {
  const cache = await caches.open(VIDEO);
  const hit = await cache.match(fullKey(request.url));
  if (!hit) return null;

  const range = request.headers.get("range");
  if (!range) return hit;

  // ⚠️ **每個 Range 請求都重新 `arrayBuffer()` 一次會很痛。**
  // Safari 播一支影片會連續送很多段 Range，而 `arrayBuffer()` 的成本跟**檔案大小**
  // 成正比（不是跟要的那一段）—— 實測 335K 的片每段 5.7ms，1.8M 的 final 每段
  // 11.5ms（桌機 Chromium；手機還要再乘幾倍）。等於播 1.8M 的片就要反覆解出
  // 24 次 1.8MB，記憶體與 CPU 都在空轉，播放就會頓。
  // 只留最近一支的 buffer 就好 —— 播放時本來就是連續要同一支。
  const cacheKey = fullKey(request.url).url;
  let buf;
  if (lastBuf.url === cacheKey && lastBuf.buf) {
    buf = lastBuf.buf;
  } else {
    buf = await hit.arrayBuffer();
    lastBuf = { url: cacheKey, buf };
  }
  const total = buf.byteLength;
  const m = /^bytes=(\d*)-(\d*)/.exec(range.trim());
  if (!m) return hit;
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : total - 1;
  if (!m[1] && m[2]) {
    // `bytes=-500` 是「最後 500 bytes」，不是「0 到 500」
    start = Math.max(0, total - parseInt(m[2], 10));
    end = total - 1;
  }
  if (!Number.isFinite(start) || start >= total || start < 0) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" },
    });
  }
  end = Math.min(end, total - 1);

  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": hit.headers.get("content-type") || "video/mp4",
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
    },
  });
}

/**
 * 預熱佇列。**只在玩家沒有在等任何東西的時候跑**（目前是主選單），
 * 一次一支、不並發，收到 `hf-warm-stop` 立刻收手。
 * 這是唯一會主動下載影片的地方 —— 演出進行中絕對不碰網路。
 */
let warmQueue = [];
let warming = false;

async function runWarm() {
  if (warming) return;
  warming = true;
  try {
    while (warmQueue.length) {
      await fillVideoCache(warmQueue.shift());
    }
  } finally {
    warming = false;
  }
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "hf-warm-stop") {
    warmQueue = [];
    return;
  }
  if (data.type === "hf-warm" && Array.isArray(data.urls)) {
    // 上限跟快取容量對齊（頁面現在送 43 支：魔王降臨 ＋ 等待 ＋ 確認 ＋ 攻擊）。
    // 之前寫死 40，會把清單尾端的 3 支攻擊片默默切掉。
    warmQueue = data.urls.filter((u) => typeof u === "string").slice(0, VIDEO_KEEP);
    runWarm();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }

  // 影片：range-aware 快取。**這一段一定要排在下面那條「Range 一律放行」之前**，
  // 否則帶 Range 的影片請求會被先放行掉，快取永遠不會生效。
  if (url.origin === self.location.origin && url.pathname.endsWith(".mp4")) {
    event.respondWith(
      videoResponse(request)
        // 沒命中就直接走網路，**而且什麼都不做**。
        //
        // ⚠️ v1.69 這裡會順手 `event.waitUntil(fillVideoCache(...))` 背景補快取，
        // 我以為那幾乎不花流量。**實測是錯的**：對會回 206 的伺服器
        //（GitHub Pages 就是），播放中的 Range 串流之外，背景那次會**整支重抓**——
        // 量到「Range 送出 64K」之後緊接著「無 Range 送出 335K」。
        // 在弱訊號 4G 上等於邊播邊搶頻寬，只會更慢。
        // 補快取一律交給主選單閒著時的 `hf-warm` 訊息去做。
        .then((res) => res || fetch(request))
        .catch(() => fetch(request))
    );
    return;
  }

  // 其餘帶 Range 的請求一律不碰 —— 交給瀏覽器自己處理
  if (request.headers.has("range")) return;

  // 跨網域（Google Fonts 等）交給瀏覽器自己的 HTTP 快取。
  // 不攔的原因：跨網域樣式表拿到的是 opaque 回應，存進 Cache Storage 會以
  // 「補白」的方式吃掉大量配額，換來的好處卻很有限。
  if (url.origin !== self.location.origin) return;

  // 版本探針：永遠走網路（影片已在上面處理掉了）
  if (url.pathname.endsWith("/build.txt")) return;

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
