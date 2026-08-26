ntains(btn) || btn.disabled || pickBusy) return;
      const id = btn.dataset.id;
      if (!id) return;
      ensurePickVideo()?.prime?.(id, "wait")?.catch?.(() => {});
      try {
        const img = new Image();
        img.decoding = "async";
        img.src = waitPoster(id);
      } catch (_) {}
    }, { passive: true });

    root.addEventListener("click", (event) => {
      const btn = event.target.closest?.(".hero-card[data-id]");
      if (!btn || !root.contains(btn) || btn.disabled || pickBusy) return;
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
    // 14 張圖只建立一次；之後換玩家只更新狀態，避免同一幀反覆解碼圖片與重排。
    if (grid.children.length !== HEROES.length) {
      grid.innerHTML = HEROES.map((h) => heroCardHtml(h, false, false)).join("");
    }
    bindHeroCards(grid);
    HEROES.forEach((h) => {
      const btn = grid.querySelector(`[data-id="${h.id}"]`);
      if (!btn) return;
      const locked = taken.has(h.id) && h.id !== currentPick;
      const selected = state.selectedHeroId === h.id;
      btn.classList.toggle("locked", locked);
      btn.classList.toggle("selected", selected);
      btn.disabled = locked || pickBusy;
      btn.setAttribute("aria-pressed", String(selected));
    });
  }

  function renderPartyDots() {
    const box = $("#party-dots");
    if (!box) return;
    if (box.children.length !== state.players.length) {
      box.innerHTML = state.players
        .map((_, i) => `<button type="button" class="pdot" data-slot="${i}"><span>${i + 1}</span></button>`)
        .join("");
    }
    if (box.dataset.hfBound !== "1") {
      box.dataset.hfBound = "1";
      box.addEventListener("click", (event) => {
        const dot = event.target.closest?.(".pdot[data-slot]");
        if (!dot || !box.contains(dot) || pickBusy) return;
        const slot = Number(dot.dataset.slot);
        if (!Number.isInteger(slot) || slot < 0 || slot >= state.players.length) return;
        state.pickIndex = slot;
        haptic(7);
        loadPickSelection();
      });
    }
    state.players.forEach((p, i) => {
      const dot = box.children[i];
      if (!dot) return;
      dot.classList.toggle("done", !!p.heroId);
      dot.classList.toggle("current", i === state.pickIndex);
      dot.disabled = pickBusy;
      const title = p.heroId
        ? `${playerLabel(i)} · ${heroById(p.heroId)?.name || p.heroId}`
        : `${playerLabel(i)} · 未選`;
      dot.title = title;
      dot.setAttribute("aria-label", title);
      if ((dot.dataset.heroId || "") !== (p.heroId || "")) {
        dot.dataset.heroId = p.heroId || "";
        if (p.heroId) {
          const img = document.createElement("img");
          img.src = heroThumb(p.heroId);
          img.alt = "";
          dot.replaceChildren(img);
        } else {
          const label = document.createElement("span");
          label.textContent = String(i + 1);
          dot.replaceChildren(label);
        }
      }
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
      onShown: () => {
        const pedestal = $("#screen-pick .model-pedestal");
        pedestal?.classList.remove("is-empty");
        pedestal?.classList.add("is-flipped");
        revealPickVideoIfReady();
      },
      onHide: () => {
        $("#sprite-stage")?.classList.remove("is-live");
      },
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
      $("#sprite-stage")?.classList.remove("is-live");
      pedestal?.classList.add("is-empty");
      pedestal?.classList.remove("is-flipped");
      try { pickVideo?.pause?.(); } catch (_) {}
      const backImg = $("#pick-face-back");
      if (backImg && !backImg.hidden) {
        showPickContent({ back: true });
      } else {
        flipPickCard({ back: true });
      }
      return;
    }

    $("#screen-pick")?.style.setProperty("--hero-accent", h.color || "#90caf9");
    window.HF_Audio?.playHeroMusic?.(h.id);
    if (job) job.textContent = h.name;
    if (weapon) weapon.textContent = h.weapon;
    if (flavor) flavor.textContent = `「${h.flavor}」`;

    const vp = ensurePickVideo();
    if (vp && gen === previewGen) {
      if (vp.currentId === h.id && $("#sprite-stage")?.classList.contains("is-live")) return;
      pedestal?.classList.remove("is-empty");
      pedestal?.classList.add("is-flipped");
      try {
        await flipPickCard({ heroId: h.id });
        if (gen !== previewGen) return;
        await vp.play(h.id, "wait");
      } catch (e) {
        console.warn("preview play failed", e);
      }
      if (gen === previewGen) revealPickVideoIfReady();
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
  const PRESENTATION_SKIP_EVENT = "hf-presentation-skip";

  function wait(ms) {
    return new Promise((resolve) => {
      if (state.skip) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener(PRESENTATION_SKIP_EVENT, finish);
        resolve();
      };
      const timer = setTimeout(finish, Math.max(0, ms | 0));
      window.addEventListener(PRESENTATION_SKIP_EVENT, finish, { once: true });
    });
  }

  /** 依實際片長與播放倍率算出保險上限，避免 ended 沒來時卡在最後一幀。 */
  function clipHoldMs(video, fallbackMs) {
    const rate = Math.max(0.25, Number(video?.playbackRate) || CLIP_RATE);
    const dur = Number(video?.duration);
    if (Number.isFinite(dur) && dur > 0.2) {
      return Math.min(fallbackMs, Math.round((dur / rate) * 1000 + 220));
    }
    return fallbackMs;
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
    if (!video || state.skip) return Promise.resolve(false);
    // iOS／LINE 內建瀏覽器常停在 readyState 2（有首幀），不先 play() 就不會升到 3、也不觸發 canplay。
    // 有畫面能貼上去就算就緒，不要死等 HAVE_FUTURE_DATA。
    if (video.readyState >= 2) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      let timer = 0;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("canplay", onReady);
        video.removeEventListener("playing", onReady);
        video.removeEventListener("error", onError);
        window.removeEventListener(PRESENTATION_SKIP_EVENT, onSkip);
        resolve(ok);
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);
      const onSkip = () => finish(false);
      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("canplay", onReady, { once: true });
      video.addEventListener("playing", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
      window.addEventListener(PRESENTATION_SKIP_EVENT, onSkip, { once: true });
      timer = setTimeout(() => finish(video.readyState >= 2), timeoutMs);
    });
  }

  /** 等影片自然播完（或 skip／逾時）；用於不截斷的攻擊切入 */
  function waitClipEnd(video, timeoutMs = 4200) {
    return new Promise((resolve) => {
      if (!video || state.skip) return resolve();
      let done = false;
      let timer = 0;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener("ended", finish);
        video.removeEventListener("error", finish);
        window.removeEventListener(PRESENTATION_SKIP_EVENT, finish);
        resolve();
      };
      video.addEventListener("ended", finish, { once: true });
      video.addEventListener("error", finish, { once: true });
      timer = setTimeout(finish, clipHoldMs(video, timeoutMs));
      window.addEventListener(PRESENTATION_SKIP_EVENT, finish, { once: true });
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
      const finish = (reason) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("error", onEnded);
        tapTarget?.removeEventListener("click", onTap);
        window.removeEventListener(PRESENTATION_SKIP_EVENT, onSkip);
        resolve(reason);
      };
      const startedAt = performance.now();
      const onEnded = () => finish("ended");
      const onSkip = () => finish("skip");
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
      timer = setTimeout(() => finish("timeout"), clipHoldMs(video, timeoutMs));
      window.addEventListener(PRESENTATION_SKIP_EVENT, onSkip, { once: true });
    });
  }

  function stopStageVideo(video = $("#stage-video"), release = true) {
    if (!video) return;
    video.classList.remove("show");
    video.closest?.(".stage")?.classList.remove("video-active");
    // 下一支不見得也是橫式，object-fit 一定要還原，否則直式片會被加上黑邊
    video.style.objectFit = "";
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
    root?.classList.remove("show", "is-playing", "is-impact", "is-fallback", "is-final", "can-tap");
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
    if (MEDIA_POLICY.lite) count = Math.min(count, 8);
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
    const signature = players
      .map((p, i) => `${p.slot ?? i}:${(p.hero || heroById(p.heroId))?.id || p.heroId}`)
      .join("|");
    if (line.dataset.hfHud !== signature) {
      line.innerHTML = players.map((p, i) => {
        co