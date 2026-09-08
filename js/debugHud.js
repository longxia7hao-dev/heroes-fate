/**
 * 選角影片診斷面板 —— **只在網址帶 `?debug=1` 時啟用，平常完全不執行**。
 *
 * ## 為什麼是「摘要」而不是「日誌」
 *
 * 第一版（v1.89）是一份會滾動的事件日誌。2026-09-08 睿哥回報還是卡、附了四張
 * 截圖，**其中三張根本沒有面板、第四張只剩最後五行** —— 他按下去的那一刻早就
 * 捲掉了。要靠人「在正確的時機截圖」本身就是壞設計。
 *
 * 所以現在最上面永遠釘著**上一次點擊的完整結論**：不管他隔多久才截圖，
 * 那張圖都帶著答案。下面才是事件序列（給需要細看順序時用）。
 *
 * ## 每一項在分辨什麼
 *
 *   翻牌       從手指按下到畫面真的動起來 —— **這就是他說的「卡」的長度**
 *   來源       blob＝預抓有中（本機供應）／net＝當場跟伺服器要
 *   影片卡頓   影片自己播不動的時間（沒暫停、readyState 夠、currentTime 不前進）
 *   畫面凍住   主執行緒被佔住（rAF 間隔），**跟影片卡頓是兩回事** ——
 *              2026-09-08 就是影片一次卡頓都沒有、但畫面在掉格
 *   同時下載   那一刻網路上還在跑什麼（背景工作壓到演出就是這樣看出來的）
 */
(() => {
  "use strict";
  if (!/[?&]debug=1/.test(location.search)) return;

  const LOG_LINES = 8;
  const JANK_MS = 120;        // rAF 間隔超過這個就算掉格
  const lines = [];
  let box = null, sumEl = null, logEl = null;
  let t0 = performance.now();

  /** 這一次點擊的統計，每次點角色歸零 */
  let cur = null;
  function reset(id) {
    t0 = performance.now();
    lines.length = 0;
    cur = {
      id,
      flipMs: null, src: "?",
      stallMs: 0,
      jankMax: 0, jankAt: 0, jankSum: 0,
      waits: 0, waitAt: [],        // 循環接點的重新緩衝（見下方 waiting 的處理）
      /**
       * 「換走再換回來就卡」的關鍵證據。
       *
       * iOS Safari 會回收沒在播的 `<video>` 的解碼資源（`readyState` 掉回 0，
       * `src` 還在）。若真是這樣，**換回同一個角色時會看到 rsAtTap=0
       * 而且 reloads>0**（必須整個重新載入）；如果回收理論錯了，
       * 就會是 rsAtTap=4、reloads=0。**一張截圖就能分辨。**
       */
      rsAtTap: [...document.querySelectorAll("#screen-pick .vp-video")]
        .map((v) => `${v.classList.contains("vp-video-b") ? "B" : "A"}${v.readyState}`).join(" "),
      reloads: 0,
      /**
       * **真正的「畫面順不順」。**
       *
       * 2026-09-08 睿哥：「你能不能認真測試」—— 他說得對，我一直在量
       * 「多久翻牌」跟「`currentTime` 有沒有前進」，**這兩個都抓不到掉格**：
       * 影片可以 `currentTime` 正常前進、主執行緒也不忙，而合成器在丟畫格，
       * 看起來就是頓。
       *
       * ⚠️ 這兩項**在雲端量不出來**（headless Chromium 不做真正的合成，
       * `totalVideoFrames` 回 -1／0），**但在 iOS Safari 上是真的數字** ——
       * 所以這一欄只有睿哥的截圖能回答。
       *
       *   掉格      `getVideoPlaybackQuality()`：解出來卻沒被畫出去的畫格
       *   畫格間隔  `requestVideoFrameCallback()`：**真的被畫到螢幕上**的
       *             那一格與前一格差多久。3 秒 30fps 的片正常約 33ms，
       *             一旦看到 100ms 以上就是肉眼看得到的頓。
       */
      q0: null, dropped: 0, total: 0,
      frameGapMax: 0, frameGapAt: 0, frameGaps: 0,
      netAt: performance.now(),
    };
    render();
  }

  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.id = "hf-debug-hud";   // 回歸測試靠這個 id 確認「不帶參數時完全不存在」
    // ⚠️ 摘要釘上方、事件日誌釘下方，**中間讓出來給立繪** ——
    // 睿哥要一邊看動畫一邊截圖，面板把舞台蓋住就等於沒得判斷。
    box.style.cssText = [
      "position:fixed", "left:4px", "right:4px", "top:4px", "z-index:99999",
      "font:11px/1.4 ui-monospace,Menlo,monospace",
      "pointer-events:none",
    ].join(";");
    sumEl = document.createElement("div");
    sumEl.style.cssText = [
      "color:#fff", "background:rgba(120,0,0,.92)", "border:2px solid #f55",
      "padding:6px 7px", "border-radius:6px", "white-space:pre-wrap",
      "font-weight:600",
    ].join(";");
    logEl = document.createElement("div");
    logEl.style.cssText = [
      "position:fixed", "left:4px", "right:4px", "bottom:4px", "z-index:99999",
      "font:10px/1.35 ui-monospace,Menlo,monospace",
      "color:#9effa1", "background:rgba(0,0,0,.86)", "border:1px solid #3a5",
      "padding:4px 6px", "border-radius:6px", "white-space:pre-wrap",
      "pointer-events:none", "max-height:30vh", "overflow:hidden",
    ].join(";");
    box.appendChild(sumEl);
    document.body.appendChild(box);
    document.body.appendChild(logEl);
    return box;
  }

  /** 這次點擊之後、網路上跑過哪些影片（用 Performance API，不必攔截 fetch） */
  function netSince(ms) {
    try {
      return performance.getEntriesByType("resource")
        .filter((e) => e.startTime >= ms && /\/videos\/.*\.(mp4|webm)/.test(e.name))
        .map((e) => {
          const n = e.name.split("/mobile/")[1] || e.name.split("/").pop();
          return `${n.split("?")[0]} @${Math.round(e.startTime - ms)}ms`;
        });
    } catch (_) { return []; }
  }

  /** 掛上「真的被畫出來的那一格」的回呼（Safari 15.4+／Chrome 支援） */
  function watchFrames(v) {
    if (!v || typeof v.requestVideoFrameCallback !== "function") return;
    if (v.__hfFrameHook) return;
    v.__hfFrameHook = true;
    const step = (now) => {
      /**
       * ⚠️ **兩種「不算掉格」的情況都要排除，否則數字會騙人。**
       *
       * 1. **影片還沒露臉**：翻牌動畫期間影片是 `opacity:0`，本來就不會有
       *    畫格被畫出來。睿哥 2026-09-08 那張「379ms @364ms」就同時混了
       *    「翻牌期間的空白」和「真正的播放中掉格」，分不出來。
       * 2. **暫停期間**：無縫循環會把不在畫面上的那顆暫停，而**暫停中不會
       *    觸發這個回呼** —— 基準值就停在三秒前，一交棒回來就被算成一次
       *    2833ms 的假大跳（實測 20 秒會生出 7 筆全是假的）。
       *
       * 所以基準值存在元素上，由 100ms 那圈輪詢在「不是 active」時清掉 ——
       * 不能只靠回呼自己清，因為它在該清的時候正好不會被呼叫。
       */
      const last = v.__hfFrameLast || 0;
      v.__hfFrameLast = now;
      if (last && cur && v.classList.contains("is-active")) {
        const gap = now - last;
        if (gap > 100) {                 // 一格 33ms，超過 100ms 就是掉了好幾格
          cur.frameGaps++;
          if (gap > cur.frameGapMax) {
            cur.frameGapMax = Math.round(gap);
            cur.frameGapAt = Math.round(now - t0);
          }
        }
      }
      try { v.requestVideoFrameCallback(step); } catch (_) {}
    };
    try { v.requestVideoFrameCallback(step); } catch (_) {}
  }

  function render() {
    ensureBox();
    if (!cur) { sumEl.textContent = "診斷面板已啟動 —— 點一個角色開始"; return; }
    const dl = netSince(cur.netAt);
    sumEl.textContent = [
      `【${cur.id}】`,
      `翻牌      ${cur.flipMs == null ? "還沒…" : cur.flipMs + "ms"}   來源 ${cur.src}`,
      `影片卡頓  ${cur.stallMs}ms`,
      `畫面凍住  最久 ${cur.jankMax}ms @${cur.jankAt}ms ／ 合計 ${cur.jankSum}ms`,
      `循環頓    ${cur.waits} 次${cur.waitAt.length ? " @" + cur.waitAt.slice(-4).join(",") + "ms" : ""}`,
      `點下當時  ${cur.rsAtTap}   之後重新載入 ${cur.reloads} 次`,
      `掉格      ${cur.dropped} / ${cur.total} 格`,
      `畫格間隔  超過 100ms ${cur.frameGaps} 次   最久 ${cur.frameGapMax}ms @${cur.frameGapAt}ms`,
      `同時下載  ${dl.length ? dl.join("  ") : "無"}`,
    ].join("\n");
    logEl.textContent = lines.join("\n");
  }

  function log(s) {
    lines.push(`${String(Math.round(performance.now() - t0)).padStart(5)} ${s}`);
    while (lines.length > LOG_LINES) lines.shift();
    render();
  }

  /** 選角舞台是 A／B 兩顆 <video> 交替，事件一定要分得出來是哪一顆。 */
  function tagOf(v) {
    return v.classList.contains("vp-video-b") ? "B" : "A";
  }

  function activeVideo() {
    const all = [...document.querySelectorAll("#screen-pick .vp-video")];
    return all.find((v) => v.classList.contains("is-active") && v.dataset.src)
        || all.find((v) => v.dataset.src);
  }

  function bufOf(v) {
    const b = v.buffered;
    if (!b.length) return "0段";
    const seg = [];
    for (let i = 0; i < b.length; i++) seg.push(`${b.start(i).toFixed(1)}-${b.end(i).toFixed(1)}`);
    return `${b.length}段 ${seg.join(",")}/${(v.duration || 0).toFixed(1)}`;
  }

  const hooked = new WeakSet();
  function hook(v) {
    if (hooked.has(v)) return;
    hooked.add(v);
    ["loadstart", "loadedmetadata", "loadeddata", "canplay", "canplaythrough",
     "playing", "waiting", "stalled", "suspend", "error"].forEach((e) => {
      v.addEventListener(e, () => {
        const src = (v.currentSrc || "").startsWith("blob:") ? "blob" : "net";
        /**
         * `waiting` ＝ 影片自己說「我沒東西可播了」。
         *
         * ⚠️ **就算整支都在本機 blob 裡也會發生** —— 等待片是 3 秒 `loop`，
         * WebKit 每次繞回開頭都會掉回 rs1 重新緩衝一次
         * （2026-09-08 在雲端量到 12ms，但那是桌機；手機可能大得多）。
         * 這種「每 3 秒頓一下」跟載入完全無關，**改再多載入邏輯都不會消失**，
         * 所以一定要單獨數出來。
         */
        if (cur && e === "loadstart") cur.reloads++;
        if (cur && (e === "waiting" || e === "stalled") && v.classList.contains("is-active")) {
          cur.waits++;
          cur.waitAt.push(Math.round(performance.now() - t0));
        }
        log(`${tagOf(v)} ${e.padEnd(14)} ${src} rs${v.readyState} ${bufOf(v)}`);
      });
    });
  }

  document.addEventListener("click", (e) => {
    const card = e.target.closest?.("#hero-grid .hero-card[data-id]");
    if (!card) return;
    reset(card.dataset.id);
    log(`── 點 ${card.dataset.id} ──`);
  }, true);

  // 影片自己播不動 → 影片卡頓
  setInterval(() => {
    document.querySelectorAll("#screen-pick .vp-video").forEach(hook);
    document.querySelectorAll("#screen-pick .vp-video").forEach(watchFrames);
    // 不在畫面上的那顆把基準清掉（見 watchFrames 的說明 —— 暫停中不會有回呼）
    document.querySelectorAll("#screen-pick .vp-video").forEach((v) => {
      if (!v.classList.contains("is-active")) v.__hfFrameLast = 0;
    });
    const v = activeVideo();
    if (!v || !cur) return;
    // 掉格：跟這一次點擊開始時的數字相減
    try {
      if (typeof v.getVideoPlaybackQuality === "function") {
        const q = v.getVideoPlaybackQuality();
        if (!cur.q0) cur.q0 = { d: q.droppedVideoFrames, t: q.totalVideoFrames };
        cur.dropped = q.droppedVideoFrames - cur.q0.d;
        cur.total = q.totalVideoFrames - cur.q0.t;
      }
    } catch (_) {}
    const src = (v.currentSrc || "").startsWith("blob:") ? "blob" : "net";
    if (!v.paused && v.readyState >= 2 && v.currentTime > 0) {
      if (cur.flipMs == null) {            // 畫面第一次真的動起來
        cur.flipMs = Math.round(performance.now() - t0);
        cur.src = src;
      }
      const ct = +v.currentTime.toFixed(2);
      if (v.__hfLastCt === ct) cur.stallMs += 100;
      v.__hfLastCt = ct;
    }
    render();
  }, 100);

  // 主執行緒被佔住 → 畫面凍住。**跟影片卡頓是兩回事，一定要分開量。**
  let lastFrame = performance.now();
  (function frame(now) {
    const gap = now - lastFrame;
    lastFrame = now;
    if (gap > JANK_MS && cur) {
      const at = Math.round(now - t0);
      cur.jankSum += Math.round(gap);
      if (gap > cur.jankMax) { cur.jankMax = Math.round(gap); cur.jankAt = at; }
      log(`🧊 畫面凍住 ${Math.round(gap)}ms`);
    }
    requestAnimationFrame(frame);
  })(performance.now());

  // 載入後量一次真實下載速度
  window.addEventListener("load", () => {
    setTimeout(async () => {
      try {
        const man = await window.HF_VideoPlayer?.loadManifest?.();
        const id = Object.keys(man || {})[0];
        if (!id) return;
        const u = window.HF_VideoPlayer.versioned(man[id].wait) + "&spd=" + Date.now();
        const t = performance.now();
        const r = await fetch(u, { cache: "no-store" });
        const buf = await r.arrayBuffer();
        const ms = performance.now() - t;
        log(`實測網速 ${(buf.byteLength / 1024).toFixed(0)}K / ${(ms / 1000).toFixed(2)}s = ${(buf.byteLength / 1024 / (ms / 1000)).toFixed(0)}KB/s`);
      } catch (_) {}
    }, 1500);
  });

  render();
})();
