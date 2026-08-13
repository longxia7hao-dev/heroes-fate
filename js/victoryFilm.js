/**
 * Victory short film: Sora victory video + captions ON THE SAME STAGE
 * - Video and Chinese/English titles share one letterbox
 * - Hold last frame after video ends (never black mid-sequence)
 * - Destroy only when whole sequence finishes
 */
window.HF_VictoryFilm = (() => {
  async function play(o) {
    const {
      heroId,
      stageEl,
      bannerEl,
      bossEl,
      filmHost,
      shouldSkip,
      timeScale = 1,
    } = o;

    if (!filmHost || !stageEl) return;

    stageEl.classList.add("show", "film");
    filmHost.innerHTML = "";

    const hero = (window.HF_DATA?.heroes || []).find((h) => h.id === heroId);
    const labels =
      hero?.victory && hero.victory.length
        ? hero.victory
        : ["蓄勢", "攻擊！", "命中！！", "VICTORY"];

    // Build integrated stage: video + caption overlay
    const shell = document.createElement("div");
    shell.className = "vf-shell";
    shell.innerHTML = `
      <div class="vf-video-wrap">
        <video class="vf-video" playsinline webkit-playsinline muted></video>
        <img class="vf-still" alt="" />
        <div class="vf-rays" aria-hidden="true"><i></i><i></i><i></i></div>
      </div>
      <div class="vf-title">VICTORY</div>
      <div class="vf-caption" aria-live="polite"></div>
    `;
    filmHost.appendChild(shell);

    const video = shell.querySelector(".vf-video");
    const still = shell.querySelector(".vf-still");
    const caption = shell.querySelector(".vf-caption");
    const titleEl = shell.querySelector(".vf-title");

    // 開場不要先鋪方形立繪（512×512 用 contain 會看起來被拉寬），
    // 只在影片缺片／載入失敗時才拿它當後備。
    still.src = `assets/heroes/${heroId}.png?v=2`;
    still.hidden = true;
    video.hidden = true;
    titleEl.hidden = true;

    const wait = (ms) =>
      new Promise((resolve) => {
        const need = Math.max(0, ms / Math.max(0.1, timeScale));
        const t0 = performance.now();
        const tick = () => {
          if (shouldSkip && shouldSkip()) return resolve();
          if (performance.now() - t0 >= need) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

    function setCaption(text, isVictory) {
      // The large title already says VICTORY; keep the lower ribbon meaningful
      // instead of repeating the same word twice on the same frame.
      caption.textContent = isVictory
        ? `${hero?.name || "英雄"} · 命運加冕`
        : (text || "");
      caption.classList.toggle("is-victory", !!isVictory);
      if (bannerEl) {
        bannerEl.textContent = text || "";
        bannerEl.classList.add("show", "is-film-cap");
      }
      if (isVictory) {
        titleEl.hidden = false;
        titleEl.classList.add("show");
        stageEl.classList.add("film-win");
      }
    }

    // Resolve through the shared, cached Sora manifest.
    let videoUrl = null;
    let sourceKind = "still";
    try {
      const man = window.HF_VideoPlayer
        ? await window.HF_VideoPlayer.loadManifest()
        : {};
      const m = man?.[heroId];
      videoUrl = m?.victory || m?.confirm || m?.wait || null;
      sourceKind = m?.victory
        ? "victory"
        : m?.confirm
          ? "confirm"
          : m?.wait
            ? "wait"
            : "still";
    } catch (_) {}
    shell.dataset.sourceKind = sourceKind;
    if (!videoUrl) still.hidden = false;

    let videoReady = false;
    let videoEnded = false;
    let heroAudioStarted = false;

    if (videoUrl) {
      if (sourceKind === "victory") {
        // 首幀圖與影片同比例，載入中先頂著，避免黑畫面
        video.poster = `assets/videos/poster/victory/${heroId}.jpg?v=2`;
      }
      video.src = window.HF_VideoPlayer?.versioned
        ? window.HF_VideoPlayer.versioned(videoUrl)
        : videoUrl;
      video.loop = false;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      // 先讓 video 可見，載入中就會顯示同比例的 poster 首幀而不是黑畫面
      video.hidden = false;
      try {
        video.defaultPlaybackRate = 1.3;
        video.playbackRate = 1.3;
      } catch (_) {}

      await new Promise((resolve) => {
        let done = false;
        const fin = () => {
          if (done) return;
          done = true;
          resolve();
        };
        video.addEventListener("canplay", fin, { once: true });
        video.addEventListener("error", fin, { once: true });
        try {
          video.load();
        } catch (_) {}
        setTimeout(fin, 2200);
      });

      if (video.error) {
        // keep still
        video.hidden = true;
        still.hidden = false;
      } else {
        video.hidden = false;
        still.hidden = true;
        videoReady = true;
        video.addEventListener(
          "ended",
          () => {
            videoEnded = true;
            // Freeze last frame — do NOT clear
            try {
              video.pause();
              if (video.duration && isFinite(video.duration)) {
                video.currentTime = Math.max(0, video.duration - 0.05);
              }
            } catch (_) {}
            // Show still as backup under video if blank
            still.hidden = false;
            still.style.opacity = "0";
          },
          { once: true }
        );
        try {
          await video.play();
          window.HF_Audio?.playHeroVictory?.(heroId);
          heroAudioStarted = true;
        } catch (_) {
          video.hidden = true;
          still.hidden = false;
          videoReady = false;
        }
      }
    }
    if (!heroAudioStarted) {
      window.HF_Audio?.playHeroVictory?.(heroId);
    }

    // Beat timing: spread labels across ~ video length (or 4.5s)
    const beatCount = labels.length;
    // 影片以 1.3× 播放，字幕節拍跟著縮短，整段才不會拖尾
    const totalMs = videoReady
      ? Math.max(2300, Math.min(5200, ((video.duration || 3.2) * 1000) / 1.3 + 500))
      : 3200;
    const beatMs = totalMs / beatCount;

    for (let i = 0; i < beatCount; i++) {
      if (shouldSkip && shouldSkip()) break;
      const text = labels[i];
      const isLast = i === beatCount - 1;
      const isVictory = isLast || /victory/i.test(String(text));

      setCaption(text, isVictory);

      if (bossEl) {
        bossEl.classList.remove("hurt", "down", "roar");
        if (i >= Math.floor(beatCount * 0.4) && i < beatCount - 1) {
          bossEl.classList.add("hurt");
        }
        if (isLast) bossEl.classList.add("down");
      }

      if (i === Math.floor(beatCount * 0.6)) {
        stageEl.classList.add("film-hit");
        window.HF_Audio?.cue?.("victory.hit", { group: "presentation" });
      } else if (isVictory) {
        window.HF_Audio?.cue?.("victory.crown", { group: "presentation" });
      } else {
        window.HF_Audio?.cue?.("victory.beat", { group: "presentation" });
      }

      await wait(beatMs);
      stageEl.classList.remove("film-hit");
    }

    // Hold VICTORY on last frame a bit longer
    setCaption(labels[labels.length - 1] || "VICTORY", true);
    if (videoReady && !videoEnded) {
      // let video finish if still running
      await Promise.race([
        new Promise((r) => {
          if (video.ended) return r();
          video.addEventListener("ended", r, { once: true });
        }),
        wait(2500),
      ]);
      try {
        video.pause();
      } catch (_) {}
    } else {
      await wait(1100);
    }

    if (bannerEl) {
      bannerEl.classList.remove("show", "is-film-cap");
      bannerEl.textContent = "";
    }
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch (_) {}
    window.HF_Audio?.stopGroup?.("hero-victory");
    stageEl.classList.remove("show", "film", "film-hit", "film-win");
    filmHost.innerHTML = "";
  }

  return { play };
})();
