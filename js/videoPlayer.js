/**
 * Hero Sora video player
 * - wait: loop while browsing pick
 * - confirm: play once on lock-in (wait canplay, hard-capped)
 * - victory: play once on win film
 */
window.HF_VideoPlayer = (() => {
  const MANIFEST_VERSION = "14";
  const MEDIA_VERSION = "27";
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
  let manifest = null;
  let manifestPromise = null;

  function loadManifest() {
    if (manifest) return Promise.resolve(manifest);
    if (!manifestPromise) {
      manifestPromise = fetch(`assets/videos/manifest.json?v=${MANIFEST_VERSION}`)
        .then((r) => r.json())
        .then((j) => {
          manifest = j || {};
          return manifest;
        })
        .catch(() => {
          manifest = {};
          return manifest;
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
    let currentId = null;
    let video = videos[0];
    let standby = videos[1];

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
      currentId = id || currentId;
      primeStill(currentId);
      videos.forEach((el) => {
        el.classList.remove("is-active");
        el.hidden = true;
        try { el.pause(); } catch (_) {}
      });
      root.classList.remove("vp-video-ready", "vp-confirm");
      setState("fallback");
      // 整支缺檔的防呆路徑：這時沒有動畫要等了，靜圖就是最終畫面，舞台要揭開
      try { opts.onShown?.(currentId); } catch (_) {}
    }

    function activateVideo(target, token) {
      if (destroyed || token !== playToken || !target) return false;
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
      // 影片真的上畫面了才通知呼叫端揭開舞台。放在這裡而不是 play() 裡，
      // 是因為確定動畫（playOnce）走的是另一條路徑，漏掉它就會「動畫在
      // 被隱藏的舞台裡播完」——玩家什麼都沒看到。
      try { opts.onShown?.(currentId); } catch (_) {}
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
      target.dataset.src = src;
      target.src = src;
      try { target.load(); } catch (_) {}
    }

    function primeMedia(id, kind) {
      if (destroyed || !id || !standby || standby === video) return;
      const url = videoUrl(id, kind);
      if (!url) return;
      setSource(standby, versioned(url), {
        loop: kind === "wait",
        preload: "auto",
      });
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
      if (kind === "wait" && currentId === id) return;
      const token = playToken;
      await loadManifest();
      if (destroyed || token !== playToken) return;
      const target = standby && standby !== video ? standby : null;
      const url = videoUrl(id, kind);
      if (!target || !url) return;
      setSource(target, versioned(url), {
        loop: kind === "wait",
        preload: "auto",
      });
    }

    /**
     * 揭幕訊號：**只有影片真的開演**才 resolve(true)。
     * 睿哥指定「進入任何動畫前不要跑出角色的大頭圖案」，所以載入中不頂任何靜圖，
     * 舞台就維持空的召喚陣，等 `playing` 事件到了才揭開。
     * 硬上限純粹是保險，避免呼叫端被 pending 的 play() promise 永遠掛住。
     */
    function beginReveal() {
      let settled = false;
      let resolveFn = () => {};
      const promise = new Promise((r) => { resolveFn = r; });
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveFn(!!ok);
      };
      const timer = setTimeout(() => done(false), REVEAL_GIVEUP_MS);
      return { promise, done };
    }

    /** @returns {Promise<boolean>} 影片是否真的出現在畫面上 */
    function play(id, playKind = "wait") {
      if (destroyed || !id) return Promise.resolve(false);
      const token = ++playToken;
      currentId = id;
      setBadge(playKind === "confirm" ? "鎖定中…" : "");
      root.classList.toggle("vp-confirm", playKind === "confirm");
      setState("loading");
      const reveal = beginReveal();
      runPlay(id, playKind, token, reveal).catch(() => reveal.done(false));
      return reveal.promise;
    }

    async function runPlay(id, playKind, token, reveal) {
      await loadManifest();
      if (destroyed || token !== playToken) return reveal.done(false);

      const url = videoUrl(id, playKind);
      if (!url) {
        showStill(id);
        setBadge("");
        return reveal.done(true);
      }

      const src = versioned(url);

      // 換角立刻收掉舊角色：寧可空一拍召喚陣，也不要停在上一位。
      const alreadyThis = videos.some((v) => v.dataset.src === src && v.readyState >= 2);
      if (!alreadyThis) {
        videos.forEach((v) => {
          if (v.dataset.src !== src) v.classList.remove("is-active");
        });
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

      let shown = false;
      const showVideo = () => {
        if (shown || destroyed || token !== playToken) return;
        shown = true;
        activateVideo(target, token);
        setState("playing");
        reveal.done(true);
        if (playKind === "wait") primeMedia(id, "confirm");
      };
      target.addEventListener("playing", showVideo, { once: true });

      const tryPlay = async (el) => {
        const p = el.play();
        if (p && typeof p.then === "function") await p;
      };

      try {
        await tryPlay(target);
        if (destroyed || token !== playToken) return reveal.done(false);
        showVideo();
      } catch (_) {
        target.removeEventListener("playing", showVideo);
        if (destroyed || token !== playToken) return reveal.done(false);
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
        const token = ++playToken;
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
        setBadge(tapSkip ? `${baseBadge}　點一下跳過` : baseBadge);
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
          activateVideo(target, token);
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
      playToken++;
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

    return { play, playOnce, prepare, prime, pause, stop, destroy, el: root, setBadge, get currentId() { return currentId; } };
  }

  return { create, loadManifest, videoUrl, versioned };
})();
