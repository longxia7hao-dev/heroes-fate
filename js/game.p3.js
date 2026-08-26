list, { highlightId, attack } = {}) {
    const line = $("#heroes-line");
    if (!line) return;
    line.classList.remove("is-battle-hud");
    delete line.dataset.hfHud;
    const fragment = document.createDocumentFragment();
    list.forEach((p, i) => {
      const h = p.hero || heroById(p.heroId);
      const slot = p.slot ?? i;
      let node = stageHeroNodeCache.get(slot);
      if (!node) {
        node = document.createElement("div");
        node.className = "stage-hero";
        node.innerHTML = '<img alt="" /><span></span><small></small>';
        stageHeroNodeCache.set(slot, node);
      }
      if (node.dataset.heroId !== h.id) {
        node.dataset.heroId = h.id;
        const img = node.querySelector("img");
        img.src = heroThumb(h.id);
        img.alt = h.name;
        node.querySelector("small").textContent = h.name;
      }
      node.querySelector("span").textContent = playerLabel(slot);
      node.style.setProperty("--hc", h.color);
      node.classList.toggle("highlight", !!highlightId && h.id === highlightId);
      node.classList.toggle("dim", !!highlightId && h.id !== highlightId);
      node.classList.toggle("attack", !!attack && h.id === highlightId);
      fragment.appendChild(node);
    });
    line.replaceChildren(fragment);
  }

  function startMode(mode, opts = {}) {
    if (state.presenting) return;
    // 「再來一局」不經過模式頁，所以重抽要放在這裡，否則每局都是同一隻魔王
    if (arrivalUsed) prefetchArrivalClip();
    arrivalUsed = true;
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
    const result = state.run.result || {};
    const battleMode = result.mode === "boss" || result.mode === "doom";
    const winnerId = result.winner?.heroId || result.survivor?.heroId || null;
    window.HF_Audio?.preloadHeroes?.(
      payloadPlayers.map((player) => player.heroId),
      {
        attacks: battleMode,
        winnerId,
        victories: !!winnerId,
      }
    );
    audioCue("round.open", { group: "presentation" });
    show("play");
    presentRun();
  }

  /**
   * 命運一擊：揭曉前讓全員按住螢幕蓄力。
   * 純儀式 —— 結果早已由 seedRun 定案，這裡只是把揭曉時機交到大家手上。
   */
  function warmFateCircleAssets() {
    if (!state.opts.strike) return;
    $$("#strike-gate .fc-layer[data-src]").forEach((img) => {
      img.src = img.dataset.src;
      delete img.dataset.src;
    });
  }

  function playFateStrike(fast) {
    return new Promise((resolve) => {
      const gate = $("#strike-gate");
      const countEl = $("#strike-count");
      const subEl = $("#strike-sub");
      if (!gate || !state.opts.strike || state.skip) return resolve();
      warmFateCircleAssets();

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
      /**
       * **不是魔王戰就立刻把預抓的降臨片放掉。**
       *
       * 睿哥 2026-08-17 回報「影片超卡的，連選擇角色影片也跑不出來了」，
       * 這是其中一個原因：`show("mode")` 會**投機預抓**一支 0.6–1.4MB 的魔王降臨片
       *（見 `prefetchArrivalClip`），但原本要等整段演出跑完的 `finally` 才釋放。
       * 於是玩命運分隊／命運排序時，那支**用不到**的降臨片會跟這個模式自己的
       * 開場影片**同時搶頻寬**，4G 上兩邊都慢，開場片等不到就緒就被跳過。
       *
       * 放在 `revealFateCard()` 之後：命運卡有可能把 boss 換成 doom
       *（`rng.js` 的「逆命」），那兩個模式都還要用降臨片，不能放掉。
       * 判斷用 `result.mode` 不是 `mode` —— 前者才是命運卡生效後的真正模式。
       */
      await revealFateCard(result.card, fast);
      if (result.mode !== "boss" && result.mode !== "doom") releaseArrivalPrefetch();
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
        await wait(240 * fast);
        showResultPair(result.pairs, result.bye);
      } else if (mode === "survival") {
        await presentSurvival(players, result, { stage, bg, boss, spot, victory, fast });
      } else if (mode === "teams") {
        bg.style.backgroundImage = "url(assets/bg_party.jpg)";
        boss.classList.remove("show");
        placeHeroes([]);

        /**
         * 開場影片：法師施法把命運卡排成方陣（直式 720×1280）。
         * 舞台是直向全螢幕，cover 剛好鋁滿，不再需要 contain 黑邊。
         */
        setAct("arrival");
        stage.classList.add("dark", "can-tap");
        setBanner("命運分隊 · 洗牌中……");
        await playStageClip(video, "assets/videos/mobile/teams/intro.mp4", 7000 * fast, {
          poster: artUrl("assets/videos/poster/teams/intro.jpg"),
          readyMs: 8000,
          untilEnded: true,
          tapTarget: stage,
          onPlay: () => audioCue("team.shuffle", { group: "presentation" }),
        });
        stage.classList.remove("dark", "can-tap");

        setAct("pair");
        for (let t = 0; t < result.teams.length && !state.skip; t++) {
          placeHeroes(result.teams[t]);
          setBanner(`${TEAM_LABELS[t] || `第 ${t + 1} 隊`} 成軍！`);
          impactFx(TEAM_COLORS[t] || "#7ef0ff");
          audioCue("team.reveal", { group: "presentation", rate: 1 + t * 0.04 });
          await wait(460 * fast);
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
      // can-tap 也要在這裡收：中途跳過或出錯時，魔王降臨那段的
      // remove 不一定跑得到，提示會一直掛在畫面上
      stage.classList.remove("shake", "dark", "can-tap");
      boss.classList.remove("show", "roar", "hurt", "down", "enter");
      victory.classList.remove("show", "film", "film-hit", "film-win");
      cine.classList.remove("show");
      cleanupStageMedia({ release: true });
      releaseArrivalPrefetch();
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

  function ensureBossArt() {
    const picture = $("#boss picture");
    const source = picture?.querySelector("source[data-srcset]");
    const img = picture?.querySelector("img[data-src]");
    if (source?.dataset.srcset) {
      source.srcset = artUrl(source.dataset.srcset);
      delete source.dataset.srcset;
    }
    if (img?.dataset.src) {
      img.src = artUrl(img.dataset.src);
      delete img.dataset.src;
    }
  }

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

    /**
     * 抽牌整段換成睿哥指定的管弦樂（`assets/audio/bgm/order.mp3`）。
     *
     * **在開場影片之前就下**，理由有二：一是儀式從影片就開始了，音樂晚進來
     * 會像配錯段；二是這支 431KB 在 4G 上要抓一下，早一點下才來得及在
     * 牌陣出現前接上（`crossfadeMusic()` 自己會等下載解碼，不會卡住演出）。
     *
     * ⚠️ 換回場景 BGM 寫在最下面的 `finally`，**不要搬到別的地方** ——
     * 中途被略過或丟例外時沒換回來的話，接下來整局都會掛著這首曲子。
     */
    window.HF_Audio?.playMusicTrack?.("order");

    // ── 開場影片（睿哥的素材，6.04s）。沒播成就直接進牌陣，流程不能卡。
    //    原片 1152×1728／24Mb/s／18MB，已壓成 720×1080 CRF 30（1.09MB）；
    //    音軌拿掉了 —— 舞台影片一律靜音播放（iOS 自動播放的硬性條件），留著只是負重。
    setAct("arrival");
    stage.classList.add("dark");
    setBanner("命運排序 · 儀式開始");
    await playStageClip(video, "assets/vi