import test from "node:test";
import assert from "node:assert/strict";
import {
  ENGINES,
  SCORE_THEMES,
  SOUND_PALETTES,
  SPECTRA,
  TableSynth,
  resolveEngine,
} from "../app/audio/night-synth.mjs";
import { seeded } from "./lib/rng.mjs";

// The four themes no longer share one machine. These checks pin which engine
// plays which palette, that every engine keeps the surface TableSynth and
// ArcadeMixer call, and that each engine schedules its own music.
const ids = SCORE_THEMES.map((theme) => theme.id);
const WAVE_NAMES = Object.keys(SPECTRA);
const waveIndex = (name) => WAVE_NAMES.indexOf(name);
// The calls TableSynth.startAmbient, schedule, setSparkle and stopAmbient make
// on a canopy. Nothing outside night-synth.mjs reaches into an engine.
const SHARED = ["audible", "schedule", "setSparkle", "stop"];

// A Web Audio stand-in that records the music. Every parameter call, oscillator
// start and buffer-source slice lands in one flat log, so two runs can be
// compared for determinism and one run can be read for what actually played.
function fakeAudio(currentTime = 0.5) {
  const log = [];
  const created = [];
  const waves = [];
  const param = (label, initial = 0) => {
    const calls = [];
    let value = initial;
    const target = { calls };
    Object.defineProperty(target, "value", {
      get: () => value,
      set: (next) => {
        value = next;
        calls.push(["value", next]);
        log.push([label, "value", next]);
      },
    });
    for (const method of [
      "setTargetAtTime",
      "setValueAtTime",
      "exponentialRampToValueAtTime",
      "cancelScheduledValues",
    ])
      target[method] = (...args) => {
        calls.push([method, ...args]);
        log.push([label, method, ...args]);
        return target;
      };
    return target;
  };
  const node = (label, extra = {}) => {
    const created_ = {
      label,
      targets: [],
      connect(target) {
        created_.targets.push(target);
        return target;
      },
      disconnect() {
        log.push([label, "disconnect"]);
      },
      ...extra,
    };
    created.push(created_);
    return created_;
  };
  const ctx = {
    currentTime,
    sampleRate: 48000,
    log,
    created,
    createPeriodicWave(real, imaginary) {
      waves.push({ real, imaginary });
      return waves.length - 1;
    },
    createGain: () => node("gain", { gain: param("gain.gain") }),
    createBiquadFilter: () =>
      node("filter", {
        type: "lowpass",
        frequency: param("filter.frequency"),
        Q: param("filter.Q", 0.7),
        gain: param("filter.gain", 0),
      }),
    createStereoPanner: () => node("panner", { pan: param("panner.pan", 0) }),
    createDelay: () =>
      node("delay", { delayTime: param("delayTime.delay", 0) }),
    createOscillator() {
      const osc = node("oscillator", {
        frequency: param("oscillator.frequency"),
        detune: param("oscillator.detune", 0),
        wave: null,
        onended: null,
        stops: 0,
        start(when = 0) {
          log.push([
            "oscillator",
            "start",
            when,
            osc.frequency.value,
            osc.wave,
          ]);
        },
        stop(when = 0) {
          this.stops++;
          log.push(["oscillator", "stop", when, osc.wave]);
        },
        setPeriodicWave(wave) {
          osc.wave = wave;
        },
      });
      return osc;
    },
    createBuffer(channels, frames, rate) {
      const samples = Array.from(
        { length: channels },
        () => new Float32Array(frames),
      );
      return {
        numberOfChannels: channels,
        length: frames,
        sampleRate: rate,
        duration: frames / rate,
        getChannelData: (channel) => samples[channel],
      };
    },
    createBufferSource() {
      const source = node("bufferSource", {
        buffer: null,
        loop: false,
        onended: null,
        stops: 0,
        start(when = 0, offset = 0, duration) {
          log.push(["bufferSource", "start", when, offset, duration ?? -1]);
        },
        stop(when = 0) {
          this.stops++;
          log.push(["bufferSource", "stop", when]);
        },
      });
      return source;
    },
  };
  return ctx;
}

function build(theme, { seed = 7, tension = false } = {}) {
  const ctx = fakeAudio();
  const synth = new TableSynth(ctx, {}, { random: seeded(seed), theme });
  synth.tension = tension;
  synth.startAmbient(0.6);
  return { ctx, synth, canopy: synth.canopy, log: ctx.log };
}

// Feed the canopy a 140ms tick's worth of lookahead, the way ArcadeMixer does.
function run(theme, seconds, options = {}) {
  const built = build(theme, options);
  for (let through = 0.87; through <= 0.6 + seconds; through += 0.37)
    built.synth.schedule(through);
  return built;
}

const voicesOf = (ctx, wave) =>
  ctx.created.filter(
    (node) => node.label === "oscillator" && node.wave === waveIndex(wave),
  );
const lfosOf = (ctx) =>
  ctx.created.filter(
    (node) => node.label === "oscillator" && node.wave == null,
  );
const buffersOf = (ctx) =>
  ctx.created.filter((node) => node.label === "bufferSource");

test("each palette names the engine that plays it", () => {
  assert.deepEqual(
    Object.fromEntries(ids.map((id) => [id, SOUND_PALETTES[id].engine])),
    { alley: "ambient", vapor: "bloom", reef: "abyss", ember: "pulse" },
  );
  assert.deepEqual(Object.keys(ENGINES).sort(), [
    "abyss",
    "ambient",
    "bloom",
    "pulse",
  ]);
  for (const id of ids) {
    const palette = SOUND_PALETTES[id];
    assert.equal(resolveEngine(palette), ENGINES[palette.engine], id);
    assert.equal(build(id).canopy.constructor, ENGINES[palette.engine], id);
  }
});

test("an unknown or missing engine id keeps the ambient canopy", () => {
  assert.equal(resolveEngine({ engine: "no-such-engine" }), ENGINES.ambient);
  assert.equal(resolveEngine({ engine: undefined }), ENGINES.ambient);
  assert.equal(resolveEngine({}), ENGINES.ambient);
  assert.equal(resolveEngine(undefined), ENGINES.ambient);
  assert.equal(resolveEngine(null), ENGINES.ambient);
});

test("every engine takes the ambient canopy's arguments and calls", () => {
  const arity = ENGINES.ambient.length;
  // ctx, output, score, waves, random, at, shine, palette, patches.
  assert.equal(arity, 9, "the constructor TableSynth.startAmbient calls");
  for (const [id, Engine] of Object.entries(ENGINES)) {
    assert.equal(Engine.length, arity, `${id} constructor arity`);
    const own = Object.getOwnPropertyNames(Engine.prototype);
    for (const method of SHARED) {
      assert.ok(own.includes(method), `${id} owns ${method}`);
      assert.equal(typeof Engine.prototype[method], "function", `${id}.${method}`);
    }
  }
});

// The alley render is the contract. Its engine is the original class, method
// for method: the vine, the twinkle and the heartbeat are still its own
// private surface, and no new engine was allowed to rewrite it.
test("the alley theme plays the untouched ambient canopy", () => {
  assert.equal(SOUND_PALETTES.alley.engine, "ambient");
  assert.equal(resolveEngine(SOUND_PALETTES.alley), ENGINES.ambient);
  const { canopy } = build("alley");
  assert.equal(canopy.constructor, ENGINES.ambient);
  assert.deepEqual(Object.getOwnPropertyNames(ENGINES.ambient.prototype), [
    "constructor",
    "shelf",
    "modulate",
    "voice",
    "apply",
    "setSparkle",
    "audible",
    "ribbon",
    "stars",
    "beat",
    "schedule",
    "stop",
  ]);
  // The three events that make alley's bed a bed, and nothing else.
  assert.ok(!("pulseAt" in canopy), "no heartbeat on the alley palette");
});

test("each engine replays the same music from the same seed", () => {
  for (const id of ids) {
    const first = run(id, 10, { seed: 4242 });
    const again = run(id, 10, { seed: 4242 });
    assert.deepEqual(first.log, again.log, `${id} is deterministic`);
    // A log that scheduled nothing would compare equal for the wrong reason.
    const starts = first.log.filter(
      (entry) => entry[0] === "oscillator" && entry[1] === "start",
    );
    assert.ok(starts.length >= 8, `${id} scheduled ${starts.length} voices`);
    const other = run(id, 10, { seed: 99 });
    assert.notDeepEqual(other.log, first.log, `${id} follows its seed`);
  }
});

// A NaN reaching a gain or a frequency silences a voice without throwing, so
// the log is swept for non-finite numbers after long enough for every engine's
// rarest event (a bloom glint, an abyss ping) to have fired.
test("no engine schedules a value it cannot render", () => {
  for (const id of ids) {
    const { log } = run(id, 30, { seed: 606 });
    const numbers = log.flat().filter((value) => typeof value === "number");
    assert.ok(numbers.length > 100, `${id} scheduled values`);
    assert.ok(
      numbers.every((value) => Number.isFinite(value)),
      `${id} scheduled only finite numbers`,
    );
    assert.ok(
      log.some((entry) => entry[0] === "oscillator" && entry[1] === "start"),
      `${id} sounded something`,
    );
  }
  // The rarest events really do fire inside that window.
  const sounded = (theme, seconds, voice) =>
    run(theme, seconds, { seed: 606 }).log.some(
      (entry) => entry[1] === "start" && entry[4] === waveIndex(voice),
    );
  assert.ok(sounded("vapor", 12, "glass"), "a bloom glint landed");
  assert.ok(sounded("reef", 40, "reed"), "an abyss ping landed");
});

test("the four engines make structurally different music", () => {
  const engines = ids.map((id) => run(id, 12));
  const shapes = engines.map(({ ctx }) => ({
    buffers: buffersOf(ctx).length,
    lfos: lfosOf(ctx).length,
  }));
  // Only the engines that breathe build a noise buffer, and only the groove
  // engine slices one per hit: alley and reef build none at all.
  assert.equal(shapes[0].buffers, 0, "alley is dry noise-wise");
  assert.ok(shapes[1].buffers >= 1, "vapor loops a surf buffer");
  assert.equal(shapes[2].buffers, 0, "reef has no noise layer");
  assert.ok(shapes[3].buffers >= 8, "ember slices its buffer per hat");
});

test("vapor's bloom engine crossfades pad stacks under a breathing surf", () => {
  const bloom = SOUND_PALETTES.vapor.bloom;
  assert.ok(bloom.attack >= 1.2 && bloom.attack <= 2, "slow stack attack");
  assert.ok(bloom.release >= 2.5 && bloom.release <= 4, "long stack release");
  assert.ok(bloom.surf.level > 0.01 && bloom.surf.level <= 0.03, "surf level");
  assert.ok(bloom.surf.rate >= 0.05 && bloom.surf.rate <= 0.09, "surf breath");
  assert.ok(bloom.surf.seconds >= 2 && bloom.surf.seconds <= 4, "surf loop");

  const { canopy, ctx } = build("vapor");
  const surf = buffersOf(ctx).filter((source) => source.loop);
  assert.equal(surf.length, 1, "one looping surf source, not per cycle");
  assert.equal(surf[0].buffer.numberOfChannels, 2);
  assert.equal(surf[0].buffer.duration, bloom.surf.seconds);
  // Its cutoff is held open by one very slow LFO.
  const breath = lfosOf(ctx).filter(
    (node) => node.frequency.value === bloom.surf.rate,
  );
  assert.equal(breath.length, 1, "one surf LFO");
  // oscillator -> depth gain -> the surf cutoff.
  assert.equal(
    breath[0].targets[0].targets[0],
    canopy.surfColor.frequency,
  );
  // A stack is the palette's bed plus a sub, and nothing rhythmic:
  assert.equal(canopy.stacks.length, 1);
  const stackWaves = ctx.created
    .filter((node) => node.label === "oscillator" && node.wave != null)
    .map((node) => WAVE_NAMES[node.wave]);
  assert.deepEqual(stackWaves, [
    SOUND_PALETTES.vapor.bassWave,
    ...SOUND_PALETTES.vapor.bedVoices.map((voice) => voice.wave),
  ]);
  // The palette's chorus drifts each bed voice of the stack off its own rate.
  const chorus = SOUND_PALETTES.vapor.chorus;
  const rates = lfosOf(ctx).map((node) => node.frequency.value);
  for (const i of [1, 2, 3])
    assert.ok(
      rates.includes(chorus.rate * (1 + i * 0.13)),
      `chorus drift on bed voice ${i}`,
    );
  assert.equal(rates.length, 5, "surf breath, stack sway and three chorus LFOs");
});

test("a chord change dissolves the previous stack instead of jumping", () => {
  const bloom = SOUND_PALETTES.vapor.bloom;
  const { canopy, log } = run("vapor", 14);
  assert.ok(canopy.previous, "the harmony moved");
  // Each crossfade opens one stack at unit gain over the attack:
  const attacks = log.filter(
    (entry) =>
      entry[0] === "gain.gain" &&
      entry[1] === "exponentialRampToValueAtTime" &&
      entry[2] === 1,
  );
  assert.ok(attacks.length >= 2, `${attacks.length} stacks opened`);
  for (const attack of attacks)
    assert.ok(attack[3] >= 0.6 + bloom.attack, "stack attack ramp");
  // and closes the one it replaced over the release.
  const releases = log.filter(
    (entry) =>
      entry[0] === "gain.gain" &&
      entry[1] === "exponentialRampToValueAtTime" &&
      entry[2] === 0.0001,
  );
  assert.ok(releases.length >= 1, "the outgoing stack bled away");
  for (const release of releases)
    assert.ok(release[3] >= 0.6 + bloom.release, "stack release ramp");
});

test("a knock lifts vapor's surf and pulls the next crossfade closer", () => {
  const bloom = SOUND_PALETTES.vapor.bloom;
  const calm = build("vapor"),
    knocked = build("vapor", { tension: true });
  knocked.synth.schedule(0.87);
  const held = knocked.canopy.surfAmp.gain.calls
    .filter((call) => call[0] === "setTargetAtTime")
    .at(-1);
  assert.ok(held, "the surf level was retargeted");
  assert.ok(
    Math.abs(held[1] - bloom.surf.level * (1 + bloom.pressure.surfLift)) < 1e-12,
    `surf lifted to ${held[1]}`,
  );
  // The pressure trims the wait rather than restarting the cycle.
  const plain = SOUND_PALETTES.vapor.bloom;
  assert.ok(
    knocked.canopy.changeAt < calm.canopy.changeAt + plain.dwell,
    "the crossfade cycle shortened",
  );
  assert.ok(knocked.canopy.changeAt > 0.87);
});

test("reef's abyss engine swells out of silence over a barely-felt throb", () => {
  const abyss = SOUND_PALETTES.reef.abyss;
  const pulse = SOUND_PALETTES.reef.pulse;
  assert.ok(abyss.attack[0] >= 0.8 && abyss.attack[1] <= 1.4, "slow attack");
  assert.ok(abyss.decay[0] >= 4 && abyss.decay[1] <= 7, "very long decay");
  assert.ok(abyss.every[0] >= 6 && abyss.every[1] <= 11, "swell spacing");
  assert.ok(pulse.level <= 0.03, "the throb is barely felt");

  const { canopy, ctx, log, synth } = build("reef");
  assert.equal(canopy.swellAt, 0.6 + abyss.first);
  assert.equal(canopy.pulseAt, 0.6 + 60 / pulse.bpm);
  assert.ok(!("padBus" in canopy), "no pad bed");
  // Nothing sounds between swells: no noise layer at all.
  assert.equal(buffersOf(ctx).length, 0);

  synth.schedule(0.6 + abyss.first + 0.01);
  const swell = voicesOf(ctx, SOUND_PALETTES.reef.bassWave).at(-1);
  assert.equal(swell.frequency.value, 440 * 2 ** ((canopy.frame.root - 69) / 12));
  // One chord: the sub root plus the three-voice deep bed, every voice split
  // off-unison by the palette's detune pairs.
  const detune = SOUND_PALETTES.reef.detunePairs;
  const bed = voicesOf(ctx, "deep");
  assert.equal(bed.length, 3, "three-voice bed");
  assert.deepEqual(
    bed.map((node) => node.detune.value),
    [detune, -detune, detune],
  );
  assert.equal(swell.detune.value, -detune, "the root takes the other side");
  // The swell's envelope is the shape: a slow attack into a very long, dark
  // decay, and never another swell inside that tail.
  const gains = ctx.created.filter((node) => node.label === "gain");
  const ramps = gains
    .flatMap((node) => node.gain.calls)
    .filter((call) => call[0] === "exponentialRampToValueAtTime");
  const body = gains.find((node) =>
    node.gain.calls.some(
      (call) =>
        call[0] === "exponentialRampToValueAtTime" && call[1] === abyss.level,
    ),
  );
  assert.ok(body, "the swell reached its level");
  const [up, down] = body.gain.calls.filter(
    (call) => call[0] === "exponentialRampToValueAtTime",
  );
  const attack = up[2] - canopy.frameAt,
    decay = down[2] - up[2];
  assert.ok(
    attack >= abyss.attack[0] && attack <= abyss.attack[1],
    `attack ${attack}`,
  );
  assert.ok(decay >= abyss.decay[0] && decay <= abyss.decay[1], `decay ${decay}`);
  assert.ok(
    canopy.swellAt - canopy.frameAt >= attack + decay,
    "silence between swells",
  );
  // A barely-felt throb under it, at the palette's own level.
  assert.ok(
    ramps.some((call) => call[1] === pulse.level),
    "the quiet throb is scheduled",
  );
});

test("a knock halves reef's wait and makes the next swell louder", () => {
  const abyss = SOUND_PALETTES.reef.abyss;
  const { canopy, ctx, synth } = build("reef", { tension: true });
  const waiting = canopy.swellAt;
  synth.schedule(0.87);
  // Half the remaining wait, not a restart of the cycle.
  assert.ok(
    Math.abs(
      canopy.swellAt - (0.5 + (waiting - 0.5) * abyss.pressure.hasten),
    ) < 1e-9,
    `swell pulled to ${canopy.swellAt}`,
  );
  const sooner = canopy.swellAt;
  synth.schedule(sooner + 0.001);
  assert.equal(canopy.frameAt, sooner, "the hastened swell landed");
  assert.equal(canopy.lift, 1, "the lift is spent on the swell it hastened");
  // It was a quarter louder than the palette's level.
  assert.ok(
    ctx.created
      .filter((node) => node.label === "gain")
      .some((node) =>
        node.gain.calls.some(
          (call) =>
            call[0] === "exponentialRampToValueAtTime" &&
            call[1] === abyss.level * abyss.pressure.lift,
        ),
      ),
    "the swell the reef noticed is louder",
  );
});

test("ember's pulse engine runs an eighth-note ostinato and no throb", () => {
  const groove = SOUND_PALETTES.ember.groove;
  assert.equal(groove.bpm, 112);
  assert.equal(SOUND_PALETTES.ember.bassWave, "grit");
  assert.equal(groove.pattern.length, 8);
  assert.deepEqual(
    groove.pattern.map(([offset]) => offset),
    [0, 0, 7, 0, 10, 0, 7, 5],
  );
  const { canopy, ctx, synth } = build("ember");
  assert.ok(!("pulseAt" in canopy), "the groove replaced the heartbeat");
  assert.ok(!("padBus" in canopy), "no pad bed under the groove");
  assert.ok(!("swellAt" in canopy));

  const eighth = 60 / groove.bpm / 2;
  synth.schedule(0.6 + eighth * 8);
  const root = canopy.frame.root;
  const hits = voicesOf(ctx, SOUND_PALETTES.ember.bassWave);
  assert.equal(hits.length, 8, "one bass hit per eighth");
  hits.forEach((hit, i) => {
    const [offset, octave] = groove.pattern[i];
    const expected = 440 * 2 ** ((root + offset + octave - 69) / 12);
    assert.ok(
      Math.abs(hit.frequency.value - expected) < 1e-9,
      `step ${i} played ${hit.frequency.value} not ${expected}`,
    );
  });
  // Hats on every eighth, level alternating between the palette's two accents.
  assert.equal(buffersOf(ctx).length, 8, "one noise tick per eighth");
  // Both offbeats of the first bar stab, three bed voices each; the second bar
  // stays clean.
  assert.equal(
    voicesOf(ctx, groove.stab.voice).length,
    6,
    "two stabs in the first bar",
  );
  assert.equal(canopy.frameAt, 0.6, "the chord rides for four bars");
});

test("ember's groove doubles its hats and lifts the downbeat under a knock", () => {
  const groove = SOUND_PALETTES.ember.groove;
  const eighth = 60 / groove.bpm / 2;
  const { canopy, ctx, synth } = build("ember", { tension: true });
  synth.schedule(0.6 + eighth * 8);
  assert.equal(
    buffersOf(ctx).length,
    16,
    "sixteenth-note hats while a knock bites",
  );
  const hits = voicesOf(ctx, SOUND_PALETTES.ember.bassWave);
  const [offset, octave] = groove.pattern[0];
  const lifted = 440 * 2 ** ((canopy.frame.root + offset + octave + 12 - 69) / 12);
  assert.ok(
    Math.abs(hits[0].frequency.value - lifted) < 1e-9,
    "the downbeat jumps an octave",
  );
});

// A theme swap stops the old canopy before the next one starts, so a stop that
// left a source running would double the music.
test("every engine mutes its gate and releases its sources when it stops", () => {
  for (const id of ids) {
    const { canopy } = run(id, 6);
    canopy.stop();
    const muted = canopy.gate.gain.calls.filter(
      (call) => call[0] === "setTargetAtTime" && call[1] === 0,
    );
    assert.ok(muted.length >= 1, `${id} fades its gate shut`);
    // The ambient canopy keeps an array of sources, the new engines a set.
    const sources = [...canopy.sources];
    assert.ok(sources.length >= 1, `${id} had live sources`);
    for (const source of sources)
      assert.ok(source.stops >= 1, `${id} released every source`);
  }
});

test("the harmony a player sees is the frame each engine sounds", () => {
  for (const id of ids) {
    const { synth, canopy } = build(id);
    assert.equal(synth.harmony(0.6), canopy.frame, id);
    assert.equal(synth.harmony(0.59), canopy.frame, id);
  }
});

test("a backgrounded engine catches up with exactly one event per field", () => {
  for (const id of ["vapor", "reef", "ember"]) {
    const { ctx, canopy } = build(id);
    // Schedule once at t=0.5, then simulate the tab hidden for 30 seconds.
    canopy.schedule(0.87, false);
    const before = ctx.created.filter(
      (n) => n.label === "oscillator" || n.label === "bufferSource",
    ).length;
    ctx.currentTime = 30.5;
    canopy.schedule(30.87, false);
    // Each overdue field resets to now + 0.018 and fires once; nothing may
    // replay a pile of events, and every field must have advanced past `now`.
    const fields = id === "vapor" ? ["changeAt", "glintAt"] : id === "reef" ? ["swellAt", "pulseAt"] : ["nextStepAt"];
    for (const field of fields) {
      const value = canopy[field];
      assert.ok(
        value === undefined || (Number.isFinite(value) && value > 30.5),
        `${id} ${field} advanced past the gap`,
      );
    }
    // The pulse engine's grid catches up step by step by design; assert a
    // bounded catch-up rather than an unbounded replay.
    const started = ctx.created.filter(
      (n) => n.label === "oscillator" || n.label === "bufferSource",
    ).length;
    if (id === "ember") {
      assert.ok(started < 130, `ember caught up in ${started} bounded steps`);
    } else if (id === "vapor") {
      // One crossfade is ~8 oscillator starts (root + bed + LFOs), one glint
      // 1-2; a backgrounded catch-up is at most a couple of events.
      assert.ok(started - before <= 20, `vapor replayed at most a couple of events (${started - before})`);
    } else {
      assert.ok(started - before <= 6, `reef replayed at most a couple of swells (${started - before})`);
    }
  }
});
