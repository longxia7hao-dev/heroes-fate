// Real H.264 / WebKit integration regression (no production dependencies).
// HF_PLAYWRIGHT=/absolute/path/to/playwright node tools/test_pick_runtime.cjs
// Serve this repo on :8888 first; HF_TEST_URL may point to tools/slow_server.py.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { webkit } = require(process.env.HF_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const url = process.env.HF_TEST_URL || 'http://127.0.0.1:8888/';
const baseline = process.env.HF_BASELINE_REF;
const report = { selections: [], errors: [], loops: [], layouts: [] };
let browser;

async function open(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, hasTouch: true,
    isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  // Exercise the real decode/source lifecycle without sending sound to speakers.
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      if (destination instanceof AudioDestinationNode) return destination;
      return connect.call(this, destination, ...args);
    };
  });
  page.on('pageerror', e => report.errors.push(String(e)));
  if (baseline) for (const file of ['js/game.js', 'js/videoPlayer.js', 'js/audioDirector.js']) {
    const body = execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root });
    await page.route(`**/${file}?*`, r => r.fulfill({ body, contentType: 'application/javascript' }));
  }
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { page, context };
}

async function enterPick(page, warm = true) {
  await page.locator('.home-start').click();
  await page.locator('#count-range').evaluate(el => {
    el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#screen-count [data-go="pick"]').click();
  if (warm) await page.evaluate(async () => {
    const vp = window.HF_VideoPlayer, manifest = await vp.loadManifest();
    for (const h of window.HF_DATA.heroes) await vp.storeBlob(vp.versioned(manifest[h.id].wait));
  });
}

async function select(page, hero) {
  const start = Date.now();
  await page.locator(`.hero-card[data-id="${hero}"]`).click();
  await page.waitForFunction(id => {
    const v = document.querySelector('#sprite-stage .vp-video.is-active');
    return v?.dataset.src?.includes(`/wait/${id}.mp4`) && !v.paused && v.currentTime > .05;
  }, hero, { timeout: 15000 });
  return Date.now() - start;
}

(async () => {
  browser = await webkit.launch({ headless: true });
  const { page, context } = await open();
  if (process.env.HF_RAID === '1') {
    await page.locator('#btn-settings').click();
    await page.locator('#opt-card').uncheck();
    await page.locator('#opt-strike').uncheck();
    await page.locator('#settings-close').click();
  }
  await enterPick(page, process.env.HF_COLD !== '1');
  await page.evaluate(() => {
    window.pickAudit = { seeks: [], music: [] };
    document.addEventListener('seeking', e => {
      const v = e.target;
      if (v.matches?.('.vp-video.is-active')) window.pickAudit.seeks.push(v.dataset.src);
    }, true);
    const original = window.HF_Audio.playHeroMusic;
    window.HF_Audio.playHeroMusic = function (id) {
      const matrix = new DOMMatrix(getComputedStyle(document.querySelector('#pick-card')).transform);
      window.pickAudit.music.push({ id, settled: matrix.isIdentity });
      return original.apply(this, arguments);
    };
  });
  const heroes = await page.locator('.hero-card').evaluateAll(es => es.map(e => e.dataset.id));
  for (const id of [...heroes, ...heroes.slice(0, 5)]) {
    report.selections.push({ id, ms: await select(page, id) });
    await page.waitForTimeout(750);
  }
  assert.equal(await page.locator('#party-dots img').count(), 0, 'preview must not lock players');
  report.audit = await page.evaluate(() => window.pickAudit);
  assert.equal(report.audit.seeks.length, 0, 'revealing a video must not seek while visible');
  assert(report.audit.music.length > 0 && report.audit.music.every(x => x.settled), 'hero music must start after flip settles');
  if (process.env.HF_TEST_SHOTS) await page.screenshot({ path: path.join(process.env.HF_TEST_SHOTS, 'pick-phone.png') });
  for (const viewport of [{ width: 360, height: 640 }, { width: 773, height: 601 },
    { width: 820, height: 1180 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(250);
    const bounds = await page.locator('#pick-next').boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 &&
      bounds.y + bounds.height <= viewport.height + 1, `decision button outside viewport ${JSON.stringify(viewport)}`);
    report.layouts.push({ viewport, decision: bounds });
    if (process.env.HF_TEST_SHOTS) await page.screenshot({ path: path.join(process.env.HF_TEST_SHOTS, `pick-${viewport.width}x${viewport.height}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });

  // Force delayed/rejected/never-settling partner play(), while sampling the LIVE video.
  for (const fault of ['delay', 'reject', 'hang']) {
    await select(page, fault === 'delay' ? 'knight' : fault === 'reject' ? 'paladin' : 'ranger');
    await page.evaluate(fault => {
      const original = HTMLMediaElement.prototype.play;
      window.loopAudit = { fault, triggered: false, frozen: 0 };
      HTMLMediaElement.prototype.play = function (...args) {
        const live = document.querySelector('.vp-video.is-active');
        if (!window.loopAudit.triggered && this.matches('.vp-video') && this !== live &&
            live?.dataset.src === this.dataset.src && live.currentTime > 2) {
          window.loopAudit.triggered = true;
          HTMLMediaElement.prototype.play = original;
          if (fault === 'hang') return new Promise(() => {});
          if (fault === 'reject') return Promise.reject(new Error('intentional partner rejection'));
          return new Promise((resolve, reject) => setTimeout(() => original.apply(this, args).then(resolve, reject), 600));
        }
        return original.apply(this, args);
      };
      window.loopSample = setInterval(() => {
        const v = document.querySelector('.vp-video.is-active');
        if (window.loopAudit.triggered && (!v || v.paused || v.ended)) window.loopAudit.frozen++;
      }, 20);
    }, fault);
    await page.waitForFunction(() => window.loopAudit.triggered, null, { timeout: 10000 });
    await page.waitForTimeout(1500);
    const loop = await page.evaluate(() => { clearInterval(window.loopSample); return window.loopAudit; });
    report.loops.push(loop);
    assert.equal(loop.frozen, 0, `loop ${fault} exposed a stopped video`);
  }
  // Rapid changes: last click wins, no accidental locks; repeat same hero remains playable.
  for (const id of heroes.slice(0, 8)) {
    await page.locator(`.hero-card[data-id="${id}"]`).dispatchEvent('click');
    await page.waitForTimeout(45);
  }
  await page.waitForTimeout(1500);
  await select(page, 'assassin');
  assert.equal(await page.locator('#party-dots img').count(), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await select(page, 'monk');
  await page.locator('#pick-next').click();
  await page.waitForFunction(() => document.querySelector('#pick-slot').textContent.includes('玩家 2'), null, { timeout: 11000 });
  assert.equal(await page.locator('#party-dots img').count(), 1);
  await select(page, 'princess');
  await page.locator('#pick-next').click();
  await page.waitForFunction(() => document.body.dataset.screen === 'mode', null, { timeout: 11000 });
  if (process.env.HF_RAID === '1') {
    await page.evaluate(() => {
      window.raidAudit = { seeds: 0, acts: [], unseeded: false };
      const seed = window.HF_RNG.seedRun;
      window.HF_RNG.seedRun = function (...args) {
        const run = seed.apply(this, args); window.raidAudit.seeds++; return run;
      };
      const stage = document.querySelector('#stage');
      new MutationObserver(() => {
        const act = stage.dataset.act;
        if (act && window.raidAudit.acts.at(-1) !== act) {
          window.raidAudit.acts.push(act);
          if (!window.raidAudit.seeds) window.raidAudit.unseeded = true;
        }
      }).observe(stage, { attributes: true, attributeFilter: ['data-act'] });
    });
    await page.locator('[data-mode="boss"]').click();
    await page.waitForFunction(() => document.body.dataset.screen === 'result', null, { timeout: 90000 });
    report.raid = await page.evaluate(() => window.raidAudit);
    assert.equal(report.raid.seeds, 1);
    assert.equal(report.raid.unseeded, false);
    assert(report.raid.acts.includes('arrival') && report.raid.acts.includes('attack'));
  }
  await context.close();

  // A screen change must not start a second fetch while a warm download is in flight.
  const warm = await open();
  let active = 0, peak = 0, started = 0;
  await warm.page.route('**/mobile/wait/*.mp4?*', async route => {
    if (route.request().resourceType() !== 'fetch') return route.continue();
    active++; peak = Math.max(peak, active); started++;
    const file = path.join(root, new URL(route.request().url()).pathname.replace(/^.*?(assets\/)/, '$1'));
    await new Promise(resolve => setTimeout(resolve, 2500));
    active--;
    try { await route.fulfill({ body: fs.readFileSync(file), contentType: 'video/mp4' }); } catch (_) {}
  });
  const warmDeadline = Date.now() + 10000;
  while (!started && Date.now() < warmDeadline) await warm.page.waitForTimeout(100);
  assert(started > 0, 'background warm did not start');
  await warm.page.locator('.home-start').click();
  await warm.page.waitForTimeout(1300);
  assert.equal(peak, 1, 'screen transition duplicated the in-flight warm fetch');
  report.warmPeak = peak;
  await warm.context.close();
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
})().catch(error => {
  console.error(JSON.stringify(report, null, 2));
  console.error(error);
  process.exitCode = 1;
}).finally(async () => { await browser?.close(); });
