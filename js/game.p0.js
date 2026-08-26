(() => {
  "use strict";

  window.HF_GAME_START = function HF_GAME_START() {
  const appEl = document.getElementById("app");
  if (!appEl) return;
  if (appEl.dataset.hfInit === "1") {
    const boot = document.getElementById("screen-boot");
    const home = document.getElementById("screen-home");
    if (boot) boot.classList.remove("active");
    if (home) home.classList.add("active");
    document.body.dataset.screen = "home";
    appEl.setAttribute("data-screen", "home");
    return;
  }
  appEl.dataset.hfInit = "1";

  // 手機／舊瀏覽器：任何啟動錯誤都不要整頁白死
  try {
  if (!window.HF_DATA || !Array.isArray(window.HF_DATA.heroes)) {
    console.error("HF_DATA missing");
    document.body.innerHTML =
      '<div style="padding:2rem;font-family:sans-serif;background:#0a0818;color:#ffe08a;min-height:100vh">' +
      "<h1>英雄命運</h1><p>資料載入失敗，請重新整理。</p></div>";
    return;
  }

  const HEROES = window.HF_DATA.heroes;
  const $ = (s, r = document) => (r || document).querySelector(s);
  const $$ = (s, r = document) => [...(r || document).querySelectorAll(s)];
  const on = (el, ev, fn) => {
    if (el) el.addEventListener(ev, fn);
  };

  let pickBusy = false;
  /** 影片播放倍率：略快但動作仍自然 */
  const CLIP_RATE = 1.3;
  const PICK_CONFIRM_MAX_MS = 7200; // 6s 鎖定片以 1× 完整播放，另留載入／收尾緩衝
  /** 降臨影片播到這一刻下魔王吼聲（片長 6.04s，吼聲 2.2s，剛好收在片尾前） */
  const BOSS_ROAR_CUE_MS = 3400;

  /**
   * 背景預熱必須服從裝置與網路，而不是把所有影片一起塞給瀏覽器。
   * Safari 沒有 navigator.connection / deviceMemory 時會落到標準模式；
   * 只有明確開啟省流量、2G，或硬體非常受限時才停掉純裝飾動畫。
   */
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const effectiveType = String(connection?.effectiveType || "").toLowerCase();
  const deviceMemory = Number(navigator.deviceMemory || 0);
  const cpuCores = Number(navigator.hardwareConcurrency || 0);
  const MEDIA_POLICY = Object.freeze({
    constrainedNetwork: connection?.saveData === true || /(^|slow-)2g/.test(effectiveType),
    lite:
      connection?.saveData === true ||
      /(^|slow-)2g/.test(effectiveType) ||
      (deviceMemory > 0 && deviceMemory <= 2) ||
      (cpuCores > 0 && cpuCores <= 2),
  });
  document.documentElement.classList.toggle("perf-lite", MEDIA_POLICY.lite);

  function readSafeInset(side) {
    const probe = document.createElement("div");
    probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;padding-${side}:env(safe-area-inset-${side}, 0px)`;
    document.body.appendChild(probe);
    const value = parseFloat(getComputedStyle(probe)[`padding${side[0].toUpperCase()}${side.slice(1)}`]) || 0;
    probe.remove();
    return value;
  }

  function isEmbeddedAppChrome() {
    const ua = navigator.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    const inIframe = window.self !== window.top;
    const host = `${location.hostname} ${location.href} ${document.referrer || ""}`;
    if (inIframe || /grok|x\.ai/i.test(host)) return true;
    if (isIOS && /AppleWebKit/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua) && !/Version\//.test(ua)) return true;
    if (isIOS && /AppleWebKit/i.test(ua) && /Mobile\//.test(ua) && !/Safari\//.test(ua)) return true;
    if ((isIOS || isAndroid) && window.matchMedia("(pointer: coarse)").matches) return true;
    return false;
  }

  function syncAppChrome() {
    const vv = window.visualViewport;
    const innerH = window.innerHeight || 0;
    const visH = (vv && vv.height) || innerH;
    const offsetTop = Math.max(0, (vv && vv.offsetTop) || 0);
    const gapBottom = Math.max(0, innerH - visH - offsetTop);
    const safeTop = readSafeInset("top");
    const safeBottom = readSafeInset("bottom");
    const embedded = isEmbeddedAppChrome();
    const vvAccounts = visH < innerH - 24 || offsetTop > 8;
    let top = safeTop;
    let bottom = safeBottom;
    if (embedded && !vvAccounts) {
      top = Math.max(top, safeTop + 56);
      bottom = Math.max(bottom, safeBottom + 28);
    } else if (vvAccounts) {
      top = Math.max(top, offsetTop);
      bottom = Math.max(bottom, gapBottom);
    }
    document.documentElement.classList.toggle("in-app-chrome", embedded);
    const root = document.documentElement;
    root.style.setProperty("--overlay-top", `${Math.round(top)}px`);
    root.style.setProperty("--overlay-bottom", `${Math.round(bottom)}px`);
    root.style.setProperty("--app-height", "100%");
  }
  syncAppChrome();
  window.addEventListener("resize", syncAppChrome, { passive: true });
  window.visualViewport?.addEventListener("resize", syncAppChrome, { passive: true });
  window.visualViewport?.addEventListener("scroll", syncAppChrome, { passive: true });

  const state = {
    count: 4,
    players: [], // { heroId, hero }
    pickIndex: 0,
    selectedHeroId: null,
    mode: null,
    teamCount: 2,
    run: null,
    skip: false,
    opts: {
      allowSkip: true,
      fast: false,
      sound: window.HF_Audio?.getSettings?.().enabled !== false,
      strike: true,
      fateCard: true,
    },
    presenting: false,
  };

  /* ---- 懲罰／任務清單（本機可自訂，不影響任何抽籤機率） ---- */
  const DOOM_DEFAULTS = [
    "請大家喝一輪飲料",
    "負責洗碗",
    "唱一段歌給大家聽",
    "學一種動物叫三聲",
    "幫大家點餐並跑腿",
    "講一個冷笑話，沒人笑就再講一個",
    "下一局不能選上次的角色",
    "模仿在場一位的口頭禪",
    "做十下深蹲",
    "被全場問三個問題，都要老實回答",
  ];
  const DOOM_KEY = "hf_doom_list_v1";

  function loadDoomList() {
    try {
      const raw = localStorage.getItem(DOOM_KEY);
      if (!raw) return DOOM_DEFAULTS.slice();
      const list = raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      return list.length ? list : DOOM_DEFAULTS.slice();
    } catch (_) {
      return DOOM_DEFAULTS.slice();
    }
  }

  function saveDoomList(text) {
    try {
      localStorage.setItem(DOOM_KEY, text);
    } catch (_) {}
  }

  const screens = ["boot", "home", "count", "pick", "mode", "play", "result"];

  function haptic(ms = 10) {
    try {
      navigator.vibrate?.(ms);
    } catch (_) {}
  }

  function audioCue(name, options) {
    if (!state.opts.sound) return;
    window.HF_Audio?.cue?.(name, options);
  }

  /** 使用者是否在本次載入中親手按過首頁的音效按鈕（決定按鈕是開還是關） */
  let audioUserActivated = false;

  const AUDIO_ICON_ON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16.2 8.8a4.2 4.2 0 0 1 0 6.4"/><path d="M18.4 6.4a7.2 7.2 0 0 1 0 11.2"/></svg>';
  const AUDIO_ICON_OFF =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 10.5l6 6M22 10.5l-6 6"/></svg';

  function renderAudioStatus(status = window.HF_Audio?.getStatus?.()) {
    const button = $("#audio-activate");
    const icon = $("#audio-activate-icon");
    const title = $("#audio-activate-title");
    const sub = $("#audio-activate-sub");
    if (!button || !title || !sub) return;
    const enabled = window.HF_Audio?.getSettings?.().enabled !== false;
    if (icon) icon.innerHTML = enabled ? AUDIO_ICON_ON : AUDIO_ICON_OFF;
    const settingsIcon = $("#opt-sound-icon");
    if (settingsIcon) settingsIcon.innerHTML = enabled ? AUDIO_ICON_ON : AUDIO_ICON_OFF;
    button.setAttribute("aria-pressed", String(enabled));
    button.classList.remove("is-ready", "is-loading", "is-error", "is-muted");
    if (!enabled) {
      button.classList.add("is-muted");
      title.textContent = "完整音效已關閉 · 點此開啟";
      sub.textContent = "恢復背景音樂＋角色招式＋魔王怒吼";
    } else if (status?.lastError) {
      button.classList.add("is-error");
      title.textContent = "完整音效未啟動 · 點此重試";
      sub.textContent = "手機需要一次明確觸控授權";
    } else if (status?.ready) {
      button.classList.add("is-ready");
      title.textContent = "完整音效已開啟 · 點此關閉";
      sub.textContent = "背景音樂＋角色招式＋魔王怒吼";
    } else if (status?.unlocked) {
      button.classList.add("is-loading");
      title.textContent = "完整音效載入中…";
      sub.textContent = "第一次約需一至兩秒";
    } else {
      title.textContent = "點一下開啟完整音效";
      sub.textContent = "背景音樂＋角色招式＋魔王怒吼";
    }
  }

  let transitionTimer = 0;
  function playSceneTransition(name) {
    const veil = $("#scene-transition");
    if (!veil) return;
    clearTimeout(transitionTimer);
    veil.dataset.to = name;
    veil.classList.remove("is-playing");
    void veil.offsetWidth;
    veil.classList.add("is-playing");
    transitionTimer = setTimeout(() => veil.classList.remove("is-playing"), 480);
  }

  function show(name) {
    const previous = document.body.dataset.screen;
    if (previous && previous !== name) playSceneTransition(name);
    if (name !== "pick" && $("#screen-pick")?.classList.contains("active")) {
      stopPickPreview();
    }
    if (name !== "result" && $("#screen-result")?.classList.contains("active")) {
      stopResultPortrait();
    }
    if (previous === "mode" && name !== "play") releaseArrivalPrefetch();
    document.body.dataset.screen = name;
    $("#app")?.setAttribute("data-screen", name);
    screens.forEach((id) => {
      const el = $(`#screen-${id}`);
      if (el) el.classList.toggle("active", id === name);
    });
    window.HF_Audio?.setScene?.(name);
    if (name === "result") {
      const panel = $("#screen-result .result-panel");
      if (panel) panel.scrollTop = 0;
      if (previous !== "result") audioCue("result.settle", { group: "ui" });
    }
    if (name === "count") warmPickAssets();
    if (name === "mode") prefetchArrivalClip();
  }

  function heroById(id) {
    return HEROES.find((h) => h.id === id);
  }

  /** 立繪／頭像的快取版本：換圖時必須連帶提高，否則手機會一直吃舊快取 */
  const ART_VERSION = "6";
  /**
   * 圖檔網址一律走這裡：優先用 tools/gen_asset_versions.py 產生的逐檔雜湊，
   * 查不到才退回全域 ART_VERSION。只換幾張圖時，其餘圖的網址不變 → 手機不重抓。
   */
  function artUrl(path) {
    return `${path}?v=${window.HF_ASSET_V?.[path] || ART_VERSION}`;
  }

  function heroImg(id) {
    return artUrl(`assets/heroes/${id}.png`);
  }

  /** 選角縮圖：雲端「選擇角色縮圖」頭像（3:4） */
  function heroThumb(id) {
    return artUrl(`assets/heroes/portraits/${id}.jpg`);
  }

  function playerLabel(i) {
    return `玩家 ${i + 1}`;
  }

  function displayName(p, i) {
    // 無輸入名字：顯示「玩家N · 角色名」
    const h = p.hero || heroById(p.heroId);
    return `${playerLabel(i ?? p.slot ?? 0)}`;
  }

  function takenHeroIds() {
    return new Set(state.players.map((p) => p.heroId).filter(Boolean));
  }

  function setCount(n) {
    state.count = Math.max(2, Math.min(13, n | 0));
    $("#count-num").textContent = String(state.count);
    $("#count-range").value = String(state.count);
    const minus = $("#count-minus");
    const plus = $("#count-plus");
    if (minus) minus.disabled = state.count <= 2;
    if (plus) plus.disabled = state.count >= 13;
  }

  function ensurePlayers() {
    const old = state.players;
    state.players = Array.from({ length: state.count }, (_, i) => {
      const prev = old[i];
      if (prev?.heroId) return prev;
      return { heroId: null, hero: null };
    });
  }

  /** 清空所有角色鎖定（新局／重新選角用） */
  function clearPicks() {
    stopPickPreview();
    state.players = Array.from({ length: state.count }, () => ({
      heroId: null,
      hero: null,
    }));
    state.pickIndex = 0;
    state.selectedHeroId = null;
    pickBusy = false;
  }

  /* ---- PICK with models ---- */
  let pickVideo = null;
  let previewGen = 0;
  let resultPortraitGen = 0;
  let heroThumbsWarmed = false;
  const heroThumbWarmRefs = [];
  let pickFlipping = false;
  let pickFlipWait = null;
  let pickFlipQueued = null;

  function waitPoster(id) {
    return `assets/heroes/${id}.png`;
  }

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitTransform(el, fallbackMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener("transitionend", onEnd);
        resolve();
      };
      const onEnd = (e) => {
        if (e.target !== el) return;
        finish();
      };
      el.addEventListener("transitionend", onEnd);
      setTimeout(finish, fallbackMs);
    });
  }

  function preloadPoster(id) {
    if (!id) return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      const done = () => resolve();
      img.onload = done;
      img.onerror = done;
      img.src = waitPoster(id);
      setTimeout(done, 160);
    });
  }

  function showPickContent({ back = false, heroId = null } = {}) {
    const art = $("#pick-face-art");
    const backImg = $("#pick-face-back");
    if (back) {
      if (backImg) backImg.hidden = false;
      if (art) art.hidden = true;
      $("#sprite-stage")?.classList.remove("is-live");
      return;
    }
    if (backImg) backImg.hidden = true;
    if (art && heroId) {
      art.hidden = false;
      art.src = waitPoster(heroId);
    }
  }

  function revealPickVideoIfReady() {
    const id = state.selectedHeroId || state.players[state.pickIndex]?.heroId;
    if (id && pickVideo?.currentId === id) {
      $("#sprite-stage")?.classList.add("is-live");
    }
  }

  function flipPickCard({ back = false, heroId = null, instant = false } = {}) {
    const card = $("#pick-card");
    if (!card) return Promise.resolve();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduce) instant = true;

    if (instant) {
      card.classList.remove("is-out", "is-in-from", "no-anim");
      showPickContent({ back, heroId });
      return Promise.resolve();
    }

    if (pickFlipping) {
      pickFlipQueued = { back, heroId };
      return pickFlipWait || Promise.resolve();
    }

    pickFlipping = true;
    pickFlipWait = (async () => {
      try {
        if (heroId) await preloadPoster(heroId);
        card.classList.remove("is-in-from", "no-anim");
        card.classList.add("is-out");
        await waitTransform(card, 300);
        showPickContent({ back, heroId });
        $("#sprite-stage")?.classList.remove("is-live");
        card.classList.add("no-anim");
        card.classList.remove("is-out");
        card.classList.add("is-in-from");
        void card.offsetWidth;
        card.classList.remove("no-anim");
        card.classList.remove("is-in-from");
        await waitTransform(card, 340);
      } finally {
        pickFlipping = false;
        const queued = pickFlipQueued;
        pickFlipQueued = null;
        pickFlipWait = null;
        if (queued && ((queued.heroId || null) !== (heroId || null) || queued.back !== back)) {
          await flipPickCard(queued);
        }
      }
    })();
    return pickFlipWait;
  }

  function stopPickPreview() {
    previewGen++;
    if (!pickVideo) return;
    try {
      pickVideo.stop?.();
      pickVideo.destroy?.();
    } catch (_) {}
    pickVideo = null;
  }

  function warmHeroThumbnails() {
    if (heroThumbsWarmed) return;
    heroThumbsWarmed = true;
    HEROES.forEach((hero) => {
      const img = new Image();
      img.decoding = "async";
      try { img.fetchPriority = "low"; } catch (_) {}
      img.src = heroThumb(hero.id);
      heroThumbWarmRefs.push(img);
    });
  }

  function warmPickAssets() {
    ensurePlayers();
    // 人數頁不知道玩家會點誰，只暖 2KB manifest；任意抓第一位英雄的
    // wait + confirm 會白耗約 700KB，還可能跟真正點選的角色搶連線。
    window.HF_VideoPlayer?.loadManifest?.().catch(() => {});
    try {
      const card = new Image();
      card.decoding = "async";
      card.src = "assets/ui/card_back.webp";
    } catch (_) {}
    const warm = () => {
      warmHeroThumbnails();
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(warm, { timeout: 350 });
    } else {
      setTimeout(warm, 40);
    }
  }

  function allPlayersPicked() {
    return (
      state.players.length === state.count &&
      state.players.length > 0 &&
      state.players.every((p) => p && p.heroId)
    );
  }

  function missingPlayerIndexes() {
    return state.players
      .map((p, i) => (!p?.heroId ? i + 1 : null))
      .filter(Boolean);
  }

  function setPickStatus(msg) {
    const el = $("#pick-status");
    if (el) el.textContent = msg || "";
  }

  function heroCardHtml(h, locked, selected) {
    return `
      <button type="button" class="hero-card ${locked ? "locked" : ""} ${selected ? "selected" : ""}"
        data-id="${h.id}" data-hero-id="${h.id}" aria-pressed="${selected ? "true" : "false"}"
        ${locked || pickBusy ? "disabled" : ""} style="--hc:${h.color}">
        <img src="${heroThumb(h.id)}" alt="${h.name}" width="240" height="322"
          loading="eager" decoding="async" fetchpriority="low"
          onerror="this.style.opacity=0.3" />
        <span class="nm">${h.name}</span>
      </button>`;
  }

  function bindHeroCards(root) {
    if (!root || root.dataset.hfBound === "1") return;
    root.dataset.hfBound = "1";

    // 手指壓下的那一刻就把頻寬交給眼前這支，不再背景掃完整個角色名冊。
    root.addEventListener("pointerdown", (event) => {
      const btn = event.target.closest?.(".hero-card[data-id]");
      if (!btn || !root.co