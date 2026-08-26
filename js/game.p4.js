deos/mobile/order/intro.mp4", 9000 * fast, {
      poster: artUrl("assets/videos/poster/order/intro.jpg"),
      readyMs: 8000,
      untilEnded: true,
      onPlay: () => audioCue("boss.enter", { group: "presentation" }),
    });
    stage.classList.remove("dark");

    // 整段包在 try/finally 裡 —— 跳過或中途出錯時牌陣一定要收掉、BGM 一定要換回來，
    // 不然牌會卡在畫面上、曲子會一路掛到下一段。
    //
    // ⚠️ `if (!wrap) return` 原本排在 try 之前，現在**必須留在 try 裡面** ——
    // 排在外面的話那條路徑會跳過 finally，音樂就換不回來了。
    try {
      if (!wrap) return;

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
      // wrap 可能是 null（上面那條 early return 的情況），一律用 optional chaining
      wrap?.setAttribute("aria-hidden", "true");
      if (wrap) wrap.innerHTML = "";
      wrap?.style.removeProperty("--rk-n");
      // 抽牌的曲子只屬於這一段，收工換回場景 BGM
      window.HF_Audio?.restoreSceneMusic?.();
    }
  }

  async function presentSurvival(players, result, ctx) {
    const { stage, bg, boss, spot, victory, fast } = ctx;
    ensureBossArt();
    const survivor = result.survivor;
    prefetchFinalClip((survivor?.hero || heroById(survivor?.heroId))?.id);
    const sh = survivor.hero || heroById(survivor.heroId);

    bg.style.backgroundImage = "url(assets/bg_battle_arena_v2.jpg)";
    setAct("gather");
    renderBattleHud(players);
    setBanner("命運淘汰 · 全員登場");
    audioCue("battle.gather", { group: "presentation" });
    await wait(380 * fast);

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
    await wait(400 * fast);

    // === ACT 2: 魔王降臨。就是這支影片，沒有別的演出 ===
    // 睿哥指定：拿掉「魔王小圖飛進來撞擊」那套設計（立繪 enter + impactFx），
    // 也不要在影片播完後把小圖砸上來。魔王立繪從 ACT 3A 才進場。
    setAct("arrival");
    stage.classList.add("dark");
    // 這一局的魔王在進模式頁時就抽好了（見 prefetchArrivalClip），
    // 所以預抓的跟現在要播的一定是同一支。
    const arrival = currentArrival;
    setBanner(isDoom ? `${arrival.name}降臨——它要挑一個人帶走` : `${arrival.name}降臨！！`);
    let roarTimer = 0;
    stage.classList.add("can-tap");
    const arrivalPlayed = await playStageClip(
      video,
      arrival.src,
      9000 * fast,
      {
        poster: artUrl(arrival.poster),
        fit: arrival.fit,
        readyMs: 8000,
        untilEnded: true,
        // 一鍵跳過：跟英雄攻擊切入同一套（click、前 600ms 防誤觸）
        tapTarget: stage,
        onPlay: () => {
          releaseArrivalPrefetch();
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
    // 實播元素已接手同一 URL，預抓副本立即釋放，重玩不累積解碼器與記憶體。
    releaseArrivalPrefetch();
    stage.classList.remove("can-tap");
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

    /**
     * ⚠️ **ACT 3A「全軍突擊」已於 2026-08-17 移除，不要加回來。**
     *
     * 睿哥看了畫面直接說「這個畫面不要了，魔王降臨動畫後直接接英雄攻擊畫面」。
     * 原本這裡會播 `assets/ref_battle_mobile.mp4`（全螢幕戰場空景）＋
     * 「命運之輪 · 全軍突擊！」橫幅，夾在降臨與英雄切入中間。
     *
     * 一併清掉的東西，找不到時別以為是誰漏刪：
     *   - `assets/ref_battle_mobile.mp4`（Codex 才在 v1.47 納入版控修 404，
     *     現在沒人用了，照專案鐵則「只收實際在用的素材」刪掉。
     *     要復原的話原片還在睿哥 Mac 的 `assets/ref_battle.mp4`，那支是 .gitignore 的）
     *   - `revamp.css` 的 `[data-act="clash"]` 幾條規則變成死規則，**先留著**：
     *     `clash` 這個 act 名稱沒別人用，留著不影響任何畫面，
     *     真要清也該連同 `audioDirector.js` 的 `battle.clash` 一起，另外開一次。
     *
     * HUD 不必在這裡補建 —— ACT 2 的 `renderBattleHud(players)` 已經建好，
     * `playAttackSequence()` 每一位攻擊時還會再更新 active。
     */

    // === ACT 3B: 各角色的攻擊動畫一支接一支連播，中間不插打擊演出（避免割裂感） ===
    setAct("attack");
    await playAttackSequence(players, attackSources, { winnerId: wh?.id });
    warmFateCircleAssets();

    // === ACT 4: retaliation and a full-frame smoke wipe. ===
    if (!state.skip) {
      setAct("fate");
      renderBattleHud(players);
      smoke.classList.add("on");
      stage.classList.add("shake");
      setBanner(`${arrival.name}怒吼——戰場被命運吞沒！`);
      audioCue("boss.roar", { group: "presentation" });
      audioCue("smoke.burst", { group: "presentation", volume: 0.72 });
      haptic(22);
      await wait(520 * fast);
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
      await playFinalBlow(w, wh, arrival);
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
    const panel = $("#screen-result .result-panel");
    panel?.classList.toggle("result-list", !!opts.list);
    /**
     * `hidePortrait`：整塊立繪不要（目前只有分隊在用）。
     * ⚠️ **一定要在這裡就 return**，不能只靠 CSS 藏 —— 後面那段會去載入並播放
     * 勝利短片，藏起來也照載、照播，等於在 4G 上白白吃掉幾百 KB 與一個解碼器。
     * 同時把 `token` 往前推，取消掉上一局可能還在跑的載入。
     */
    panel?.classList.toggle("result-no-portrait", !!opts.hidePortrait);
    if (opts.hidePortrait) {
      resultPortraitGen += 1;
      model?.classList.remove("has-video");
      if (video) {
        try { video.pause(); video.removeAttribute("src"); video.load(); } catch (_) {}
      }
      if (img) img.removeAttribute("src");
      return;
    }
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

    $("#result-badge").textContent = isDoom ? "命運審判" : "勝利者";
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
    $("#result-name