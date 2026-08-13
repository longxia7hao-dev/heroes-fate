/**
 * Winner exclusive ~6s storyboard cinematic
 * Timeline driven; each hero has unique FX / camera / poses
 */
window.HF_Victory = (() => {
  /** @type {Record<string, Array<{t:number,label:string,fx?:string,cam?:string,boss?:string,pose?:string}>>} */
  const BOARDS = {
    knight: [
      { t: 0.0, label: "衝刺前進！", fx: "dash", cam: "zoom-in", pose: "run" },
      { t: 1.1, label: "聖劍高舉！", fx: "slash-up", cam: "low", pose: "raise" },
      { t: 2.3, label: "一刀兩斷！", fx: "slash", cam: "hit", pose: "slash", boss: "hurt" },
      { t: 3.6, label: "魔王倒地！", fx: "shock", cam: "pull", pose: "idle", boss: "down" },
      { t: 4.7, label: "VICTORY", fx: "victory", cam: "hero", pose: "win" },
    ],
    berserker: [
      { t: 0.0, label: "熱血沸騰！", fx: "aura-red", cam: "zoom-in", pose: "roar" },
      { t: 1.0, label: "旋風重斧！", fx: "spin", cam: "spin", pose: "spin" },
      { t: 2.4, label: "大地震裂！", fx: "quake", cam: "hit", pose: "smash", boss: "hurt" },
      { t: 3.7, label: "粉碎魔王！", fx: "shock", cam: "pull", boss: "down" },
      { t: 4.8, label: "VICTORY", fx: "victory", cam: "hero", pose: "win" },
    ],
    mage: [
      { t: 0.0, label: "詠唱開始……", fx: "circle", cam: "zoom-in", pose: "cast" },
      { t: 1.2, label: "巨大火球！", fx: "fireball", cam: "focus", pose: "cast2" },
      { t: 2.6, label: "爆裂閃光！", fx: "explode", cam: "hit", boss: "hurt" },
      { t: 3.8, label: "化為灰燼！", fx: "ash", cam: "pull", boss: "down" },
      { t: 4.9, label: "VICTORY", fx: "victory", cam: "hero", pose: "win" },
    ],
    ranger: [
      { t: 0.0, label: "拉滿弓弦！", fx: "wind", cam: "zoom-in", pose: "aim" },
      { t: 1.0, label: "三連貫穿！", fx: "arrows", cam: "focus", pose: "shoot" },
      { t: 2.4, label: "要害命中！", fx: "pierce", cam: "hit", boss: "hurt" },
      { t: 3.7, label: "收弓定格！", fx: "spark", cam: "pull", boss: "down" },
      { t: 4.8, label: "VICTORY", fx: "victory", cam: "hero", pose: "win" },
    ],
    assassin: [
      { t: 0.0, label: "影遁……", fx: "vanish", cam: "dark", pose: "hide" },
      { t: 1.0, label: "背後現身！", fx: "appear", cam: "back", pose: "strike" },
      { t: 2.3, label: "致命背刺！", fx: "stab", cam: "hit", boss: "hurt" },
      { t: 3.6, label: "收刀離去。", fx: "sheath", cam: "pull", boss: "down" },
      { t: 4.7, label: "VICTORY", fx: "victory", cam: "hero", pose: "win" },
    ],
    paladin: [
      { t: 0.0, label: "祈禱……", fx: "holy-soft", cam: "zoom-in", pose: "pray" },
      { t: 1.2, label: "聖光灌注！", fx: "holy", cam: "up", pose: "glow" },
      { t: 2.5, label: "審判一擊！", fx: "smite", cam: "hit", boss: "hurt" },
      { t: 3.8, label: "邪暗消散！", fx: "purge", cam: "pull", boss: "down" },
      { t: 4.9, label: "VICTORY", fx: "victory", cam: "hero", pose: "win" },
    ],
    king: [
      { t: 0.0, label: "王令頒布！", fx: "fanfare", cam: "zoom-in", pose: "command" },
      { t: 1.1, label: "皇家衛隊！", fx: "army", cam: "wide", pose: "command" },
      { t: 2.5, label: "萬箭齊發！", fx: "arrows-gold", cam: "hit", boss: "hurt" },
      { t: 3.8, label: "魔王跪地！", fx: "crown", cam: "pull", boss: "down" },
      { t: 4.9, label: "VICTORY", fx: "victory", cam: "hero", pose: "win" },
    ],
    prince: [
      { t: 0.0, label: "優雅起勢！", fx: "sparkle", cam: "zoom-in", pose: "ready" },
      { t: 1.0, label: "劍花連刺！", fx: "thrusts", cam: "focus", pose: "thrust" },
      { t: 2.4, label: "白光收招！", fx: "white", cam: "hit", boss: "hurt" },
      { t: 3.7, label: "行禮致意。", fx: "spark", cam: "pull", boss: "down" },
      { t: 4.8, label: "VICTORY", fx: "victory", cam: "hero", pose: "win" },
    ],
    elf: [
      { t: 0.0, label: "葉旋起舞！", fx: "leaves", cam: "zoom-in", pose: "dance" },
      { t: 1.1, label: "藤蔓束縛！", fx: "vines", cam: "focus", boss: "hurt" },
      { t: 2.5, label: "一刀花開！", fx: "petal", cam: "hit", pose: "slash" },
      { t: 3.8, label: "風息平靜。", fx: "wind", cam: "pull", boss: "down" },
      { t: 4.9, label: "VICTORY", fx: "victory", cam: "hero", pose: "win" },
    ],
    orc: [
      { t: 0.0, label: "戰吼！！", fx: "roar", cam: "zoom-in", pose: "roar" },
      { t: 1.0, label: "飛撲重砸！", fx: "leap", cam: "follow", pose: "leap" },
      { t: 2.3, label: "地面碎裂！", fx: "quake", cam: "hit", boss: "hurt" },
      { t: 3.7, label: "勝利大笑！", fx: "shock", cam: "pull", boss: "down" },
      { t: 4.8, label: "VICTORY", fx: "victory", cam: "hero", pose: "win" },
    ],
    witch: [
      { t: 0.0, label: "藥水拋出！", fx: "bottle", cam: "zoom-in", pose: "throw" },
      { t: 1.1, label: "彩色爆炸！", fx: "rainbow", cam: "hit", boss: "hurt" },
      { t: 2.5, label: "魔王暈眩！", fx: "dizzy", cam: "focus", boss: "hurt" },
      { t: 3.7, label: "比耶☆", fx: "sparkle", cam: "pull", boss: "down", pose: "pose" },
      { t: 4.8, label: "VICTORY", fx: "victory", cam: "hero", pose: "win" },
    ],
    dragon: [
      { t: 0.0, label: "喚龍！", fx: "dragon", cam: "zoom-in", pose: "summon" },
      { t: 1.2, label: "龍槍突刺！", fx: "spear", cam: "focus", pose: "thrust" },
      { t: 2.5, label: "龍息終結！", fx: "breath", cam: "hit", boss: "hurt" },
      { t: 3.8, label: "王座之影。", fx: "ember", cam: "pull", boss: "down" },
      { t: 4.9, label: "VICTORY", fx: "victory", cam: "hero", pose: "win" },
    ],
  };

  const TOTAL = 6.0;

  /**
   * @param {object} opts
   * @param {string} opts.heroId
   * @param {HTMLElement} opts.root  victory stage root
   * @param {HTMLImageElement} opts.heroImg
   * @param {HTMLElement} opts.bossEl
   * @param {HTMLElement} opts.bannerEl
   * @param {HTMLElement} opts.fxLayer
   * @param {() => boolean} opts.shouldSkip
   * @param {(f:number,d:number)=>void} opts.beep
   * @param {number} opts.timeScale
   */
  async function play(opts) {
    const {
      heroId,
      root,
      heroImg,
      bossEl,
      bannerEl,
      fxLayer,
      shouldSkip,
      beep,
      timeScale = 1,
    } = opts;

    const board = BOARDS[heroId] || BOARDS.knight;
    root.classList.add("show", "cine");
    root.dataset.hero = heroId;
    fxLayer.innerHTML = "";
    fxLayer.className = "vfx-layer";

    const wait = (ms) =>
      new Promise((resolve) => {
        const need = ms / timeScale;
        const t0 = performance.now();
        const tick = () => {
          if (shouldSkip()) return resolve();
          if (performance.now() - t0 >= need) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

    let lastT = 0;
    for (let i = 0; i < board.length; i++) {
      if (shouldSkip()) break;
      const step = board[i];
      const nextT = board[i + 1]?.t ?? TOTAL;
      const hold = Math.max(0.35, nextT - step.t);

      // apply step
      bannerEl.textContent = step.label;
      bannerEl.classList.add("show");
      root.dataset.fx = step.fx || "";
      root.dataset.cam = step.cam || "";
      root.dataset.pose = step.pose || "idle";
      heroImg.className = `v-hero pose-${step.pose || "idle"}`;

      if (bossEl) {
        bossEl.classList.remove("hurt", "down", "roar");
        if (step.boss === "hurt") bossEl.classList.add("hurt");
        if (step.boss === "down") bossEl.classList.add("down");
      }

      spawnFx(fxLayer, step.fx, heroId);
      if (step.label === "VICTORY") beep?.(990, 0.14);
      else beep?.(520 + i * 40, 0.06);

      await wait(hold * 1000);
      lastT = step.t;
    }

    // ensure total ~6s if not skipped
    if (!shouldSkip()) {
      const remain = (TOTAL - lastT) * 1000 * 0.15;
      if (remain > 0) await wait(remain);
    }

    root.classList.remove("show", "cine");
    root.dataset.fx = "";
    root.dataset.cam = "";
    root.dataset.pose = "";
    fxLayer.innerHTML = "";
  }

  function spawnFx(layer, fx, heroId) {
    if (!fx || !layer) return;
    layer.innerHTML = "";
    layer.dataset.fx = fx;

    const add = (cls, n = 1) => {
      for (let i = 0; i < n; i++) {
        const el = document.createElement("div");
        el.className = `vfx ${cls}`;
        el.style.setProperty("--i", String(i));
        el.style.setProperty("--r", String(Math.random()));
        layer.appendChild(el);
      }
    };

    switch (fx) {
      case "slash":
      case "slash-up":
        add("vfx-slash");
        add("vfx-spark", 8);
        break;
      case "fireball":
        add("vfx-fireball");
        add("vfx-ember", 12);
        break;
      case "explode":
      case "ash":
        add("vfx-boom");
        add("vfx-ember", 16);
        break;
      case "arrows":
      case "arrows-gold":
        add("vfx-arrow", 5);
        break;
      case "stab":
      case "pierce":
        add("vfx-slash");
        add("vfx-spark", 6);
        break;
      case "holy":
      case "holy-soft":
      case "smite":
      case "purge":
        add("vfx-holy");
        add("vfx-spark", 10);
        break;
      case "spin":
      case "quake":
      case "shock":
        add("vfx-shock");
        add("vfx-rock", 8);
        break;
      case "leaves":
      case "vines":
      case "petal":
        add("vfx-leaf", 14);
        break;
      case "rainbow":
      case "bottle":
      case "dizzy":
      case "sparkle":
        add("vfx-bubble", 12);
        add("vfx-spark", 8);
        break;
      case "dragon":
      case "breath":
      case "ember":
      case "spear":
        add("vfx-fireball");
        add("vfx-ember", 14);
        break;
      case "victory":
        add("vfx-victory");
        add("vfx-spark", 20);
        break;
      case "vanish":
      case "appear":
        add("vfx-smoke");
        break;
      case "dash":
        add("vfx-dash");
        break;
      default:
        add("vfx-spark", 6);
    }
  }

  return { play, BOARDS, TOTAL };
})();
