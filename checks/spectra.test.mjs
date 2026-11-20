import test from "node:test";
import assert from "node:assert/strict";
import {
  SCORE_THEMES,
  SOUND_PALETTES,
  SPECTRA,
  TableSynth,
} from "../app/audio/night-synth.mjs";
import { seeded } from "./lib/rng.mjs";

// The spectra are the instrument layer: pure harmonic amplitudes that
// initWaves turns into PeriodicWaves. They are data, so they can be pinned
// here without an AudioContext.
const ids = SCORE_THEMES.map((theme) => theme.id);
// The four spectra added for the vapor / reef / ember identities, plus the
// theme-neutral instrument the original alley bed still plays.
const NEW_SPECTRA = ["mist", "sub", "deep", "grit"];
// phrase() only knows these four voices; its patch table keys them, so a glint
// or a cue can never be voiced by a bare bed spectrum.
const cueVoices = ["bass", "pluck", "reed", "glass"];

test("every spectrum is a usable harmonic shape", () => {
  for (const [name, spectrum] of Object.entries(SPECTRA)) {
    assert.ok(Array.isArray(spectrum), `${name} is an array`);
    assert.ok(
      spectrum.length >= 6 && spectrum.length <= 12,
      `${name} has ${spectrum.length} partials`,
    );
    for (const [i, amplitude] of spectrum.entries())
      assert.ok(
        Number.isFinite(amplitude) && amplitude >= 0,
        `${name}[${i}] ${amplitude} is a finite non-negative amplitude`,
      );
    // The fundamental leads: a recessive first partial would put the pitch of
    // the voice in a harmonic the filters then have to hunt for.
    assert.equal(spectrum[0], Math.max(...spectrum), `${name} fundamental`);
    assert.ok(spectrum[0] > 0, `${name} has a fundamental`);
  }
  for (const name of NEW_SPECTRA) assert.ok(name in SPECTRA, `${name} shipped`);
});

test("the new instruments are spectrally distinct from each other", () => {
  // Two shapes within a hair of each other would read as the same instrument
  // after a filter and a room, which is exactly the bug being fixed.
  const apart = (a, b) => {
    const width = Math.max(a.length, b.length);
    let total = 0;
    for (let i = 0; i < width; i++) total += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    return total;
  };
  const names = Object.keys(SPECTRA);
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      assert.ok(
        apart(SPECTRA[names[i]], SPECTRA[names[j]]) > 0.3,
        `${names[i]} and ${names[j]} are different instruments`,
      );
  // The specific character asked for: `sub` is nearly a sine, `grit` is odd.
  assert.ok(SPECTRA.sub[1] < 0.1, "sub's 2nd harmonic is a whisper");
  assert.ok(
    SPECTRA.grit[2] > SPECTRA.grit[1] && SPECTRA.grit[4] > SPECTRA.grit[3],
    "grit's 3rd and 5th dominate their even neighbours",
  );
  assert.ok(
    SPECTRA.deep[3] + SPECTRA.deep[4] > SPECTRA.deep[1] + SPECTRA.deep[2],
    "deep is hollow rather than bright",
  );
});

test("every palette voice names a spectrum that initWaves builds", () => {
  const spectra = Object.keys(SPECTRA);
  for (const id of ids) {
    const palette = SOUND_PALETTES[id];
    for (const [i, voice] of palette.bedVoices.entries())
      assert.ok(spectra.includes(voice.wave), `${id} bed ${i} ${voice.wave}`);
    assert.ok(spectra.includes(palette.bassWave), `${id} bass wave`);
    assert.ok(cueVoices.includes(palette.glintVoice), `${id} glint voice`);
    if (palette.pulse)
      assert.ok(spectra.includes(palette.pulse.wave), `${id} pulse wave`);
    // phrase() voices every cue, so each cue voice needs its own spectrum too.
    for (const voice of cueVoices) assert.ok(spectra.includes(voice), voice);
  }
  // The vine hums on a fixed reed regardless of palette, so reed must survive.
  assert.ok(spectra.includes("reed"), "the vine's reed spectrum ships");
});

// Minimal Web Audio stand-ins: the constructor is enough to prove initWaves
// built every spectrum, which is where a mistyped wave name would throw.
function param(value = 0) {
  const node = { value };
  for (const method of [
    "setTargetAtTime",
    "setValueAtTime",
    "exponentialRampToValueAtTime",
    "cancelScheduledValues",
  ])
    node[method] = () => node;
  return node;
}
const stubNode = (extra = {}) => ({
  connect: (target) => target,
  disconnect() {},
  ...extra,
});
function stubContext(waves) {
  return {
    currentTime: 0.5,
    sampleRate: 48000,
    createPeriodicWave: (real, imaginary) => {
      const wave = { real, imaginary };
      waves.push(wave);
      return wave;
    },
    createGain: () => stubNode({ gain: param() }),
    createBiquadFilter: () =>
      stubNode({ frequency: param(), Q: param(), gain: param() }),
    createStereoPanner: () => stubNode({ pan: param() }),
    createOscillator: () =>
      stubNode({ frequency: param(), detune: param(), start() {}, stop() {} }),
    createDelay: () => stubNode({ delayTime: param() }),
  };
}

test("initWaves builds one periodic wave per spectrum", () => {
  const built = [];
  const ctx = stubContext(built);
  const synth = new TableSynth(ctx, {}, { random: seeded(3), theme: "vapor" });
  assert.deepEqual(Object.keys(synth.waves).sort(), Object.keys(SPECTRA).sort());
  assert.equal(built.length, Object.keys(SPECTRA).length);
  for (const [name, spectrum] of Object.entries(SPECTRA)) {
    const wave = synth.waves[name];
    assert.equal(wave.imaginary.length, spectrum.length + 1, `${name} length`);
    assert.equal(wave.imaginary[0], 0, `${name} carries no DC term`);
    // Float32 rounding is the only difference a spectrum may pick up here.
    Array.from(wave.imaginary.slice(1)).forEach((amplitude, i) =>
      assert.ok(
        Math.abs(amplitude - spectrum[i]) < 1e-6,
        `${name} partial ${i + 1} ${amplitude} vs ${spectrum[i]}`,
      ),
    );
    // A real-only wave would render silent; the sine terms must be populated.
    assert.ok(
      wave.real.every((value) => value === 0),
      `${name} is a pure sine-sum`,
    );
  }
});
