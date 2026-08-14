(() => {
  "use strict";

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
  const PICK_CONFIRM_MAX_MS = 4200; // 3.04s 鎖定片以 1× 完整播放，另留載入／收尾緩衝
  /** 降臨影片播到這一刻下魔王吼聲（片長 6.04s，吼聲 2.2s，剛好收在片尾前） */
  const BOSS_ROAR_CUE_MS = 3400;

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

  function renderAudioStatus(status = window.HF_Audio?.getStatus?.()) {
    const button = $("#audio-activate");
    const icon = $("#audio-activate-icon");
    const title = $("#audio-activate-title");
    const sub = $("#audio-activate-sub");
    if (!button || !title || !sub) return;
    const enabled = window.HF_Audio?.getSettings?.().enabled !== false;
    if (icon) icon.textContent = enabled ? "🔊" : "🔇";
    const settingsIcon = $("#opt-sound-icon");
    if (settingsIcon) settingsIcon.textContent = enabled ? "🔊" : "🔇";
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
    transitionTimer = setTimeout(() => veil.classList.remove("is-playing"), 720);
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
  const ART_VERSION = "4";
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

  /**
   * 人數頁就把 13 支待選片依序抓進快取，之後點任何角色都能立刻播，
   * 不必等當下才開始下載（手機 4G 的卡頓主因）。
   */
  const waitPrefetchPool = [];
  let waitPrefetchStarted = false;

  /**
   * 放掉一支預抓影片，並中止它還沒下載完的部分。
   * `preload="auto"` 的 video 就算已經 canplay 也會**繼續**把整支抓完，
   * 13 支疊起來就是 13 條連線在背景吃頻寬 —— 4G 上這是致命的。
   */
  function releaseWaitClip(el) {
    if (!el) return;
    try {
      el.removeAttribute("src");
      el.load();
    } catch (_) {}
  }

  /** 選角舞台正在等影片就緒時暫停預抓（上限 6 秒，避免整串卡死） */
  async function yieldToActivePick() {
    const busy = () => {
      const st = pickVideo?.el?.dataset?.state;
      return st === "loading" || st === "confirm-loading";
    };
    if (!busy()) return;
    // 玩家正盯著舞台等 → 背景那幾條連線立刻收掉，頻寬全給他眼前那一支
    while (waitPrefetchPool.length) releaseWaitClip(waitPrefetchPool.pop());
    const until = performance.now() + 6000;
    while (busy() && performance.now() < until) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async function prefetchWaitClips() {
    if (waitPrefetchStarted || !window.HF_VideoPlayer?.loadManifest) return;
    waitPrefetchStarted = true;
    try {
      await window.HF_VideoPlayer.loadManifest();
    } catch (_) {
      return;
    }
    // 連續幾支都慢就整串停掉：這條線路撐不起預抓，硬抓只會害玩家眼前那支更慢
    let slowStrikes = 0;
    for (const hero of HEROES) {
      // 玩家眼前那支還在載的時候先讓路：預抓是排隊在後面的 13 支，
      // 搶了頻寬就會變成「點了角色卻停在空舞台」（龍騎士排最後最明顯）。
      await yieldToActivePick();
      const url = window.HF_VideoPlayer.videoUrl(hero.id, "wait");
      if (!url) continue;
      const el = document.createElement("video");
      el.preload = "auto";
      el.muted = true;
      el.playsInline = true;
      el.src = window.HF_VideoPlayer.versioned(url);
      try { el.load(); } catch (_) {}
      const startedAt = performance.now();
      // 一支一支來，避免同時開 13 條連線把頻寬吃光
      const ready = await new Promise((resolve) => {
        let done = false;
        const fin = (ok) => {
          if (done) return;
          done = true;
          clearTimeout(t);
          el.removeEventListener("canplaythrough", onOk);
          el.removeEventListener("canplay", onOk);
          el.removeEventListener("error", onBad);
          resolve(ok);
        };
        const onOk = () => fin(true);
        const onBad = () => fin(false);
        el.addEventListener("canplaythrough", onOk, { once: true });
        el.addEventListener("canplay", onOk, { once: true });
        el.addEventListener("error", onBad, { once: true });
        const t = setTimeout(() => fin(false), 2500);
      });
      const tookMs = performance.now() - startedAt;

      if (ready) {
        // 同時間最多留 2 支在背景把剩下的抓完，其餘放掉
        waitPrefetchPool.push(el);
        while (waitPrefetchPool.length > 2) releaseWaitClip(waitPrefetchPool.shift());
      } else {
        releaseWaitClip(el);
      }

      if (!ready || tookMs > 2000) {
        if (++slowStrikes >= 2) break;
      } else {
        slowStrikes = 0;
      }
    }
  }

  function warmPickAssets() {
    ensurePlayers();
    const taken = takenHeroIds();
    const current = state.players[state.pickIndex]?.heroId;
    const hero = heroById(current) || HEROES.find((h) => !taken.has(h.id)) || HEROES[0];
    const vp = ensurePickVideo();
    if (hero && vp?.prepare) {
      vp.prepare(hero.id).catch(() => {});
    } else {
      window.HF_VideoPlayer?.loadManifest?.().catch(() => {});
    }
    const warm = () => {
      warmHeroThumbnails();
      prefetchWaitClips();
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
    if (!root) return;
    root.querySelectorAll(".hero-card:not(.locked)").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (pickBusy) return;
        const id = btn.dataset.id;
        if (!id) return;
        state.selectedHeroId = id;
        haptic(8);
        audioCue("pick.preview", { group: "ui" });
        renderHeroGrid();
        updateModelPreview();
        updatePickButtons();
        const h = heroById(id);
        setPickStatus(`已預覽：${h?.name || id}　→ 請按「決定」鎖定`);
      });
    });
  }

  /**
   * 縮圖選單：動畫框下方的網格（14 角 → 完整 7 欄 × 2 列），名稱在圖片下方
   */
  function renderHeroGrid() {
    const taken = takenHeroIds();
    const currentPick = state.players[state.pickIndex]?.heroId;
    const grid = $("#hero-grid");
    if (!grid) return;

    grid.hidden = false;
    grid.innerHTML = HEROES.map((h) => {
      const locked = taken.has(h.id) && h.id !== currentPick;
      const selected = state.selectedHeroId === h.id;
      return heroCardHtml(h, locked, selected);
    }).join("");
    bindHeroCards(grid);
  }

  function renderPartyDots() {
    const box = $("#party-dots");
    if (!box) return;
    box.innerHTML = state.players
      .map((p, i) => {
        const cls = [
          "pdot",
          p.heroId ? "done" : "",
          i === state.pickIndex ? "current" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const img = p.heroId
          ? `<img src="${heroThumb(p.heroId)}" alt="" />`
          : `<span>${i + 1}</span>`;
        const title = p.heroId
          ? `${playerLabel(i)} · ${heroById(p.heroId)?.name || p.heroId}`
          : `${playerLabel(i)} · 未選`;
        return `<button type="button" class="${cls}" data-slot="${i}" title="${title}"
          aria-label="${title}" ${pickBusy ? "disabled" : ""}>${img}</button>`;
      })
      .join("");
    box.querySelectorAll(".pdot[data-slot]").forEach((dot) => {
      dot.addEventListener("click", () => {
        if (pickBusy) return;
        const slot = Number(dot.dataset.slot);
        if (!Number.isInteger(slot) || slot < 0 || slot >= state.players.length) return;
        state.pickIndex = slot;
        haptic(7);
        loadPickSelection();
      });
    });
  }

  function ensurePickVideo() {
    if (pickVideo) return pickVideo;
    const el = $("#sprite-stage");
    if (!el) return null;
    if (!window.HF_VideoPlayer) {
      console.warn("HF_VideoPlayer missing");
      return null;
    }
    pickVideo = window.HF_VideoPlayer.create(el, {
      // 影片真的開演才揭開舞台。在那之前維持空的召喚陣，
      // 不拿立繪或頭像去頂（睿哥：進動畫前不要跑出角色的大頭圖案）。
      onShown: () => $("#screen-pick .model-pedestal")?.classList.remove("is-empty"),
    });
    return pickVideo;
  }

  async function updateModelPreview() {
    const gen = ++previewGen;
    ensurePlayers();
    const p = state.players[state.pickIndex] || { heroId: null, hero: null };
    // 沒有點選、也沒有已鎖定的角色 → 舞台留空（不預設帶入任何角色）
    const h = state.selectedHeroId
      ? heroById(state.selectedHeroId)
      : p.hero || heroById(p.heroId) || null;

    const pedestal = $("#screen-pick .model-pedestal");
    const slot = $("#pick-slot");
    const job = $("#pick-job");
    const weapon = $("#pick-weapon");
    const flavor = $("#pick-flavor");
    if (slot) {
      slot.textContent = `${playerLabel(state.pickIndex)} / 共 ${state.players.length} 人`;
    }
    renderPartyDots();

    if (!h) {
      window.HF_Audio?.clearHeroMusic?.();
      $("#screen-pick")?.style.setProperty("--hero-accent", "#9a7ad6");
      if (job) job.textContent = "選擇角色";
      if (weapon) weapon.textContent = "";
      if (flavor) flavor.textContent = "";
      pedestal?.classList.add("is-empty");
      try { ensurePickVideo()?.pause?.(); } catch (_) {}
      return;
    }

    $("#screen-pick")?.style.setProperty("--hero-accent", h.color || "#90caf9");
    window.HF_Audio?.playHeroMusic?.(h.id);
    if (job) job.textContent = h.name;
    if (weapon) weapon.textContent = h.weapon;
    if (flavor) flavor.textContent = `「${h.flavor}」`;

    // 換角色先回到空的召喚陣：新影片還沒開演前，寧可留空，也不要顯示
    // 上一位角色的畫面或任何角色靜圖。揭幕交給 onShown（影片真的在播才做）。
    pedestal?.classList.add("is-empty");
    const vp = ensurePickVideo();
    if (vp && gen === previewGen) {
      try {
        await vp.play(h.id, "wait");
      } catch (e) {
        console.warn("preview play failed", e);
      }
    }
  }

  function updatePickButtons() {
    const has = Boolean(
      state.selectedHeroId || state.players[state.pickIndex]?.heroId
    );
    const prev = $("#pick-prev");
    const next = $("#pick-next");
    if (prev) prev.disabled = state.pickIndex === 0 || pickBusy;
    if (next) {
      next.disabled = !has || pickBusy;
      const last = state.pickIndex >= state.players.length - 1;
      next.textContent = pickBusy
        ? "鎖定中…"
        : last
          ? "決定 · 選擇模式"
          : "決定 · 下一位玩家";
    }
  }

  function loadPickSelection() {
    ensurePlayers();
    const p = state.players[state.pickIndex] || { heroId: null };
    state.selectedHeroId = p.heroId || null;
    renderHeroGrid();
    updatePickButtons();
    updateModelPreview();
    const done = state.players.filter((x) => x.heroId).length;
    setPickStatus(
      p.heroId
        ? `${playerLabel(state.pickIndex)} 已鎖定 ${heroById(p.heroId)?.name || p.heroId}，可重新選擇後再按決定`
        : `請先點一位角色預覽，再按「決定」鎖定（已鎖定 ${done}/${state.players.length}）`
    );
  }

  /** 寫入目前玩家選擇並播確定動畫 */
  async function applyPick() {
    ensurePlayers();
    const id = state.selectedHeroId || state.players[state.pickIndex]?.heroId;
    if (!id) {
      setPickStatus("請先點選一位角色");
      return false;
    }
    const h = heroById(id);
    if (!h) {
      setPickStatus("角色資料錯誤，請重新整理頁面");
      return false;
    }
    // 不可搶別人已鎖的角色（自己重選除外）
    const taken = takenHeroIds();
    const mine = state.players[state.pickIndex]?.heroId;
    if (taken.has(id) && id !== mine) {
      setPickStatus(`${h.name} 已被其他玩家鎖定`);
      return false;
    }

    // 同步寫入（動畫前就生效）
    state.players[state.pickIndex] = { heroId: id, hero: h };
    state.selectedHeroId = id;
    haptic(18);
    // 這一鎖之後全隊就到齊了 → 吹號角，而不是又一次木扣（睿哥指定）。
    // 判斷放在寫入 state.players 之後，allPlayersPicked() 才算得準。
    audioCue(allPlayersPicked() ? "pick.complete" : "pick.lock", { group: "ui" });
    renderPartyDots();
    renderHeroGrid();
    setPickStatus(`已鎖定：${h.name}`);

    // Confirm 開始後，利用空出的影片緩衝預載下一位默認英雄。
    // 這只影響演出載入，不會寫入下一位玩家的選角。
    const nextWaitHero = state.pickIndex < state.players.length - 1
      ? HEROES.find((hero) => !takenHeroIds().has(hero.id))
      : null;

    const vp = ensurePickVideo();
    if (vp) {
      try {
        await vp.playOnce(
          id,
          "confirm",
          PICK_CONFIRM_MAX_MS,
          nextWaitHero?.id || null,
          // 點一下就跳過鎖定動畫，直接換下一位待命；想看完的人不點就好。
          // tapTarget 用整個舞台座（比影片框大，手機好按）。
          { tapSkip: true, tapTarget: $("#screen-pick .model-pedestal") || undefined }
        );
      } catch (e) {
        console.warn("confirm video failed", e);
      }
    }
    return true;
  }

  function goModeIfReady() {
    if (!allPlayersPicked()) {
      const miss = missingPlayerIndexes().join("、");
      alert(`還有玩家未鎖定角色：玩家 ${miss}\n請為每位玩家按「決定」鎖定。`);
      // 跳到第一位未選的
      const idx = state.players.findIndex((p) => !p?.heroId);
      if (idx >= 0) {
        state.pickIndex = idx;
        loadPickSelection();
      }
      return false;
    }
    show("mode");
    return true;
  }

  /* ---- PRESENTATION ---- */
  function wait(ms) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (state.skip) return resolve();
        if (performance.now() - t0 >= ms) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function setBanner(text) {
    const el = $("#cut-banner");
    el.textContent = text;
    el.classList.add("show");
  }
  function hideBanner() {
    $("#cut-banner").classList.remove("show");
  }

  function flash(color = "#fff0bd") {
    const el = $("#fx-flash");
    if (!el) return;
    el.style.setProperty("--flash-color", color);
    el.classList.remove("on");
    void el.offsetWidth;
    el.classList.add("on");
  }

  let fxBeat = 0;

  function setAct(act) {
    const stage = $("#stage");
    if (!stage) return;
    if (act) stage.dataset.act = act;
    else delete stage.dataset.act;
  }

  function waitMediaReady(video, timeoutMs = 850) {
    if (!video) return Promise.resolve(false);
    if (video.readyState >= 3) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      let timer = 0;
      let skipTimer = 0;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(skipTimer);
        video.removeEventListener("canplay", onReady);
        video.removeEventListener("error", onError);
        resolve(ok);
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);
      video.addEventListener("canplay", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
      timer = setTimeout(() => finish(false), timeoutMs);
      skipTimer = setInterval(() => {
        if (state.skip) finish(false);
      }, 32);
    });
  }

  /** 等影片自然播完（或 skip／逾時）；用於不截斷的攻擊切入 */
  function waitClipEnd(video, timeoutMs = 4200) {
    return new Promise((resolve) => {
      if (!video || state.skip) return resolve();
      let done = false;
      let timer = 0;
      let skipTimer = 0;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(skipTimer);
        video.removeEventListener("ended", finish);
        video.removeEventListener("error", finish);
        resolve();
      };
      video.addEventListener("ended", finish, { once: true });
      video.addEventListener("error", finish, { once: true });
      const dur = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration * 1000 + 400
        : timeoutMs;
      timer = setTimeout(finish, Math.max(timeoutMs, dur));
      skipTimer = setInterval(() => {
        if (state.skip) finish();
      }, 32);
    });
  }

  /**
   * 等影片播完，但允許點一下切入層提早跳到下一支。
   * 想看的角色就不要點，讓它自然播完。
   */
  function waitClipEndOrTap(video, tapTarget, timeoutMs = 4200) {
    return new Promise((resolve) => {
      if (!video || state.skip) return resolve("skip");
      let done = false;
      let timer = 0;
      let skipTimer = 0;
      const finish = (reason) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(skipTimer);
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("error", onEnded);
        tapTarget?.removeEventListener("click", onTap);
        resolve(reason);
      };
      const startedAt = performance.now();
      const onEnded = () => finish("ended");
      // 用 click（tap 完成才觸發）而不是 pointerdown：
      // 滑動、按住不放、手指殘留都不會誤觸發，避免整段攻擊被連續跳掉。
      const onTap = () => {
        if (performance.now() - startedAt < 600) return;
        haptic(8);
        finish("tap");
      };
      video.addEventListener("ended", onEnded, { once: true });
      video.addEventListener("error", onEnded, { once: true });
      tapTarget?.addEventListener("click", onTap);
      const dur = Number.isFinite(video.duration) && video.duration > 0
        ? (video.duration / CLIP_RATE) * 1000 + 400
        : timeoutMs;
      timer = setTimeout(() => finish("timeout"), Math.max(timeoutMs, dur));
      skipTimer = setInterval(() => {
        if (state.skip) finish("skip");
      }, 32);
    });
  }

  function stopStageVideo(video = $("#stage-video"), release = true) {
    if (!video) return;
    video.classList.remove("show");
    try {
      video.pause();
      if (release) {
        video.removeAttribute("src");
        video.load();
      }
    } catch (_) {}
  }

  function stopHeroCut(release = true) {
    const root = $("#hero-cut");
    const video = $("#hero-cut-video");
    root?.classList.remove("show", "is-playing", "is-impact", "is-fallback", "can-tap");
    root?.setAttribute("aria-hidden", "true");
    if (!video) return;
    try {
      video.pause();
      if (release) {
        video.removeAttribute("src");
        video.load();
      }
    } catch (_) {}
  }

  function cleanupStageMedia({ release = true } = {}) {
    stopStageVideo($("#stage-video"), release);
    stopHeroCut(release);
    if (release) clearAttackPrefetch();
  }

  function spawnParticles(color = "#d9a5ff", count = 16) {
    const box = $("#fx-particles");
    if (!box) return;
    const seed = ((state.run?.seed || 0) ^ 0x7f4a7c15 ^ ++fxBeat) >>> 0;
    const rand = window.HF_RNG.mulberry32(seed);
    box.innerHTML = Array.from({ length: count }, () => {
      const x = 18 + rand() * 64;
      const y = 38 + rand() * 34;
      const size = 2 + rand() * 5;
      const dx = `${Math.round((rand() - 0.5) * 170)}px`;
      const dy = `${Math.round(-55 - rand() * 135)}px`;
      const d = `${(0.55 + rand() * 0.65).toFixed(2)}s`;
      return `<i style="--x:${x.toFixed(1)}%;--y:${y.toFixed(1)}%;--s:${size.toFixed(1)}px;--dx:${dx};--dy:${dy};--d:${d};--pc:${color}"></i>`;
    }).join("");
    setTimeout(() => {
      if (box) box.innerHTML = "";
    }, 1400);
  }

  function impactFx(color = "#fff0bd") {
    const ring = $("#impact-ring");
    if (ring) {
      ring.style.setProperty("--impact", color);
      ring.classList.remove("on");
      void ring.offsetWidth;
      ring.classList.add("on");
    }
    spawnParticles(color, 18);
    flash(color);
    haptic(14);
  }

  function renderBattleHud(players, activeSlot = null, winnerSlot = null) {
    const line = $("#heroes-line");
    if (!line) return;
    line.classList.add("is-battle-hud");
    line.style.opacity = "1";
    line.innerHTML = players.map((p, i) => {
      const h = p.hero || heroById(p.heroId);
      const slot = p.slot ?? i;
      const active = slot === activeSlot ? " active" : "";
      const winner = slot === winnerSlot ? " winner" : "";
      return `<div class="battle-hud-badge${active}${winner}" style="--hc:${h.color}"
        title="${playerLabel(slot)} · ${h.name}" ${active ? 'aria-current="true"' : ""}>
        <img src="${heroThumb(h.id)}" alt="" />
        <span>${slot + 1}</span>
      </div>`;
    }).join("");
  }

  function clearBattleHud() {
    const line = $("#heroes-line");
    if (!line) return;
    line.classList.remove("is-battle-hud");
    line.style.opacity = "1";
    line.innerHTML = "";
  }

  /** 魔王戰攻擊切入：優先用雲端「攻擊魔王動畫」，缺片才退回 confirm */
  async function resolveAttackSources(players) {
    if (!window.HF_VideoPlayer?.loadManifest) return new Map();
    try {
      await Promise.race([
        window.HF_VideoPlayer.loadManifest(),
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ]);
    } catch (_) {}
    const map = new Map(players.map((p) => [
      p.heroId,
      window.HF_VideoPlayer.videoUrl(p.heroId, "attack"),
    ]));
    prefetchAttackClips(map);
    return map;
  }

  /**
   * 開場就把所有參戰者的攻擊片預抓起來，避免輪到某位時才開始下載，
   * 造成該段只剩深色底（手機 4G 尤其明顯）。
   */
  const attackPrefetchPool = [];
  /** poster 只有 ~30KB，先抓起來，避免攻擊切入第一瞬間整片全黑 */
  const posterWarmRefs = [];
  function prefetchPosters(kind, ids) {
    ids.forEach((id) => {
      if (!id) return;
      const img = new Image();
      img.decoding = "async";
      // 低優先：poster 只是頂替用，搶在攻擊影片前面反而害它更慢
      try { img.fetchPriority = "low"; } catch (_) {}
      img.src = artUrl(`assets/videos/poster/${kind}/${id}.jpg`);
      posterWarmRefs.push(img);
    });
  }

  function prefetchAttackClips(map) {
    attackPrefetchPool.length = 0;
    prefetchPosters("attack", [...map.keys()]);
    map.forEach((url) => {
      if (!url) return;
      const el = document.createElement("video");
      el.preload = "auto";
      el.muted = true;
      el.playsInline = true;
      el.src = window.HF_VideoPlayer?.versioned
        ? window.HF_VideoPlayer.versioned(url)
        : url;
      try { el.load(); } catch (_) {}
      attackPrefetchPool.push(el);
    });
  }

  /** 勝者的 final 片較大（2–4MB），開場就先抓，免得輪到它才等 */
  async function prefetchFinalClip(heroId) {
    if (!heroId) return;
    prefetchPosters("final", [heroId]);
    prefetchPosters("victory", [heroId]);
    try {
      await window.HF_VideoPlayer?.loadManifest?.();
      const url = window.HF_VideoPlayer?.videoUrl?.(heroId, "final");
      if (!url) return;
      const el = document.createElement("video");
      el.preload = "auto";
      el.muted = true;
      el.playsInline = true;
      el.src = window.HF_VideoPlayer.versioned(url);
      try { el.load(); } catch (_) {}
      attackPrefetchPool.push(el);
    } catch (_) {}
  }

  /**
   * 魔王降臨片（1.35MB）在選模式那一頁就開始抓：ACT2 一到就要播，
   * 等到那一刻才下載，4G 上必定卡住或整段被跳過。
   */
  let arrivalPrefetch = null;
  function prefetchArrivalClip() {
    if (arrivalPrefetch) return;
    try {
      const url = "assets/videos/mobile/boss/arrival.mp4";
      const el = document.createElement("video");
      el.preload = "auto";
      el.muted = true;
      el.playsInline = true;
      el.src = window.HF_VideoPlayer?.versioned
        ? window.HF_VideoPlayer.versioned(url)
        : url;
      try { el.load(); } catch (_) {}
      arrivalPrefetch = el;
    } catch (_) {}
  }

  function clearAttackPrefetch() {
    attackPrefetchPool.forEach((el) => {
      try {
        el.pause();
        el.removeAttribute("src");
        el.load();
      } catch (_) {}
    });
    attackPrefetchPool.length = 0;
  }

  async function playStageClip(video, url, durationMs, opts = {}) {
    if (!video || !url || state.skip) return false;
    stopStageVideo(video, true);
    try {
      if (opts.poster) video.poster = opts.poster;
      video.src = window.HF_VideoPlayer?.versioned
        ? window.HF_VideoPlayer.versioned(url)
        : url;
      video.preload = "auto";
      video.loop = false;
      video.muted = true;
      video.playsInline = true;
      try { video.load(); } catch (_) {}
      // 大支的全螢幕片（魔王降臨 1.35MB）在 4G 上 1 秒絕對載不完，
      // 就緒等待要能個別放寬，否則整段會被判定沒就緒而直接跳過。
      const ready = await waitMediaReady(video, opts.readyMs || 1000);
      if (!ready || state.skip) return false;
      try { video.currentTime = 0; } catch (_) {}
      video.classList.add("show");
      try { video.play()?.catch?.(() => {}); } catch (_) {}
      // 聲音要對得上畫面，就得從「真的開播」這一刻起算 —— 4G 上載入可能等好幾秒，
      // 在 await 之前就下音效會變成「聲音先響、畫面幾秒後才來」。
      try { opts.onPlay?.(); } catch (_) {}
      // untilEnded：等 ended 事件而不是硬等固定秒數，播多久就是多久，
      // 起播晚了也不會被攔腰切掉（durationMs 此時只當保險上限）。
      if (opts.untilEnded) await waitClipEnd(video, Math.max(600, durationMs | 0));
      else await wait(Math.max(180, durationMs | 0));
      return !video.error;
    } finally {
      // Always clears the overlay, including an early Skip.
      stopStageVideo(video, true);
    }
  }

  /**
   * 攻擊段：全螢幕切入只開一次，各角色的攻擊動畫接續播完，
   * 中間不退回舞台做打擊演出（睿哥：會有割裂感）。
   */
  /**
   * 打敗魔王專屬影片：命運一擊之後、勝利短片之前的全螢幕演出。
   * 沿用攻擊切入層，播完（等 ended）才交棒。
   */
  async function playFinalBlow(player, hero) {
    const root = $("#hero-cut");
    const video = $("#hero-cut-video");
    if (!root || !video || state.skip || !hero) return false;
    let url = null;
    try {
      await window.HF_VideoPlayer?.loadManifest?.();
      url = window.HF_VideoPlayer?.videoUrl?.(hero.id, "final");
    } catch (_) {}
    if (!url) return false;

    stopHeroCut(true);
    root.style.setProperty("--cut-accent", hero.color || "#b78cff");
    root.dataset.hero = hero.id;
    $("#hero-cut-count").textContent = "FINAL";
    $("#hero-cut-player").textContent = playerLabel(player.slot ?? 0);
    $("#hero-cut-name").textContent = hero.name;
    $("#hero-cut-weapon").textContent = "終結一擊";
    root.setAttribute("aria-hidden", "false");
    root.classList.add("show");
    root.classList.remove("can-tap");

    try {
      video.pause();
      video.poster = artUrl(`assets/videos/poster/final/${hero.id}.jpg`);
      video.src = window.HF_VideoPlayer?.versioned
        ? window.HF_VideoPlayer.versioned(url)
        : url;
      video.preload = "auto";
      video.loop = false;
      video.muted = true;
      video.playsInline = true;
      try { video.load(); } catch (_) {}
      // final 片是 10s 級（1.2–2.4MB），4G 下要給足時間；
      // 等待期間畫面已是同比例的首幀 poster，不會空著。
      const ready = await waitMediaReady(video, 8000);
      if (state.skip) return false;
      if (!ready) {
        // 真的來不及就至少讓首幀停一下，不要整段憑空消失
        await wait(1600);
        return false;
      }
      try { video.currentTime = 0; } catch (_) {}
      try {
        video.defaultPlaybackRate = CLIP_RATE;
        video.playbackRate = CLIP_RATE;
      } catch (_) {}
      try { video.play()?.catch?.(() => {}); } catch (_) {}
      root.classList.add("is-playing");
      /**
       * ⚠️ 這裡本來是 `audioCue("hero.attack." + hero.id, …)`，但 **cueMap 裡
       * 根本沒有 `hero.attack.<id>` 這種名字**（per-hero 的攻擊聲是走
       * `HF_Audio.playHeroAttack()`，不是 cue 表）。`cue()` 查不到就直接
       * return null，所以整段最後一擊**一顆音效都沒放**，只剩討伐曲在跑 ——
       * 睿哥聽起來就是「最後一擊的音效太小聲」。
       *
       * 改成跟攻擊輪播同一條路徑，並且**放大 1.45 倍 + 把音樂壓到 0.42**：
       * 這是整場的高潮，跟輪播用一模一樣的音量會沒有份量。
       * final 片 1.3× 播完約 12s，duck 給 5.2s 涵蓋撞擊到餘韻。
       */
      window.HF_Audio?.playHeroAttack?.(hero.id, { volume: 1.45, duck: 0.42, duckMs: 5200 });
      // 最長的一支約 16s，1.3× 播完約 12.4s，上限給 14s
      await waitClipEnd(video, 14000);
      return true;
    } finally {
      stopHeroCut(true);
    }
  }

  async function playAttackSequence(players, sources) {
    const root = $("#hero-cut");
    const video = $("#hero-cut-video");
    const stage = $("#stage");
    if (!root || !video || state.skip) return;
    const total = players.length;

    stage?.classList.add("cut-active");
    root.setAttribute("aria-hidden", "false");
    root.classList.add("show", "can-tap");
    try {
      for (let i = 0; i < total && !state.skip; i++) {
        const p = players[i];
        const h = p.hero || heroById(p.heroId);
        if (!h) continue;

        root.style.setProperty("--cut-accent", h.color || "#b78cff");
        root.dataset.hero = h.id;
        $("#hero-cut-count").textContent =
          `${String(i + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
        $("#hero-cut-player").textContent = playerLabel(p.slot ?? i);
        $("#hero-cut-name").textContent = h.name;
        $("#hero-cut-weapon").textContent = h.weapon;
        setBanner(`${playerLabel(p.slot ?? i)} · ${h.name} 出擊！`);
        renderBattleHud(players, p.slot ?? i);

        // 收回上一位的影片畫面：不清掉的話，慢速網路下會看到上一位角色的
        // poster 還壓在畫面上（名字卻已經換人）。載入中維持深色底＋名牌，
        // 不頂任何角色圖（睿哥指定）。
        root.classList.remove("is-playing");

        const source = sources.get(h.id);
        if (!source) {
          window.HF_Audio?.playHeroAttack?.(h.id);
          await wait(500);
          continue;
        }

        video.pause();
        // 首幀圖與影片同比例，載入中先頂著，避免黑畫面
        video.poster = artUrl(`assets/videos/poster/attack/${h.id}.jpg`);
        video.src = window.HF_VideoPlayer?.versioned
          ? window.HF_VideoPlayer.versioned(source)
          : source;
        video.preload = "auto";
        video.loop = false;
        video.muted = true;
        video.playsInline = true;
        try { video.load(); } catch (_) {}
        // 4G 下（尤其換過快取版本、影片全部要重抓）要給足時間，
        // 否則整支攻擊切入會被判定沒就緒而直接跳過。
        const ready = await waitMediaReady(video, i === 0 ? 6000 : 4500);
        if (state.skip) continue;
        if (!ready) {
          // 沒就緒也讓同比例的首幀停一下，不要整位角色憑空消失
          await wait(1200);
          continue;
        }
        try { video.currentTime = 0; } catch (_) {}
        try {
          video.defaultPlaybackRate = CLIP_RATE;
          video.playbackRate = CLIP_RATE;
        } catch (_) {}
        root.classList.remove("beat");
        void root.offsetWidth;
        root.classList.add("beat");
        window.HF_Audio?.playHeroAttack?.(h.id);
        try { video.play()?.catch?.(() => {}); } catch (_) {}
        root.classList.add("is-playing");
        // 點一下切入層就跳下一位；不點就完整播完
        await waitClipEndOrTap(video, root, 3400);
      }
    } finally {
      window.HF_Audio?.stopGroup?.("hero-attack");
      stage?.classList.remove("cut-active");
      stopHeroCut(true);
    }
  }

  function placeHeroes(list, { highlightId, attack } = {}) {
    const line = $("#heroes-line");
    line.classList.remove("is-battle-hud");
    line.innerHTML = list
      .map((p, i) => {
        const h = p.hero || heroById(p.heroId);
        const hi = highlightId && h.id === highlightId ? " highlight" : "";
        const dim = highlightId && h.id !== highlightId ? " dim" : "";
        const atk = attack && h.id === highlightId ? " attack" : "";
        return `<div class="stage-hero${hi}${dim}${atk}" style="--hc:${h.color}">
          <img src="${heroThumb(h.id)}" alt="${h.name}" />
          <span>${playerLabel(p.slot ?? i)}</span>
          <small>${h.name}</small>
        </div>`;
      })
      .join("");
  }

  function startMode(mode, opts = {}) {
    if (state.presenting) return;
    state.mode = mode;
    if (opts.teamCount) state.teamCount = opts.teamCount;
    state.skip = false;
    const payloadPlayers = state.players.map((p, i) => ({
      slot: i,
      name: playerLabel(i),
      heroId: p.heroId,
      hero: p.hero,
    }));
    state.run = window.HF_RNG.seedRun(mode, payloadPlayers, {
      teamCount: state.teamCount,
      useFateCard: state.opts.fateCard,
    });
    window.HF_Audio?.preloadHeroes?.(payloadPlayers.map((player) => player.heroId));
    audioCue("round.open", { group: "presentation" });
    show("play");
    presentRun();
  }

  /**
   * 命運一擊：揭曉前讓全員按住螢幕蓄力。
   * 純儀式 —— 結果早已由 seedRun 定案，這裡只是把揭曉時機交到大家手上。
   */
  function playFateStrike(fast) {
    return new Promise((resolve) => {
      const gate = $("#strike-gate");
      const countEl = $("#strike-count");
      const subEl = $("#strike-sub");
      if (!gate || !state.opts.strike || state.skip) return resolve();

      const holdMs = Math.max(1200, 3000 * fast); // 睿哥：全員按住 3 秒
      let held = false;
      let startedAt = 0;
      let raf = 0;
      let done = false;
      let waitTimer = 0;

      /**
       * 四個符文亮起的門檻。
       * ⚠️ **必須跟 `css/revamp.css` 的 `.fc-rune[data-rune="n"]` 一致** ——
       * 那邊是 `opacity: clamp(0, calc((var(--p) - 門檻) * 18), 1)`，
       * 亮起的瞬間就是 `--p` 越過門檻的那一刻。改了一邊就要改另一邊，
       * 不然聲音會跟畫面對不上。
       */
      const RUNE_AT = [0.22, 0.45, 0.68, 0.9];
      let runesLit = 0;

      const finish = () => {
        if (done) return;
        done = true;
        cancelAnimationFrame(raf);
        clearTimeout(waitTimer);
        gate.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        gate.classList.remove("show", "charging");
        gate.setAttribute("aria-hidden", "true");
        gate.style.setProperty("--p", "0");
        resolve();
      };

      const tick = () => {
        if (done) return;
        if (state.skip) return finish();
        const p = Math.min(1, (performance.now() - startedAt) / holdMs);
        // 魔法陣的亮度與四個符文全由這個值驅動（見 css/revamp.css 的 .fate-circle）
        gate.style.setProperty("--p", String(p));
        // 符文逐一亮起，每亮一顆響一次（總共四次）。
        // 用 while 不用 if：畫面卡頓時一個 frame 可能跨過兩個門檻，
        // 那也要補放，不能讓某一顆默默沒有聲音。
        while (runesLit < RUNE_AT.length && p >= RUNE_AT[runesLit]) {
          runesLit += 1;
          audioCue("strike.rune", { group: "presentation", cooldown: 0 });
        }
        if (countEl) countEl.textContent = String(Math.max(1, Math.ceil((1 - p) * 3)));
        if (p >= 1) {
          haptic(24);
          audioCue("strike.release", { group: "presentation" });
          impactFx("#ffe08a");
          return finish();
        }
        raf = requestAnimationFrame(tick);
      };

      const onDown = () => {
        if (done || held) return;
        held = true;
        startedAt = performance.now();
        gate.classList.add("charging");
        if (subEl) subEl.textContent = "撐住……命運正在凝聚";
        haptic(10);
        audioCue("strike.charge", { group: "presentation" });
        raf = requestAnimationFrame(tick);
      };

      const onUp = () => {
        if (done || !held) return;
        held = false;
        cancelAnimationFrame(raf);
        gate.classList.remove("charging");
        // 放開就整組回到暗版，下次按住重新開始 —— 符文的計數也要跟著歸零，
        // 否則重按一次就再也不會響
        gate.style.setProperty("--p", "0");
        runesLit = 0;
        if (subEl) subEl.textContent = "放開了……再按住一次";
        if (countEl) countEl.textContent = "3";
      };

      if (countEl) countEl.textContent = "3";
      if (subEl) subEl.textContent = "一起把命運按下去";
      gate.style.setProperty("--p", "0");
      gate.classList.add("show");
      gate.setAttribute("aria-hidden", "false");
      gate.addEventListener("pointerdown", onDown);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      // 沒人按也不能卡住流程
      waitTimer = setTimeout(() => {
        if (!held) finish();
      }, Math.max(4000, 9000 * fast));
    });
  }

  async function presentRun() {
    state.presenting = true;
    state.skip = false;
    const { result, players, mode } = state.run;
    const stage = $("#stage");
    const bg = $("#stage-bg");
    const video = $("#stage-video");
    const boss = $("#boss");
    const smoke = $("#smoke");
    const spot = $("#spotlight");
    const skipBtn = $("#btn-skip");
    const victory = $("#victory-panel");
    const cine = $("#cine-layer");

    skipBtn.style.display = state.opts.allowSkip ? "inline-flex" : "none";
    cleanupStageMedia({ release: true });
    clearBattleHud();
    smoke.classList.remove("on");
    spot.classList.remove("on");
    stage.classList.remove("shake", "dark");
    boss.classList.remove("show", "roar", "hurt", "down", "enter");
    victory.classList.remove("show", "film", "film-hit", "film-win");
    cine.classList.add("show");
    hideBanner();
    setAct(null);

    const fast = state.opts.fast ? 0.5 : 1;
    const presentationRand = window.HF_RNG.mulberry32(
      ((state.run.seed >>> 0) ^ 0xa511e9b3) >>> 0
    );

    try {
      await revealFateCard(result.card, fast);
      if (result.mode === "boss" || result.mode === "doom") {
        await presentBossRaid(players, result, { stage, bg, video, boss, smoke, spot, victory, cine, fast });
      } else if (mode === "order") {
        await presentOrderCards(result.order, { stage, bg, boss, video, fast });
        showResultOrder(result.order);
      } else if (mode === "pair") {
        setAct("pair");
        bg.style.backgroundImage = "url(assets/bg_party.jpg)";
        boss.classList.remove("show");
        placeHeroes(players);
        setBanner("命運洗牌……");
        for (let k = 0; k < 10 && !state.skip; k++) {
          // Visual-only seeded stream; it can never influence the precomputed pairs.
          placeHeroes(window.HF_RNG.shuffle(players, presentationRand));
          await wait(100 * fast);
        }
        setBanner("配對揭曉！");
        impactFx("#7ef0ff");
        audioCue("pair.reveal", { group: "presentation" });
        placeHeroes(players);
        await wait(340 * fast);
        showResultPair(result.pairs, result.bye);
      } else if (mode === "survival") {
        await presentSurvival(players, result, { stage, bg, boss, spot, victory, fast });
      } else if (mode === "teams") {
        setAct("pair");
        bg.style.backgroundImage = "url(assets/bg_party.jpg)";
        boss.classList.remove("show");
        placeHeroes(players);
        setBanner("命運分隊 · 洗牌中……");
        for (let k = 0; k < 8 && !state.skip; k++) {
          placeHeroes(window.HF_RNG.shuffle(players, presentationRand));
          await wait(100 * fast);
        }
        for (let t = 0; t < result.teams.length && !state.skip; t++) {
          placeHeroes(result.teams[t]);
          setBanner(`${TEAM_LABELS[t] || `第 ${t + 1} 隊`} 成軍！`);
          impactFx(TEAM_COLORS[t] || "#7ef0ff");
          audioCue("team.reveal", { group: "presentation", rate: 1 + t * 0.04 });
          await wait(620 * fast);
        }
        showResultTeams(result.teams);
      }
    } catch (error) {
      console.error("presentation failed", error);
      // Media/VFX failure must never change the seed-first result.
      if (result.mode === "boss" || result.mode === "doom") {
        const winner = result.winner;
        showResultBoss(winner, winner.hero || heroById(winner.heroId));
      } else if (mode === "order") {
        showResultOrder(result.order);
      } else if (mode === "pair") {
        showResultPair(result.pairs, result.bye);
      } else if (mode === "survival") {
        showResultSurvival(result);
      } else if (mode === "teams") {
        showResultTeams(result.teams);
      }
    } finally {
      state.presenting = false;
      hideBanner();
      smoke.classList.remove("on");
      spot.classList.remove("on");
      stage.classList.remove("shake", "dark");
      boss.classList.remove("show", "roar", "hurt", "down", "enter");
      victory.classList.remove("show", "film", "film-hit", "film-win");
      cine.classList.remove("show");
      cleanupStageMedia({ release: true });
      clearBattleHud();
      setAct(null);
      const filmHost = $("#film-host");
      if (filmHost) filmHost.innerHTML = "";
    }
  }

  /** 命運卡：開局翻牌（卡片本身也是 seed-first 抽出） */
  function revealFateCard(card, fast) {
    return new Promise((resolve) => {
      const layer = $("#fate-card-layer");
      if (!card || !layer || state.skip) return resolve();
      $("#fate-card-name").textContent = card.name;
      $("#fate-card-desc").textContent = card.desc;
      layer.dataset.card = card.id;
      layer.classList.add("show");
      layer.setAttribute("aria-hidden", "false");
      audioCue("fate.cardReveal", { group: "presentation" });
      haptic(12);
      const hold = Math.max(900, 1600 * fast);
      setTimeout(() => {
        layer.classList.remove("show");
        layer.setAttribute("aria-hidden", "true");
        resolve();
      }, hold);
    });
  }

  /* ---- 今晚戰績（純本機統計，不影響任何抽籤） ---- */
  const STATS_KEY = "hf_night_stats_v1";

  function loadStats() {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (!data || !Array.isArray(data.rounds)) return { rounds: [] };
      return data;
    } catch (_) {
      return { rounds: [] };
    }
  }

  function saveStats(data) {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function recordRound(entry) {
    const data = loadStats();
    data.rounds.push({ t: Date.now(), ...entry });
    if (data.rounds.length > 200) data.rounds = data.rounds.slice(-200);
    saveStats(data);
  }

  function renderStats() {
    const body = $("#stats-body");
    if (!body) return;
    const data = loadStats();
    if (!data.rounds.length) {
      body.innerHTML = '<p class="stats-empty">今晚還沒有紀錄，先玩一局吧。</p>';
      return;
    }
    const hit = new Map();
    const luckyHit = new Map();
    const doomHit = new Map();
    const heroUse = new Map();
    data.rounds.forEach((r) => {
      (r.chosen || []).forEach((c) => {
        const key = c.slot;
        hit.set(key, (hit.get(key) || 0) + 1);
        if (r.isDoom) doomHit.set(key, (doomHit.get(key) || 0) + 1);
        else luckyHit.set(key, (luckyHit.get(key) || 0) + 1);
        if (c.heroId) heroUse.set(c.heroId, (heroUse.get(c.heroId) || 0) + 1);
      });
    });
    const slots = [...hit.keys()].sort((a, b) => (hit.get(b) || 0) - (hit.get(a) || 0));
    // 命運寵兒只算「非審判」的中選；被審判的另外算最衰
    const topLucky = [...luckyHit.keys()].sort((a, b) => (luckyHit.get(b) || 0) - (luckyHit.get(a) || 0))[0];
    const topDoom = [...doomHit.keys()].sort((a, b) => (doomHit.get(b) || 0) - (doomHit.get(a) || 0))[0];
    const titles = [];
    if (topLucky != null) titles.push(`命運寵兒：${playerLabel(topLucky)}（${luckyHit.get(topLucky)} 次）`);
    if (topDoom != null) titles.push(`今晚最衰：${playerLabel(topDoom)}（受罰 ${doomHit.get(topDoom)} 次）`);
    const zero = state.players
      .map((_, i) => i)
      .filter((i) => !hit.get(i));
    if (zero.length) titles.push(`隱形人：${zero.map((i) => playerLabel(i)).join("、")}`);

    const rows = slots
      .map(
        (slot) =>
          `<li><b>${playerLabel(slot)}</b><span>被選中 ${hit.get(slot)} 次${doomHit.get(slot) ? `／受罰 ${doomHit.get(slot)}` : ""}</span></li>`
      )
      .join("");
    const heroRows = [...heroUse.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => `<li><b>${heroById(id)?.name || id}</b><span>${n} 次</span></li>`)
      .join("");

    body.innerHTML = `
      <p class="stats-sum">共 ${data.rounds.length} 局</p>
      ${titles.length ? `<div class="stats-titles">${titles.map((t) => `<span>${t}</span>`).join("")}</div>` : ""}
      <p class="stats-label">玩家</p>
      <ul class="stats-list">${rows}</ul>
      ${heroRows ? `<p class="stats-label">熱門角色</p><ul class="stats-list">${heroRows}</ul>` : ""}`;
  }

  const TEAM_LABELS = ["紅隊", "藍隊", "綠隊", "金隊"];
  const TEAM_COLORS = ["#ff7a7a", "#7ec8ff", "#8be08b", "#ffd76a"];

  /**
   * 命運淘汰：每輪倒下一位，最後生還者勝出。
   * 淘汰順序在 seedRun 就已決定，這裡只負責演出。
   */
  /**
   * 命運排序的演出（睿哥 2026-08-15 指定，取代原本「一位一位站出來」的版本）：
   *
   *   1. 先播一段影片開場，跟魔王討伐同一個排面
   *   2. 每位角色化成一張牌，**卡背朝上**排出來，一眼數得出有幾張
   *   3. **同時翻面**，正面是英雄的樣貌；由左至右就是第一名到最後一名
   *
   * ⚠️ 名次不是這裡決定的 —— `result.order` 早在 `seedRun()` 就定案了
   * （專案鐵則：先 RNG 定案，再播演出）。這裡只負責把既定的順序演出來，
   * 所以牌陣直接照 `order` 的索引排，不做任何抽樣。
   */
  async function presentOrderCards(order, ctx) {
    const { stage, bg, boss, video, fast } = ctx;
    const wrap = $("#rank-cards");
    setAct("order");
    bg.style.backgroundImage = "url(assets/bg_party.jpg)";
    boss.classList.remove("show");
    placeHeroes([]);

    // ── 開場影片。用魔王降臨那支：目前唯一的全螢幕開場片，
    //    也是「命運儀式開場」的排面。沒播成就直接進牌陣，流程不能卡。
    setAct("arrival");
    stage.classList.add("dark");
    setBanner("命運排序 · 儀式開始");
    await playStageClip(video, "assets/videos/mobile/boss/arrival.mp4", 9000 * fast, {
      poster: artUrl("assets/videos/poster/boss/arrival.jpg"),
      readyMs: 8000,
      untilEnded: true,
      onPlay: () => audioCue("boss.enter", { group: "presentation" }),
    });
    stage.classList.remove("dark");
    if (!wrap) return;

    // 整段包在 try/finally 裡 —— 跳過或中途出錯時牌陣一定要收掉，
    // 不然會一直卡在畫面上。
    try {
      // ── 發牌：全部卡背朝上
      setAct("cards");
      setBanner("命運之牌 · 由左至右決定順位");
      // 一列最多七張還看得清楚；再多就折成兩列。寬度換算交給 CSS 的 calc，
      // 因為它才知道容器實際多寬、gap 佔掉多少。
      const perRow = Math.min(order.length, 7);
      wrap.style.setProperty("--rk-n", String(perRow));
      wrap.innerHTML = order
        .map((p, i) => {
          const h = p.hero || heroById(p.heroId);
          return `<div class="rank-card${i < 3 ? " is-top" : ""}" style="--rk-i:${i};--rk-c:${h.color || "#ffe08a"}">
            <div class="rk-inner">
              <div class="rk-face rk-back"></div>
              <div class="rk-face rk-front">
                <img src="${heroThumb(h.id)}" alt="${h.name}" width="240" height="322"
                     loading="eager" decoding="async" />
                <span class="rk-no"><b>${i + 1}</b>${playerLabel(p.slot)}</span>
              </div>
            </div>
          </div>`;
        })
        .join("");
      wrap.setAttribute("aria-hidden", "false");

      // 發牌音：每張一聲，跟 CSS 的 90ms 間隔對齊
      for (let i = 0; i < order.length && !state.skip; i++) {
        audioCue("order.rank", { group: "presentation", cooldown: 0, rate: 1 + i * 0.02 });
        await wait(90 * fast);
      }
      await wait(700 * fast);

      // ── 同時翻面
      if (!state.skip) {
        setBanner("翻牌！");
        audioCue("fate.cardReveal", { group: "presentation" });
        impactFx("#ffe08a");
        wrap.querySelectorAll(".rank-card").forEach((el) => el.classList.add("is-flipped"));
        // CSS 的翻面是 620ms，等它轉完再讓大家看清楚
        await wait(760 * fast);
        audioCue("reveal.winner", { group: "presentation" });
        const top = order[0];
        const th = top.hero || heroById(top.heroId);
        setBanner(`第一名 · ${playerLabel(top.slot)} · ${th.name}`);
        await wait(1500 * fast);
      }
    } finally {
      wrap.setAttribute("aria-hidden", "true");
      wrap.innerHTML = "";
      wrap.style.removeProperty("--rk-n");
    }
  }

  async function presentSurvival(players, result, ctx) {
    const { stage, bg, boss, spot, victory, fast } = ctx;
    const survivor = result.survivor;
    prefetchFinalClip((survivor?.hero || heroById(survivor?.heroId))?.id);
    const sh = survivor.hero || heroById(survivor.heroId);

    bg.style.backgroundImage = "url(assets/bg_battle_arena_v2.jpg)";
    setAct("gather");
    renderBattleHud(players);
    setBanner("命運淘汰 · 全員登場");
    audioCue("battle.gather", { group: "presentation" });
    await wait(520 * fast);

    setAct("arrival");
    stage.classList.add("dark");
    boss.style.setProperty("--boss-enter-ms", `${Math.max(1, 520 * fast)}ms`);
    boss.classList.add("show", "enter");
    setBanner("魔王降臨——只有一人能留下");
    audioCue("boss.enter", { group: "presentation" });
    impactFx("#cf73ff");
    await wait(130 * fast);
    audioCue("boss.roar", { group: "presentation", volume: 0.72 });
    await wait(390 * fast);
    boss.classList.remove("enter");

    const alive = players.slice();
    for (let i = 0; i < result.eliminated.length && !state.skip; i++) {
      const gone = result.eliminated[i];
      const gh = gone.hero || heroById(gone.heroId);
      setAct("attack");
      setBanner(`命運之手落下——${playerLabel(gone.slot)} · ${gh.name} 出局`);
      renderBattleHud(alive, gone.slot);
      stage.classList.add("shake");
      boss.classList.add("hurt");
      impactFx(gh.color || "#cf73ff");
      audioCue("survival.eliminate", {
        group: "presentation",
        rate: Math.max(0.7, 1 - i * 0.035),
      });
      haptic(14);
      await wait(560 * fast);
      stage.classList.remove("shake");
      boss.classList.remove("hurt");
      const idx = alive.findIndex((p) => p.slot === gone.slot);
      if (idx >= 0) alive.splice(idx, 1);
      renderBattleHud(alive);
      await wait(260 * fast);
    }

    setAct("fate");
    renderBattleHud(alive);
    setBanner("只剩最後一人……");
    await wait(420 * fast);

    await playFateStrike(fast);

    setAct("reveal");
    boss.classList.add("show", "hurt");
    spot.classList.add("on");
    renderBattleHud(alive, survivor.slot, survivor.slot);
    setBanner(`生還者——${playerLabel(survivor.slot)} · ${sh.name}！`);
    audioCue("reveal.winner", { group: "presentation" });
    impactFx(sh.color || "#fff0bd");
    await wait(620 * fast);

    if (!state.skip) {
      setAct("attack");
      await playFinalBlow(survivor, sh);
    }

    setAct("victory");
    clearBattleHud();
    cleanupStageMedia({ release: true });
    boss.classList.remove("show", "roar", "enter");
    boss.classList.add("hurt", "down");
    audioCue("boss.defeat", { group: "presentation" });
    spot.classList.remove("on");
    hideBanner();
    victory.classList.add("show");
    try {
      await window.HF_VictoryFilm.play({
        heroId: sh.id,
        stageEl: victory,
        bannerEl: $("#cut-banner"),
        bossEl: boss,
        filmHost: $("#film-host"),
        shouldSkip: () => state.skip,
        timeScale: state.opts.fast ? 1.6 : 1,
      });
    } catch (e) {
      console.warn("victory film failed", e);
    }
    showResultSurvival(result);
  }

  async function presentBossRaid(players, result, ctx) {
    const { stage, bg, video, boss, smoke, spot, victory, cine, fast } = ctx;
    const isDoom = !!result.isDoom;
    const w = result.winner;
    const wh = w.hero || heroById(w.heroId);

    // All presentation media resolves only after the seed-first result above exists.
    const attackSourcesPromise = resolveAttackSources(players);
    prefetchFinalClip(wh?.id);
    bg.style.backgroundImage = "url(assets/bg_battle_arena_v2.jpg)";
    cine.classList.add("show");
    // 音樂：整場魔王討伐就是 setScene("play") 的討伐曲一首到底，中途不換。
    // 曾經在降臨段插一首專屬曲，但降臨只有 6 秒，「音樂剛出來就被切掉」，
    // 睿哥要求拿掉（2026-08-14）。要再加中途換曲前先想清楚段落有多長。

    // === ACT 1: the party enters as a deliberate HUD, not tiny combat blocks. ===
    setAct("gather");
    renderBattleHud(players);
    setBanner(isDoom ? "全員到齊——審判即將降下" : "英雄集結——命運已經定案");
    audioCue("battle.gather", { group: "presentation" });
    await wait(560 * fast);

    // === ACT 2: 魔王降臨。就是這支影片，沒有別的演出 ===
    // 睿哥指定：拿掉「魔王小圖飛進來撞擊」那套設計（立繪 enter + impactFx），
    // 也不要在影片播完後把小圖砸上來。魔王立繪從 ACT 3A 才進場。
    setAct("arrival");
    stage.classList.add("dark");
    setBanner(isDoom ? "魔王降臨——它要挑一個人帶走" : "魔王降臨！！");
    // 降臨片本身沒有音軌（Sora 匯出的都沒有），整段的聲音全靠這兩個音效。
    // 原本 boss.enter 在影片載入前就下、boss.roar 排在整支播完之後，
    // 結果是「重音對著還沒出現的畫面響，吼聲響在全軍突擊上面」，
    // 中間 6 秒的降臨反而是全靜音。改成兩個都跟著影片走。
    let roarTimer = 0;
    const arrivalPlayed = await playStageClip(
      video,
      "assets/videos/mobile/boss/arrival.mp4",
      9000 * fast,
      {
        poster: artUrl("assets/videos/poster/boss/arrival.jpg"),
        readyMs: 8000,
        untilEnded: true,
        onPlay: () => {
          // 第一幀＝降臨重音
          audioCue("boss.enter", { group: "presentation" });
          // 魔王走到鏡頭前才吼。影片 6.04s、吼聲 2.2s，3.4s 下去剛好收在片尾之前。
          // 這裡不乘 fast：stage clip 一律 1× 播放，乘了反而對不上。
          roarTimer = setTimeout(() => {
            roarTimer = 0;
            if (!state.skip) audioCue("boss.roar", { group: "presentation" });
          }, BOSS_ROAR_CUE_MS);
        },
      }
    );
    // 影片比預期短（載不動、被跳過）時 roarTimer 還沒燒到，這裡補吼一聲 ——
    // 不補的話「魔王降臨卻完全沒聲音」會再發生一次。
    if (roarTimer) {
      clearTimeout(roarTimer);
      roarTimer = 0;
      if (!state.skip) audioCue("boss.roar", { group: "presentation" });
    } else if (!arrivalPlayed && !state.skip) {
      // 連播都沒播成：重音與吼聲都還沒下過，兩個都補
      audioCue("boss.enter", { group: "presentation" });
      audioCue("boss.roar", { group: "presentation" });
    }

    const attackSources = await attackSourcesPromise;

    // === ACT 3A: full-screen Sora battle reel. Always cleared in finally. ===
    if (!state.skip) {
      setAct("clash");
      renderBattleHud(players);
      setBanner("命運之輪 · 全軍突擊！");
      audioCue("battle.clash", { group: "presentation" });
      await playStageClip(video, "assets/ref_battle_mobile.mp4", 1500 * fast);
    }

    // === ACT 3B: 各角色的攻擊動畫一支接一支連播，中間不插打擊演出（避免割裂感） ===
    setAct("attack");
    await playAttackSequence(players, attackSources);

    // === ACT 4: retaliation and a full-frame smoke wipe. ===
    if (!state.skip) {
      setAct("fate");
      renderBattleHud(players);
      smoke.classList.add("on");
      stage.classList.add("shake");
      setBanner("魔王怒吼——戰場被命運吞沒！");
      audioCue("boss.roar", { group: "presentation" });
      audioCue("smoke.burst", { group: "presentation", volume: 0.72 });
      haptic(22);
      await wait(760 * fast);
      stage.classList.remove("shake", "dark");
    }

    // 揭曉前把時機交給全場（純儀式，結果早已定案）
    smoke.classList.remove("on");
    await playFateStrike(fast);

    // === ACT 5: reveal only the winner already stored in result. ===
    setAct("reveal");
    smoke.classList.remove("on");
    renderBattleHud(players, w.slot, w.slot);
    spot.classList.add("on");
    const chosenAll = result.chosen?.length ? result.chosen : [w];
    const names = chosenAll
      .map((c) => `${playerLabel(c.slot)} · ${(c.hero || heroById(c.heroId))?.name}`)
      .join("　＋　");
    setBanner(isDoom ? `命運降罪——${names}！` : `命運選中——${names}！`);
    audioCue(isDoom ? "reveal.doom" : "reveal.winner", { group: "presentation" });
    impactFx(isDoom ? "#ff6b6b" : wh.color || "#fff0bd");
    await wait(620 * fast);

    // === ACT 5.5: 「打敗魔王」專屬影片。命運審判也要播（先前誤在此之前就 return）===
    if (!state.skip) {
      setAct("attack");
      await playFinalBlow(w, wh);
    }

    // 命運審判沒有勝利短片可播（語意不符），改用一段短促的判決收尾
    if (isDoom) {
      setAct("fate");
      stage.classList.add("shake", "dark");
      smoke.classList.add("on");
      setBanner("審判降下……");
      audioCue("doom.slam", { group: "presentation" });
      haptic(26);
      await wait(900 * fast);
      stage.classList.remove("shake", "dark");
      smoke.classList.remove("on");
      showResultBoss(w, wh);
      return;
    }

    // === ACT 6: Sora victory film fills the screen; no duplicate top caption. ===
    setAct("victory");
    clearBattleHud();
    cleanupStageMedia({ release: true });
    // 睿哥指定：降臨影片之後整場不再出現魔王立繪，所以沒有「倒下」可演，只留擊敗音效
    audioCue("boss.defeat", { group: "presentation" });
    smoke.classList.remove("on");
    spot.classList.remove("on");
    hideBanner();
    victory.classList.add("show");

    if (window.HF_VictoryFilm) {
      try {
        await window.HF_VictoryFilm.play({
          heroId: wh.id,
          stageEl: victory,
          bannerEl: null,
          // 立繪已從魔王討伐移除，勝利片不必再操作它
          bossEl: null,
          filmHost: $("#film-host"),
          shouldSkip: () => state.skip,
          timeScale: state.opts.fast ? 1.45 : 1,
        });
      } catch (error) {
        console.warn("victory film failed; keeping precomputed result", error);
      }
    }

    boss.classList.remove("show", "hurt", "down", "enter", "roar");
    victory.classList.remove("show", "film", "film-hit", "film-win");
    showResultBoss(w, wh);
  }

  /** 結果頁頭像：優先播該角色的勝利動畫，載不動才用立繪 */
  /**
   * @param {string} heroId
   * @param {{list?: boolean}} [opts] `list: true` 代表這一頁的主角是**名單**
   *   （分隊／排序／淘汰／配對），不是單一勝利者。名單的長度隨人數變，
   *   立繪就得讓位 —— 見 css/ornate.css 的 `.result-panel.result-list`。
   */
  async function setResultPortrait(heroId, opts = {}) {
    const model = $("#result-model");
    const img = $("#result-img");
    const video = $("#result-video");
    $("#screen-result .result-panel")?.classList.toggle("result-list", !!opts.list);
    if (img) img.src = heroImg(heroId);
    model?.classList.remove("has-video");
    if (!video || !window.HF_VideoPlayer) return;
    const token = ++resultPortraitGen;
    try {
      await window.HF_VideoPlayer.loadManifest();
      if (token !== resultPortraitGen) return;
      const url = window.HF_VideoPlayer.videoUrl(heroId, "victory");
      if (!url) return;
      video.src = window.HF_VideoPlayer.versioned(url);
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      try { video.load(); } catch (_) {}
      // 結果頁不能沿用 waitMediaReady（它綁 state.skip，略過動畫後會直接失敗）
      const ready = await new Promise((resolve) => {
        if (video.readyState >= 3) return resolve(true);
        let done = false;
        const fin = (ok) => {
          if (done) return;
          done = true;
          clearTimeout(t);
          video.removeEventListener("canplay", onOk);
          video.removeEventListener("error", onErr);
          resolve(ok);
        };
        const onOk = () => fin(true);
        const onErr = () => fin(false);
        video.addEventListener("canplay", onOk, { once: true });
        video.addEventListener("error", onErr, { once: true });
        const t = setTimeout(() => fin(video.readyState >= 2), 1600);
      });
      if (!ready || token !== resultPortraitGen) return;
      // 影片就緒就換上（即使瀏覽器擋自動播放，至少是正確比例的畫面）
      model?.classList.add("has-video");
      try { await video.play(); } catch (_) {}
    } catch (_) {}
  }

  function stopResultPortrait() {
    resultPortraitGen++;
    const video = $("#result-video");
    $("#result-model")?.classList.remove("has-video");
    if (!video) return;
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch (_) {}
  }

  function showResultBoss(w, wh) {
    const result = state.run?.result || {};
    const isDoom = !!result.isDoom;
    const chosen = result.chosen?.length ? result.chosen : [w];
    const card = result.card;

    $("#result-badge").textContent = isDoom ? "☠️ 命運審判" : "🏆 勝利者";
    $("#result-name").textContent = chosen
      .map((c) => playerLabel(c.slot ?? 0))
      .join("　＋　");
    $("#result-hero").textContent =
      chosen.length > 1
        ? chosen.map((c) => (c.hero || heroById(c.heroId))?.name).join(" × ")
        : `${wh.name} · ${wh.weapon}`;
    setResultPortrait(wh.id);
    const cardLine = card
      ? `<p class="seed-note">命運卡：<b style="color:#ffe08a">${card.name}</b> — ${card.desc}</p>`
      : "";
    $("#result-detail").innerHTML = `
      <p class="flavor-line">${isDoom ? "「命運已經指名了你。」" : `「${wh.flavor}」`}</p>
      ${cardLine}
      <p class="seed-note">公平隨機 · 結果於演出前已決定</p>`;
    recordRound({
      mode: result.mode,
      isDoom,
      card: card?.id || null,
      chosen: chosen.map((c) => ({ slot: c.slot, heroId: c.heroId })),
    });
    applyDoomPolicy(card);
    show("result");
  }

  /** 命運卡對懲罰的影響：仁慈＝不抽、加倍＝抽兩張 */
  let doomTimes = 1;
  function applyDoomPolicy(card) {
    const eff = card?.effect || {};
    doomTimes = eff.doomTimes || 1;
    const btn = $("#btn-doom");
    if (!btn) return;
    if (eff.noDoom) {
      btn.disabled = true;
      btn.textContent = "本局免罰";
    } else {
      btn.disabled = false;
      btn.textContent = doomTimes > 1 ? "抽懲罰任務 ×2" : "抽懲罰任務";
    }
  }

  function showResultSurvival(result) {
    applyDoomPolicy(result.card);
    recordRound({
      mode: "survival",
      isDoom: false,
      card: result.card?.id || null,
      chosen: [{ slot: result.survivor?.slot, heroId: result.survivor?.heroId }],
    });
    const s = result.survivor;
    const sh = s.hero || heroById(s.heroId);
    $("#result-badge").textContent = "🛡️ 最後生還者";
    $("#result-name").textContent = playerLabel(s.slot ?? 0);
    $("#result-hero").textContent = `${sh.name} · ${sh.weapon}`;
    setResultPortrait(sh.id, { list: true });
    const outOrder = result.eliminated
      .map((p, i) => {
        const h = p.hero || heroById(p.heroId);
        return `<li><span>${result.eliminated.length - i}</span> <b>${playerLabel(p.slot)}</b> · ${h.name}</li>`;
      })
      .reverse()
      .join("");
    $("#result-detail").innerHTML = `
      <p class="flavor-line">「${sh.flavor}」</p>
      <p class="seed-note">淘汰順序（由後往前）</p>
      <ol class="rank-list rank-out">${outOrder}</ol>`;
    show("result");
  }

  function showResultTeams(teams) {
    $("#result-badge").textContent = "🚩 命運分隊";
    $("#result-name").textContent = "分隊完成";
    $("#result-hero").textContent = `${teams.length} 隊`;
    const first = teams[0]?.[0];
    setResultPortrait(
      first ? (first.hero || heroById(first.heroId)).id : "knight",
      { list: true }
    );
    $("#result-detail").innerHTML = teams
      .map((team, t) => {
        const members = team
          .map((p) => {
            const h = p.hero || heroById(p.heroId);
            return `<li><b>${playerLabel(p.slot)}</b> · ${h.name}</li>`;
          })
          .join("");
        return `<div class="team-block" style="--tc:${TEAM_COLORS[t] || "#7ef0ff"}">
          <p class="team-name">${TEAM_LABELS[t] || `第 ${t + 1} 隊`}<small>${team.length} 人</small></p>
          <ul class="team-list">${members}</ul>
        </div>`;
      })
      .join("");
    show("result");
  }

  /* ---- 命運卷軸：把結果畫成可截圖分享的直式圖卡 ---- */
  let lastDoomText = "";

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const chars = String(text || "").split("");
    let line = "";
    let yy = y;
    chars.forEach((ch) => {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, yy);
        line = ch;
        yy += lineHeight;
      } else {
        line = test;
      }
    });
    if (line) ctx.fillText(line, x, yy);
    return yy;
  }

  async function drawFateScroll() {
    const canvas = $("#scroll-canvas");
    const run = state.run;
    if (!canvas || !run) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const result = run.result || {};
    const isDoom = !!result.isDoom;
    const chosen = result.chosen?.length
      ? result.chosen
      : result.survivor
        ? [result.survivor]
        : result.winner
          ? [result.winner]
          : [];
    const main = chosen[0];
    const mainHero = main ? main.hero || heroById(main.heroId) : null;

    // 底
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#2a1450");
    grad.addColorStop(0.55, "#160a2e");
    grad.addColorStop(1, "#08030f");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 外框
    ctx.strokeStyle = "rgba(255,224,138,0.7)";
    ctx.lineWidth = 6;
    roundRect(ctx, 24, 24, W - 48, H - 48, 28);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffe08a";
    ctx.font = "700 34px 'Noto Sans TC', system-ui, sans-serif";
    ctx.fillText("英雄命運 · 命運卷軸", W / 2, 96);

    ctx.fillStyle = isDoom ? "#ff9d9d" : "#7ef0ff";
    ctx.font = "800 30px 'Noto Sans TC', system-ui, sans-serif";
    const modeName =
      result.mode === "doom"
        ? "命運審判"
        : result.mode === "survival"
          ? "命運淘汰"
          : result.mode === "teams"
            ? "命運分隊"
            : result.mode === "order"
              ? "命運排序"
              : result.mode === "pair"
                ? "命運配對"
                : "魔王討伐";
    ctx.fillText(modeName, W / 2, 142);

    // 立繪
    if (mainHero) {
      const img =
        (await loadImage(`assets/videos/poster/victory/${mainHero.id}.jpg`)) ||
        (await loadImage(heroImg(mainHero.id)));
      if (img) {
        const boxW = 420;
        const boxH = 560;
        const bx = (W - boxW) / 2;
        const by = 180;
        ctx.save();
        roundRect(ctx, bx, by, boxW, boxH, 22);
        ctx.clip();
        const scale = Math.max(boxW / img.width, boxH / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, bx + (boxW - dw) / 2, by + (boxH - dh) / 2, dw, dh);
        ctx.restore();
        ctx.strokeStyle = "rgba(255,224,138,0.75)";
        ctx.lineWidth = 4;
        roundRect(ctx, bx, by, boxW, boxH, 22);
        ctx.stroke();
      }
    }

    let y = 800;
    ctx.fillStyle = "#fff7df";
    ctx.font = "900 56px 'Noto Sans TC', system-ui, sans-serif";
    ctx.fillText(
      chosen.map((c) => playerLabel(c.slot ?? 0)).join(" ＋ ") || "—",
      W / 2,
      y
    );
    y += 52;
    ctx.fillStyle = "#baf4ff";
    ctx.font = "700 32px 'Noto Sans TC', system-ui, sans-serif";
    ctx.fillText(
      chosen
        .map((c) => (c.hero || heroById(c.heroId))?.name)
        .filter(Boolean)
        .join(" × ") || "",
      W / 2,
      y
    );

    if (result.card) {
      y += 56;
      ctx.fillStyle = "#ffd98a";
      ctx.font = "700 28px 'Noto Sans TC', system-ui, sans-serif";
      ctx.fillText(`命運卡：${result.card.name}`, W / 2, y);
    }

    if (lastDoomText) {
      y += 58;
      ctx.fillStyle = "#ff9d9d";
      ctx.font = "800 30px 'Noto Sans TC', system-ui, sans-serif";
      y = wrapText(ctx, `判決：${lastDoomText}`, W / 2, y, W - 140, 40);
    }

    const d = new Date();
    ctx.fillStyle = "#9d92b8";
    ctx.font = "500 24px 'Noto Sans TC', system-ui, sans-serif";
    ctx.fillText(
      `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} · 公平隨機 · 結果於演出前已決定`,
      W / 2,
      H - 60
    );
  }

  /** 懲罰／任務：抽完誰之後，再抽要做什麼（與勝負 RNG 完全分離） */
  function rollDoom() {
    const list = loadDoomList();
    if (!list.length) return;
    const box = $("#doom-box");
    const text = $("#doom-text");
    if (!box || !text) return;
    const times = Math.max(1, Math.min(3, doomTimes | 0 || 1));
    const a = new Uint32Array(times);
    crypto.getRandomValues(a);
    const picks = [];
    for (let i = 0; i < times; i++) {
      const candidates = list.filter((x) => !picks.includes(x));
      const pool = candidates.length ? candidates : list;
      picks.push(pool[a[i] % pool.length]);
    }
    box.hidden = false;
    box.classList.remove("pop");
    void box.offsetWidth;
    box.classList.add("pop");
    text.innerHTML = picks.map((x) => `<span>${x}</span>`).join("");
    lastDoomText = picks.join("；");
    haptic(16);
    audioCue("doom.roll", { group: "ui" });
  }

  function clearDoom() {
    const box = $("#doom-box");
    if (box) {
      box.hidden = true;
      box.classList.remove("pop");
    }
  }

  function showResultOrder(order) {
    applyDoomPolicy(state.run?.result?.card);
    recordRound({
      mode: "order",
      isDoom: false,
      card: state.run?.result?.card?.id || null,
      chosen: order[0] ? [{ slot: order[0].slot, heroId: order[0].heroId }] : [],
    });
    $("#result-badge").textContent = "📋 命運順位";
    $("#result-name").textContent = "排序完成";
    $("#result-hero").textContent = `共 ${order.length} 位`;
    setResultPortrait((order[0].hero || heroById(order[0].heroId)).id, { list: true });
    $("#result-detail").innerHTML =
      `<ol class="rank-list">` +
      order
        .map((p, i) => {
          const h = p.hero || heroById(p.heroId);
          const m = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
          return `<li><span>${m}</span> <b>${playerLabel(p.slot)}</b> · ${h.name}</li>`;
        })
        .join("") +
      `</ol>`;
    show("result");
  }

  function showResultPair(pairs, bye) {
    applyDoomPolicy(state.run?.result?.card);
    recordRound({
      mode: "pair",
      isDoom: false,
      card: state.run?.result?.card?.id || null,
      chosen: [],
    });
    $("#result-badge").textContent = "🔗 命運配對";
    $("#result-name").textContent = "配對完成";
    $("#result-hero").textContent = `${pairs.length} 組`;
    const first = pairs[0]?.[0];
    setResultPortrait(first
      ? (first.hero || heroById(first.heroId)).id
      : "knight", { list: true });
    let html = `<ul class="pair-list">`;
    pairs.forEach(([a, b]) => {
      const ha = a.hero || heroById(a.heroId);
      const hb = b.hero || heroById(b.heroId);
      html += `<li><b>${playerLabel(a.slot)}</b> ${ha.name} × ${hb.name} <b>${playerLabel(b.slot)}</b></li>`;
    });
    html += `</ul>`;
    if (bye) {
      const hb = bye.hero || heroById(bye.heroId);
      html += `<p class="bye">🌙 命運輪空：${playerLabel(bye.slot)}（${hb.name}）</p>`;
    }
    $("#result-detail").innerHTML = html;
    show("result");
  }

  /* ---- WIRE ---- */
  on(window, "hf-audio-state", (event) => renderAudioStatus(event.detail));
  on($("#audio-activate"), "click", async (event) => {
    event.stopPropagation();
    const enabled = window.HF_Audio?.getSettings?.().enabled !== false;
    // 用「本次載入是否已由使用者親手啟用過」判斷，而不是看音樂有沒有在播。
    // 看播放狀態會有兩個問題：音樂還在載入時關不掉，
    // 而全域的手勢解鎖又會讓第一次點擊被誤判成關閉。
    if (audioUserActivated && enabled) {
      state.opts.sound = false;
      window.HF_Audio?.setEnabled?.(false);
      const sound = $("#opt-sound");
      if (sound) sound.checked = false;
      refreshAudioSettingsUi();
      renderAudioStatus(window.HF_Audio?.getStatus?.());
      return;
    }
    audioUserActivated = true;
    state.opts.sound = true;
    window.HF_Audio?.setEnabled?.(true);
    const sound = $("#opt-sound");
    if (sound) sound.checked = true;
    renderAudioStatus(window.HF_Audio?.getStatus?.());
    const ok = await window.HF_Audio?.unlock?.();
    if (ok) audioCue("pick.lock", { group: "ui", cooldown: 0, volume: 0.75 });
    renderAudioStatus(window.HF_Audio?.getStatus?.());
  });

  on($("#count-minus"), "click", () => {
    audioCue("ui.click", { group: "ui" });
    setCount(state.count - 1);
  });
  on($("#count-plus"), "click", () => {
    audioCue("ui.click", { group: "ui" });
    setCount(state.count + 1);
  });
  on($("#count-range"), "input", (e) => setCount(Number(e.target.value)));

  $$("[data-go]").forEach((btn) => {
    on(btn, "click", () => {
      const go = btn.dataset.go;
      window.HF_Audio?.unlock?.();
      haptic(7);
      audioCue(go === "home" ? "ui.back" : "ui.navigate", { group: "ui" });
      if (go === "pick") {
        if (btn.dataset.resetPicks === "1") {
          clearPicks();
        } else {
          ensurePlayers();
        }
        const idx = state.players.findIndex((p) => !p?.heroId);
        state.pickIndex = idx >= 0 ? idx : 0;
        pickBusy = false;
        show("pick");
        loadPickSelection();
      } else if (go === "mode") {
        ensurePlayers();
        if (!allPlayersPicked()) {
          const miss = missingPlayerIndexes().join("、");
          alert(`尚有玩家未鎖定角色：玩家 ${miss}`);
          show("pick");
          const idx = state.players.findIndex((p) => !p?.heroId);
          state.pickIndex = idx >= 0 ? idx : 0;
          loadPickSelection();
          return;
        }
        show("mode");
      } else if (go === "count") {
        clearPicks();
        show("count");
      } else if (go === "home") {
        clearPicks();
        show("home");
      }
    });
  });

  on($("#pick-prev"), "click", () => {
    if (pickBusy || state.pickIndex <= 0) return;
    state.pickIndex--;
    loadPickSelection();
  });

  on($("#pick-next"), "click", async () => {
    if (pickBusy) return;
    pickBusy = true;
    updatePickButtons();
    renderHeroGrid();
    try {
      const ok = await applyPick();
      if (!ok) return;
      // 還有人沒選 → 換人的過場音；全隊到齊時什麼都不放，
      // 因為 applyPick() 已經吹過號角了（pick.complete）。
      // 原本這裡會再補一記 reveal_chime，2 秒的鐘聲會跟 2.4 秒的號角糊在一起。
      const hasNext = state.players.some((player, index) => index > state.pickIndex && !player?.heroId);
      if (hasNext) audioCue("pick.advance", { group: "ui" });

      if (state.pickIndex >= state.players.length - 1) {
        goModeIfReady();
        return;
      }
      let next = state.pickIndex + 1;
      while (next < state.players.length && state.players[next]?.heroId) {
        next++;
      }
      if (next >= state.players.length) {
        goModeIfReady();
        return;
      }
      state.pickIndex = next;
      loadPickSelection();
    } catch (err) {
      console.warn("pick-next failed", err);
      setPickStatus("鎖定時發生錯誤，請再按一次決定");
    } finally {
      pickBusy = false;
      if ($("#screen-pick")?.classList.contains("active")) {
        updatePickButtons();
        renderHeroGrid();
        renderPartyDots();
      }
    }
  });

  function launchMode(mode, opts) {
    ensurePlayers();
    if (!allPlayersPicked()) {
      const miss = missingPlayerIndexes().join("、");
      alert(`請先完成角色選擇（玩家 ${miss} 尚未鎖定）`);
      show("pick");
      const idx = state.players.findIndex((p) => !p?.heroId);
      state.pickIndex = idx >= 0 ? idx : 0;
      loadPickSelection();
      return;
    }
    haptic(10);
    audioCue("mode.select", { group: "ui" });
    clearDoom();
    lastDoomText = "";
    startMode(mode, opts);
  }

  $$("#screen-mode [data-mode]").forEach((el) => {
    on(el, "click", (ev) => {
      ev.stopPropagation();
      const mode = el.dataset.mode;
      if (!mode) return;
      const teams = Number(el.dataset.teams) || 0;
      launchMode(mode, teams ? { teamCount: teams } : {});
    });
  });

  on($("#btn-skip"), "click", () => {
    if (!state.opts.allowSkip) return;
    state.skip = true;
    window.HF_Audio?.stopGroup?.("presentation");
    window.HF_Audio?.stopGroup?.("hero-attack");
    window.HF_Audio?.stopGroup?.("hero-victory");
    cleanupStageMedia({ release: true });
    $("#smoke")?.classList.remove("on");
    haptic(8);
    audioCue("ui.skip", { group: "ui" });
  });

  on($("#btn-replay"), "click", () => {
    if (!state.mode) return show("mode");
    haptic(10);
    if (!allPlayersPicked()) {
      clearPicks();
      show("pick");
      loadPickSelection();
      return;
    }
    startMode(state.mode);
  });

  on($("#btn-doom"), "click", () => {
    haptic(10);
    rollDoom();
  });

  on($("#btn-scroll"), "click", async () => {
    haptic(10);
    $("#modal-scroll")?.classList.remove("hidden");
    await drawFateScroll();
  });
  on($("#scroll-close"), "click", () =>
    $("#modal-scroll")?.classList.add("hidden")
  );
  on($("#scroll-save"), "click", () => {
    const canvas = $("#scroll-canvas");
    if (!canvas) return;
    try {
      const a = document.createElement("a");
      a.download = `heroes-fate-${Date.now()}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (_) {}
  });

  on($("#btn-stats"), "click", () => {
    haptic(10);
    renderStats();
    $("#modal-stats")?.classList.remove("hidden");
  });
  on($("#stats-close"), "click", () =>
    $("#modal-stats")?.classList.add("hidden")
  );
  on($("#stats-clear"), "click", () => {
    saveStats({ rounds: [] });
    renderStats();
  });

  const audioRangeIds = ["master", "music", "effects"];
  function refreshAudioSettingsUi() {
    audioRangeIds.forEach((key) => {
      const input = $(`#opt-${key}`);
      const output = $(`#opt-${key}-value`);
      if (input && output) output.textContent = `${Math.round(Number(input.value) || 0)}%`;
    });
    const enabled = $("#opt-sound")?.checked !== false;
    $("#audio-settings")?.classList.toggle("is-muted", !enabled);
    const icon = $("#opt-sound-icon");
    if (icon) icon.textContent = enabled ? "🔊" : "🔇";
  }

  function fillAudioSettings() {
    const values = window.HF_Audio?.getSettings?.() || {
      enabled: state.opts.sound,
      master: 0.86,
      music: 0.48,
      effects: 0.82,
    };
    const sound = $("#opt-sound");
    if (sound) sound.checked = values.enabled !== false;
    audioRangeIds.forEach((key) => {
      const input = $(`#opt-${key}`);
      if (input) input.value = String(Math.round((values[key] ?? 0) * 100));
    });
    refreshAudioSettingsUi();
  }

  function applyAudioSettings() {
    const sound = $("#opt-sound");
    state.opts.sound = sound?.checked !== false;
    window.HF_Audio?.setEnabled?.(state.opts.sound);
    window.HF_Audio?.setVolumes?.({
      master: Number($("#opt-master")?.value ?? 86) / 100,
      music: Number($("#opt-music")?.value ?? 48) / 100,
      effects: Number($("#opt-effects")?.value ?? 82) / 100,
    });
    refreshAudioSettingsUi();
  }

  audioRangeIds.forEach((key) => {
    on($(`#opt-${key}`), "input", () => {
      refreshAudioSettingsUi();
      applyAudioSettings();
    });
  });
  on($("#opt-sound"), "change", () => {
    applyAudioSettings();
    if (state.opts.sound) audioCue("ui.click", { group: "ui" });
  });

  on($("#btn-settings"), "click", () => {
    const box = $("#opt-doom-list");
    if (box) box.value = loadDoomList().join("\n");
    const st = $("#opt-strike");
    if (st) st.checked = state.opts.strike;
    const fc = $("#opt-card");
    if (fc) fc.checked = state.opts.fateCard;
    fillAudioSettings();
    $("#modal-settings")?.classList.remove("hidden");
  });
  on($("#doom-reset"), "click", () => {
    const box = $("#opt-doom-list");
    if (box) box.value = DOOM_DEFAULTS.join("\n");
  });
  on($("#settings-close"), "click", () => {
    const sk = $("#opt-skip");
    const fa = $("#opt-fast");
    const so = $("#opt-sound");
    const st = $("#opt-strike");
    const doom = $("#opt-doom-list");
    if (sk) state.opts.allowSkip = sk.checked;
    if (fa) state.opts.fast = fa.checked;
    if (so) state.opts.sound = so.checked;
    applyAudioSettings();
    if (st) state.opts.strike = st.checked;
    const fc = $("#opt-card");
    if (fc) state.opts.fateCard = fc.checked;
    if (doom) saveDoomList(doom.value);
    $("#modal-settings")?.classList.add("hidden");
  });

  // 手機連線提示
  function fillPhoneHint() {
    const el = $("#phone-url-hint");
    if (!el) return;
    const host = location.hostname;
    // 正式公開網址：GitHub Pages。永久固定，不需要 Mac 開機或隧道。
    const PUBLIC = "https://longxia7hao-dev.github.io/heroes-fate/";
    if (host === "127.0.0.1" || host === "localhost") {
      el.innerHTML =
        "<b>手機 4G／網際網路（推薦）：</b><br/>" +
        `<a href="${PUBLIC}" style="color:#7ef0ff;word-break:break-all">${PUBLIC}</a><br/>` +
        "<small>永久網址，不需要 Mac 開機</small><br/><br/>" +
        "<b>同一 Wi‑Fi（測本機未 push 的改動）：</b><br/>" +
        `<code style="color:#b0a8d0">http://192.168.68.52:8888/index.html</code><br/>` +
        "<small>勿在手機用 127.0.0.1</small>";
    } else if (host.includes("github.io")) {
      el.innerHTML =
        "已從網際網路連入，可直接遊玩。<br/>" +
        `<code style="color:#7ef0ff;word-break:break-all">${PUBLIC}</code>`;
    } else if (host.includes("trycloudflare.com") || host.includes("loca.lt")) {
      el.innerHTML =
        "已從網際網路連入，可直接遊玩。<br/>" +
        `<code style="color:#7ef0ff;word-break:break-all">${location.origin}/index.html</code>`;
    } else {
      el.innerHTML =
        "目前網址：<br/>" +
        `<code style="color:#7ef0ff;word-break:break-all">${location.origin}/index.html</code>`;
    }
  }

  setCount(4);
  fillPhoneHint();
  renderAudioStatus();
  /**
   * 新版偵測。手機上「改了卻看到舊的」在這個專案反覆發生：GitHub Pages 給
   * HTML 的是 max-age=600，而且**分頁一直開著不重新整理，index.html 根本
   * 不會再被抓一次**，於是所有 ?v= 都失效 —— 頁面自己不會知道有新版。
   *
   * 所以主動去問：抓 build.txt（no-store 繞過快取）跟頁面內嵌的印記比對，
   * 不一樣就跳出提示讓玩家點一下更新。**不自動重載** —— 那會打斷正在進行
   * 的一局。回到分頁時再查一次，那是最常「錯過新版」的時機。
   *
   * build.txt 由 `tools/sync_build.py` 從 index.html 的印記產生，改版後要跑。
   */
  (function watchForNewBuild() {
    const stampEl = $("#build-stamp");
    const button = $("#build-update");
    if (!stampEl || !button) return;
    const mine = stampEl.textContent.trim();
    let notified = false;

    async function check() {
      if (notified || navigator.onLine === false) return;
      try {
        const res = await fetch(`build.txt?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const live = (await res.text()).trim();
        if (!live || live === mine) return;
        notified = true;
        button.textContent = `有新版本 ${live} · 點一下更新`;
        button.hidden = false;
      } catch (_) {
        // 離線或抓不到就安靜略過：這只是加分功能，不能因此壞掉
      }
    }

    button.addEventListener("click", () => location.reload());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) check();
    });
    setTimeout(check, 1500);
  })();

  window.HF_VideoPlayer?.loadManifest?.().catch(() => {});
  setTimeout(() => show("home"), 800);
  } catch (err) {
    console.error(err);
    document.body.innerHTML =
      '<div style="padding:1.5rem;font-family:system-ui;background:#0a0818;color:#f4f0ff;min-height:100vh">' +
      "<h1 style='color:#ffe08a'>英雄命運</h1>" +
      "<p>啟動時發生錯誤，請重新整理。</p>" +
      "<pre style='color:#f88;font-size:12px;white-space:pre-wrap'>" +
      String(err && err.stack ? err.stack : err) +
      "</pre>" +
      "<p style='color:#7ef0ff'>手機請開：http://192.168.68.52:8888/index.html<br/>（同一 Wi‑Fi，勿用 127.0.0.1）</p></div>";
  }
})();
