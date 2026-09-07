/**
 * Hero Sora video player
 * - wait: loop while browsing pick
 * - confirm: play once on lock-in (wait canplay, hard-capped)
 * - victory: play once on win film
 */
window.HF_VideoPlayer = (() => {
  const MANIFEST_VERSION = "15";
  const MEDIA_VERSION = "32";
  /** 立繪／頭像／poster 的版本，必須與 game.js 的 ART_VERSION 一致 */
  const ART_VERSION = "6";
  /** 攻擊／勝利短片維持現有節奏；選角確定片必須以原始速度完整播放。 */
  const CLIP_RATE = 1.3;
  const CONFIRM_RATE = 1;
  /**
   * 等到這麼久還沒開播就放棄等待，讓呼叫端往下走（舞台維持空的召喚陣）。
   * 這只是保險：慢速網路上 `video.play()` 的 promise 會一直 pending，
   * 沒有硬上限就會把呼叫端永遠掛住 —— 那正是「動畫從來沒出現」的原始 bug。
   */
  const REVEAL_GIVEUP_MS = 8000;
  /**
   * 選角等待片的「不要卡住」預算。
   *
   * `playing` 事件只代表**第一幀解出來了**，不代表後面接得上。睿哥的實際連線
   * 約 130KB/s、等待片平均 168K（≈1.3 秒），所以一就緒就開播的結果是
   * **播一下又靜止約 1.9 秒**（兩支螢幕錄影逐幀分析：1.67s／1.87s）。
   *
   * 改成：先用已在快取裡的頭像把牌翻開（實測 376ms），影片**整支緩衝完**
   * 才接手。總等待時間差不多，但不會出現「動一下又結凍」的觀感。
   *
   *   GRACE   影片本來就在快取裡的話這段時間內就緩衝完了 → 直接揭露影片，不必先閃頭像
   *   TIMEOUT 緩衝不完也不能無限等，逾時就退回原本的行為（有第一幀就上）。
   *           168K÷130KB/s≈1.3s、最大的 paladin 315K≈2.4s，3 秒是留了餘裕的上限
   */
  const BUFFER_GRACE_MS = 300;
  const BUFFER_TIMEOUT_MS = 3000;
  /**
   * 逾時之後還願意在背景等多久。這段期間畫面上是頭像靜圖（乾淨的），
   * 緩衝完就無縫換成影片；等不到就一直是靜圖 —— 那也比一直頓好。
   * 20 秒：睿哥最慢的情況（315K ÷ 130KB/s ≈ 2.4 秒）也遠遠夠用，
   * 留這麼寬是為了訊號更差時仍有機會補上。
   */
  const LATE_TAKEOVER_MS = 20000;
  // 影片清單的抓取上限。fetch() 沒有內建 timeout，弱訊號 4G 上一個「連上了
  // 但不回應」的連線會讓整段演出吊死，所以一定要自己掐。
  const MANIFEST_TIMEOUT_MS = 6000;
  let manifest = null;
  let manifestPromise = null;

  /**
   * 影片清單。**這是全部影片的單一故障點** —— 它拿不到，`videoUrl()` 對每個
   * 角色、每種片型都會回 null，選角片、確認片、魔王降臨會一起消失。
   * 睿哥 2026-09-05 回報的「影片載入不了了，到魔王降臨就卡住」就是這裡。
   *
   * 舊版有兩個各自足以造成永久災情的問題：
   *
   * 1. **失敗會變成永久狀態**：`catch` 裡寫 `manifest = {}`，而 `{}` 是 truthy，
   *    第一行的 `if (manifest) return` 就再也不會重抓 —— 弱訊號 4G 上偶爾一次
   *    失敗，這一整個 session 的影片就全滅，重試也沒用。
   *    改成**失敗時把 `manifestPromise` 清掉、`manifest` 維持 null**，下次呼叫重抓。
   *
   * 2. **`fetch()` 本身沒有 timeout**：連線卡住（不是斷線，是不回應）時這個
   *    promise 永遠不 settle，`await loadManifest()` 就整段吊死 —— 魔王降臨
   *    卡住不動正是這個。改成 `AbortController` + 6 秒上限。
   *
   * 另外會**驗證內容**：弱訊號下截斷的 JSON 一樣是 HTTP 200，parse 不動就當失敗，
   * 不要把半截的東西當成正常清單（Service Worker 那邊也加了同樣的把關）。
   */
  function loadManifest() {
    if (manifest) return Promise.resolve(manifest);
    if (!manifestPromise) {
      const ctrl =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl
        ? setTimeout(() => {
            try { ctrl.abort(); } catch (_) {}
          }, MANIFEST_TIMEOUT_MS)
        : null;
      manifestPromise = fetch(
        `assets/videos/manifest.json?v=${MANIFEST_VERSION}`,
        ctrl ? { signal: ctrl.signal } : undefined
      )
        .then((r) => {
          if (!r.ok) throw new Error(`manifest HTTP ${r.status}`);
          return r.json();
        })
        .then((j) => {
          if (!j || typeof j !== "object" || !Object.keys(j).length) {
            throw new Error("manifest empty");
          }
          manifest = j;
          return manifest;
        })
        .catch(() => {
          // 不留下 `manifest = {}` 這種「成功地拿到空清單」的假象，
          // 讓下一次呼叫可以重新抓一遍。
          manifestPromise = null;
          return {};
        })
        .finally(() => {
          if (timer) clearTimeout(timer);
        });
    }
    return manifestPromise;
  }

  function videoUrl(heroId, kind, bossId) {
    const m = manifest?.[heroId];
    if (!m) return null;
    if (kind === "victory") return m.victory || m.attack || m.confirm || m.wait || null;
    if (kind === "final") return m.final || null;
    if (kind === "attack") return m.attack || m.confirm || m.wait || null;
    if (kind === "confirm") return m.confirm || m.wait || null;
    return m.wait || m.confirm || null;
  }

  function waitEvent(el, name, timeoutMs) {
    if (name === "canplay" && el?.readyState >= 3) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener(name, onOk);
        el.removeEventListener("error", onErr);
        clearTimeout(t);
        resolve();
      };
      const onOk = () => finish();
      const onErr = () => finish();
      el.addEventListener(name, onOk, { once: true });
      el.addEventListener("error", onErr, { once: true });
      const t = setTimeout(finish, timeoutMs);
    });
  }

  /**
   * 逐檔內容雜湊優先（見 tools/gen_asset_versions.py）。
   * 這樣只換一支影片時，其他 69 支的網址不變，手機不會整包重抓；
   * 版本表還沒載入或查不到時才退回全域 MEDIA_VERSION。
   */
  function assetVersion(path, fallback) {
    return window.HF_ASSET_V?.[path] || fallback;
  }

  function versioned(url) {
    if (!url) return null;
    return url + (url.includes("?") ? "&" : "?") + `v=${assetVersion(url, MEDIA_VERSION)}`;
  }

  /**
   * 這支影片是不是**真的整支緩衝完了**（從頭到尾連續一段）。
   *
   * ⚠️ **刻意不用 `canplaythrough` / `readyState >= 4`**。規格上那只是
   * 「以目前下載速度*估計*可以播完不中斷」—— 是估計，不是事實。實測
   * （Chromium，影片限速 130KB/s）`canplaythrough` 跟 `playing` **每次都在同一毫秒**
   * 觸發，等於完全沒有等到。睿哥手機上會卡住 1.9 秒，正是這個估計失準：
   * 頻寬還要分給角色 BGM 與其他素材，實際到不了估計的速度。
   *
   * 等待片只有約 168K（3.04s），整支等完在 130KB/s 上也才 1.3 秒，
   * 所以直接要求「全部緩衝完」——**確定的事實，跨瀏覽器都一樣**。
   */
  /* ── 自己握住影片位元組（Blob）─────────────────────────────────────
   *
   * **為什麼非這樣不可**：2026-09-07 實測（限速 130KB/s、伺服器有送
   * `ETag`／`Last-Modified`）——**預抓完全沒有被 `<video>` 重用**：
   *   用 `fetch()` 預抓完 knight → `<video>` 播同一支，又跟伺服器要了 2 次
   *   改用隱藏的 `<video preload="auto">` 預熱 → 第二顆 `<video>` 仍重抓 1641ms
   * 也就是說 v1.80 以來的預抓只是在搶頻寬。要讓預載真的有用，
   * **只剩一條路：位元組自己留著，播放時餵 `blob:` URL** ——
   * blob 由瀏覽器自己供應，網路與 Service Worker 都不在播放路徑上。
   *
   * ⚠️ **不要跟 v1.69 那次的 Service Worker 混為一談**（專案鐵則第 6 條）。
   * 那次是讓 SW 去合成媒體回應，iOS Safari 上會整個播不動。
   * `blob:` 是完全不同的機制：瀏覽器自己持有的位元組，沒有攔截、沒有合成。
   *
   * ⚠️ **退路必須是「逾時」而不是「error」。** 上次 iOS 的失效模式是
   * **不報錯、也永遠不會變成可播** —— 接 `error` 事件根本接不住。
   * 這裡改成：blob 來源的影片若在 `BLOB_PROVE_MS` 內連第一幀都拿不到，
   * 就**整場停用 blob 並改用原本的網路網址重載**。最差就是退回今天的行為。
   */
  const blobUrls = new Map();     // 正規網址 → blob: URL
  let blobsOk = true;
  const BLOB_PROVE_MS = 2500;     // blob 影片要在這段時間內至少拿到第一幀

  /**
   * 等待片整支緩衝完之前，**不准開第二個下載**。這是預抓 confirm 的等待上限；
   * 超過就乾脆不預抓（按「決定」時再抓，那時線是空的）。理由見
   * `primeConfirmWhenSafe()` 的註解 —— 2026-09-07 睿哥實機診斷的結論。
   */
  const CONFIRM_PRIME_WAIT_MS = 20000;
  const CONFIRM_PRIME_POLL_MS = 250;

  /**
   * 由 `game.js` 注入：「等待片的背景預抓還有事情要做嗎？」
   * 回 true 代表**還在抓**，這時候不准去碰 confirm。
   */
  let waitWarmBusy = null;
  function setWaitWarmProbe(fn) { waitWarmBusy = fn; }

  /** 有 blob 就用 blob，否則用原本的網址。**必須同步**（setSource 是同步的）。 */
  function blobSrc(src) {
    return (blobsOk && blobUrls.get(src)) || src;
  }

  /** 把一支影片整個抓下來留著。已經有就直接回 true。 */
  async function storeBlob(src, signal) {
    if (!blobsOk || !src) return false;
    if (blobUrls.has(src)) return true;
    try {
      const res = await fetch(src, signal ? { signal } : undefined);
      if (!res || res.status !== 200) return false;
      const blob = await res.blob();
      if (!blob || !blob.size) return false;
      if (blobUrls.has(src)) return true;           // 期間別人先存好了
      blobUrls.set(src, URL.createObjectURL(blob));
      return true;
    } catch (_) {
      return false;
    }
  }

  function hasBlob(src) {
    return blobsOk && blobUrls.has(src);
  }

  /** blob 播不動：整場停用並全部釋放，呼叫端會改用網路網址。 */
  function disableBlobs() {
    if (!blobsOk) return;
    blobsOk = false;
    for (const url of blobUrls.values()) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
    blobUrls.clear();
  }

  function fullyBuffered(el) {
    if (!el || !el.duration || !isFinite(el.duration)) return false;
    const b = el.buffered;
    if (!b.length) return false;
    // ⚠️ **必須是「一段連續」的範圍。**
    // 原本只看 `start(0)` 與 `end(length-1)` —— 那是第一段的頭與最後一段的尾，
    // **中間有洞也會被判成完整**。Chromium 走這條路徑時永遠只有一段，所以在
    // 雲端測不出來；但 **Safari 用 Range 請求時很常產生多段**，一旦中間缺一塊，
    // 播到那裡就會餓死 —— 正是「已經緩衝完了卻還是凍住」的成因之一。
    if (b.length !== 1) return false;
    return b.start(0) <= 0.05 && b.end(0) >= el.duration - 0.15;
  }

  /**
   * 等到影片整支緩衝完。逾時回 false，由呼叫端決定怎麼退。
   *
   * 用輪詢而不是只掛事件：這條路徑上的影片在等待期間是**被暫停又藏起來**的
   * （`revealPrepared()` 揭露靜圖時會 pause 掉所有 video），媒體事件在那種狀態
   * 下最不可靠，`progress` 也不保證密集。輪詢 `buffered` 是唯一穩的。
   *
   * @returns {Promise<boolean>} 是否在期限內緩衝完成
   */
  function waitUntilBuffered(el, timeoutMs) {
    if (!el) return Promise.resolve(false);
    if (fullyBuffered(el)) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearTimeout(timer);
        resolve(ok);
      };
      // 50ms：實測 WebKit 在 play() 回來時往往「差一點就緩衝完」，
      // 輪詢間隔就是這條路徑白等的時間，壓小一點沒有成本。
      const poll = setInterval(() => {
        if (fullyBuffered(el)) finish(true);
      }, 50);
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  /**
   * @param {HTMLElement} container
   * @param {{hint?: string}} opts
   */
  function create(container, opts = {}) {
    const root = document.createElement("div");
    root.className = "vp-root";
    root.innerHTML = `
      <div class="vp-frame">
        <video class="vp-video vp-video-a" playsinline webkit-playsinline muted></video>
        <video class="vp-video vp-video-b" playsinline webkit-playsinline muted></video>
        <img class="vp-still" alt="" hidden />
        <div class="vp-badge" hidden></div>
      </div>
    `;
    container.innerHTML = "";
    container.appendChild(root);

    const videos = [...root.querySelectorAll(".vp-video")];
    const still = root.querySelector(".vp-still");
    const badge = root.querySelector(".vp-badge");

    let destroyed = false;
    let playToken = 0;
    // currentId 是最新請求；visibleId 只有媒體真的在 90° 揭露點接手後才更新。
    // 兩者分開可避免同一角色快速連點時，把「正在載入」誤判成「已顯示」。
    let currentId = null;
    let visibleId = null;
    let video = videos[0];
    let standby = videos[1];
    // 選角翻牌會先把下一支 wait 片播到第一幀，但要等卡牌轉到 90°
    // 才真正換上畫面。這個 pending 只保存「已可揭露」的媒體，不會改選角狀態。
    let pendingReveal = null;
    let primeGeneration = 0;
    let primedTarget = null;
    let primedSrc = "";

    videos.forEach((el) => {
      el.preload = "metadata";
      el.disablePictureInPicture = true;
      el.muted = true;
      el.playsInline = true;
      el.preservesPitch = false;
    });

    function setState(name) {
      root.dataset.state = name;
    }

    function setBadge(text) {
      if (!text) {
        badge.hidden = true;
        badge.textContent = "";
        return;
      }
      badge.hidden = false;
      badge.textContent = text;
    }

    /**
     * 頂替用的靜圖一律用**選角卡那張 240×322 頭像**（13KB），不要用 512×512 立繪（280KB）。
     * 頭像在選角格上已經顯示過、必定在快取裡，所以是 0 位元組就能立刻出現；
     * 立繪反而會在網路已經塞爆時再排一個 280KB 的請求，結果就是破圖的 ?。
     */
    function primeStill(id) {
      if (!id) return;
      const p = `assets/heroes/portraits/${id}.jpg`;
      still.src = `${p}?v=${assetVersion(p, ART_VERSION)}`;
      still.hidden = false;
    }

    function showStill(id) {
      pendingReveal = null;
      currentId = id || currentId;
      primeStill(currentId);
      videos.forEach((el) => {
        el.classList.remove("is-active");
        el.hidden = true;
        try { el.pause(); } catch (_) {}
      });
      root.classList.remove("vp-video-ready", "vp-confirm");
      setState("fallback");
      visibleId = currentId;
      // 整支缺檔的防呆路徑：這時沒有動畫要等了，靜圖就是最終畫面，舞台要揭開
      try { opts.onShown?.(visibleId); } catch (_) {}
    }

    /**
     * 影片真的載不動時，準備已在選角格快取裡的 3:4 頭像當後備。
     * 先保持 hidden，等翻牌 90° 的同一個揭露點才顯示；不會再先閃 512×512 方圖。
     */
    async function queueFallback(id, token) {
      if (destroyed || !id || token !== playToken) return false;
      currentId = id;
      const p = `assets/heroes/portraits/${id}.jpg`;
      const src = `${p}?v=${assetVersion(p, ART_VERSION)}`;
      still.dataset.src = src;
      still.src = src;
      still.hidden = true;
      videos.forEach((el) => {
        try { el.pause(); } catch (_) {}
      });

      // 縮圖通常已在 hero grid 快取；若還沒完成，最多等 1.2 秒。只有真的
      // 有像素才建立 pending，避免缺圖時翻走卡背後留下透明空框。
      if (!(still.complete && still.naturalWidth > 0)) {
        const loaded = await new Promise((resolve) => {
          let done = false;
          const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            still.removeEventListener("load", onLoad);
            still.removeEventListener("error", onError);
            resolve(ok);
          };
          const onLoad = () => finish(true);
          const onError = () => finish(false);
          const timer = setTimeout(() => finish(false), 1200);
          still.addEventListener("load", onLoad, { once: true });
          still.addEventListener("error", onError, { once: true });
        });
        if (!loaded) return false;
      }
      if (
        destroyed ||
        token !== playToken ||
        still.dataset.src !== src ||
        !still.naturalWidth
      ) return false;

      pendingReveal = { type: "still", id, token, src };
      setState("fallback-ready");
      return true;
    }

    function prepareFallback(id) {
      if (destroyed || !id) return Promise.resolve(false);
      primeGeneration++;
      primedTarget = null;
      primedSrc = "";
      const token = ++playToken;
      pendingReveal = null;
      currentId = id;
      return queueFallback(id, token);
    }

    function activateVideo(target, token, id = currentId) {
      if (destroyed || token !== playToken || !target) return false;
      pendingReveal = null;
      if (target === primedTarget) {
        primedTarget = null;
        primedSrc = "";
      }
      const previous = video;
      target.hidden = false;
      target.classList.add("is-active");
      videos.forEach((el) => {
        if (el === target) return;
        el.classList.remove("is-active");
        try { el.pause(); } catch (_) {}
      });
      video = target;
      standby = previous === target
        ? videos.find((el) => el !== target)
        : previous;
      still.hidden = true;
      root.classList.add("vp-video-ready");
      currentId = id || currentId;
      visibleId = id || currentId;
      // 影片真的上畫面了才通知呼叫端揭開舞台。放在這裡而不是 play() 裡，
      // 是因為確定動畫（playOnce）走的是另一條路徑，漏掉它就會「動畫在
      // 被隱藏的舞台裡播完」——玩家什麼都沒看到。
      try { opts.onShown?.(visibleId); } catch (_) {}
      return true;
    }

    /** 在翻牌轉到 90° 的那一刻，才把已就緒的影片／後備頭像換上畫面。 */
    function revealPrepared(id) {
      const pending = pendingReveal;
      if (
        destroyed ||
        !pending ||
        pending.token !== playToken ||
        pending.id !== id
      ) return false;

      if (pending.type === "video") {
        // standby 可能被手指預熱碰過；來源不再相符就絕不揭露錯角色。
        if (
          !pending.target ||
          pending.target.dataset.src !== pending.src ||
          pending.target.readyState < 2
        ) return false;
        pendingReveal = null;
        // 準備期間影片可在不可見層先觸發 playing；真正揭露時歸零，確保
        // 翻回正面看到的是完整待選動畫開頭，而不是已偷跑數百毫秒。
        try { pending.target.currentTime = 0; } catch (_) {}
        if (!activateVideo(pending.target, pending.token, pending.id)) return false;
        try {
          const resume = pending.target.play();
          resume?.catch?.(() => {});
        } catch (_) {}
        setState("playing");
        if (pending.playKind === "wait") {
          primeConfirmWhenSafe(id, pending.target, pending.token);
        }
        return true;
      }

      if (
        still.dataset.src !== pending.src ||
        !still.complete ||
        !still.naturalWidth
      ) return false;
      pendingReveal = null;
      videos.forEach((el) => {
        el.classList.remove("is-active");
        el.hidden = true;
        try { el.pause(); } catch (_) {}
      });
      still.hidden = false;
      root.classList.remove("vp-video-ready", "vp-confirm");
      setState("fallback");
      currentId = pending.id;
      visibleId = pending.id;
      try { opts.onShown?.(visibleId); } catch (_) {}
      return true;
    }

    function setSource(target, src, { loop = false, preload = "auto" } = {}) {
      if (!target || !src) return;
      target.loop = loop;
      target.preload = preload;
      target.muted = true;
      target.playsInline = true;
      target.hidden = false;
      try {
        target.defaultPlaybackRate = 1;
        target.playbackRate = 1;
      } catch (_) {}
      if (target.dataset.src === src) return;
      try { target.pause(); } catch (_) {}
      target.classList.remove("is-active");
      // ⚠️ `dataset.src` **一律存正規網址**（不是 blob:）——
      // `videos.find((v) => v.dataset.src === src)` 之類的比對到處都是。
      target.dataset.src = src;
      const actual = blobSrc(src);
      target.src = actual;
      if (actual !== src) {
        // 逾時退路：blob 若連第一幀都給不出來（iOS 上是「不報錯也不會好」），
        // 整場停用 blob 並用原本的網址重載一次。
        setTimeout(() => {
          if (target.dataset.src !== src) return;      // 已經換別支了
          if (target.readyState >= 2 || !blobsOk) return;
          disableBlobs();
          target.src = src;
          try { target.load(); } catch (_) {}
        }, BLOB_PROVE_MS);
      }
      try { target.load(); } catch (_) {}
    }

    function primeMedia(id, kind) {
      if (destroyed || !id || !standby || standby === video) return;
      const url = videoUrl(id, kind);
      if (!url) return;
      const src = versioned(url);
      setSource(standby, src, {
        loop: kind === "wait",
        preload: "auto",
      });
      if (standby === primedTarget && primedSrc !== src) {
        primedTarget = null;
        primedSrc = "";
      }
    }

    /**
     * 等待片播起來之後才預抓 confirm —— **但排在等待片預抓的後面**。
     *
     * 2026-09-07 睿哥 iPhone 實機（`?debug=1`）四次點擊給出的事實：
     *
     *     武鬥宗師  blob → 影片 9ms 就上場，順的
     *     僧侶      net  → 1089ms
     *     大魔導師  net  →  990ms
     *     龍騎士    net  →  974ms
     *
     * **卡的來源就是「沒預抓到」**：一支 110〜200K 的片在他約 130KB/s 的線上
     * 要將近 1 秒，這是物理，除非事先抓好。有抓到 blob 的那支是 9ms。
     *
     * 而每點一個角色，舊版還會**再抓一支 confirm**（約 160K、實測佔線 1.1 秒）——
     * 那是他**只是路過、根本沒按「決定」**的角色。瀏覽 10 個角色就白花 1.6MB，
     * 比整個等待片庫（14 支共約 2.3MB）還多。那些頻寬本來該拿去預抓下一支等待片。
     *
     * 所以優先順序寫死：**等待片永遠排在 confirm 前面。**
     *   ① 自己這支等待片要先整支緩衝完（blob 來源立刻滿足）
     *   ② 而且背景的等待片預抓要沒事做了
     * 兩個條件都成立才去預抓 confirm；`CONFIRM_PRIME_WAIT_MS` 內等不到就**不抓**。
     *
     * 不抓的代價很小：按「決定」時 `playOnce("confirm")` 本來就會等 canplay，
     * 而且那時畫面上有「鎖定中…」。**一次鎖定多等一下，好過每次瀏覽都卡一秒。**
     */
    function primeConfirmWhenSafe(id, target, token) {
      if (destroyed || !id || !target) return;
      const deadline = Date.now() + CONFIRM_PRIME_WAIT_MS;
      const tick = () => {
        if (destroyed || token !== playToken || currentId !== id) return;
        if (Date.now() > deadline) return;               // 放棄預抓，不是錯誤
        const ready = fullyBuffered(target) && !(waitWarmBusy && waitWarmBusy());
        if (ready) primeMedia(id, "confirm");
        else setTimeout(tick, CONFIRM_PRIME_POLL_MS);
      };
      tick();
    }

    /**
     * Warm the first wait clip before the pick screen is shown, then its confirm.
     * This never changes currentId or selection state.
     */
    async function prepare(id) {
      if (destroyed || !id) return;
      await loadManifest();
      if (destroyed) return;

      const waitUrl = videoUrl(id, "wait");
      if (!waitUrl) return;
      const waitTarget = video;
      setSource(waitTarget, versioned(waitUrl), { loop: true, preload: "auto" });
      if (waitTarget.readyState < 3) {
        await waitEvent(waitTarget, "canplay", 1400);
      }
      if (destroyed || (currentId && currentId !== id)) return;

      const confirmUrl = videoUrl(id, "confirm");
      const confirmTarget = standby && standby !== waitTarget ? standby : null;
      if (confirmUrl && confirmTarget) {
        setSource(confirmTarget, versioned(confirmUrl), {
          loop: false,
          preload: "auto",
        });
      }
    }

    /**
     * 使用者已按到某張卡時，只在「待命槽」暖該角色影片。
     * 和 prepare() 不同，這條路徑絕不暫停目前正在播放的角色；手指滑開取消
     * 也不會讓舞台閃空。真正的選擇與 currentId 仍只由 play() 改變。
     */
    async function prime(id, kind = "wait") {
      if (destroyed || !id) return;
      if (pendingReveal) return;
      // current 與 visible 不同代表另一支待選片仍在解碼；pointer 預熱不能
      // 共用它的 standby。真正 click 會用新 playToken 安全接手。
      if (currentId && currentId !== visibleId) return;
      if (kind === "wait" && visibleId === id) return;
      const generation = ++primeGeneration;
      const token = playToken;
      await loadManifest();
      if (
        destroyed ||
        pendingReveal ||
        (currentId && currentId !== visibleId) ||
        generation !== primeGeneration ||
        token !== playToken
      ) return;
      const target = standby && standby !== video ? standby : null;
      const url = videoUrl(id, kind);
      if (!target || !url) return;
      const src = versioned(url);
      setSource(target, src, {
        loop: kind === "wait",
        preload: "auto",
      });
      if (destroyed || generation !== primeGeneration || token !== playToken) return;
      primedTarget = target;
      primedSrc = src;
    }

    /** 取消一次沒有形成 click 的手指預熱，且絕不碰 active／pending 影片。 */
    function cancelPrime() {
      primeGeneration++;
      const target = primedTarget;
      const src = primedSrc;
      primedTarget = null;
      primedSrc = "";
      if (
        !target ||
        target.classList.contains("is-active") ||
        pendingReveal?.target === target ||
        target.dataset.src !== src
      ) return;
      try { target.pause(); } catch (_) {}
      try {
        target.removeAttribute("src");
        target.removeAttribute("data-src");
        target.hidden = true;
        target.load();
      } catch (_) {}
    }

    /**
     * 揭幕訊號：**只有影片真的開演**才 resolve(true)。
     * 睿哥指定「進入任何動畫前不要跑出角色的大頭圖案」，所以載入中不頂任何靜圖，
     * 舞台就維持空的召喚陣，等 `playing` 事件到了才揭開。
     * 硬上限純粹是保險，避免呼叫端被 pending 的 play() promise 永遠掛住。
     */
    function beginReveal() {
      let settled = false;
      let result = false;
      let resolveFn = () => {};
      const promise = new Promise((r) => { resolveFn = r; });
      const done = (ok) => {
        if (settled) return;
        settled = true;
        result = !!ok;
        clearTimeout(timer);
        resolveFn(result);
      };
      const timer = setTimeout(() => done(false), REVEAL_GIVEUP_MS);
      return {
        promise,
        done,
        get settled() { return settled; },
        get result() { return result; },
      };
    }

    /** @returns {Promise<boolean>} 影片是否真的出現在畫面上 */
    function play(id, playKind = "wait") {
      return startPlay(id, playKind, false);
    }

    /**
     * 先播到第一幀但暫不換畫面；由 revealPrepared() 在翻牌中點揭露。
     * @returns {Promise<boolean>} 是否已有可揭露的影片／manifest 後備
     */
    function prepareReveal(id, playKind = "wait") {
      return startPlay(id, playKind, true);
    }

    function startPlay(id, playKind, deferShow) {
      if (destroyed || !id) return Promise.resolve(false);
      primeGeneration++;
      primedTarget = null;
      primedSrc = "";
      const token = ++playToken;
      pendingReveal = null;
      currentId = id;
      setBadge(playKind === "confirm" ? "鎖定中…" : "");
      root.classList.toggle("vp-confirm", playKind === "confirm");
      setState("loading");
      const reveal = beginReveal();
      runPlay(id, playKind, token, reveal, { deferShow }).catch(() => reveal.done(false));
      return reveal.promise;
    }

    async function runPlay(id, playKind, token, reveal, { deferShow = false } = {}) {
      await loadManifest();
      if (destroyed || token !== playToken) return reveal.done(false);

      const url = videoUrl(id, playKind);
      if (!url) {
        if (deferShow) return reveal.done(await queueFallback(id, token));
        showStill(id);
        setBadge("");
        return reveal.done(true);
      }

      const src = versioned(url);

      // 換角立刻收掉舊角色：寧可空一拍召喚陣，也不要停在上一位。
      const alreadyThis = videos.some((v) => v.dataset.src === src && v.readyState >= 2);
      if (!deferShow && !alreadyThis) {
        videos.forEach((v) => {
          if (v.dataset.src !== src) v.classList.remove("is-active");
        });
        visibleId = null;
        try { opts.onHide?.(); } catch (_) {}
      }

      // iOS 同時只能播一支：先全部暫停，再決定用哪一個緩衝。
      videos.forEach((v) => {
        try { v.pause(); } catch (_) {}
      });

      let target = videos.find((v) => v.dataset.src === src)
        || (standby && standby !== video ? standby : video)
        || video;
      if (!target) {
        if (deferShow) return reveal.done(await queueFallback(id, token));
        showStill(id);
        return reveal.done(true);
      }
      if (target.dataset.src !== src) {
        setSource(target, src, { loop: playKind === "wait", preload: "auto" });
      }
      target.loop = playKind === "wait";

      try {
        target.currentTime = 0;
        target.defaultPlaybackRate = 1;
        target.playbackRate = 1;
      } catch (_) {}

      // 選角的等待片走「先翻牌、影片緩衝完再接手」；其餘（確定片、演出片）維持原樣。
      const smoothWait = deferShow && playKind === "wait";

      /** 把已就緒的影片掛成待揭露內容（翻牌 90° 由 revealPrepared 換上）。 */
      const queueVideoReveal = () => {
        // `playing` 代表第一幀已解碼。先在不可見層暫停並歸零，等卡牌
        // 轉到 90° 才重新播放，因此不會在翻牌期間偷跑。
        try { target.pause(); } catch (_) {}
        try { target.currentTime = 0; } catch (_) {}
        pendingReveal = { type: "video", id, token, target, playKind, src };
        setState("ready");
      };

      let tookOver = false;
      /**
       * 影片緩衝完成時的接手路徑。揭露點可能還沒到，也可能早就過去了 ——
       * **這正是雲端那次改 `canplaythrough` 失敗的地方**：只走 pendingReveal
       * 的話，牌一旦已經用頭像翻開就再也沒有人會來消費它，影片永遠不上場。
       *
       *   - 揭露點還沒到 → 把待揭露內容從靜圖換成影片，翻牌中點一次揭露，不閃兩段
       *   - 揭露點已過去 → 直接 activateVideo 換掉靜圖
       */
      const takeOverWithVideo = () => {
        if (tookOver || destroyed || token !== playToken) return;
        if (!target || target.dataset.src !== src || target.readyState < 2) return;
        tookOver = true;
        const pending = pendingReveal;
        if (pending && pending.type === "still" && pending.token === token && pending.id === id) {
          queueVideoReveal();
          return;
        }
        try { target.currentTime = 0; } catch (_) {}
        if (!activateVideo(target, token, id)) return;
        try {
          const resume = target.play();
          resume?.catch?.(() => {});
        } catch (_) {}
        setState("playing");
        primeConfirmWhenSafe(id, target, token);
      };

      let shown = false;
      const showVideo = () => {
        if (shown || destroyed || token !== playToken || reveal.settled) return;
        shown = true;
        if (deferShow) {
          queueVideoReveal();
          reveal.done(true);
          return;
        }
        activateVideo(target, token, id);
        setState("playing");
        reveal.done(true);
        if (playKind === "wait") primeConfirmWhenSafe(id, target, token);
      };
      if (!smoothWait) target.addEventListener("playing", showVideo, { once: true });

      const tryPlay = async (el) => {
        const p = el.play();
        if (p && typeof p.then === "function") await p;
      };

      try {
        await tryPlay(target);
        if (destroyed || token !== playToken) return reveal.done(false);
        if (!smoothWait) {
          showVideo();
          return;
        }

        // ① 先給影片一小段時間。本來就在快取裡（或 v1.80 的閒置預抓已經拿過）
        //    的話這時就緒了 —— 直接照原本的路徑揭露影片，不必先閃一張頭像。
        if (await waitUntilBuffered(target, BUFFER_GRACE_MS)) {
          if (destroyed || token !== playToken) return reveal.done(false);
          tookOver = true;
          queueVideoReveal();
          return reveal.done(true);
        }
        if (destroyed || token !== playToken) return reveal.done(false);

        // ② 影片還在下載 —— 先用已在選角格快取裡的 13K 頭像把牌翻開（實測 376ms），
        //    別讓玩家盯著卡背等 1.3 秒。這條後備路徑本來就是對的，原樣沿用。
        const stillReady = await queueFallback(id, token);
        if (destroyed || token !== playToken) return reveal.done(false);
        if (stillReady) reveal.done(true);

        // ③ 緩衝到能一路播完才讓影片接手。
        const buffered = await waitUntilBuffered(target, BUFFER_TIMEOUT_MS - BUFFER_GRACE_MS);
        if (destroyed || token !== playToken) return reveal.done(false);
        if (target.dataset.src !== src || target.readyState < 2) {
          // 連第一幀都還沒有：交給呼叫端自己的後備（prepareFallback）
          if (!reveal.settled) reveal.done(false);
          return;
        }
        if (!reveal.settled) {
          // 頭像後備失敗過，沒有東西可以先翻 → 維持原本「翻牌中點揭露影片」的行為
          tookOver = true;
          queueVideoReveal();
          return reveal.done(true);
        }
        if (buffered) {
          takeOverWithVideo();
          return;
        }

        /**
         * ④ **逾時了 —— 絕對不要放行沒緩衝完的影片。**
         *
         * v1.84 這裡是「有第一幀就上，寧可卡一下也不要永遠停在靜圖」。
         * 但睿哥的線速（約 130KB/s）本來就常常達不到 3 秒的預算，
         * 所以那個保險**每一支都會觸發** —— 就是他回報的
         * 「每隻角色第一次載入的時候都會卡」。
         *
         * 而「永遠停在靜圖」是假的兩難：頭像已經在畫面上了（乾淨、不會抖），
         * 我們可以繼續在背景等，真的緩衝完再無縫接手。
         * **一張清楚的靜圖，永遠好過一段一直頓的影片。**
         */
        waitUntilBuffered(target, LATE_TAKEOVER_MS).then((ok) => {
          if (ok) takeOverWithVideo();
        });
      } catch (_) {
        target.removeEventListener("playing", showVideo);
        if (destroyed || token !== playToken) return reveal.done(false);
        // deferred 選角不可拿目前可見的 active 緩衝重試；iOS 拒播時改準備
        // 已快取的 3:4 頭像，卡背會一直留到後備像素就緒。
        if (deferShow) {
          return reveal.done(await queueFallback(id, token));
        }
        // 雙緩衝在 iOS 上常被擋：改在目前這顆 video 上換 src 再播。
        try {
          if (video && video !== target) {
            videos.forEach((v) => { try { v.pause(); } catch (e) {} });
            setSource(video, src, { loop: playKind === "wait", preload: "auto" });
            target = video;
            target.addEventListener("playing", showVideo, { once: true });
            await tryPlay(target);
            if (destroyed || token !== playToken) return reveal.done(false);
            showVideo();
            return;
          }
        } catch (e2) {
          target.removeEventListener("playing", showVideo);
        }
        if (token === playToken) setBadge("");
        reveal.done(false);
      }
    }

    /**
     * Play once; always resolves within maxMs.
     */
    function playOnce(id, playKind = "confirm", maxMs = 4200, nextWaitId = null, opts = {}) {
      return new Promise(async (resolve) => {
        if (destroyed || !id) return resolve();
        primeGeneration++;
        primedTarget = null;
        primedSrc = "";
        const token = ++playToken;
        pendingReveal = null;
        currentId = id;
        let settled = false;
        let timer = 0;
        let target = video;
        const maxTotalMs = Math.max(450, maxMs | 0);
        const startedAt = performance.now();

        // 點一下就收掉這段動畫（想看完的人就別點）。等到影片真的開始播才算，
        // 並留一段寬限期，免得按「決定」那一下的殘留觸控立刻把動畫跳掉。
        const tapSkip = !!opts.tapSkip;
        const tapGraceMs = Number.isFinite(opts.tapGraceMs) ? opts.tapGraceMs : 500;
        const tapTarget = opts.tapTarget || root;
        let playStartedAt = 0;
        const onTap = () => {
          if (settled || !playStartedAt) return;
          if (performance.now() - playStartedAt < tapGraceMs) return;
          finish();
        };

        const finish = () => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (tapSkip) tapTarget.removeEventListener("click", onTap);
          target?.removeEventListener("ended", onEnded);
          target?.removeEventListener("error", onError);
          setBadge("");
          root.classList.remove("vp-confirm");
          setState("holding");
          videos.forEach((el) => {
            try { el.pause(); } catch (_) {}
            try {
              el.defaultPlaybackRate = 1;
              el.playbackRate = 1;
            } catch (_) {}
          });
          still.hidden = true;
          resolve();
        };

        const onEnded = () => finish();
        const onError = () => finish();

        const baseBadge = playKind === "confirm" ? "鎖定中…" : "播放中…";
        // 換行而不是全形空白：擠在同一行時「點一下跳過」會被框寬折成很醜的位置。
        // `.vp-badge` 有 white-space: pre-line + text-align: center 接這個 \n。
        setBadge(tapSkip ? `${baseBadge}\n點一下跳過` : baseBadge);
        root.classList.toggle("vp-confirm", playKind === "confirm");
        setState("confirm-loading");
        timer = setTimeout(finish, maxTotalMs);

        try {
          await loadManifest();
        } catch (_) {
          return finish();
        }
        if (destroyed || token !== playToken) return finish();

        const url = videoUrl(id, playKind);
        if (!url) {
          showStill(id);
          return finish();
        }

        const src = versioned(url);
        target = standby?.dataset.src === src
          ? standby
          : video.dataset.src === src
            ? video
            : standby;
        if (!target) return finish();
        setSource(target, src, { loop: false, preload: "auto" });
        target.addEventListener("ended", onEnded, { once: true });
        target.addEventListener("error", onError, { once: true });

        // iOS 同時只能播一支，先把另一顆停掉。
        videos.forEach((el) => {
          if (el !== target) {
            try { el.pause(); } catch (_) {}
            el.classList.remove("is-active");
          }
        });

        if (target.readyState < 2) {
          await waitEvent(target, "loadeddata", 2400);
        }
        if (destroyed || token !== playToken || settled) return finish();
        if (target.error) return finish();

        try {
          target.currentTime = 0;
        } catch (_) {}

        // 鎖定動畫維持 1× 原速；不可因其他短片節奏或音樂功能而被加速。
        try {
          const rate = playKind === "confirm" ? CONFIRM_RATE : CLIP_RATE;
          target.defaultPlaybackRate = rate;
          target.playbackRate = rate;
        } catch (_) {}

        try {
          const p = target.play();
          if (p && typeof p.then === "function") await p;
          if (destroyed || token !== playToken || settled) return finish();
          activateVideo(target, token, id);
          setState("playing");
          playStartedAt = performance.now();
          if (tapSkip) tapTarget.addEventListener("click", onTap);
          if (nextWaitId) primeMedia(nextWaitId, "wait");
        } catch (_) {
          finish();
        }
      });
    }

    function pause() {
      if (destroyed) return;
      primeGeneration++;
      primedTarget = null;
      primedSrc = "";
      playToken++;
      pendingReveal = null;
      currentId = null;
      visibleId = null;
      videos.forEach((el) => {
        el.classList.remove("is-active");
        try { el.pause(); } catch (_) {}
        try {
          el.defaultPlaybackRate = 1;
          el.playbackRate = 1;
        } catch (_) {}
      });
      root.classList.remove("vp-confirm", "vp-video-ready");
      setBadge("");
      still.hidden = true;
      setState("paused");
    }

    function stop() {
      if (destroyed) return;
      pause();
      videos.forEach((el) => {
        try {
          el.removeAttribute("src");
          el.removeAttribute("data-src");
          el.load();
        } catch (_) {}
      });
      setState("idle");
    }

    function destroy() {
      stop();
      destroyed = true;
      root.remove();
    }

    return {
      play,
      prepareReveal,
      revealPrepared,
      prepareFallback,
      playOnce,
      prepare,
      prime,
      cancelPrime,
      pause,
      stop,
      destroy,
      el: root,
      setBadge,
      get currentId() { return currentId; },
      get visibleId() { return visibleId; },
    };
  }

  // fullyBuffered 給 game.js 的背景預抓當閘門用（見 warmLineFree()）
  return {
    create, loadManifest, videoUrl, versioned, storeBlob, hasBlob,
    fullyBuffered, setWaitWarmProbe,
  };
})();
