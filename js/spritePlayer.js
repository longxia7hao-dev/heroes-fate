/**
 * Smooth character animator
 * - crossfade between frames (no hard cuts)
 * - ping-pong idle
 * - victory sequence ~6s
 */
window.HF_SpritePlayer = (() => {
  let manifest = null;
  let loadPromise = null;

  async function loadManifest() {
    if (manifest) return manifest;
    if (!loadPromise) {
      loadPromise = fetch("assets/anim/manifest.json?v=" + Date.now())
        .then((r) => r.json())
        .then((j) => {
          manifest = j;
          return j;
        })
        .catch(() => {
          manifest = {};
          return manifest;
        });
    }
    return loadPromise;
  }

  function preload(urls) {
    return Promise.all(
      urls.map(
        (src) =>
          new Promise((res) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = () => res(null);
            img.src = src + (src.includes("?") ? "&" : "?") + "t=1";
          })
      )
    );
  }

  function create(container, opts = {}) {
    const canvas = document.createElement("canvas");
    canvas.className = "sprite-canvas";
    canvas.width = 512;
    canvas.height = 512;
    container.innerHTML = "";
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const hint = document.createElement("p");
    hint.className = "drag-hint";
    hint.textContent = opts.hint || "角色肢體動作（流暢待機）";
    container.appendChild(hint);

    let heroId = "knight";
    let images = [];
    let mode = "idle";
    /** continuous frame index for crossfade */
    let fpos = 0;
    let last = performance.now();
    let running = true;
    let victoryResolve = null;
    let victoryDone = false;
    let raf = 0;
    let scale = 1;
    let bob = 0;
    let dir = 1; // ping-pong

    function drawFrame(img, alpha, yOff = 0, sc = 1) {
      if (!img || alpha <= 0.01) return;
      const w = canvas.width;
      const h = canvas.height;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (!iw || !ih) return;
      const fit = Math.min((w * 0.88) / iw, (h * 0.8) / ih) * sc * scale;
      const dw = iw * fit;
      const dh = ih * fit;
      const dx = (w - dw) / 2;
      const dy = h * 0.06 + (h * 0.72 - dh) / 2 + yOff;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.globalAlpha = 1;
    }

    function draw() {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const g = ctx.createRadialGradient(w / 2, h * 0.75, 8, w / 2, h * 0.75, w * 0.45);
      g.addColorStop(0, "rgba(192,132,252,0.4)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(w / 2, h * 0.8);
      ctx.strokeStyle = "rgba(233,213,255,0.5)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, 120, 24, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      if (!images.length) return;

      const n = images.length;
      // crossfade between floor(fpos) and next
      let i0 = Math.floor(fpos) % n;
      if (i0 < 0) i0 += n;
      let i1 = (i0 + 1) % n;
      let t = fpos - Math.floor(fpos);
      // smoothstep
      t = t * t * (3 - 2 * t);

      const yOff = Math.sin(bob) * 4;
      drawFrame(images[i0], 1 - t, yOff, 1);
      drawFrame(images[i1], t, yOff, 1);
    }

    function tick(now) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      bob += dt * 3.2;

      const m = manifest?.[heroId];
      const fps =
        mode === "victory"
          ? m?.fps_victory || 10
          : m?.fps_idle || 14;
      const speed = fps; // frames per second continuous

      if (images.length > 1) {
        if (mode === "idle") {
          // ping-pong for smoothness
          fpos += dir * speed * dt;
          if (fpos >= images.length - 1) {
            fpos = images.length - 1;
            dir = -1;
          } else if (fpos <= 0) {
            fpos = 0;
            dir = 1;
          }
        } else {
          fpos += speed * dt;
          if (fpos >= images.length - 1) {
            fpos = images.length - 1;
            if (!victoryDone) {
              victoryDone = true;
              if (victoryResolve) {
                const r = victoryResolve;
                victoryResolve = null;
                // hold last frame briefly
                setTimeout(r, 400);
              }
            }
          }
        }
      } else {
        // single image: procedural breathe via bob only
        fpos = 0;
      }

      scale += (1 - scale) * 0.1;
      draw();
      raf = requestAnimationFrame(tick);
    }

    async function setHero(id) {
      await loadManifest();
      heroId = id;
      const m = manifest[id];
      let urls = m?.idle?.length ? m.idle : null;
      // prefer new idle_XX naming; fallback old f0-f2; fallback still
      if (!urls || !urls.length) {
        urls = [];
        for (let i = 0; i < 12; i++) {
          urls.push(`assets/anim/frames/${id}/idle_${String(i).padStart(2, "0")}.png`);
        }
      }
      let imgs = (await preload(urls)).filter(Boolean);
      if (imgs.length < 2) {
        // try legacy f0-f5
        const legacy = [];
        for (let i = 0; i < 6; i++) legacy.push(`assets/anim/frames/${id}/f${i}.png`);
        imgs = (await preload(legacy)).filter(Boolean);
      }
      if (imgs.length < 1) {
        const img = new Image();
        img.src = `assets/heroes/${id}.png`;
        await new Promise((r) => {
          img.onload = r;
          img.onerror = r;
        });
        imgs = [img];
      }
      images = imgs;
      mode = "idle";
      fpos = 0;
      dir = 1;
      victoryDone = false;
      draw();
    }

    async function playVictory(id) {
      await loadManifest();
      heroId = id || heroId;
      const m = manifest[heroId];
      let urls = m?.victory?.length ? m.victory : null;
      if (!urls || !urls.length) {
        urls = [];
        for (let i = 0; i < 18; i++) {
          urls.push(`assets/anim/frames/${heroId}/win_${String(i).padStart(2, "0")}.png`);
        }
      }
      let imgs = (await preload(urls)).filter(Boolean);
      if (imgs.length < 2) {
        const legacy = [];
        for (let i = 0; i < 6; i++) legacy.push(`assets/anim/frames/${heroId}/f${i}.png`);
        imgs = (await preload(legacy)).filter(Boolean);
      }
      if (imgs.length < 1) {
        await setHero(heroId);
        imgs = images;
      }
      images = imgs;
      mode = "victory";
      fpos = 0;
      victoryDone = false;
      scale = 1.06;
      return new Promise((resolve) => {
        victoryResolve = resolve;
        setTimeout(() => {
          if (victoryResolve) {
            const r = victoryResolve;
            victoryResolve = null;
            r();
          }
        }, 7000);
      });
    }

    function playIdle() {
      mode = "idle";
      fpos = 0;
      dir = 1;
      victoryDone = false;
      setHero(heroId);
    }

    function destroy() {
      running = false;
      cancelAnimationFrame(raf);
      container.innerHTML = "";
    }

    raf = requestAnimationFrame(tick);
    return { setHero, playIdle, playVictory, destroy, canvas };
  }

  return { loadManifest, create };
})();
