/**
 * Heroes' Fate audio director
 * - scene-aware and character-aware crossfaded BGM
 * - low-latency Web Audio cues and character-specific Sora effects
 * - one gesture unlock path for iOS / Android browsers
 * - independent master, music and effect levels
 */
window.HF_Audio = (() => {
  "use strict";

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const STORE_KEY = "hf_audio_v1";
  const REV = "4";
  /**
   * 逐檔內容雜湊優先（表由 tools/gen_asset_versions.py 產生）。
   * 只換掉幾個音效時，其餘 40 幾支的網址不變 —— 尤其那 4MB 的角色 BGM
   * 不會因為改了一顆 UI 音效就在 4G 上整包重抓。查不到才退回全域 REV。
   */
  const asset = (path) => `${path}?v=${window.HF_ASSET_V?.[path] || REV}`;

  const musicTracks = {
    home: asset("assets/audio/bgm/home_custom.mp3"),
    pick: asset("assets/audio/bgm/pick.mp3"),
    battle: asset("assets/audio/bgm/battle.mp3"),
    // 魔王降臨專用：只在魔王討伐的開場那幾秒播，之後交棒給 battle
    bossArrival: asset("assets/audio/bgm/boss_arrival.mp3"),
  };

  /** 使用者製作的角色選擇曲精華；只在選角預覽時取代通用 pick BGM。 */
  const heroMusicTracks = {
    knight: asset("assets/audio/heroes/bgm/knight.mp3"),
    paladin: asset("assets/audio/heroes/bgm/paladin.mp3"),
    ranger: asset("assets/audio/heroes/bgm/ranger.mp3"),
    orc_archer: asset("assets/audio/heroes/bgm/orc_archer.mp3"),
    axeman: asset("assets/audio/heroes/bgm/axeman.mp3"),
    amazon: asset("assets/audio/heroes/bgm/amazon.mp3"),
    dark_fighter: asset("assets/audio/heroes/bgm/dark_fighter.mp3"),
    assassin: asset("assets/audio/heroes/bgm/assassin.mp3"),
    archmage: asset("assets/audio/heroes/bgm/archmage.mp3"),
    dark_mage: asset("assets/audio/heroes/bgm/dark_mage.mp3"),
    dark_elf: asset("assets/audio/heroes/bgm/dark_elf.mp3"),
    monk: asset("assets/audio/heroes/bgm/monk.mp3"),
    princess: asset("assets/audio/heroes/bgm/princess.mp3"),
    dragon_knight: asset("assets/audio/heroes/bgm/dragon_knight.mp3"),
  };
  Object.keys(heroMusicTracks).forEach((heroId) => {
    musicTracks[`hero:${heroId}`] = heroMusicTracks[heroId];
  });

  const sceneMusic = {
    boot: "home",
    home: "home",
    count: "home",
    pick: "pick",
    mode: "pick",
    play: "battle",
    result: "home",
  };

  const sfx = {
    ui_click: asset("assets/audio/sfx/ui_click.mp3"),
    ui_lock: asset("assets/audio/sfx/ui_lock.mp3"),
    ui_whoosh: asset("assets/audio/sfx/ui_whoosh.mp3"),
    wheel_hit: asset("assets/audio/sfx/wheel_hit.mp3"),
    smoke_burst: asset("assets/audio/sfx/smoke_burst.mp3"),
    reveal_chime: asset("assets/audio/sfx/reveal_chime.mp3"),
    boss_stinger: asset("assets/audio/sfx/boss_stinger.mp3"),
    boss_roar: asset("assets/audio/sfx/boss_roar.mp3"),
    boss_defeat: asset("assets/audio/sfx/boss_defeat.mp3"),
    victory_fanfare: asset("assets/audio/sfx/victory_fanfare.mp3"),
    attack_sword: asset("assets/audio/sfx/attack_sword.mp3"),
    attack_heavy: asset("assets/audio/sfx/attack_heavy.mp3"),
    attack_arrow: asset("assets/audio/sfx/attack_arrow.mp3"),
    attack_magic: asset("assets/audio/sfx/attack_magic.mp3"),
    attack_holy: asset("assets/audio/sfx/attack_holy.mp3"),
  };

  const heroAttackKind = {
    knight: "sword",
    paladin: "holy",
    ranger: "arrow",
    orc_archer: "arrow",
    axeman: "heavy",
    amazon: "heavy",
    dark_fighter: "sword",
    assassin: "sword",
    archmage: "magic",
    dark_mage: "magic",
    dark_elf: "magic",
    monk: "holy",
    princess: "magic",
    dragon_knight: "magic",
  };

  const cueMap = {
    "ui.click": ["ui_click", 0.44, 1],
    "ui.navigate": ["ui_whoosh", 0.5, 1],
    "ui.back": ["ui_whoosh", 0.4, 0.84],
    "ui.skip": ["ui_click", 0.38, 0.78],
    "pick.preview": ["ui_click", 0.32, 1.06],
    "pick.lock": ["ui_lock", 0.7, 1],
    "pick.advance": ["ui_whoosh", 0.48, 1.08],
    "pick.partyReady": ["reveal_chime", 0.68, 1.04],
    "mode.select": ["ui_lock", 0.64, 0.92],
    "round.open": ["ui_whoosh", 0.7, 0.82],
    "fate.cardReveal": ["reveal_chime", 0.66, 0.96],
    "strike.charge": ["wheel_hit", 0.42, 0.72],
    "strike.release": ["reveal_chime", 0.74, 1.05],
    "battle.gather": ["wheel_hit", 0.42, 0.82],
    "battle.clash": ["smoke_burst", 0.52, 1.06],
    "boss.enter": ["boss_stinger", 0.84, 1],
    "boss.roar": ["boss_roar", 0.92, 1],
    "boss.defeat": ["boss_defeat", 0.88, 1],
    "smoke.burst": ["smoke_burst", 0.68, 1],
    "reveal.winner": ["reveal_chime", 0.78, 1.03],
    "reveal.doom": ["wheel_hit", 0.76, 0.66],
    "doom.slam": ["boss_defeat", 0.78, 0.78],
    "survival.eliminate": ["wheel_hit", 0.62, 0.82],
    "order.rank": ["ui_lock", 0.42, 1.04],
    "pair.reveal": ["reveal_chime", 0.68, 1.04],
    "team.reveal": ["ui_lock", 0.48, 0.95],
    "victory.beat": ["ui_click", 0.34, 0.9],
    "victory.hit": ["wheel_hit", 0.5, 0.72],
    "victory.crown": ["victory_fanfare", 0.84, 1],
    "result.settle": ["ui_lock", 0.34, 1.08],
    "doom.roll": ["reveal_chime", 0.66, 0.82],
  };

  let settings = loadSettings();
  let context = null;
  let sfxBus = null;
  let musicBus = null;
  let unlocked = false;
  let unlockPromise = null;
  let lastError = null;
  let currentScene = "boot";
  let desiredMusic = sceneMusic.boot;
  let currentMusic = null;
  let currentVoice = null;
  let musicRequest = 0;
  let duckFactor = 1;
  let duckTimer = 0;
  const rawCache = new Map();
  const bufferCache = new Map();
  const activeGroups = new Map();
  const cooldowns = new Map();

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      return {
        enabled: saved?.enabled !== false,
        master: clamp(saved?.master, 0, 1, 0.86),
        music: clamp(saved?.music, 0, 1, 0.48),
        effects: clamp(saved?.effects, 0, 1, 0.82),
      };
    } catch (_) {
      return { enabled: true, master: 0.86, music: 0.48, effects: 0.82 };
    }
  }

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    } catch (_) {}
  }

  function ensureContext() {
    if (!AudioCtx) return null;
    if (!context) {
      try {
        context = new AudioCtx({ latencyHint: "interactive" });
      } catch (_) {
        context = new AudioCtx();
      }
      sfxBus = context.createGain();
      musicBus = context.createGain();
      sfxBus.connect(context.destination);
      musicBus.connect(context.destination);
      updateLevels();
    }
    return context;
  }

  function notifyState() {
    try {
      window.dispatchEvent(new CustomEvent("hf-audio-state", { detail: getStatus() }));
    } catch (_) {}
  }

  function rememberError(error) {
    lastError = String(error?.message || error || "audio error");
    notifyState();
  }

  function updateLevels() {
    if (!context) return;
    const sfxValue = settings.enabled ? settings.master * settings.effects : 0;
    const musicValue = settings.enabled
      ? settings.master * settings.music * duckFactor
      : 0;
    if (sfxBus) {
      sfxBus.gain.cancelScheduledValues(context.currentTime);
      sfxBus.gain.setTargetAtTime(sfxValue, context.currentTime, 0.025);
    }
    if (musicBus) {
      musicBus.gain.cancelScheduledValues(context.currentTime);
      musicBus.gain.setTargetAtTime(musicValue, context.currentTime, 0.035);
    }
  }

  function fetchRaw(url) {
    if (!rawCache.has(url)) {
      rawCache.set(
        url,
        fetch(url, { cache: "default" })
          .then((response) => {
            if (!response.ok) throw new Error(`audio ${response.status}: ${url}`);
            return response.arrayBuffer();
          })
          .catch((error) => {
            rawCache.delete(url);
            throw error;
          })
      );
    }
    return rawCache.get(url);
  }

  function decodeBuffer(ctx, raw) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ok = (buffer) => {
        if (settled) return;
        settled = true;
        resolve(buffer);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error || new Error("decodeAudioData failed"));
      };
      try {
        // Callback form supports older iOS Safari; Promise form supports modern engines.
        const maybePromise = ctx.decodeAudioData(raw.slice(0), ok, fail);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(ok, fail);
        }
      } catch (error) {
        fail(error);
      }
    });
  }

  async function ensureRunning(ctx = ensureContext()) {
    if (!ctx) return false;
    if (ctx.state === "running") return true;
    try {
      await ctx.resume();
    } catch (error) {
      rememberError(error);
      return false;
    }
    const running = ctx.state === "running";
    if (!running) rememberError(`AudioContext state: ${ctx.state}`);
    return running;
  }

  async function getBuffer(url) {
    const ctx = ensureContext();
    if (!ctx) return null;
    if (!bufferCache.has(url)) {
      bufferCache.set(
        url,
        fetchRaw(url)
          .then((raw) => decodeBuffer(ctx, raw))
          .catch((error) => {
            bufferCache.delete(url);
            rememberError(error);
            console.warn("HF_Audio decode failed", error);
            return null;
          })
      );
    }
    return bufferCache.get(url);
  }

  function registerSource(source, group) {
    if (!group) return;
    let set = activeGroups.get(group);
    if (!set) activeGroups.set(group, (set = new Set()));
    set.add(source);
    const cleanup = () => {
      set.delete(source);
      if (!set.size) activeGroups.delete(group);
      notifyState();
    };
    if (typeof source.addEventListener === "function") {
      source.addEventListener("ended", cleanup, { once: true });
    } else {
      source.onended = cleanup;
    }
  }

  async function playUrl(url, options = {}) {
    if (!settings.enabled) return null;
    const ctx = ensureContext();
    if (!ctx) return null;
    if (!(await ensureRunning(ctx))) return null;
    const buffer = await getBuffer(url);
    if (!buffer || !settings.enabled) return null;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = clamp(options.rate, 0.45, 2.2, 1);
    gain.gain.value = clamp(options.volume, 0, 1.5, 1);
    source.connect(gain);
    gain.connect(sfxBus);
    registerSource(source, options.group || "presentation");
    try {
      source.start(0);
      lastError = null;
      notifyState();
    } catch (error) {
      rememberError(error);
      return null;
    }
    return source;
  }

  function canPlayCue(name, cooldown = 60) {
    const now = performance.now();
    const last = cooldowns.get(name) || 0;
    if (now - last < cooldown) return false;
    cooldowns.set(name, now);
    return true;
  }

  function cue(name, options = {}) {
    const def = cueMap[name];
    if (!def || !settings.enabled) return null;
    if (!canPlayCue(name, options.cooldown ?? 70)) return null;
    const [key, gain, rate] = def;
    if (name === "victory.crown") duck(0.5, 3400);
    return playUrl(sfx[key], {
      group: options.group || "presentation",
      volume: gain * clamp(options.volume, 0, 1.5, 1),
      rate: rate * clamp(options.rate, 0.6, 1.6, 1),
    });
  }

  function stopGroup(group) {
    const set = activeGroups.get(group);
    if (!set) return;
    [...set].forEach((source) => {
      try { source.stop(); } catch (_) {}
    });
    activeGroups.delete(group);
  }

  function stopAllEffects() {
    [...activeGroups.keys()].forEach(stopGroup);
  }

  function stopMusic() {
    musicRequest++;
    if (currentVoice) {
      try { currentVoice.source.stop(); } catch (_) {}
    }
    currentVoice = null;
    currentMusic = null;
    notifyState();
  }

  async function crossfadeMusic(key, immediate = false) {
    if (!musicTracks[key]) return;
    desiredMusic = key;
    if (!unlocked || !settings.enabled || document.hidden || !musicTracks[key]) return;
    if (currentMusic === key && currentVoice) {
      updateLevels();
      return;
    }

    const request = ++musicRequest;
    const ctx = ensureContext();
    if (!(await ensureRunning(ctx))) return;
    const buffer = await getBuffer(musicTracks[key]);
    if (
      !buffer ||
      request !== musicRequest ||
      !unlocked ||
      !settings.enabled ||
      document.hidden ||
      desiredMusic !== key
    ) return;

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const fadeSeconds = immediate || !currentVoice ? 0.06 : 0.68;
    source.buffer = buffer;
    source.loop = true;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1, now + fadeSeconds);
    source.connect(gain);
    gain.connect(musicBus);

    const outgoing = currentVoice;
    try {
      source.start(0);
    } catch (error) {
      rememberError(error);
      return;
    }

    currentVoice = { source, gain, key };
    currentMusic = key;
    lastError = null;
    notifyState();

    if (outgoing) {
      outgoing.gain.gain.cancelScheduledValues(now);
      const heldGain = Number.isFinite(outgoing.gain.gain.value)
        ? Math.max(0.0001, outgoing.gain.gain.value)
        : 1;
      outgoing.gain.gain.setValueAtTime(heldGain, now);
      outgoing.gain.gain.linearRampToValueAtTime(0.0001, now + fadeSeconds);
      setTimeout(() => {
        try { outgoing.source.stop(); } catch (_) {}
      }, fadeSeconds * 1000 + 120);
    }
  }

  function setScene(scene) {
    currentScene = sceneMusic[scene] ? scene : "home";
    crossfadeMusic(sceneMusic[currentScene]);
    notifyState();
  }

  function playHeroMusic(heroId) {
    if (currentScene !== "pick") return;
    const key = heroMusicTracks[heroId] ? `hero:${heroId}` : sceneMusic.pick;
    crossfadeMusic(key);
  }

  function clearHeroMusic() {
    if (currentScene === "pick") crossfadeMusic(sceneMusic.pick);
  }

  /**
   * 演出中途換場景音樂（目前用於魔王討伐：降臨曲 → 討伐曲）。
   * 與 playHeroMusic 同樣的守則 —— 只在對應畫面有效，避免演出結束後
   * 殘留的呼叫把結果頁的音樂蓋掉。
   */
  function playRaidMusic(key) {
    if (currentScene !== "play") return;
    crossfadeMusic(musicTracks[key] ? key : sceneMusic.play);
  }

  function unlock() {
    const ctx = ensureContext();
    if (!ctx) {
      rememberError("Web Audio is unavailable");
      return Promise.resolve(false);
    }

    // Starting a silent one-frame buffer inside the gesture is the most reliable
    // way to unlock Web Audio on iPhone. It is inaudible and never enters a group.
    try {
      const silent = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      const primer = ctx.createBufferSource();
      primer.buffer = silent;
      primer.connect(sfxBus);
      primer.start(0);
    } catch (_) {}

    if (ctx.state === "running") {
      unlocked = true;
      lastError = null;
      preloadCore();
      crossfadeMusic(desiredMusic || sceneMusic[currentScene] || "home", !currentVoice);
      notifyState();
      return Promise.resolve(true);
    }
    if (unlockPromise) return unlockPromise;

    unlockPromise = ensureRunning(ctx)
      .then((running) => {
        unlocked = running;
        if (running) {
          lastError = null;
          preloadCore();
          crossfadeMusic(desiredMusic || sceneMusic[currentScene] || "home", !currentVoice);
        }
        notifyState();
        return running;
      })
      .finally(() => {
        unlockPromise = null;
      });
    return unlockPromise;
  }

  function setEnabled(enabled) {
    settings.enabled = !!enabled;
    saveSettings();
    if (!settings.enabled) {
      stopAllEffects();
      stopMusic();
    } else if (unlocked) {
      unlock();
    }
    updateLevels();
    notifyState();
  }

  function setVolumes(next = {}) {
    if (next.master != null) settings.master = clamp(next.master, 0, 1, settings.master);
    if (next.music != null) settings.music = clamp(next.music, 0, 1, settings.music);
    if (next.effects != null) settings.effects = clamp(next.effects, 0, 1, settings.effects);
    saveSettings();
    updateLevels();
  }

  function duck(factor = 0.5, duration = 2400) {
    clearTimeout(duckTimer);
    duckFactor = clamp(factor, 0.15, 1, 0.5);
    updateLevels();
    duckTimer = setTimeout(() => {
      duckFactor = 1;
      updateLevels();
    }, Math.max(200, duration));
  }

  function playHeroAttack(heroId) {
    stopGroup("hero-attack");
    const specific = asset(`assets/audio/heroes/attack/${heroId}.mp3`);
    const fallback = sfx[`attack_${heroAttackKind[heroId] || "sword"}`];
    return playUrl(specific, { group: "hero-attack", volume: 0.84 }).then((source) => {
      if (!source && fallback) return playUrl(fallback, { group: "hero-attack", volume: 0.74 });
      return source;
    });
  }

  function playHeroVictory(heroId) {
    stopGroup("hero-victory");
    duck(0.48, 4200);
    return playUrl(asset(`assets/audio/heroes/victory/${heroId}.mp3`), {
      group: "hero-victory",
      volume: 0.78,
    });
  }

  function preloadHeroes(heroIds = []) {
    [...new Set(heroIds.filter(Boolean))].forEach((heroId) => {
      fetchRaw(asset(`assets/audio/heroes/attack/${heroId}.mp3`)).catch(() => {});
      fetchRaw(asset(`assets/audio/heroes/victory/${heroId}.mp3`)).catch(() => {});
    });
  }

  function preloadCore() {
    [
      sfx.ui_click,
      sfx.ui_lock,
      sfx.ui_whoosh,
      sfx.wheel_hit,
      sfx.reveal_chime,
      sfx.boss_stinger,
      sfx.boss_roar,
      sfx.boss_defeat,
      sfx.smoke_burst,
      sfx.victory_fanfare,
    ].forEach((url) => {
      const load = context ? getBuffer(url) : fetchRaw(url);
      load.catch(() => {});
    });
  }

  function getSettings() {
    return { ...settings };
  }

  function getStatus() {
    return {
      unlocked,
      ready: unlocked && !!currentVoice && !lastError,
      contextState: context?.state || "not-created",
      scene: currentScene,
      music: currentMusic,
      desiredMusic,
      engine: "webaudio-buffer",
      lastError,
      activeGroups: [...activeGroups.keys()],
    };
  }

  function handleVisibility() {
    if (document.hidden) {
      context?.suspend?.().catch?.(() => {});
      return;
    }
    if (unlocked && settings.enabled) {
      ensureRunning().then((running) => {
        if (running && (!currentVoice || currentMusic !== desiredMusic)) {
          crossfadeMusic(desiredMusic || sceneMusic[currentScene] || "home", true);
        }
        notifyState();
      });
    }
  }

  const gestureUnlock = () => { unlock(); };
  document.addEventListener("pointerdown", gestureUnlock, { capture: true, passive: true });
  document.addEventListener("touchend", gestureUnlock, { capture: true, passive: true });
  document.addEventListener("click", gestureUnlock, { capture: true, passive: true });
  document.addEventListener("keydown", gestureUnlock, { capture: true });
  document.addEventListener("visibilitychange", handleVisibility);
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1400));
  idle(() => {
    if (settings.enabled) preloadCore();
  });

  return {
    cue,
    duck,
    getSettings,
    getStatus,
    clearHeroMusic,
    playHeroAttack,
    playHeroMusic,
    playHeroVictory,
    playRaidMusic,
    preloadHeroes,
    setEnabled,
    setScene,
    setVolumes,
    stopAllEffects,
    stopGroup,
    unlock,
  };
})();
