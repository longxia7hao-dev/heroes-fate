/**
 * 選角影片診斷面板 —— **只在網址帶 `?debug=1` 時啟用，平常完全不執行**。
 *
 * 為什麼需要它：雲端 session 沒有 Safari、解不了 H.264、也接不到睿哥的手機，
 * 所以「影片在他機器上到底怎麼卡的」一直只能從螢幕錄影反推。
 * 這個面板把 `<video>` 的真實狀態直接畫在畫面上，他截一張圖就是第一手事實。
 *
 * 顯示的每一項都是為了分辨一種可能：
 *   src=blob/net   Blob 有沒有真的被用到（v1.88 的重點）
 *   rs             readyState：0 沒東西 / 1 有中繼資料 / 2 有第一幀 / 3 可播 / 4 估計可播完
 *   buf            緩衝了幾段、涵蓋到哪裡 —— **多段代表中間有洞**（Safari 走 Range 常見）
 *   事件序列        playing / waiting / stalled 的先後，卡住時一定看得到 waiting
 *   STALL          真正的卡頓：沒被暫停、currentTime 卻不前進
 */
(() => {
  "use strict";
  if (!/[?&]debug=1/.test(location.search)) return;

  const MAX_LINES = 14;
  const lines = [];
  let box = null;
  let t0 = performance.now();

  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.id = "hf-debug-hud";
    box.style.cssText = [
      "position:fixed", "left:4px", "right:4px", "top:4px", "z-index:99999",
      "font:11px/1.35 ui-monospace,Menlo,monospace", "color:#9effa1",
      "background:rgba(0,0,0,.86)", "border:1px solid #3a5",
      "padding:5px 6px", "border-radius:6px", "white-space:pre-wrap",
      "pointer-events:none", "max-height:52vh", "overflow:hidden",
    ].join(";");
    document.body.appendChild(box);
    return box;
  }

  function log(s) {
    lines.push(`${String(Math.round(performance.now() - t0)).padStart(5)} ${s}`);
    while (lines.length > MAX_LINES) lines.shift();
    ensureBox().textContent = lines.join("\n");
  }

  /** 目前選角舞台上、真的在用的那顆 video */
  function activeVideo() {
    return [...document.querySelectorAll("#screen-pick .vp-video")]
      .find((v) => v.classList.contains("is-active") && v.dataset.src)
      || [...document.querySelectorAll("#screen-pick .vp-video")]
        .find((v) => v.dataset.src);
  }

  function bufOf(v) {
    const b = v.buffered;
    if (!b.length) return "0段";
    const seg = [];
    for (let i = 0; i < b.length; i++) seg.push(`${b.start(i).toFixed(1)}-${b.end(i).toFixed(1)}`);
    return `${b.length}段 ${seg.join(",")}/${(v.duration || 0).toFixed(1)}`;
  }

  /**
   * 選角舞台是 A／B 兩顆 `<video>` 交替（一顆在播、一顆在預熱下一支）。
   * **兩顆的事件一定要分得出來**：2026-09-07 睿哥的截圖裡
   * `playing` 之後 4ms 冒出的那個 `loadstart`，其實是另一顆在抓 confirm ——
   * 沒有 A／B 標記時看起來像同一顆在重抓，會把人帶往完全錯的方向。
   */
  function tagOf(v) {
    return v.classList.contains("vp-video-b") ? "B" : "A";
  }

  const hooked = new WeakSet();
  function hook(v) {
    if (hooked.has(v)) return;
    hooked.add(v);
    // waiting／stalled 是「餓死」的直接證據；suspend 代表瀏覽器自己停止下載
    ["loadstart", "loadedmetadata", "loadeddata", "canplay", "canplaythrough",
     "playing", "waiting", "stalled", "suspend", "error"].forEach((e) => {
      v.addEventListener(e, () => {
        const src = (v.currentSrc || "").startsWith("blob:") ? "blob" : "net";
        log(`${tagOf(v)} ${e.padEnd(14)} ${src} rs${v.readyState} ${bufOf(v)}`);
      });
    });
  }

  // 點角色＝一次新的觀察，把時間軸歸零
  document.addEventListener("click", (e) => {
    const card = e.target.closest?.("#hero-grid .hero-card[data-id]");
    if (!card) return;
    t0 = performance.now();
    lines.length = 0;
    log(`── 點 ${card.dataset.id} ──`);
  }, true);

  // 每 100ms 掃一次：抓 STALL，並在狀態變動時記一行
  let last = null;
  setInterval(() => {
    // 兩顆都要掛，否則預熱那顆的下載完全看不到（正是 v1.90 抓到的兇手）
    document.querySelectorAll("#screen-pick .vp-video").forEach(hook);
    const v = activeVideo();
    if (!v) return;
    const src = (v.currentSrc || "").startsWith("blob:") ? "blob" : "net";
    const key = `${src}|${v.readyState}|${v.paused}|${bufOf(v)}`;
    const ct = +v.currentTime.toFixed(2);
    if (key !== last) {
      last = key;
      log(`${tagOf(v)} state          ${src} rs${v.readyState} ${v.paused ? "暫停" : "播放"} ${bufOf(v)}`);
    }
    // 沒被暫停、readyState 夠、currentTime 卻不動 → 真的卡住了
    if (!v.paused && v.readyState >= 2) {
      if (v.__hfLastCt === ct) {
        v.__hfStall = (v.__hfStall || 0) + 100;
        if (v.__hfStall % 400 === 0) log(`⚠ STALL ${v.__hfStall}ms @${ct}s ${bufOf(v)}`);
      } else v.__hfStall = 0;
      v.__hfLastCt = ct;
    }
  }, 100);

  // 網路實測：抓一支等待片，量真實下載速度
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

  log("診斷面板已啟動 —— 點一個角色開始");
})();
