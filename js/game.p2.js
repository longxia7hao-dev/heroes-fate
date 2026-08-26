nst h = p.hero || heroById(p.heroId);
        const slot = p.slot ?? i;
        return `<div class="battle-hud-badge" data-slot="${slot}" style="--hc:${h.color}"
          title="${playerLabel(slot)} · ${h.name}">
          <img src="${heroThumb(h.id)}" alt="" />
          <span>${slot + 1}</span>
        </div>`;
      }).join("");
      line.dataset.hfHud = signature;
    }
    line.querySelectorAll(".battle-hud-badge[data-slot]").forEach((badge) => {
      const slot = Number(badge.dataset.slot);
      const active = slot === activeSlot;
      badge.classList.toggle("active", active);
      badge.classList.toggle("winner", slot === winnerSlot);
      if (active) badge.setAttribute("aria-current", "true");
      else badge.removeAttribute("aria-current");
    });
  }

  function clearBattleHud() {
    const line = $("#heroes-line");
    if (!line) return;
    line.classList.remove("is-battle-hud");
    line.style.opacity = "1";
    line.innerHTML = "";
    delete line.dataset.hfHud;
  }

  /** 魔王戰攻擊切入：優先用雲端「攻擊魔王動畫」，缺片才退回 confirm */
  async function resolveAttackSources(players) {
    if (!window.HF_VideoPlayer?.loadManifest) return new Map();
    const generation = mediaPrefetchGeneration;
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
    if (generation === mediaPrefetchGeneration) prefetchAttackClips(map);
    return map;
  }

  /**
   * 媒體管線固定為「畫面上的影片 + 下一支攻擊 + 勝者 final」。
   * 舊版會在同一瞬間建立 13 attack + 1 final，手機的網路、解碼器與記憶體
   * 一起被塞滿；現在背景 attack 永遠最多一支，播放中才往前暖下一支。
   */
  const attackPrefetchPool = new Map();
  const posterWarmRefs = new Map();
  let finalPrefetch = null;
  let mediaPrefetchGeneration = 0;

  function releaseMediaElement(el) {
    if (!el) return;
    try {
      el.pause();
      el.removeAttribute("src");
      el.load();
    } catch (_) {}
  }

  function prefetchPosters(kind, ids) {
    ids.forEach((id) => {
      if (!id) return;
      const key = `${kind}:${id}`;
      if (posterWarmRefs.has(key)) return;
      const img = new Image();
      img.decoding = "async";
      // 低優先：poster 只是頂替用，搶在攻擊影片前面反而害它更慢
      try { img.fetchPriority = "low"; } catch (_) {}
      img.src = artUrl(`assets/videos/poster/${kind}/${id}.jpg`);
      posterWarmRefs.set(key, img);
      // 只保留眼前幾張的 JS 引用；圖片本身仍可由 HTTP cache 重用。
      while (posterWarmRefs.size > 6) {
        const oldest = posterWarmRefs.keys().next().value;
        posterWarmRefs.delete(oldest);
      }
    });
  }

  function releaseAttackClip(url) {
    const el = attackPrefetchPool.get(url);
    if (!el) return;
    releaseMediaElement(el);
    attackPrefetchPool.delete(url);
  }

  function warmAttackClip(url) {
    if (!url || MEDIA_POLICY.constrainedNetwork || attackPrefetchPool.has(url)) return;
    // 下一支改變時，立即中止上一個背景下載；不讓晚到請求重新塞回 pool。
    attackPrefetchPool.forEach((el) => releaseMediaElement(el));
    attackPrefetchPool.clear();
    const el = document.createElement("video");
    el.preload = "auto";
    el.muted = true;
    el.playsInline = true;
    el.src = window.HF_VideoPlayer?.versioned
      ? window.HF_VideoPlayer.versioned(url)
      : url;
    attackPrefetchPool.set(url, el);
    try { el.load(); } catch (_) {}
  }

  function prefetchAttackClips(map) {
    const first = [...map.entries()].find(([, url]) => !!url);
    if (!first) return;
    prefetchPosters("attack", [first[0]]);
    warmAttackClip(first[1]);
  }

  function finalPosterPath(heroId) {
    return `assets/videos/poster/final/${heroId}.jpg`;
  }

  /** 勝者的 final 片較大（2–4MB），第一支攻擊交棒後再抓，避開降臨片。 */
  async function prefetchFinalClip(heroId) {
    if (!heroId) return;
    const generation = mediaPrefetchGeneration;
    const bossId = "demon";
    prefetchPosters("final", [heroId]);
    prefetchPosters("victory", [heroId]);
    const extraPoster = finalPosterPath(heroId);
    if (extraPoster && !posterWarmRefs.has(extraPoster)) {
      const img = new Image();
      img.decoding = "async";
      try { img.fetchPriority = "low"; } catch (_) {}
      img.src = artUrl(extraPoster);
      posterWarmRefs.set(extraPoster, img);
    }
    if (MEDIA_POLICY.constrainedNetwork) return;
    try {
      await window.HF_VideoPlayer?.loadManifest?.();
      if (generation !== mediaPrefetchGeneration) return;
      const url = window.HF_VideoPlayer?.videoUrl?.(heroId, "final", bossId);
      if (!url) return;
      releaseMediaElement(finalPrefetch);
      const el = document.createElement("video");
      el.preload = "auto";
      el.muted = true;
      el.playsInline = true;
      el.src = window.HF_VideoPlayer.versioned(url);
      try { el.load(); } catch (_) {}
      finalPrefetch = el;
    } catch (_) {}
  }

  /**
   * 魔王名冊。只留原版惡魔魔王，不再輪換獨眼魔像／熔岩魔女。
   */
  const BOSS_ARRIVALS = [
    { id: "demon", name: "魔王", nameEn: "DEMON LORD", src: "assets/videos/mobile/boss/arrival.mp4", poster: "assets/videos/poster/boss/arrival.jpg" },
  ];
  /** 這一局選中的魔王。 */
  let currentArrival = BOSS_ARRIVALS[0];
  window.HF_setBoss = (id) => {
    const pick = BOSS_ARRIVALS.find((b) => b.id === id);
    if (!pick) return false;
    currentArrival = pick;
    arrivalUsed = false;
    return pick.id;
  };
  /**
   * 這隻是不是已經被某一局用掉了。
   *
   * ⚠️ **這個旗標是為了「再來一局」存在的。** 抽籤原本只寫在「進模式頁」，
   * 但 `#btn-replay` 是**直接呼叫 `startMode()`、不經過模式頁**的 ——
   * 於是重玩幾次都還是第一次抽到的那隻，睿哥實測「怎麼都沒有新增的魔物出現」
   * 就是這樣來的。現在改成：進模式頁先抽一次（爭取預抓時間），
   * 而 `startMode()` 發現上一隻已經用過就**重抽**。
   */
  let arrivalUsed = false;

  /**
   * 魔王降臨片（0.6–1.4MB）在選模式那一頁就開始抓：ACT2 一到就要播，
   * 等到那一刻才下載，4G 上必定卡住或整段被跳過。
   * **抽魔王也在這裡** —— 抽完才知道要預抓哪一支，不然會抓錯白花流量。
   */
  let arrivalPrefetch = null;
  function releaseArrivalPrefetch() {
    releaseMediaElement(arrivalPrefetch);
    arrivalPrefetch = null;
  }

  function prefetchArrivalClip() {
    const pick = BOSS_ARRIVALS[Math.floor(Math.random() * BOSS_ARRIVALS.length)];
    arrivalUsed = false;
    if (arrivalPrefetch && pick.src === currentArrival.src) return;
    // 換人了就把上一支放掉，不要留著佔記憶體與流量
    releaseArrivalPrefetch();
    currentArrival = pick;
    try {
      const url = pick.src;
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
    mediaPrefetchGeneration++;
    attackPrefetchPool.forEach((el) => releaseMediaElement(el));
    attackPrefetchPool.clear();
    releaseMediaElement(finalPrefetch);
    finalPrefetch = null;
    posterWarmRefs.clear();
  }

  async function playStageClip(video, url, durationMs, opts = {}) {
    if (!video || !url || state.skip) return false;
    stopStageVideo(video, true);
    try {
      if (opts.poster) video.poster = opts.poster;
      // 橫式素材要 contain，不然直向舞台的 cover 會把兩側裁掉
      video.style.objectFit = opts.fit || "";
      video.src = window.HF_VideoPlayer?.versioned
        ? window.HF_VideoPlayer.versioned(url)
        : url;
      video.preload = "auto";
      video.loop = false;
      video.muted = true;
      video.playsInline = true;
      try { video.load(); } catch (_) {}
      /**
       * **就緒之前就先揭幕**，讓那段等待顯示的是 poster（影片首幀）而不是全黑。
       *
       * 睿哥回報「點『進入戰場』後約 4～5 秒全黑」—— 就是這一段：揭幕原本排在
       * `waitMediaReady()` 之後，4G 上等 1.35MB 的降臨片要好幾秒，那幾秒舞台是
       * 暗的、什麼都沒有，看起來像當掉。poster 跟影片同比例又是同一幀，先頂著
       * 再無縫接上真正的播放，完全不突嵌。
       *
       * 沒 poster 就不先揭幕 —— 那只是把黑畫面換個地方黑，沒有意義。
       * 三條離開路徑（沒就緒、被略過、`play()` 失敗）都會走到 `finally` 的
       * `stopStageVideo()`，那裡 `show` 與 `video-active` 都會收乾淨。
       */
      if (opts.poster) {
        video.closest?.(".stage")?.classList.add("video-active");
        video.classList.add("show");
      }
      // 大支的全螢幕片（魔王降臨 1.35MB）在 4G 上 1 秒絕對載不完，
      // 就緒等待要能個別放寬，否則整段會被判定沒就緒而直接跳過。
      const ready = await waitMediaReady(video, opts.readyMs || 1000);
      if (!ready || state.skip) return false;
      try { video.currentTime = 0; } catch (_) {}
      video.closest?.(".stage")?.classList.add("video-active");
      video.classList.add("show");
      try {
        const started = video.play();
        if (started && typeof started.then === "function") await started;
      } catch (_) {
        return false;
      }
      if (state.skip) return false;
      // 聲音要對得上畫面，就得從「真的開播」這一刻起算 —— 4G 上載入可能等好幾秒，
      // 在 await 之前就下音效會變成「聲音先響、畫面幾秒後才來」。
      try { opts.onPlay?.(); } catch (_) {}
      // untilEnded：等 ended 事件而不是硬等固定秒數，播多久就是多久，
      // 起播晚了也不會被攔腰切掉（durationMs 此時只當保險上限）。
      if (opts.untilEnded) {
        // 有給 tapTarget 就允許點一下提早結束，跟英雄攻擊切入同一套手勢
        if (opts.tapTarget) await waitClipEndOrTap(video, opts.tapTarget, Math.max(600, durationMs | 0));
        else await waitClipEnd(video, Math.max(600, durationMs | 0));
      } else await wait(Math.max(180, durationMs | 0));
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
  async function playFinalBlow(player, hero, boss) {
    const root = $("#hero-cut");
    const video = $("#hero-cut-video");
    const stage = $("#stage");
    if (!root || !video || state.skip || !hero) return false;
    const bossId = "demon";
    const bossName = "魔王";
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
    $("#hero-cut-weapon").textContent = `終結${bossName}`;
    root.setAttribute("aria-hidden", "false");
    root.classList.add("show", "is-final");
    root.classList.remove("can-tap");
    stage?.classList.add("cut-active");

    try {
      const posterUrl = artUrl(finalPosterPath(hero.id));
      const posterEl = $("#hero-cut-poster");
      if (posterEl) posterEl.src = posterUrl;
      video.pause();
      video.poster = posterUrl;
      video.setAttribute("preload", "auto");
      video.preload = "auto";
      video.loop = false;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.src = window.HF_VideoPlayer?.versioned
        ? window.HF_VideoPlayer.versioned(url)
        : url;
      try { video.load(); } catch (_) {}
      /**
       * iOS／LINE 內建瀏覽器：不先 play()，canplay 永遠不來，8 秒後整段被當成
       * 沒就緒而放棄 —— 畫面只剩名牌＋深色底，就是「黑頻」。先踢 decode，
       * 封面層（is-final）頂著，等有畫面再淡入影片。
       */
      try {
        video.defaultPlaybackRate = CLIP_RATE;
        video.playbackRate = CLIP_RATE;
      } catch (_) {}
      const revealVideo = () => {
        if (!state.skip) root.classList.add("is-playing");
      };
      video.addEventListener("playing", revealVideo, { once: true });
      video.addEventListener("loadeddata", revealVideo, { once: true });
      let playAttempt = null;
      try { playAttempt = video.play(); } catch (_) {}
      const ready = await waitMediaReady(video, 14000);
      if (state.skip) return false;
      if (playAttempt && typeof playAttempt.then === "function") {
        try { await playAttempt; } catch (_) {
          if (ready) {
            try { await video.play(); } catch (_) {}
          }
        }
      } else if (ready && video.paused) {
        try { await video.play(); } catch (_) {}
      }
      const hasFrame = !video.error && (video.readyState >= 2 || !video.paused);
      if (!hasFrame) {
        await wait(2200);
        return false;
      }
      releaseMediaElement(finalPrefetch);
      finalPrefetch = null;
      try {
        video.defaultPlaybackRate = CLIP_RATE;
        video.playbackRate = CLIP_RATE;
      } catch (_) {}
      if (video.paused) {
        try {
          const started = video.play();
          if (started && typeof started.then === "function") await started;
        } catch (_) {}
      }
      if (state.skip) return false;
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
      stage?.classList.remove("cut-active");
      stopHeroCut(true);
    }
  }

  async function playAttackSequence(players, sources, { winnerId = null } = {}) {
    const root = $("#hero-cut");
    const video = $("#hero-cut-video");
    const stage = $("#stage");
    if (!root || !video || state.skip) return;
    const total = players.length;
    let finalWarmStarted = false;

    const warmFollowing = (index) => {
      const next = players[index + 1];
      const nextHero = next && (next.hero || heroById(next.heroId));
      if (nextHero) {
        prefetchPosters("attack", [nextHero.id]);
        warmAttackClip(sources.get(nextHero.id));
      }
      // final 很大，等第一支攻擊真的交棒後才抓；前面仍有其餘攻擊＋命運一擊。
      if (!finalWarmStarted && winnerId) {
        finalWarmStarted = true;
        prefetchFinalClip(winnerId);
      }
    };

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

        // 第一位才收成深色底；其後保持上一幀，等新片 playing 再接，避免黑一拍。
        if (i === 0) root.classList.remove("is-playing");

        const source = sources.get(h.id);
        if (!source) {
          window.HF_Audio?.playHeroAttack?.(h.id);
          warmFollowing(i);
          await wait(360);
          continue;
        }

        prefetchPosters("attack", [h.id]);
        warmAttackClip(source);
        video.pause();
        video.poster = artUrl(`assets/videos/poster/attack/${h.id}.jpg`);
        video.src = window.HF_VideoPlayer?.versioned
          ? window.HF_VideoPlayer.versioned(source)
          : source;
        video.preload = "auto";
        video.loop = false;
        video.muted = true;
        video.playsInline = true;
        try { video.load(); } catch (_) {}
        const ready = video.readyState >= 2
          ? true
          : await waitMediaReady(video, i === 0 ? 5000 : 1800);
        if (state.skip) continue;
        if (!ready) {
          releaseAttackClip(source);
          warmFollowing(i);
          await wait(720);
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
        try {
          const started = video.play();
          if (started && typeof started.then === "function") await started;
        } catch (_) {
          releaseAttackClip(source);
          warmFollowing(i);
          continue;
        }
        if (state.skip) continue;
        releaseAttackClip(source);
        root.classList.add("is-playing");
        window.HF_Audio?.playHeroAttack?.(h.id);
        warmFollowing(i);
        await waitClipEndOrTap(video, root, 2800);
      }
    } finally {
      window.HF_Audio?.stopGroup?.("hero-attack");
      stage?.classList.remove("cut-active");
      stopHeroCut(true);
    }
  }

  const stageHeroNodeCache = new Map();
  function placeHeroes(