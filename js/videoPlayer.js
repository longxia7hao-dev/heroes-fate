/**
 * Hero Sora video player
 * - wait: loop while browsing pick
 * - confirm: play once on lock-in (wait canplay, hard-capped)
 * - victory: play once on win film
 */
window.HF_VideoPlayer = (() => {
  const MANIFEST_VERSION = "13";
  const MEDIA_VERSION = "13";
  /** 攻擊／勝利短片維持現有節奏；選角確定片必須以原始速度完整播放。 */
  const CLIP_RATE = 1.3;
  const CONFIRM_RATE = 1;
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

  function versioned(url) {
    if (!url) return null;
    return url + (url.includes("?") ? "&" : "?") + `v=${MEDIA_VERSION}`;
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
      still.src = `assets/heroes/${id}.png?v=2`;
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

    async function play(id, playKind = "wait") {
      if (destroyed || !id) return;
      const token = ++playToken;
      currentId = id;
      setBadge(playKind === "confirm" ? "鎖定中…" : "");
      root.classList.toggle("vp-confirm", playKind === "confirm");
      setState("loading");
      // 不預先鋪方形立繪：等影片就緒直接播，避免先出現比例不同的靜圖

      await loadManifest();
      if (destroyed || token !== playToken) return;

      const url = videoUrl(id, playKind);
      if (!url) {
        showStill(id);
        setBadge("");
        return;
      }

      const src = versioned(url);
      const target = video.dataset.src === src ? video : standby;
      if (!target) {
        showStill(id);
        return;
      }
      if (target.dataset.src !== src) {
        setSource(target, src, { loop: playKind === "wait", preload: "auto" });
        await waitEvent(target, "canplay", 1400);
        if (destroyed || token !== playToken) return;
      }
      target.loop = playKind === "wait";

      try {
        target.currentTime = 0;
        target.defaultPlaybackRate = 1;
        target.playbackRate = 1;
      } catch (_) {}

      try {
        const p = target.play();
        if (p && typeof p.then === "function") await p;
        if (destroyed || token !== playToken) return;
        activateVideo(target, token);
        setState("playing");
        if (playKind === "wait") primeMedia(id, "confirm");
      } catch (_) {
        if (token === playToken) {
          showStill(id);
          setBadge("");
        }
      }
    }

    /**
     * Play once; always resolves within maxMs.
     */
    function playOnce(id, playKind = "confirm", maxMs = 4200, nextWaitId = null) {
      return new Promise(async (resolve) => {
        if (destroyed || !id) return resolve();
        const token = ++playToken;
        currentId = id;
        let settled = false;
        let timer = 0;
        let target = video;
        const maxTotalMs = Math.max(450, maxMs | 0);
        const startedAt = performance.now();

        const finish = () => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
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

        setBadge(playKind === "confirm" ? "鎖定中…" : "播放中…");
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
        // 載不動就直接收尾，不要呆等硬上限（手機網路差時會像卡住）
        if (target.error || target.readyState < 2) return finish();

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
