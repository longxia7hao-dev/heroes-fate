").textContent = playerLabel(s.slot ?? 0);
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

  /**
   * 分隊結果：用**角色大頭圖**直接把分配結果攪開（睿哥 2026-08-17：
   * 「最後用角色大頭圖直覺的展現分配的結果」）。
   *
   * 原本是每隊一串文字 `<li>`，有兩個問題：
   *   1. **看不完** —— 睿哥回報「3 隊」卻只看到兩隊，就是第三隊被捲出可視範圍了
   *      （`.result-detail` 是會捲的）。文字列一人一行，4 隊 13 人要 17 行，一定爆。
   *   2. 不直覺 —— 要讀完名字才知道誰跟誰同隊。
   * 換成一隊一排頭像後，同樣的高度裝得下更多人，而且一眼就看得出隊形。
   *
   * **上方那張大立繪在這個模式關掉**：它本來顯示的是「第一隊第一個人」，
   * 位置又長得跟魔王討伐的勝利者一樣，很容易被誤會成「這個人贏了」——
   * 分隊根本沒有勝利者。關掉之後那塊空間全部讓給隊伍，剛好是睿哥要的重點。
   */
  function showResultTeams(teams) {
    $("#result-badge").textContent = "🚩 命運分隊";
    $("#result-name").textContent = "分隊完成";
    $("#result-hero").textContent = `${teams.length} 隊`;
    setResultPortrait(null, { list: true, hidePortrait: true });
    $("#result-detail").innerHTML = teams
      .map((team, t) => {
        const faces = team
          .map((p) => {
            const h = p.hero || heroById(p.heroId);
            return `<div class="tm-chip">
              <img class="tm-face" src="${heroThumb(h.id)}" alt="${h.name}"
                   width="240" height="322" loading="eager" decoding="async" />
              <span class="tm-tag">${playerLabel(p.slot)}</span>
            </div>`;
          })
          .join("");
        return `<div class="team-block" style="--tc:${TEAM_COLORS[t] || "#7ef0ff"}">
          <p class="team-name">${TEAM_LABELS[t] || `第 ${t + 1} 隊`}<small>${team.length} 人</small></p>
          <div class="team-faces">${faces}</div>
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
    // 720×1080 bitmap 約 3.1MB；只有玩家真的開啟卷軸時才配置，不佔首屏記憶體。
    const exportWidth = Number(canvas.dataset.exportWidth) || 720;
    const exportHeight = Number(canvas.dataset.exportHeight) || 1080;
    if (canvas.width !== exportWidth) canvas.width = exportWidth;
    if (canvas.height !== exportHeight) canvas.height = exportHeight;
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
    window.dispatchEvent(new Event(PRESENTATION_SKIP_EVENT));
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
    if (icon) icon.innerHTML = enabled ? AUDIO_ICON_ON : AUDIO_ICON_OFF;
  }

  function fillAudioSettings() {
    const values = window.HF_Audio?.getS