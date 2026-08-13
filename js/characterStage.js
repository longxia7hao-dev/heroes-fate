/**
 * CharacterStage — smooth, charming presentation (no mesh-split, no ghost crossfade)
 *
 * idle: single full-body art + continuous sine motion (breath / sway / bob)
 * victory: clean keyframe holds (optional sheet frames) + cinematic camera + soft FX
 */
window.HF_CharacterStage = (() => {
  const SHEET_KEYS = [
    "knight", "berserker", "mage", "ranger", "assassin", "paladin",
    "prince", "elf", "orc", "witch", // king/dragon may use procedural only
  ];

  const PERSONALITY = {
    knight: { hue: 210, bob: 1, sway: 0.8, spin: 0, spark: "steel" },
    berserker: { hue: 0, bob: 1.4, sway: 1.6, spin: 0, spark: "ember" },
    mage: { hue: 280, bob: 0.9, sway: 0.6, spin: 0.3, spark: "arcane" },
    ranger: { hue: 140, bob: 1.1, sway: 1.0, spin: 0, spark: "leaf" },
    assassin: { hue: 290, bob: 0.7, sway: 1.3, spin: 0, spark: "shadow" },
    paladin: { hue: 45, bob: 0.85, sway: 0.5, spin: 0.15, spark: "holy" },
    king: { hue: 40, bob: 0.75, sway: 0.7, spin: 0.1, spark: "gold" },
    prince: { hue: 195, bob: 1.0, sway: 1.1, spin: 0.2, spark: "spark" },
    elf: { hue: 130, bob: 1.05, sway: 0.9, spin: 0.25, spark: "leaf" },
    orc: { hue: 90, bob: 1.35, sway: 1.4, spin: 0, spark: "ember" },
    witch: { hue: 300, bob: 1.15, sway: 1.2, spin: 0.35, spark: "arcane" },
    dragon: { hue: 10, bob: 1.2, sway: 1.0, spin: 0.15, spark: "ember" },
  };

  function heroStill(id) {
    return `assets/heroes/${id}.png`;
  }

  function loadImg(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function trySheetFrames(heroId) {
    // Prefer original clean sheet crops f0-f5 (no blended intermediates)
    const urls = [];
    for (let i = 0; i < 6; i++) urls.push(`assets/anim/frames/${heroId}/f${i}.png`);
    const imgs = await Promise.all(urls.map(loadImg));
    const ok = imgs.filter(Boolean);
    // only use if we have at least 4 real frames and they look distinct enough
    if (ok.length >= 4) return ok;
    return null;
  }

  /**
   * @param {HTMLElement} container
   * @param {{hint?: string, mode?: 'pick'|'film'}} opts
   */
  function create(container, opts = {}) {
    const wrap = document.createElement("div");
    wrap.className = "char-stage " + (opts.mode === "film" ? "is-film" : "is-pick");
    wrap.innerHTML = `
      <div class="char-stage-bg"></div>
      <div class="char-stage-ring"></div>
      <div class="char-stage-shadow"></div>
      <img class="char-stage-art" alt="" draggable="false" />
      <canvas class="char-stage-fx" width="512" height="512"></canvas>
      <p class="char-stage-hint"></p>
    `;
    container.innerHTML = "";
    container.appendChild(wrap);

    const art = wrap.querySelector(".char-stage-art");
    const fx = wrap.querySelector(".char-stage-fx");
    const hint = wrap.querySelector(".char-stage-hint");
    const ctx = fx.getContext("2d");
    hint.textContent = opts.hint || "";

    let heroId = "knight";
    let mode = "idle"; // idle | victory
    let t0 = performance.now();
    let running = true;
    let raf = 0;
    let victoryKey = 0;
    let victoryFrames = null; // Image[] or null
    let victoryResolve = null;
    let cam = { z: 1, x: 0, y: 0, r: 0 };
    let camTarget = { z: 1, x: 0, y: 0, r: 0 };
    let particles = [];

    function personality() {
      return PERSONALITY[heroId] || PERSONALITY.knight;
    }

    function resizeFx() {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      fx.width = Math.max(1, Math.floor(r.width * dpr));
      fx.height = Math.max(1, Math.floor(r.height * dpr));
      fx.style.width = r.width + "px";
      fx.style.height = r.height + "px";
    }

    function spawnSparks(kind, n = 8) {
      const p = personality();
      for (let i = 0; i < n; i++) {
        particles.push({
          x: 0.5 + (Math.random() - 0.5) * 0.35,
          y: 0.55 + (Math.random() - 0.5) * 0.2,
          vx: (Math.random() - 0.5) * 0.12,
          vy: -0.08 - Math.random() * 0.15,
          life: 0.6 + Math.random() * 0.7,
          age: 0,
          hue: p.hue + (Math.random() - 0.5) * 30,
          kind: kind || p.spark,
          s: 1.5 + Math.random() * 2.5,
        });
      }
    }

    function drawFx(dt) {
      const w = fx.width;
      const h = fx.height;
      ctx.clearRect(0, 0, w, h);
      particles = particles.filter((p) => p.age < p.life);
      for (const p of particles) {
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const a = 1 - p.age / p.life;
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${a})`;
        const px = p.x * w;
        const py = p.y * h;
        ctx.beginPath();
        ctx.arc(px, py, p.s * (w / 280), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function applyArtTransform(elapsed) {
      const p = personality();
      const e = elapsed;

      if (mode === "idle") {
        // silky continuous motion — whole image, never cuts / never mesh-split
        const bob = Math.sin(e * 2.1) * (5.5 * p.bob);
        const sway = Math.sin(e * 1.35 + 0.4) * (2.2 * p.sway);
        const breath = 1 + Math.sin(e * 2.1) * 0.018 * p.bob;
        const tilt = Math.sin(e * 1.1) * (1.2 * p.sway);
        art.style.opacity = "1";
        art.style.transform =
          `translate(calc(-50% + ${sway.toFixed(2)}px), calc(-50% + ${bob.toFixed(2)}px)) ` +
          `rotate(${tilt.toFixed(2)}deg) scale(${breath.toFixed(4)})`;
        wrap.style.setProperty("--glow", `hsla(${p.hue}, 80%, 60%, 0.35)`);
      } else {
        // victory cinematic camera — smooth lerp toward targets
        cam.z += (camTarget.z - cam.z) * 0.08;
        cam.x += (camTarget.x - cam.x) * 0.08;
        cam.y += (camTarget.y - cam.y) * 0.08;
        cam.r += (camTarget.r - cam.r) * 0.08;
        art.style.transform =
          `translate(calc(-50% + ${cam.x.toFixed(2)}px), calc(-50% + ${cam.y.toFixed(2)}px)) ` +
          `rotate(${cam.r.toFixed(2)}deg) scale(${cam.z.toFixed(4)})`;
      }
    }

    let lastT = performance.now();

    function tick(now) {
      if (!running) return;
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      const elapsed = (now - t0) / 1000;

      applyArtTransform(elapsed);
      drawFx(dt);

      // idle ambient particles
      if (mode === "idle" && Math.random() < 0.04) spawnSparks(null, 1);

      raf = requestAnimationFrame(tick);
    }

    async function setHero(id) {
      heroId = id;
      mode = "idle";
      t0 = performance.now();
      victoryFrames = null;
      victoryKey = 0;
      cam = { z: 1, x: 0, y: 0, r: 0 };
      camTarget = { z: 1, x: 0, y: 0, r: 0 };
      particles = [];

      // Always use clean full-body still for idle (most charming, no flicker)
      const img = await loadImg(heroStill(id));
      if (img) {
        art.src = img.src;
        art.classList.remove("is-hidden");
      }
      wrap.dataset.hero = id;
      wrap.classList.remove("is-victory");
      wrap.classList.add("is-idle");
      resizeFx();
    }

    /**
     * Victory ~6s short film:
     * - Prefer 6 clean key poses (no morph)
     * - Soft fade between holds
     * - Camera push / pull / slight pan
     */
    async function playVictory(id) {
      heroId = id || heroId;
      mode = "victory";
      t0 = performance.now();
      wrap.classList.remove("is-idle");
      wrap.classList.add("is-victory");
      particles = [];

      const sheet = await trySheetFrames(heroId);
      victoryFrames = sheet;
      const beats = victoryFrames && victoryFrames.length >= 4
        ? victoryFrames
        : [await loadImg(heroStill(heroId))].filter(Boolean);

      // camera beat plan (6s)
      const plan = [
        { z: 1.05, x: 0, y: 8, r: -1.5, hold: 900, flash: false },
        { z: 1.12, x: -6, y: 0, r: 1.2, hold: 900, flash: false },
        { z: 1.2, x: 8, y: -6, r: -2, hold: 950, flash: true },
        { z: 1.08, x: 0, y: 4, r: 0.5, hold: 950, flash: true },
        { z: 1.18, x: 0, y: -10, r: 0, hold: 1000, flash: false },
        { z: 1.25, x: 0, y: -4, r: 0, hold: 1100, flash: true },
      ];

      const n = Math.min(beats.length, plan.length);

      return new Promise(async (resolve) => {
        victoryResolve = resolve;
        for (let i = 0; i < n; i++) {
          if (!running) break;
          const img = beats[i] || beats[beats.length - 1];
          const beat = plan[i];

          // soft cut: fade out → swap → fade in (no double-exposure morph)
          art.style.transition = "opacity 0.18s ease, transform 0.55s cubic-bezier(.22,.8,.25,1)";
          art.style.opacity = "0";
          await sleep(180);
          if (img) art.src = img.src || img;
          camTarget = { z: beat.z, x: beat.x, y: beat.y, r: beat.r };
          cam = { ...cam, z: beat.z * 0.96, x: beat.x * 0.5, y: beat.y * 0.5 };
          art.style.opacity = "1";
          if (beat.flash) {
            wrap.classList.add("flash");
            spawnSparks(null, 14);
            setTimeout(() => wrap.classList.remove("flash"), 220);
          } else {
            spawnSparks(null, 4);
          }
          await sleep(beat.hold);
        }
        // final hold glory
        camTarget = { z: 1.22, x: 0, y: -6, r: 0 };
        spawnSparks(null, 18);
        await sleep(500);
        if (victoryResolve) {
          const r = victoryResolve;
          victoryResolve = null;
          r();
        }
      });
    }

    function sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    function destroy() {
      running = false;
      cancelAnimationFrame(raf);
      container.innerHTML = "";
    }

    // start
    resizeFx();
    window.addEventListener("resize", resizeFx);
    raf = requestAnimationFrame(tick);

    // default
    setHero("knight");

    return { setHero, playVictory, destroy, wrap };
  }

  return { create };
})();
