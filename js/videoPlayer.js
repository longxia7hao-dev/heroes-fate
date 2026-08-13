/**
 * Hero Sora video player
 * - wait: loop while browsing pick
 * - confirm: play once on lock-in (wait canplay, hard-capped)
 * - victory: play once on win film
 */
window.HF_VideoPlayer = (() => {
  const MANIFEST_VERSION = "13";
  const MEDIA_VERSION = "14";
  /** 立繪／頭像／poster 的版本，必須與 game.js 的 ART_VERSION 一致 */
  const ART_VERSION = "4";
  /** 攻擊／勝利短片維持現有節奏；選角確定片必須以原始速度完整播放。 */
  const CLIP_RATE = 1.3;
  const CONFIRM_RATE = 1;
  /**
   * 待命片沒能在這時間內開播，就先亮立繪頂著。
   * 4G 首次載入時影片要好幾秒，沒有這層舞台會一直停在空的召喚陣。
   */
  const STILL_FALLBACK_MS = 260;
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

  function videoUrl(heroId, kind) {
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

    function primeStill(id) {
      if (!id) return;
      const p = `assets/heroes/${id}.png`;
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
    }

    /** 目前畫面上是否已經有影片在演（有的話就別用靜圖蓋掉它） */
    function hasVisibleVideo() {
      return videos.some((el) => el.classList.contains("is-active"));
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
     * 「舞台上已經有東西了」的訊號。呼叫端（選角頁）靠它決定何時揭開舞台，
     * 所以它必須在影片開播 **或** 立繪頂上時就 resolve —— 不能等 video.play()。
     * 慢速網路上 play() 的 promise 會一直 pending，等它就等於永遠不揭開。
     */
    function beginReveal(id, token) {
      let settled = false;
      let resolveFn = () => {};
      const promise = new Promise((r) => { resolveFn = r; });
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveFn();
      };
      const timer = setTimeout(() => {
        if (!destroyed && token === playToken && !hasVisibleVideo()) primeStill(id);
        done();
      }, STILL_FALLBACK_MS);
      return { promise, done };
    }

    function play(id, playKind = "wait") {
      if (destroyed || !id) return Promise.resolve();
      const token = ++playToken;
      currentId = id;
      setBadge(playKind === "confirm" ? "鎖定中…" : "");
      root.classList.toggle("vp-confirm", playKind === "confirm");
      setState("loading");
      const reveal = beginReveal(id, token);
      runPlay(id, playKind, token, reveal).catch(() => reveal.done());
      return reveal.promise;
    }

    async function runPlay(id, playKind, token, reveal) {
      await loadManifest();
      if (destroyed || token !== playToken) return reveal.done();

      const url = videoUrl(id, playKind);
      if (!url) {
        showStill(id);
        setBadge("");
        return reveal.done();
      }

      const src = versioned(url);
      const target = video.dataset.src === src ? video : standby;
      if (!target) {
        showStill(id);
        return reveal.done();
      }
      if (target.dataset.src !== src) {
        setSource(target, src, { loop: playKind === "wait", preload: "auto" });
        await waitEvent(target, "canplay", 1400);
        if (destroyed || token !== playToken) return reveal.done();
      }
      target.loop = playKind === "wait";

      try {
        target.currentTime = 0;
        target.defaultPlaybackRate = 1;
        target.playbackRate = 1;
      } catch (_) {}

      // 以 playing 事件當「真的開演」的訊號：影片晚幾秒才就緒也換得掉立繪。
      let shown = false;
      const showVideo = () => {
        if (shown || destroyed || token !== playToken) return;
        shown = true;
        activateVideo(target, token);
        setState("playing");
        reveal.done();
        if (playKind === "wait") primeMedia(id, "confirm");
      };
      target.addEventListener("playing", showVideo, { once: true });

      try {
        const p = target.play();
        if (p && typeof p.then === "function") await p;
        if (destroyed || token !== playToken) return reveal.done();
        showVideo();
      } catch (_) {
        target.removeEventListener("playing", showVideo);
        if (token === playToken) {
          showStill(id);
          setBadge("");
        }
        reveal.done();
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
          root.classList.remove("vp-confirm", "vp-video-ready");
          setState("holding");
          videos.forEach((el) => {
            el.classList.remove("is-active");
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

        if (target.readyState < 3) {
          await waitEvent(target, "canplay", Math.min(560, Math.max(220, (maxMs | 0) - 180)));
        }
        if (destroyed || token !== playToken || settled) return finish();
        // 載不動就直接收尾，不要呆等硬上限（手機網路差時會像卡住）。
        // 但畫面上若連待命片都沒有，先用立繪頂一拍再收，至少讓玩家看到自己選的角色。
        if (target.error || target.readyState < 2) {
          if (hasVisibleVideo()) return finish();
          showStill(id);
          const left = maxTotalMs - (performance.now() - startedAt);
          if (timer) clearTimeout(timer);
          timer = setTimeout(finish, Math.max(0, Math.min(900, left)));
          return;
        }

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

    return { play, playOnce, prepare, pause, stop, destroy, el: root, setBadge };
  }

  return { create, loadManifest, videoUrl, versioned };
})();
