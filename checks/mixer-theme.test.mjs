import test from "node:test";
import assert from "node:assert/strict";
import { ArcadeMixer } from "../app/arcade-audio.js";

// A fake synth that mimics TableSynth's canopy lifecycle: setTheme stops the
// canopy and (with the real class) only the mixer's sync() may restart it.
function fakeSynth(theme) {
  return {
    theme,
    tension: false,
    started: 0,
    stopped: 0,
    themeChanges: [],
    startAmbient() {
      this.started++;
    },
    stopAmbient() {
      this.stopped++;
    },
    quiet() {},
    close() {},
    setSparkle() {},
    setTheme(next) {
      this.themeChanges.push(next);
      this.theme = next;
      // Mirror the real class: swap tears the canopy down.
      this.stopped++;
    },
    schedule() {},
    harmony() {
      return { label: "test" };
    },
  };
}

const fakeCtx = () => ({
  state: "running",
  currentTime: 1,
  resume: () => Promise.resolve(),
  createBuffer: () => ({}),
  createBufferSource: () => ({ connect() {}, start() {}, disconnect() {} }),
  createGain: () => ({ gain: { value: 1, setTargetAtTime() {} }, connect() {} }),
  createDynamicsCompressor: () => ({
    threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
    connect() {},
  }),
  onstatechange: null,
  close: () => Promise.resolve(),
  suspend: () => Promise.resolve(),
});

// The engine is declared outside the try so the finally can stop its clock:
// a const inside a try block is invisible to that statement's finally.
function withEngine(settings, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { hidden: false },
  });
  const engine = new ArcadeMixer(settings, () => {});
  try {
    run(engine);
  } finally {
    engine.timer != null && clearInterval(engine.timer);
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  }
}

test("switching the theme keeps the ambient bed playing", () => {
  withEngine({ enabled: true, music: true, volume: 75, score: "alley" }, (engine) => {
    engine.context = fakeCtx();
    engine.synth = fakeSynth("alley");
    engine.master = { gain: { setTargetAtTime() {} } };
    engine.sync();
    assert.equal(engine.synth.started, 1, "ambient starts with the clock");

    engine.set({ ...engine.settings, score: "vapor" });
    assert.deepEqual(engine.synth.themeChanges, ["vapor"]);
    // The clock is still running, so the next sync must not early-return:
    // the canopy the swap tore down has to come back.
    engine.sync();
    assert.ok(engine.synth.started >= 2, "ambient restarts after a theme swap");
  });
});

test("a restarted mixer's fresh synth starts even if a clock was running", () => {
  withEngine({ enabled: true, music: true, volume: 75, score: "vapor" }, (engine) => {
    engine.context = fakeCtx();
    engine.synth = fakeSynth("vapor");
    engine.master = { gain: { setTargetAtTime() {} } };
    engine.sync();
    assert.ok(engine.timer != null, "the clock is running");
    // restart() tears everything down and hands recovery to unlock(); the
    // mixer regression was the old timer surviving and suppressing sync(),
    // which stopped the replacement synth's bed from ever starting.
    engine.quiet();
    assert.equal(engine.timer, null, "quiet disarms the clock");
    engine.synth = fakeSynth("vapor");
    engine.sync();
    assert.equal(engine.synth.started, 1, "fresh synth starts");
  });
});
