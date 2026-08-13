/**
 * True frame-by-frame animator (game-style)
 * - Hard frame cuts (no ghost crossfade)
 * - No mesh splitting at runtime
 * - walk: loop 8 frames
 * - attack: play once 6 frames then hold
 */
window.HF_FrameAnimator = (() => {
  let rig = null;
  let rigPromise = null;

  function loadRig() {
    if (rig) return Promise.resolve(rig);
    if (!rigPromise) {
      rigPromise = fetch("assets/anim/rig_manifest.json?v=4-sheets")
        .then((r) => r.json())
        .then((j) => {
          rig = j;
          return j;
        })
        .catch(() => {
          rig = { walk: {}, attack: {} };
          return rig;
        });
    }
    return rigPromise;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function loadFrames(urls) {
    const imgs = await Promise.all(urls.map(loadImage));
    return imgs.filter(Boolean);
  }

  /**
   * @param {HTMLElement} container
   * @param {{hint?: string, mode?: 'pick'|'film'}} opts
   */
  function create(container, opts = {}) {
    const root = document.createElement("div");
    root.className = "fa-root" + (opts.mode === "film" ? " fa-film" : "");
    root.innerHTML = `
      <div class="fa-bg"></div>
      <div class="fa-ring"></div>
      <div class="fa-shadow"></div>
      <canvas class="fa-canvas" width="512" height="512"></canvas>
      <p class="fa-hint"></p>
    `;
    container.innerHTML = "";
    container.appendChild(root);

    const canvas = root.querySelector(".fa-canvas");
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const hint = root.querySelector(".fa-hint");
    if (opts.hint) hint.textContent = opts.hint;
    else hint.style.display = "none";

    let heroId = "knight";
    let anim = "walk"; // walk | attack | still
    let frames = [];
    let frame = 0;
    let acc = 0;
    let fps = 12;
    let last = performance.now();
    let running = true;
    let raf = 0;
    let attackResolve = null;
    let held = false;
    let cache = {}; // heroId+anim -> Image[]

    function draw() {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // soft stage light
      const g = ctx.createRadialGradient(w / 2, h * 0.72, 10, w / 2, h * 0.72, w * 0.4);
      g.addColorStop(0, "rgba(168,85,247,0.28)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // ground ring
      ctx.save();
      ctx.translate(w / 2, h * 0.8);
      ctx.strokeStyle = "rgba(233,213,255,0.45)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, 118, 22, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      const img = frames[frame] || frames[0];
      if (!img) return;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const fit = Math.min((w * 0.9) / iw, (h * 0.82) / ih);
      const dw = iw * fit;
      const dh = ih * fit;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2 - h * 0.02;
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    function tick(now) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      acc += dt;

      const step = 1 / Math.max(1, fps);
      if (frames.length > 1 && !held) {
        while (acc >= step) {
          acc -= step;
          if (anim === "walk" || anim === "idle") {
            frame = (frame + 1) % frames.length;
          } else if (anim === "attack") {
            if (frame < frames.length - 1) {
              frame += 1;
            } else {
              held = true;
              if (attackResolve) {
                const r = attackResolve;
                attackResolve = null;
                // hold last frame ~0.45s then resolve
                setTimeout(r, 450);
              }
            }
          }
        }
      }

      draw();
      raf = requestAnimationFrame(tick);
    }

    async function ensure(hero, kind) {
      const key = hero + ":" + kind;
      if (cache[key]) return cache[key];
      await loadRig();
      const entry = rig[kind]?.[hero];
      let urls = entry?.frames;
      if (!urls || !urls.length) {
        urls = [`assets/heroes/${hero}.png`];
      }
      const imgs = await loadFrames(urls);
      cache[key] = imgs.length ? imgs : [];
      if (!cache[key].length) {
        const fallback = await loadImage(`assets/heroes/${hero}.png`);
        cache[key] = fallback ? [fallback] : [];
      }
      return cache[key];
    }

    async function setHero(id, prefer = "walk") {
      heroId = id;
      anim = prefer;
      held = false;
      frames = await ensure(id, prefer === "attack" ? "attack" : "walk");
      // if walk missing multi-frame, try still
      if (frames.length < 2) {
        frames = await ensure(id, "walk");
      }
      fps = rig?.walk?.[id]?.fps || (prefer === "attack" ? 10 : 12);
      if (prefer === "attack") fps = rig?.attack?.[id]?.fps || 10;
      frame = 0;
      acc = 0;
      draw();
    }

    async function playWalk(id) {
      return setHero(id || heroId, "walk");
    }

    async function playAttack(id) {
      heroId = id || heroId;
      anim = "attack";
      held = false;
      frames = await ensure(heroId, "attack");
      fps = rig?.attack?.[heroId]?.fps || 10;
      frame = 0;
      acc = 0;
      return new Promise((resolve) => {
        attackResolve = resolve;
        // safety
        setTimeout(() => {
          if (attackResolve) {
            const r = attackResolve;
            attackResolve = null;
            r();
          }
        }, 4000);
      });
    }

    function destroy() {
      running = false;
      cancelAnimationFrame(raf);
      container.innerHTML = "";
    }

    raf = requestAnimationFrame(tick);
    return { setHero, playWalk, playAttack, destroy, canvas: canvas };
  }

  return { create, loadRig };
})();
