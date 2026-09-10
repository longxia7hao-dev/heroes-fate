"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const directorSource = fs.readFileSync(
  path.join(__dirname, "..", "js", "audioDirector.js"),
  "utf8"
);

class FakeParam {
  constructor() { this.value = 1; }
  cancelScheduledValues() {}
  setTargetAtTime(value) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
}

function makeHarness({ failMusicStart = false, failEffectStart = false, stopEmitsEnded = true } = {}) {
  const state = { failMusicStart, failEffectStart, stopEmitsEnded, sources: [], gains: [] };

  class FakeNode {
    constructor() {
      this.connections = [];
      this.disconnectCalls = 0;
    }
    connect(target) {
      this.connections.push(target);
      return target;
    }
    disconnect() { this.disconnectCalls += 1; }
  }

  class FakeGain extends FakeNode {
    constructor() {
      super();
      this.gain = new FakeParam();
      state.gains.push(this);
    }
  }

  class FakeSource extends FakeNode {
    constructor() {
      super();
      this.buffer = null;
      this.loop = false;
      this.playbackRate = { value: 1 };
      this.stopCalls = 0;
      this.listeners = new Map();
      state.sources.push(this);
    }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    start() {
      if (this.loop && state.failMusicStart) {
        state.failMusicStart = false;
        throw new Error("music start failed");
      }
      if (!this.loop && this.buffer?.kind === "decoded" && state.failEffectStart) {
        state.failEffectStart = false;
        throw new Error("effect start failed");
      }
      this.started = true;
    }
    stop() {
      this.stopCalls += 1;
      if (state.stopEmitsEnded) this.emitEnded();
    }
    emitEnded() {
      const callback = this.listeners.get("ended") || this.onended;
      if (callback) callback();
    }
  }

  class FakeAudioContext {
    constructor() {
      this.state = "running";
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = {};
    }
    createGain() { return new FakeGain(); }
    createBufferSource() { return new FakeSource(); }
    createBuffer() { return { kind: "silent" }; }
    resume() { this.state = "running"; return Promise.resolve(); }
    suspend() { this.state = "suspended"; return Promise.resolve(); }
    decodeAudioData(_raw, success) {
      const buffer = { kind: "decoded", duration: 1 };
      queueMicrotask(() => success?.(buffer));
      return Promise.resolve(buffer);
    }
  }

  const sandbox = {
    AudioContext: FakeAudioContext,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init?.detail; }
    },
    Map,
    Promise,
    Set,
    WeakMap,
    clearTimeout,
    console,
    document: { hidden: false, addEventListener() {} },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    localStorage: { getItem() { return null; }, setItem() {} },
    performance,
    queueMicrotask,
    setTimeout,
  };
  sandbox.window = sandbox;
  sandbox.dispatchEvent = () => {};
  vm.createContext(sandbox);
  vm.runInContext(directorSource, sandbox, { filename: "audioDirector.js" });
  return { api: sandbox.HF_Audio, state };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function unlockAndSettle(api) {
  await api.unlock();
  await settle();
  await settle();
}

async function testNaturalEffectEnd() {
  const { api } = makeHarness();
  await unlockAndSettle(api);
  const source = await api.cue("ui.click", { cooldown: 0, group: "test-natural" });
  const gain = source.connections[0];
  source.emitEnded();
  assert.equal(source.disconnectCalls, 1, "natural end disconnects source");
  assert.equal(gain.disconnectCalls, 1, "natural end disconnects gain");
  assert.equal(api.getStatus().activeGroups.length, 0, "natural end clears group");
}

async function testStoppedEffectIsIdempotent() {
  const { api } = makeHarness();
  await unlockAndSettle(api);
  const source = await api.cue("ui.click", { cooldown: 0, group: "test-stop" });
  const gain = source.connections[0];
  api.stopGroup("test-stop");
  source.emitEnded();
  assert.equal(source.disconnectCalls, 1, "stop plus late ended disconnects source once");
  assert.equal(gain.disconnectCalls, 1, "stop plus late ended disconnects gain once");
  assert.equal(api.getStatus().activeGroups.length, 0, "stop clears group");
}

async function testStoppedEffectWithoutEnded() {
  const { api } = makeHarness({ stopEmitsEnded: false });
  await unlockAndSettle(api);
  const source = await api.cue("ui.click", { cooldown: 0, group: "test-late-ended" });
  const gain = source.connections[0];
  api.stopGroup("test-late-ended");
  assert.equal(source.stopCalls, 1, "stop is requested without waiting for ended");
  assert.equal(source.disconnectCalls, 1, "missing ended still disconnects source immediately");
  assert.equal(gain.disconnectCalls, 1, "missing ended still disconnects gain immediately");
  assert.equal(api.getStatus().activeGroups.length, 0, "missing ended still clears group immediately");

  const replacement = await api.cue("ui.click", { cooldown: 0, group: "test-late-ended" });
  source.emitEnded();
  assert.equal(source.disconnectCalls, 1, "late ended does not disconnect source twice");
  assert.equal(gain.disconnectCalls, 1, "late ended does not disconnect gain twice");
  assert.equal(api.getStatus().activeGroups.length, 1, "late ended preserves a reused group");
  assert.equal(replacement.disconnectCalls, 0, "late ended leaves replacement playing");
  api.stopGroup("test-late-ended");
  assert.equal(replacement.disconnectCalls, 1, "replacement remains stoppable");
  assert.equal(api.getStatus().activeGroups.length, 0, "replacement stop clears group");
}

async function testEffectStartFailure() {
  const { api, state } = makeHarness({ failEffectStart: true });
  await unlockAndSettle(api);
  const source = await api.cue("ui.click", { cooldown: 0, group: "test-fail" });
  assert.equal(source, null, "failed effect start returns null");
  const failed = state.sources.find((item) => item.buffer?.kind === "decoded" && !item.loop);
  const gain = failed.connections[0];
  assert.equal(failed.disconnectCalls, 1, "failed effect start disconnects source");
  assert.equal(gain.disconnectCalls, 1, "failed effect start disconnects gain");
  assert.equal(api.getStatus().activeGroups.length, 0, "failed effect start clears group");
}

async function testStopMusic() {
  const { api, state } = makeHarness({ stopEmitsEnded: false });
  await unlockAndSettle(api);
  const music = state.sources.find((source) => source.loop && source.started);
  const gain = music.connections[0];
  api.setEnabled(false);
  assert.equal(music.stopCalls, 1, "disabling audio stops music");
  assert.equal(music.disconnectCalls, 1, "stopping music disconnects source");
  assert.equal(gain.disconnectCalls, 1, "stopping music disconnects gain");
  music.emitEnded();
  assert.equal(music.disconnectCalls, 1, "late music ended does not repeat source cleanup");
  assert.equal(gain.disconnectCalls, 1, "late music ended does not repeat gain cleanup");
}

async function testMusicStartFailure() {
  const { api, state } = makeHarness({ failMusicStart: true });
  await unlockAndSettle(api);
  const failed = state.sources.find((source) => source.loop);
  const gain = failed.connections[0];
  assert.equal(failed.disconnectCalls, 1, "failed music start disconnects source");
  assert.equal(gain.disconnectCalls, 1, "failed music start disconnects gain");
  assert.match(api.getStatus().lastError, /music start failed/);
}

(async () => {
  await testNaturalEffectEnd();
  await testStoppedEffectIsIdempotent();
  await testStoppedEffectWithoutEnded();
  await testEffectStartFailure();
  await testStopMusic();
  await testMusicStartFailure();
  console.log("audio cleanup regression tests: 6 passed");
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
