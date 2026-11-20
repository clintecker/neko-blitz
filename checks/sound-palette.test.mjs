import test from "node:test";
import assert from "node:assert/strict";
import {
  SOUND_PALETTES,
  TableSynth,
  resolvePalette,
  SCORE_THEMES,
} from "../app/audio/night-synth.mjs";
import { seeded } from "./lib/rng.mjs";

// Node has no AudioContext, so these tests pin the palette data and the
// threading from TableSynth into the canopy, never the rendered graph.
const ids = SCORE_THEMES.map((theme) => theme.id);
const fields = Object.keys(SOUND_PALETTES.alley);
// The cue voices phrase() can shape: its patch table keys, shared with the
// score's strike vocabulary.
const cueVoices = ["bass", "pluck", "reed", "glass"];
const waves = ["bass", "pad", "reed", "pluck", "glass"];

const differing = (a, b) =>
  fields.filter(
    (field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]),
  );

function assertUnit(owner, name, value, low, high) {
  assert.equal(typeof value, "number", `${owner}.${name} is a number`);
  assert.ok(
    Number.isFinite(value) && value > low && value <= high,
    `${owner}.${name} ${value} in (${low}, ${high}]`,
  );
}

function assertPositive(owner, name, value) {
  assert.ok(
    Number.isFinite(value) && value > 0,
    `${owner}.${name} ${value} is positive`,
  );
}

function assertBand(owner, name, band) {
  const [low, high] = band;
  assert.ok(Array.isArray(band) && band.length === 2, `${owner}.${name} pair`);
  assertPositive(owner, `${name}[0]`, low);
  assert.ok(high > low, `${owner}.${name} high ${high} above ${low}`);
}

test("every shipped score theme carries a usable sound palette", () => {
  for (const id of ids) {
    const palette = SOUND_PALETTES[id];
    assert.ok(palette, `${id} has a palette`);
    // Same field set everywhere: a missing field would silently fall back to
    // another theme's instrument, which is the bug this registry prevents.
    assert.deepEqual(Object.keys(palette).sort(), [...fields].sort(), id);
    assert.equal(palette.bedVoices.length, 3, `${id} holds three bed voices`);
    for (const [i, voice] of palette.bedVoices.entries()) {
      assert.ok(
        waves.includes(voice.wave),
        `${id} bed ${i} wave ${voice.wave}`,
      );
      assertUnit(`${id}.bedVoices[${i}]`, "level", voice.level, 0, 0.12);
      assertUnit(`${id}.bedVoices[${i}]`, "pan", voice.pan, -1, 1);
    }
    assert.ok(waves.includes(palette.bassWave), `${id} bass wave`);
    assertBand(id, "bassCutoff", palette.bassCutoff);
    for (const key of ["base", "shineGain", "jitter"])
      assertPositive(id, `bedCutoff.${key}`, palette.bedCutoff[key]);
    for (const key of ["base", "gain", "spread"])
      assertPositive(id, `bedSparkle.${key}`, palette.bedSparkle[key]);
    assertPositive(id, "vineCutoff.low", palette.vineCutoff.low);
    assertPositive(id, "vineCutoff.high", palette.vineCutoff.high);
    assertPositive(id, "vineCutoff.shineGain", palette.vineCutoff.shineGain);
    assert.ok(
      palette.vineCutoff.high > palette.vineCutoff.low,
      `${id} vine band`,
    );
    for (const key of ["bass", "bed", "vine"])
      assertPositive(id, `openCutoffs.${key}`, palette.openCutoffs[key]);
    // Glints are struck by phrase(), which only knows the cue patch table.
    assert.ok(
      cueVoices.includes(palette.glintVoice),
      `${id} glint voice ${palette.glintVoice}`,
    );
    assertUnit(id, "glintStrength", palette.glintStrength, 0, 1.5);
    assertPositive(id, "echo.leftTime", palette.echo.leftTime);
    assertPositive(id, "echo.rightTime", palette.echo.rightTime);
    assertUnit(id, "echo.feedback", palette.echo.feedback, 0, 0.95);
    assertPositive(id, "echo.brightness", palette.echo.brightness);
    assertPositive(id, "gateRamp", palette.gateRamp);
    for (const [voice, patch] of Object.entries(palette.cuePatches)) {
      assert.ok(cueVoices.includes(voice), `${id} cue patch ${voice}`);
      for (const [key, value] of Object.entries(patch))
        assertPositive(id, `cuePatches.${voice}.${key}`, value);
    }
  }
  // A theme the score ships without a palette would play the alley instrument.
  assert.deepEqual(Object.keys(SOUND_PALETTES).sort(), [...ids].sort());
});

// The alley render is the contract: these are the literals the synth used
// before the palettes existed, so any edit here changes the mixed track.
test("the alley palette is the original instrument, number for number", () => {
  assert.deepEqual(SOUND_PALETTES.alley, {
    bedVoices: [
      { wave: "pad", level: 0.061, pan: -0.36 },
      { wave: "reed", level: 0.055, pan: 0.21 },
      { wave: "pad", level: 0.049, pan: 0.42 },
    ],
    bassWave: "bass",
    bassCutoff: [495, 820],
    bedCutoff: { base: 950, shineGain: 1050, jitter: 720 },
    bedSparkle: { base: 1150, gain: 1450, spread: 130 },
    vineCutoff: { low: 1000, high: 1900, shineGain: 1000 },
    openCutoffs: { bass: 720, bed: 1800, vine: 1530 },
    glintVoice: "glass",
    glintStrength: 1,
    glintShelf: { base: -3, shine: 7 },
    echo: {
      leftTime: 0.287,
      rightTime: 0.419,
      feedback: 0.37,
      brightness: 4950,
    },
    gateRamp: 0.28,
    cuePatches: {},
  });
});

test("the four palettes give each theme its own timbre", () => {
  for (const id of ids.filter((theme) => theme !== "alley")) {
    const apart = differing(SOUND_PALETTES[id], SOUND_PALETTES.alley);
    assert.ok(apart.length >= 4, `${id} differs from alley on ${apart}`);
  }
  const rest = ids.filter((theme) => theme !== "alley");
  for (let i = 0; i < rest.length; i++)
    for (let j = i + 1; j < rest.length; j++) {
      const apart = differing(SOUND_PALETTES[rest[i]], SOUND_PALETTES[rest[j]]);
      assert.ok(
        apart.length >= 4,
        `${rest[i]} and ${rest[j]} differ on ${apart}`,
      );
    }
});

test("an unknown theme id plays the alley instrument", () => {
  assert.equal(resolvePalette("alley"), SOUND_PALETTES.alley);
  assert.equal(resolvePalette(undefined), SOUND_PALETTES.alley);
  assert.equal(resolvePalette(null), SOUND_PALETTES.alley);
  assert.equal(resolvePalette("no-such-bay"), SOUND_PALETTES.alley);
  for (const id of ids) assert.equal(resolvePalette(id), SOUND_PALETTES[id]);
});

// Minimal Web Audio stand-ins: enough for the constructor graph, and the
// recorded parameter calls prove the palette numbers reached the nodes.
function numberParam(value = 0) {
  const param = { value, calls: [] };
  for (const method of [
    "setTargetAtTime",
    "setValueAtTime",
    "exponentialRampToValueAtTime",
    "cancelScheduledValues",
  ])
    param[method] = (...args) => {
      param.calls.push([method, ...args]);
      return param;
    };
  return param;
}

function stubNode(extra = {}) {
  return {
    connect: (target) => target,
    disconnect() {},
    ...extra,
  };
}

function stubContext() {
  return {
    currentTime: 0.5,
    sampleRate: 48000,
    createPeriodicWave: () => ({}),
    createGain: () => stubNode({ gain: numberParam() }),
    createBiquadFilter: () =>
      stubNode({
        type: "lowpass",
        frequency: numberParam(),
        Q: numberParam(),
        gain: numberParam(),
      }),
    createStereoPanner: () => stubNode({ pan: numberParam() }),
    createOscillator: () =>
      stubNode({
        frequency: numberParam(),
        detune: numberParam(),
        setPeriodicWave(wave) {
          this.wave = wave;
        },
        start() {},
        stop() {},
      }),
    createDelay: () => stubNode({ delayTime: numberParam() }),
  };
}

const lastTarget = (param) =>
  param.calls.filter((call) => call[0] === "setTargetAtTime").at(-1)?.[3];

test("a theme swap rebuilds the canopy on that theme's palette", () => {
  const ctx = stubContext();
  const synth = new TableSynth(ctx, {}, { random: seeded(4), theme: "reef" });
  assert.equal(synth.palette, SOUND_PALETTES.reef);
  // A palette only overrides the cue voices it names.
  assert.deepEqual(synth.patches.reed, {
    attack: 0.024,
    cutoff: 1900,
    sustain: 0.64,
    tail: 0.19,
  });
  // Named fields replace the base patch; the rest of the voice survives.
  assert.deepEqual(synth.patches.bass, {
    attack: 0.015,
    cutoff: 820,
    sustain: 0.59,
    tail: 0.14,
  });

  synth.startAmbient(0.6);
  const reef = synth.canopy;
  assert.equal(reef.palette, SOUND_PALETTES.reef);
  assert.equal(reef.patches, synth.patches);
  assert.equal(lastTarget(reef.gate.gain), SOUND_PALETTES.reef.gateRamp);
  const shelf = SOUND_PALETTES.reef.glintShelf;
  assert.equal(reef.glassBus.gain.value, shelf.base + shelf.shine * 0.78);
  // The bed opens on its palette's own waves, not on a fixed pad/reed pair.
  assert.deepEqual(
    reef.bed.map((voice) => voice.osc.wave),
    SOUND_PALETTES.reef.bedVoices.map((voice) => synth.waves[voice.wave]),
  );
  assert.equal(reef.bass.osc.wave, synth.waves[SOUND_PALETTES.reef.bassWave]);

  synth.setTheme("vapor");
  synth.startAmbient(1);
  assert.notEqual(synth.canopy, reef, "the swap tears down the old canopy");
  assert.equal(synth.canopy.palette, SOUND_PALETTES.vapor);
  assert.equal(synth.canopy.patches.glass.cutoff, 9600);
  assert.equal(
    lastTarget(synth.canopy.gate.gain),
    SOUND_PALETTES.vapor.gateRamp,
  );
});
