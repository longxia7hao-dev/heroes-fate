ettings?.() || {
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
  on($("#screen-boot"), "click", () => show("home"));
  setTimeout(() => show("home"), 480);
  } catch (err) {
    console.error(err);
    document.body.innerHTML =
      '<div style="padding:1.5rem;font-family:system-ui;background:#0a0818;color:#f4f0ff;min-height:100vh">' +
      "<h1 style='color:#ffe08a'>英雄命運</h1>" +
      "<p>啟動時發生錯誤，請重新整理。</p>" +
      "<pre style='color:#f88;font-size:12px;white-space:pre-wrap'>" +
      String(err && err.stack ? err.stack : err) +
      "</pre></div>";
  }
  };
  window.HF_GAME_START();
})();
