import test from "node:test";
import assert from "node:assert/strict";
import {
  ENGINES,
  SOUND_PALETTES,
  SPECTRA,
  TableSynth,
  resolvePalette,
  SCORE_THEMES,
} from "../app/audio/night-synth.mjs";
import { seeded } from "./lib/rng.mjs";

// Node has no AudioContext, so these tests pin the palette data and the
// threading from TableSynth into the canopy, never the rendered graph.
const ids = SCORE_THEMES.map((theme) => theme.id);
const fields = Object.keys(SOUND_PALETTES.alley);
// Every palette carries the alley field set; effects are opt-in per theme and
// a palette that omits one builds no node for it at all.
const effectFields = ["chorus", "detunePairs", "tremolo", "pulse"];
// Each engine that needs its own numbers carries one block, named after the
// engine. The ambient canopy reads the shared fields and owns no block.
const engineBlock = {
  ambient: null,
  bloom: "bloom",
  abyss: "abyss",
  pulse: "groove",
};
const engineBlocks = Object.values(engineBlock).filter(Boolean);
// The cue voices phrase() can shape: its patch table keys, shared with the
// score's strike vocabulary.
const cueVoices = ["bass", "pluck", "reed", "glass"];
// Every name initWaves can build, i.e. every wave a bed or bass may name.
const waves = Object.keys(SPECTRA);

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
    for (const field of fields)
      assert.ok(field in palette, `${id} carries ${field}`);
    for (const field of Object.keys(palette))
      assert.ok(
        fields.includes(field) ||
          effectFields.includes(field) ||
          engineBlocks.includes(field),
        `${id} ${field} is a base, effect or engine field`,
      );
    // The palette names the engine that plays it, and carries that engine's
    // own block: which machine, and the numbers it reads.
    assert.ok(
      Object.hasOwn(ENGINES, palette.engine),
      `${id} engine ${palette.engine}`,
    );
    const block = engineBlock[palette.engine];
    if (block) assert.ok(block in palette, `${id} carries its ${block} block`);
    for (const other of engineBlocks)
      if (other !== block)
        assert.ok(!(other in palette), `${id} has no ${other} block`);
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
    for (const key of ["min", "max", "base", "shineGain"])
      assertPositive(id, `glintRate.${key}`, palette.glintRate[key]);
    assert.ok(
      palette.glintRate.max > palette.glintRate.min,
      `${id} glint window`,
    );
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
    // The routing field, not an instrument number: alley is the ambient canopy.
    engine: "ambient",
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
    glintRate: { min: 0.7, max: 2.05, base: 0.48, shineGain: 0.71 },
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

// The identity a listener hears: which engine plays, which spectra are in play,
// which effects move them, and how fast the pulse runs.
function identity(palette) {
  const spectra = [
    palette.bassWave,
    ...palette.bedVoices.map((voice) => voice.wave),
  ].sort();
  const effects = effectFields
    .filter((field) => field in palette)
    .map((field) => (field === "pulse" ? `pulse@${palette.pulse.bpm}` : field));
  return [palette.engine, spectra.join("/"), effects.join("+") || "dry"].join(
    " ",
  );
}

test("each theme has its own engine, spectra and effects", () => {
  const identities = new Map();
  for (const id of ids) identities.set(identity(SOUND_PALETTES[id]), id);
  assert.equal(identities.size, ids.length, [...identities]);

  const { alley, vapor, reef, ember } = SOUND_PALETTES;
  // Alley is the instrument every new field has to be a no-op for.
  for (const field of effectFields) assert.ok(!(field in alley), field);
  // Vapor drifts its bed and never thumps.
  assert.deepEqual(vapor.chorus, { rate: 0.13, depthCents: 7 });
  assert.ok(!("pulse" in vapor) && !("detunePairs" in vapor));
  // Reef muddies paired detune under a slow deep throb.
  assertPositive("reef", "detunePairs", reef.detunePairs);
  assert.equal(reef.pulse.bpm, 46);
  assert.equal(reef.pulse.wave, "sub");
  // Ember flutters its stabs and runs a grittier groove instead of a throb.
  assert.equal(ember.engine, "pulse");
  assert.equal(ember.groove.bpm, 112);
  assert.equal(ember.bassWave, "grit");
  assert.ok(!("pulse" in ember), "the groove replaced the heartbeat");
  assertPositive("ember", "tremolo.rate", ember.tremolo.rate);
  // Every effect stays inside the ranges the engine assumes.
  for (const id of ids) {
    const palette = SOUND_PALETTES[id];
    if (palette.chorus) {
      assertPositive(id, "chorus.rate", palette.chorus.rate);
      assertUnit(id, "chorus.depthCents", palette.chorus.depthCents, 0, 30);
    }
    if (palette.tremolo) {
      assertPositive(id, "tremolo.rate", palette.tremolo.rate);
      // The pad bus runs at unit gain, so the depth is an absolute excursion.
      assertUnit(id, "tremolo.depth", palette.tremolo.depth, 0, 0.5);
    }
    if (palette.detunePairs)
      assertUnit(id, "detunePairs", palette.detunePairs, 0, 25);
    if (palette.pulse) {
      assertPositive(id, "pulse.bpm", palette.pulse.bpm);
      assert.ok(waves.includes(palette.pulse.wave), `${id} pulse wave`);
      assertUnit(id, "pulse.level", palette.pulse.level, 0, 0.2);
      assert.ok(
        Number.isInteger(palette.pulse.offset),
        `${id} pulse offset`,
      );
    }
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
  // The node factories also log what they made, so a test can find the nodes a
  // single scheduler pass added (the heartbeat's thump, for one).
  const ctx = {
    currentTime: 0.5,
    sampleRate: 48000,
    oscillators: [],
    gains: [],
    createPeriodicWave: () => ({}),
    createGain: () => {
      const node = stubNode({ gain: numberParam() });
      ctx.gains.push(node);
      return node;
    },
    createBiquadFilter: () =>
      stubNode({
        type: "lowpass",
        frequency: numberParam(),
        Q: numberParam(),
        gain: numberParam(),
      }),
    createStereoPanner: () => stubNode({ pan: numberParam() }),
    createOscillator: () => {
      const node = stubNode({
        frequency: numberParam(),
        detune: numberParam(),
        setPeriodicWave(wave) {
          this.wave = wave;
        },
        start() {},
        stop() {},
      });
      ctx.oscillators.push(node);
      return node;
    },
    createDelay: () => stubNode({ delayTime: numberParam() }),
    // The bloom and pulse engines build one noise buffer each, from these two.
    createBuffer: (channels, frames) => ({
      numberOfChannels: channels,
      length: frames,
      getChannelData: () => new Float32Array(frames),
    }),
    createBufferSource: () =>
      stubNode({ buffer: null, loop: false, start() {}, stop() {} }),
  };
  return ctx;
}

const lastTarget = (param) =>
  param.calls.filter((call) => call[0] === "setTargetAtTime").at(-1)?.[3];

test("a theme swap rebuilds the canopy on that theme's engine", () => {
  const ctx = stubContext();
  const synth = new TableSynth(ctx, {}, { random: seeded(4), theme: "reef" });
  assert.equal(synth.palette, SOUND_PALETTES.reef);
  // A palette only overrides the cue voices it names.
  assert.deepEqual(synth.patches.reed, {
    attack: 0.03,
    cutoff: 2400,
    sustain: 0.64,
    tail: 0.16,
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
  assert.equal(reef.constructor, ENGINES[SOUND_PALETTES.reef.engine]);
  assert.equal(reef.palette, SOUND_PALETTES.reef);
  assert.equal(reef.patches, synth.patches);
  assert.equal(lastTarget(reef.gate.gain), SOUND_PALETTES.reef.gateRamp);
  // The abyss engine holds its first swell for the palette's own delay.
  assert.equal(reef.swellAt, 0.6 + SOUND_PALETTES.reef.abyss.first);

  // A swap changes the machine, not just the numbers it reads.
  synth.setTheme("vapor");
  synth.startAmbient(1);
  assert.notEqual(synth.canopy, reef, "the swap tears down the old canopy");
  assert.equal(synth.canopy.constructor, ENGINES[SOUND_PALETTES.vapor.engine]);
  assert.equal(synth.canopy.palette, SOUND_PALETTES.vapor);
  assert.equal(synth.canopy.patches.glass.cutoff, 7200);
  assert.equal(
    lastTarget(synth.canopy.gate.gain),
    SOUND_PALETTES.vapor.gateRamp,
  );
  const shelf = SOUND_PALETTES.vapor.glintShelf;
  assert.equal(
    synth.canopy.glassBus.gain.value,
    shelf.base + shelf.shine * 0.78,
  );
});

// The effect layer is the second half of a theme's identity: a chorus drift, a
// paired detune, a tremolo flutter and a heartbeat. Alley ships none of them,
// so its graph must stay exactly the size it was before they existed.
test("the alley canopy builds the original graph and no effect nodes", () => {
  const ctx = stubContext();
  const synth = new TableSynth(ctx, {}, { random: seeded(7), theme: "alley" });
  synth.startAmbient(0.6);
  const canopy = synth.canopy;
  // Two width LFOs, the bass, three bed voices, the vine, the six detune and
  // cutoff LFOs those chorused voices own, four level LFOs and the vine pan.
  assert.equal(ctx.oscillators.length, 20, "alley oscillator tally");
  assert.ok(!("pulseAt" in canopy), "no heartbeat is scheduled");
  assert.ok(!("pulseBus" in canopy), "no heartbeat bus exists");
  // Alternating detune is reef's mud; alley keeps its jittered detune.
  assert.ok(
    canopy.bed.every((voice) => Math.abs(voice.osc.detune.value) <= 3),
    "alley bed detune stays inside its jitter",
  );
  // The ambient engine is the only one with a three-voice bed and a vine.
  assert.equal(canopy.bed.length, 3);
  assert.ok(canopy.vine, "the vine is the ambient engine's own");
});

test("only the abyss engine schedules the quiet reef throb", () => {
  const ctx = stubContext();
  const synth = new TableSynth(ctx, {}, { random: seeded(11), theme: "reef" });
  synth.startAmbient(0.6);
  const reef = synth.canopy;
  const beat = 60 / SOUND_PALETTES.reef.pulse.bpm;
  reef.schedule(0.6 + beat * 2.5);
  // Two thumps landed, each one beat after the last.
  assert.ok(
    Math.abs(reef.pulseAt - (0.6 + beat * 3)) < 1e-9,
    `reef pulseAt ${reef.pulseAt}`,
  );
  const peaks = ctx.gains.flatMap((node) =>
    node.gain.calls
      .filter((call) => call[0] === "exponentialRampToValueAtTime")
      .map((call) => call[1]),
  );
  assert.ok(
    peaks.includes(SOUND_PALETTES.reef.pulse.level),
    "the quiet thump is scheduled",
  );
  // The engines that replaced the heartbeat never grow the field, and vapor's
  // scheduler adds no field at all.
  for (const theme of ["ember", "vapor"]) {
    const other = new TableSynth(ctx, {}, { random: seeded(11), theme });
    other.startAmbient(0.6);
    const before = Object.keys(other.canopy).sort();
    other.canopy.schedule(0.6 + 8);
    assert.ok(!("pulseAt" in other.canopy), `${theme} has no throb`);
    if (theme === "vapor")
      assert.deepEqual(Object.keys(other.canopy).sort(), before);
  }
});
