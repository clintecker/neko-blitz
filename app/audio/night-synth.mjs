import * as nightScore from "./night-score.mjs";

const { createScore } = nightScore;
const fallbackTheme = nightScore.DEFAULT_THEME;

// The score module owns the theme registry. Reading it through the namespace
// keeps this module loadable against a score build that ships only the
// default theme.
function readThemes() {
  const source = nightScore.themeList ?? nightScore.THEMES;
  const registry = typeof source === "function" ? source() : source;
  const entries = Array.isArray(registry)
    ? registry.map((theme) => [theme?.id, theme])
    : registry && typeof registry === "object"
      ? Object.entries(registry)
      : [];
  const themes = entries
    .map(([id, theme]) => ({ id: theme?.id ?? id, name: theme?.name ?? id }))
    .filter((theme) => typeof theme.id === "string");
  return themes.length ? themes : [{ id: fallbackTheme, name: "Alley" }];
}

export const SCORE_THEMES = Object.freeze(readThemes());

// A stored preference can name a theme this build no longer ships.
export function resolveThemeId(id) {
  return SCORE_THEMES.some((theme) => theme.id === id) ? id : fallbackTheme;
}

const hz = (note) => 440 * 2 ** ((note - 69) / 12);
const range = (random, low, high) => low + random() * (high - low);
const pick = (random, notes) => notes[Math.floor(random() * notes.length)];
const limit = (n, low, high) => Math.max(low, Math.min(high, n));
const floor = 0.0001;

// These spectra give the rack distinct instruments before filtering or FM.
// Each harmonic amplitude shape is hand-drawn, so the bed of a theme reads as
// its own instrument family even before the filters and the room. The registry
// is exported so the checks can pin the spectra themselves.
export const SPECTRA = Object.freeze({
  bass: [1, 0.44, 0.27, 0.07, 0.09, 0.02],
  pad: [1, 0.48, 0.26, 0.17, 0.11, 0.07, 0.045, 0.028, 0.022],
  reed: [1, 0.19, 0.37, 0.1, 0.24, 0.045, 0.09, 0.032, 0.04],
  pluck: [1, 0.61, 0.31, 0.24, 0.15, 0.1, 0.082, 0.059, 0.046, 0.033, 0.02],
  glass: [1, 0.29, 0.46, 0.053, 0.18, 0.09, 0.026, 0.075, 0.015, 0.03],
  // Vapor's bed: breath first, a gentle 2nd/3rd, a fast rolloff and a trace
  // of odd shimmer so wide chords stay airy instead of turning into an organ.
  mist: [1, 0.34, 0.14, 0.05, 0.062, 0.03, 0.016, 0.008],
  // Vapor and reef bass: round and deep. A whisper of 2nd harmonic and a trace
  // of 3rd keep the pitch readable on a phone speaker.
  sub: [1, 0.055, 0.03, 0.012, 0.006, 0.003],
  // Reef's bed: dark and hollow. Weak 2nd, a pronounced 4th/5th, no top.
  deep: [1, 0.12, 0.08, 0.44, 0.33, 0.06, 0.03, 0.012],
  // Ember's bed: odd harmonics with a nasal 3rd/5th hump, a clarinet squawk.
  grit: [1, 0.16, 0.52, 0.1, 0.44, 0.07, 0.26, 0.05, 0.13],
});
function initWaves(ctx) {
  return Object.fromEntries(
    Object.entries(SPECTRA).map(([name, spectrum]) => {
      const imaginary = Float32Array.from([0, ...spectrum]);
      return [
        name,
        ctx.createPeriodicWave(new Float32Array(imaginary.length), imaginary),
      ];
    }),
  );
}

function volume(ctx, value, output) {
  const node = ctx.createGain();
  node.gain.value = value;
  if (output) node.connect(output);
  return node;
}
function filter(ctx, type, frequency, resonance = 0.7) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = resonance;
  return node;
}
function pan(ctx, position) {
  // Older WebKit can render the whole arrangement in mono.
  const node = ctx.createStereoPanner
    ? ctx.createStereoPanner()
    : ctx.createGain();
  if (node.pan) node.pan.value = position;
  return node;
}
function lfo(ctx, param, rate, excursion, at) {
  const oscillator = ctx.createOscillator();
  const depth = volume(ctx, excursion, param);
  oscillator.frequency.value = rate;
  oscillator.connect(depth);
  oscillator.start(at);
  return { oscillator, depth };
}

// Short cross-fed tapes: high-pass the returns and roll off some treble on
// each trip. Their tails leave space for the next dry card impact.
function echo(ctx, output, leftTime, rightTime, feedback, brightness) {
  const input = volume(ctx, 1);
  const highPass = filter(ctx, "highpass", 480);
  const lowPass = filter(ctx, "lowpass", brightness);
  const left = ctx.createDelay(1),
    right = ctx.createDelay(1);
  const back = volume(ctx, feedback),
    across = volume(ctx, 0.68);
  const leftPan = pan(ctx, -0.64),
    rightPan = pan(ctx, 0.62);
  left.delayTime.value = leftTime;
  right.delayTime.value = rightTime;
  input.connect(highPass).connect(lowPass).connect(left);
  left.connect(leftPan).connect(output);
  left.connect(across).connect(right);
  right.connect(rightPan).connect(output);
  right.connect(back).connect(highPass);
  return {
    input,
    close() {
      for (const n of [
        input,
        highPass,
        lowPass,
        left,
        right,
        back,
        across,
        leftPan,
        rightPan,
      ])
        n.disconnect();
    },
  };
}

const basePatches = {
  bass: { attack: 0.015, cutoff: 1390, sustain: 0.59, tail: 0.08 },
  pluck: { attack: 0.005, cutoff: 5300, sustain: 0.23, tail: 0.06 },
  reed: { attack: 0.016, cutoff: 3550, sustain: 0.58, tail: 0.105 },
  glass: { attack: 0.006, cutoff: 8150, sustain: 0.27, tail: 0.24 },
};

// A theme's harmony data does not describe a tone colour, so each theme names
// its own instrument here: which spectra hold the bed, where the filters sit,
// how the room rings out, and which effects move it. The alley numbers are the
// original instrument, so they reproduce its render exactly; the other palettes
// are the difference the ear hears between the four tables. Cutoffs marked
// `open` are the starting values the first frame and the first ribbon glide
// away from. `glintRate` is required everywhere (alley carries the original
// twinkle formula); `chorus`, `detunePairs`, `tremolo` and `pulse` are optional
// and a palette without them builds no extra node, LFO or thump at all.
//
// `engine` names the machine that plays the instrument. Tuning four copies of
// one architecture had reached its ceiling, so each theme now runs its own
// engine instead of its own knob values: alley keeps the original ambient
// canopy, vapor crossfades pad stacks under surf, reef swells out of silence,
// and ember is a groove. The engine block below each palette (`bloom`, `abyss`,
// `groove`) is read by that engine and by nothing else; a palette field the
// engine does not read stays as that theme's vocabulary for the engines that do.
export const SOUND_PALETTES = Object.freeze({
  alley: {
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
  },
  // Airy and wide: breathy mist bowed by one reed, a round near-sine bass, a
  // chorus drifting every bed voice, a long bright room, and a bloom engine
  // that dissolves each chord into the next under a breathing surf instead of
  // playing events at it.
  vapor: {
    engine: "bloom",
    bloom: {
      attack: 1.5, // s the incoming stack swells in
      release: 3.2, // s the outgoing stack bleeds away
      dwell: 2.4, // s held beyond the score frame before the next crossfade
      drift: 0.061, // Hz sway on the stack colour
      sway: 240, // Hz of that sway
      rootLevel: 0.075,
      surf: {
        seconds: 3.2, // s of noise in the looping buffer, built once
        cutoff: 470,
        brighten: 190, // Hz the sparkle control opens the surf
        sway: 150, // Hz of the cutoff's breath
        rate: 0.071, // Hz: one breath every fourteen seconds
        level: 0.024,
        pan: -0.3,
      },
      glint: { min: 6.5, max: 9.5, level: 0.09, strength: 0.42 },
      pressure: { surfLift: 0.3, hasten: 0.75 },
    },
    bedVoices: [
      { wave: "mist", level: 0.052, pan: -0.62 },
      { wave: "reed", level: 0.026, pan: 0.18 },
      { wave: "mist", level: 0.045, pan: 0.66 },
    ],
    bassWave: "sub",
    bassCutoff: [640, 980],
    bedCutoff: { base: 1300, shineGain: 1150, jitter: 900 },
    bedSparkle: { base: 1500, gain: 1250, spread: 190 },
    vineCutoff: { low: 1500, high: 2600, shineGain: 1300 },
    openCutoffs: { bass: 900, bed: 2400, vine: 2200 },
    glintVoice: "glass",
    glintStrength: 1.08,
    glintShelf: { base: 1, shine: 8 },
    glintRate: { min: 0.35, max: 1.1, base: 0.48, shineGain: 0.71 },
    chorus: { rate: 0.13, depthCents: 7 },
    echo: {
      leftTime: 0.36,
      rightTime: 0.52,
      feedback: 0.42,
      brightness: 6200,
    },
    gateRamp: 0.9,
    cuePatches: {
      bass: { attack: 0.021, cutoff: 1150, sustain: 0.62, tail: 0.1 },
      pluck: { attack: 0.011, cutoff: 6800, sustain: 0.3, tail: 0.09 },
      reed: { attack: 0.026, cutoff: 4300, sustain: 0.62, tail: 0.16 },
      // Woodier flute: the bell's cutoff drops and its tail shortens.
      glass: { attack: 0.012, cutoff: 7200, sustain: 0.33, tail: 0.3 },
    },
  },
  // Muffled and deep: a hollow deep-spectrum bed in unison, a near-sine bass,
  // paired detune for mud, and an abyss engine that mostly stays silent: one
  // long dark swell at a time over a barely-felt 46bpm throb.
  reef: {
    engine: "abyss",
    abyss: {
      first: 3.6, // s to the first swell
      every: [6, 11], // s between swells
      attack: [0.8, 1.4],
      decay: [4, 7],
      level: 0.14,
      rootLevel: 0.09,
      bedTrim: 0.8,
      ping: { every: [2, 3], delay: [0.8, 1.8], level: 0.05, strength: 0.16 },
      pressure: { hasten: 0.5, lift: 1.25 },
    },
    bedVoices: [
      { wave: "deep", level: 0.064, pan: -0.22 },
      { wave: "deep", level: 0.042, pan: 0.14 },
      { wave: "deep", level: 0.055, pan: 0.34 },
    ],
    bassWave: "sub",
    bassCutoff: [360, 600],
    bedCutoff: { base: 620, shineGain: 700, jitter: 300 },
    bedSparkle: { base: 780, gain: 900, spread: 90 },
    vineCutoff: { low: 420, high: 880, shineGain: 520 },
    openCutoffs: { bass: 520, bed: 1150, vine: 700 },
    glintVoice: "reed",
    glintStrength: 0.62,
    glintShelf: { base: -9, shine: 4 },
    glintRate: { min: 1.4, max: 3.2, base: 0.48, shineGain: 0.71 },
    detunePairs: 9,
    // The throb is felt rather than heard: 0.03 under swells that reach 0.14.
    pulse: { bpm: 46, wave: "sub", level: 0.03, offset: -12 },
    echo: {
      leftTime: 0.42,
      rightTime: 0.61,
      feedback: 0.44,
      brightness: 3200,
    },
    gateRamp: 0.62,
    cuePatches: {
      bass: { cutoff: 820, tail: 0.14 },
      pluck: { attack: 0.012, cutoff: 2600, sustain: 0.3, tail: 0.12 },
      reed: { attack: 0.03, cutoff: 2400, sustain: 0.64, tail: 0.16 },
      glass: { attack: 0.014, cutoff: 3900, sustain: 0.34, tail: 0.4 },
    },
  },
  // Close and tense: a gritty odd-harmonic bed against one reed, a tremolo
  // flutter on the stab bus, and a pulse engine whose eighth-note ostinato is
  // the heartbeat. The separate throb would fight the groove, so there is none.
  ember: {
    engine: "pulse",
    groove: {
      bpm: 112,
      bars: 4, // bars each chord is held before the grid re-voices
      level: 0.11,
      attack: 0.004,
      length: 0.11,
      swing: [0.86, 1.12], // per-hit level variation
      cutoff: 1650,
      brighten: 900, // Hz the sparkle control opens the bass colour
      // [semitones over the frame root, octave accent] per eighth note.
      pattern: [
        [0, 0],
        [0, 12],
        [7, 0],
        [0, 12],
        [10, 0],
        [0, 12],
        [7, 0],
        [5, 12],
      ],
      stab: { voice: "pluck", strength: 0.3, length: [0.06, 0.09], every: 2 },
      hat: {
        cutoff: 6200,
        levels: [0.008, 0.014],
        length: 0.05,
        pan: [0.22, -0.16],
      },
      noise: 1.6, // s of noise in the buffer the hats slice, built once
    },
    bedVoices: [
      { wave: "grit", level: 0.056, pan: -0.5 },
      { wave: "reed", level: 0.03, pan: 0.28 },
      { wave: "grit", level: 0.042, pan: 0.52 },
    ],
    bassWave: "grit",
    bassCutoff: [600, 980],
    bedCutoff: { base: 1100, shineGain: 1500, jitter: 1500 },
    bedSparkle: { base: 1250, gain: 1900, spread: 240 },
    vineCutoff: { low: 900, high: 2200, shineGain: 1600 },
    openCutoffs: { bass: 880, bed: 2000, vine: 1900 },
    glintVoice: "pluck",
    glintStrength: 0.82,
    glintShelf: { base: 2, shine: 5 },
    glintRate: { min: 0.25, max: 0.8, base: 0.48, shineGain: 0.71 },
    tremolo: { rate: 4.3, depth: 0.22 },
    echo: {
      leftTime: 0.12,
      rightTime: 0.19,
      feedback: 0.3,
      brightness: 4400,
    },
    gateRamp: 0.12,
    cuePatches: {
      bass: { attack: 0.008, cutoff: 1650, sustain: 0.5, tail: 0.05 },
      pluck: { attack: 0.003, cutoff: 6200, sustain: 0.19, tail: 0.045 },
      reed: { attack: 0.01, cutoff: 4200, sustain: 0.5, tail: 0.06 },
      glass: { attack: 0.004, cutoff: 9000, sustain: 0.22, tail: 0.14 },
    },
  },
});

// An unknown id keeps the alley instrument, mirroring resolveThemeId.
export function resolvePalette(id) {
  const theme = resolveThemeId(id);
  return SOUND_PALETTES[theme] ?? SOUND_PALETTES[fallbackTheme];
}

// A palette names only the cue voices it changes; the rest keep the base patch.
function soundPatches(palette) {
  const merged = { ...basePatches };
  for (const [voice, patch] of Object.entries(palette.cuePatches))
    merged[voice] = { ...basePatches[voice], ...patch };
  return merged;
}

// A phrase owns its entire graph. Ending or replacing an audition releases
// every scheduled oscillator, including voices that have not sounded yet.
function phrase(ctx, waves, random, strikes, at, out, space, options) {
  const group = volume(ctx, options.level);
  const stereo = pan(ctx, options.pan);
  const send = volume(ctx, options.wet, space);
  group.connect(stereo);
  stereo.connect(out);
  stereo.connect(send);
  const nodes = [group, stereo, send],
    sources = new Set();
  let resolve;
  const ended = new Promise((done) => {
    resolve = done;
  });
  // Callers await `ended`, so a phrase carrying no strikes still has to settle.
  if (!strikes.length) {
    for (const node of nodes) node.disconnect();
    resolve();
    return { ended, cancel() {} };
  }
  function start(oscillator, from, to) {
    sources.add(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect();
      sources.delete(oscillator);
      if (!sources.size) {
        for (const node of nodes) node.disconnect();
        resolve();
      }
    };
    oscillator.start(from);
    oscillator.stop(to);
  }
  for (const hit of strikes) {
    const patch = options.patches[hit.voice],
      time = at + hit.at;
    const tail = options.dry ? 0.032 : patch.tail;
    const stop = time + hit.length + tail;
    const attack = Math.min(patch.attack, hit.length * 0.23);
    const amp = volume(ctx, floor, group);
    const body = filter(
      ctx,
      "lowpass",
      patch.cutoff,
      hit.voice === "reed" ? 1.04 : 0.72,
    );
    body.connect(amp);
    nodes.push(amp, body);
    const peak = (0.4 * hit.strength) / hit.notes.length ** 0.67;
    amp.gain.setValueAtTime(floor, time);
    amp.gain.exponentialRampToValueAtTime(peak, time + attack);
    amp.gain.exponentialRampToValueAtTime(
      peak * patch.sustain,
      time + hit.length * 0.72,
    );
    amp.gain.exponentialRampToValueAtTime(floor, stop);
    const highest = Math.max(...hit.notes);
    const cutoff = Math.min(
      ctx.sampleRate * 0.44,
      patch.cutoff * (0.73 + 0.64 * options.shine) * range(random, 0.86, 1.12),
    );
    body.frequency.setValueAtTime(cutoff, time);
    body.frequency.exponentialRampToValueAtTime(
      Math.max(
        hz(highest) * 1.35,
        cutoff * (hit.voice === "glass" ? 0.57 : 0.22),
      ),
      stop,
    );
    for (const [i, note] of hit.notes.entries()) {
      const osc = ctx.createOscillator(),
        frequency = hz(note);
      const onset = time + (options.dry ? 0 : i * 0.0023);
      osc.setPeriodicWave(waves[hit.voice]);
      osc.frequency.value = frequency;
      osc.detune.value = range(random, -3.8, 3.8);
      osc.connect(body);
      // A brief non-integer FM transient gives the upper bell a silver edge.
      // Its modulation index falls away so the tail lands on a clear pitch.
      if (hit.voice === "glass" && note === highest) {
        const mod = ctx.createOscillator();
        const index = volume(ctx, 0, osc.frequency);
        mod.frequency.value = frequency * range(random, 2.006, 2.025);
        index.gain.setValueAtTime(
          frequency * (0.18 + 0.34 * options.shine),
          onset,
        );
        index.gain.exponentialRampToValueAtTime(
          0.01,
          onset + Math.min(0.26, hit.length),
        );
        mod.connect(index);
        nodes.push(index);
        start(mod, onset, stop + 0.01);
      }
      start(osc, onset, stop + 0.011);
    }
  }
  return {
    ended,
    cancel(when = ctx.currentTime) {
      group.gain.setTargetAtTime(0, when, 0.007);
      for (const source of sources) {
        try {
          source.stop(when + 0.04);
        } catch {}
      }
    },
  };
}

class Canopy {
  constructor(ctx, output, score, waves, random, at, shine, palette, patches) {
    this.ctx = ctx;
    this.waves = waves;
    this.random = random;
    this.shine = shine;
    this.score = score;
    this.palette = palette;
    this.patches = patches;
    this.nodes = [];
    this.sources = [];
    this.glints = new Set();
    const { openCutoffs, echo: room } = palette;
    this.gate = volume(ctx, 0, output);
    this.gate.gain.setTargetAtTime(1, at, palette.gateRamp);
    this.space = echo(
      ctx,
      this.gate,
      room.leftTime,
      room.rightTime,
      room.feedback,
      room.brightness,
    );
    this.padBus = volume(ctx, 1, this.gate);
    // The sparkle control also moves a shelf on longer bell tails; turning
    // it has an audible effect even between the scheduler’s next glints.
    this.glassBus = filter(ctx, "highshelf", 3100);
    this.glassBus.gain.value = this.shelf(shine);
    this.glassBus.connect(this.gate);
    this.nodes.push(this.padBus, this.glassBus);
    // The pad bus runs at unit gain, so a tremolo excursion is a fraction of
    // full level: ember's 0.22 swings the bed between 0.78 and 1.22 without
    // ever gating it shut. Palettes without tremolo add no LFO at all.
    if (palette.tremolo)
      this.modulate(
        this.padBus.gain,
        palette.tremolo.rate,
        palette.tremolo.depth,
        at,
      );
    // Two gently modulated, short delays add width without detuning the bass.
    for (const [side, ms, rate] of [
      [-0.69, 0.016, 0.17],
      [0.67, 0.024, 0.229],
    ]) {
      const delay = ctx.createDelay(0.06),
        speaker = pan(ctx, side);
      const mix = volume(ctx, 0.18, this.gate);
      delay.delayTime.value = ms;
      this.padBus.connect(delay).connect(speaker).connect(mix);
      this.modulate(delay.delayTime, rate, 0.0018, at);
      this.nodes.push(delay, speaker, mix);
    }
    const frame = score.current();
    this.bass = this.voice(
      palette.bassWave,
      frame.root,
      0.135,
      0,
      openCutoffs.bass,
      at,
      false,
    );
    this.bed = frame.bed.map((note, i) => {
      const { wave, level, pan: position } = palette.bedVoices[i];
      const voice = this.voice(
        wave,
        note,
        level,
        position,
        openCutoffs.bed,
        at,
        true,
      );
      // Both theme effects retune oscillators that already exist: the chorus
      // drifts them at three slightly different rates and a detune pair splits
      // them off-unison. Neither adds a bed voice or draws a random value.
      if (palette.chorus)
        this.modulate(
          voice.osc.detune,
          palette.chorus.rate * (1 + i * 0.13),
          palette.chorus.depthCents,
          at,
        );
      if (palette.detunePairs)
        voice.osc.detune.value = (i % 2 ? 1 : -1) * palette.detunePairs;
      return voice;
    });
    this.vineNote = frame.bed[2];
    this.vine = this.voice(
      "reed",
      this.vineNote,
      0.003,
      -0.12,
      openCutoffs.vine,
      at,
      true,
    );
    if (this.vine.speaker.pan)
      this.modulate(this.vine.speaker.pan, 0.041, 0.34, at);
    // The heartbeat bus exists only for themes that ship a pulse; no other
    // graph node and no scheduler event is added for the rest.
    if (palette.pulse) {
      this.pulseBus = volume(ctx, 1, this.gate);
      this.nodes.push(this.pulseBus);
    }
    this.apply(frame, at, true);
    this.vineAt = at + 0.36;
    this.glintAt = at + 0.43;
    if (palette.pulse) this.pulseAt = at + 60 / palette.pulse.bpm;
  }
  // The high shelf on the glint bus follows the same sparkle curve per theme.
  shelf(amount) {
    const { base, shine } = this.palette.glintShelf;
    return base + shine * amount;
  }
  modulate(param, rate, depth, at) {
    const mod = lfo(this.ctx, param, rate, depth, at);
    this.sources.push(mod.oscillator);
    this.nodes.push(mod.depth);
  }
  voice(wave, note, level, position, cutoff, at, chorused) {
    const ctx = this.ctx,
      random = this.random;
    const osc = ctx.createOscillator(),
      color = filter(ctx, "lowpass", cutoff, 0.82);
    const amp = volume(ctx, level),
      speaker = pan(ctx, position);
    osc.setPeriodicWave(this.waves[wave]);
    osc.frequency.value = hz(note);
    osc.detune.value = range(random, -3, 3);
    osc
      .connect(color)
      .connect(amp)
      .connect(speaker)
      .connect(chorused ? this.padBus : this.gate);
    osc.start(at);
    this.sources.push(osc);
    this.nodes.push(color, amp, speaker);
    if (chorused) {
      this.modulate(
        osc.detune,
        range(random, 0.067, 0.15),
        range(random, 2.5, 5.3),
        at,
      );
      this.modulate(
        color.frequency,
        range(random, 0.037, 0.09),
        range(random, 110, 260),
        at,
      );
    }
    if (level > 0.01)
      this.modulate(amp.gain, range(random, 0.039, 0.112), level * 0.22, at);
    return { osc, color, amp, speaker };
  }
  apply(frame, at, initial = false) {
    this.previous = this.frame;
    this.frame = frame;
    this.frameAt = at;
    this.changeAt = at + frame.seconds;
    if (!initial)
      this.bass.osc.frequency.setTargetAtTime(hz(frame.root), at, 0.32);
    const random = this.random;
    const { bassCutoff, bedCutoff } = this.palette;
    this.bass.color.frequency.setTargetAtTime(
      range(random, bassCutoff[0], bassCutoff[1]),
      at,
      0.82,
    );
    this.bed.forEach((voice, i) => {
      voice.osc.frequency.setTargetAtTime(
        hz(frame.bed[i]),
        at + i * 0.041,
        0.24 + 0.095 * i,
      );
      voice.color.frequency.setTargetAtTime(
        bedCutoff.base +
          this.shine * bedCutoff.shineGain +
          range(random, 0, bedCutoff.jitter),
        at,
        0.91,
      );
    });
  }
  setSparkle(amount) {
    this.shine = amount;
    const now = this.ctx.currentTime;
    const { base, gain, spread } = this.palette.bedSparkle;
    this.glassBus.gain.setTargetAtTime(this.shelf(amount), now, 0.12);
    this.bed.forEach((voice, i) =>
      voice.color.frequency.setTargetAtTime(
        base + gain * amount + i * spread,
        now,
        0.33,
      ),
    );
  }
  audible(at) {
    return this.previous && at < this.frameAt ? this.previous : this.frame;
  }
  ribbon(at) {
    const random = this.random;
    const vineCutoff = this.palette.vineCutoff;
    const candidates = [
      ...this.frame.bed.slice(1),
      ...this.frame.stars.map((n) => n - 12),
    ]
      .filter((n) => n !== this.vineNote)
      .sort(
        (a, b) => Math.abs(a - this.vineNote) - Math.abs(b - this.vineNote),
      );
    this.vineNote = pick(random, candidates.slice(0, 4)) ?? this.frame.bed[2];
    const duration = range(random, 1.18, 2.84),
      glide = range(random, 0.14, 0.54);
    const voice = this.vine;
    voice.osc.frequency.setTargetAtTime(hz(this.vineNote), at, glide);
    voice.color.frequency.setTargetAtTime(
      range(random, vineCutoff.low, vineCutoff.high) +
        vineCutoff.shineGain * this.shine,
      at,
      0.29,
    );
    voice.amp.gain.setTargetAtTime(range(random, 0.035, 0.07), at, 0.24);
    voice.amp.gain.setTargetAtTime(0.0035, at + duration * 0.63, 0.27);
    this.vineAt = at + duration;
  }
  stars(at) {
    const random = this.random,
      shimmer = this.shine,
      { glintVoice, glintStrength, glintRate } = this.palette;
    // The twinkle rhythm is the theme's: reef spacing leaves silence between
    // glints, vapor sparkles twice as fast, ember ticks. Same single draw.
    this.glintAt =
      at +
      range(random, glintRate.min, glintRate.max) /
        (glintRate.base + glintRate.shineGain * shimmer);
    if (shimmer <= 0.001) return;
    const candidates = this.frame.stars;
    const note = pick(random, candidates);
    const noteHit = (at, pitch, strength) => ({
      at,
      notes: [pitch],
      length: range(random, 0.32, 0.71),
      voice: glintVoice,
      strength: strength * glintStrength,
    });
    const hits = [noteHit(0, note, 0.34 + 0.38 * shimmer)];
    if (random() < 0.27 + 0.42 * shimmer) {
      const rest = candidates.filter((n) => n !== note);
      hits.push(
        noteHit(
          range(random, 0.13, 0.3),
          pick(random, rest),
          0.3 + 0.17 * shimmer,
        ),
      );
    }
    const glint = phrase(
      this.ctx,
      this.waves,
      random,
      hits,
      at,
      this.glassBus,
      this.space.input,
      {
        level: 0.16 + 0.32 * shimmer,
        wet: 0.49,
        pan: range(random, -0.58, 0.58),
        shine: shimmer,
        patches: this.patches,
      },
    );
    this.glints.add(glint);
    glint.ended.then(() => this.glints.delete(glint));
  }
  // One heartbeat thump of the theme's pulse wave on the frame's bass note.
  // It draws no random value, which keeps every other theme's event order
  // identical, and the osc releases itself once the thump has decayed.
  beat(at, pressure) {
    const { bpm, wave, level, offset } = this.palette.pulse;
    // tensionLift is optional: a pulse block without it must not produce NaN
    // gain on a pressure hit.
    const lift = this.palette.pulse.tensionLift ?? 0;
    const ctx = this.ctx;
    const osc = ctx.createOscillator(),
      amp = volume(ctx, floor, this.pulseBus);
    osc.setPeriodicWave(this.waves[wave]);
    osc.frequency.value = hz(this.frame.root + offset);
    osc.connect(amp);
    const peak = level * (pressure ? 1 + lift : 1);
    amp.gain.setValueAtTime(floor, at);
    amp.gain.exponentialRampToValueAtTime(peak, at + 0.004);
    amp.gain.exponentialRampToValueAtTime(floor, at + 0.19);
    osc.onended = () => {
      osc.disconnect();
      amp.disconnect();
    };
    osc.start(at);
    osc.stop(at + 0.24);
    this.pulseAt = at + 60 / bpm;
  }
  schedule(through, pressure) {
    // Audio time drives all attacks. A backgrounded tab or busy worker must
    // never replay a pile of overdue events when the UI thread returns.
    const now = this.ctx.currentTime;
    // A palette without a pulse never grows this field, so the alley canopy
    // schedules exactly the three original events.
    const upcoming = ["changeAt", "vineAt", "glintAt"];
    if (this.pulseAt !== undefined) upcoming.push("pulseAt");
    for (const field of upcoming) {
      if (this[field] < now - 0.12) this[field] = now + 0.018;
    }
    for (;;) {
      // First field in list order wins a tie, matching the old else-if chain.
      let at = Infinity,
        due;
      for (const field of upcoming)
        if (this[field] < at) {
          at = this[field];
          due = field;
        }
      if (at > through) return;
      if (due === "changeAt") this.apply(this.score.next(pressure), at);
      else if (due === "vineAt") this.ribbon(at);
      else if (due === "glintAt") this.stars(at);
      else this.beat(at, pressure);
    }
  }
  stop() {
    const now = this.ctx.currentTime;
    this.gate.gain.cancelScheduledValues(now);
    this.gate.gain.setTargetAtTime(0, now, 0.021);
    for (const glint of this.glints) glint.cancel(now);
    // Audio time can be suspended immediately after muting. Disconnecting in
    // wall time also releases delay feedback loops when the device locks.
    for (const osc of this.sources) {
      try {
        osc.stop(now + 0.1);
      } catch {}
    }
    setTimeout(() => {
      for (const n of [...this.nodes, ...this.sources, this.gate])
        n.disconnect();
      this.space.close();
    }, 125);
  }
}

// --- engines ------------------------------------------------------------
// The four themes no longer differ by knob values on one machine. Each engine
// below is its own machine, and `palette.engine` picks it. Every engine takes
// the same nine arguments and answers the same four calls, because TableSynth
// builds them all through one path (startAmbient) and ArcadeMixer only ever
// calls schedule, harmony, setSparkle, startAmbient and stopAmbient.
//
// What each engine reads from a palette, besides `engine`:
//   ambient — the whole shared field set (the original alley instrument).
//   bloom   — bedVoices, bassWave, bassCutoff, bedCutoff, openCutoffs, chorus,
//             glintVoice/Strength/Shelf, echo, gateRamp, cuePatches, `bloom`.
//   abyss   — bedVoices, bassWave, bedCutoff, openCutoffs, detunePairs,
//             glintVoice/Strength/Shelf, pulse, echo, gateRamp, cuePatches,
//             `abyss`.
//   pulse   — bassWave, glintShelf, tremolo, echo, gateRamp, cuePatches,
//             `groove`.
// A field an engine does not read stays in the registry as that theme's
// vocabulary rather than being deleted from a live sound mid-redesign.

const shelfLevel = (palette, amount) =>
  palette.glintShelf.base + palette.glintShelf.shine * amount;

// One shaped noise buffer per canopy, built from the canopy's own random so a
// seeded synth replays it exactly. The bloom engine loops it as surf; the
// groove engine slices it for hats. It is never regenerated per event.
function noiseBuffer(ctx, random, seconds) {
  const frames = Math.max(1, Math.round(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, frames, ctx.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    // A one-pole lowpass on white noise: surf, not hiss. Each channel walks its
    // own path so the panner hears depth, not a doubled mono source.
    let value = 0;
    for (let i = 0; i < frames; i++) {
      value += 0.09 * (random() * 2 - 1 - value);
      data[i] = value * 2.4;
    }
  }
  return buffer;
}

// Release one event's nodes when its last source ends. A swell, a stack and a
// bass hit all clean up the same way, so a long session never accumulates dead
// graph nodes behind the running graph.
function settle(sources, nodes, done) {
  let live = sources.length;
  for (const source of sources) {
    source.onended = () => {
      source.disconnect();
      if (--live) return;
      for (const node of nodes) node.disconnect();
      done();
    };
  }
}

// Slow crossfading pad stacks over a breathing surf. A chord change starts a
// stack that swells in over ~1.5s while the one it replaces bleeds away over
// ~3s, so the harmony dissolves instead of stepping. There is no vine, no
// heartbeat and no rhythm: the only event is a rare soft glint.
class BloomCanopy {
  constructor(ctx, output, score, waves, random, at, shine, palette, patches) {
    this.ctx = ctx;
    this.waves = waves;
    this.random = random;
    this.shine = shine;
    this.score = score;
    this.palette = palette;
    this.patches = patches;
    this.nodes = new Set();
    this.sources = new Set();
    this.glints = new Set();
    this.stacks = [];
    this.pressure = false;
    const { echo: room, bloom } = palette;
    this.gate = volume(ctx, 0, output);
    this.gate.gain.setTargetAtTime(1, at, palette.gateRamp);
    this.space = echo(
      ctx,
      this.gate,
      room.leftTime,
      room.rightTime,
      room.feedback,
      room.brightness,
    );
    this.padBus = volume(ctx, 1, this.gate);
    this.glassBus = filter(ctx, "highshelf", 3100);
    this.glassBus.gain.value = shelfLevel(palette, shine);
    this.glassBus.connect(this.gate);
    for (const node of [this.padBus, this.glassBus]) this.nodes.add(node);
    this.surf(bloom.surf, at);
    const frame = score.current();
    this.frame = frame;
    this.frameAt = at;
    this.changeAt = at + this.hold(frame);
    this.stacks.push(this.stack(frame, at));
    this.glintAt = at + range(random, bloom.glint.min, bloom.glint.max);
  }
  // The surf: one looping noise buffer through a lowpass that breathes with a
  // very slow LFO. Continuous by construction, never an event.
  surf(spec, at) {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx, this.random, spec.seconds);
    source.loop = true;
    const color = filter(ctx, "lowpass", spec.cutoff, 0.6);
    const amp = volume(ctx, spec.level);
    const speaker = pan(ctx, spec.pan);
    source.connect(color).connect(amp).connect(speaker).connect(this.gate);
    const breath = lfo(ctx, color.frequency, spec.rate, spec.sway, at);
    source.start(at);
    this.surfColor = color;
    this.surfAmp = amp;
    this.sources.add(source);
    this.sources.add(breath.oscillator);
    for (const node of [color, amp, speaker, breath.depth])
      this.nodes.add(node);
  }
  // How long one score frame is held before the stacks cross once more. The
  // dwell is what makes a 5s frame read as a 7-10s chord.
  hold(frame) {
    return frame.seconds + this.palette.bloom.dwell;
  }
  stack(frame, at) {
    const ctx = this.ctx,
      random = this.random;
    const {
      bedVoices,
      bassWave,
      bassCutoff,
      bedCutoff,
      openCutoffs,
      chorus,
      bloom,
    } = this.palette;
    const bus = volume(ctx, floor, this.padBus),
      color = filter(ctx, "lowpass", openCutoffs.bed, 0.74);
    color.connect(bus);
    bus.gain.setValueAtTime(floor, at);
    bus.gain.exponentialRampToValueAtTime(1, at + bloom.attack);
    const sources = [],
      nodes = [bus, color];
    const sway = lfo(ctx, color.frequency, bloom.drift, bloom.sway, at);
    nodes.push(sway.depth);
    sources.push(sway.oscillator);
    color.frequency.setTargetAtTime(
      bedCutoff.base +
        bedCutoff.shineGain * this.shine +
        range(random, 0, bedCutoff.jitter),
      at,
      0.9,
    );
    const specs = [
      {
        wave: bassWave,
        note: frame.root,
        level: bloom.rootLevel,
        pan: 0,
      },
      ...bedVoices.map((voice, i) => ({
        wave: voice.wave,
        note: frame.bed[i],
        level: voice.level,
        pan: voice.pan,
      })),
    ];
    for (const [i, spec] of specs.entries()) {
      const osc = ctx.createOscillator(),
        amp = volume(ctx, spec.level),
        speaker = pan(ctx, spec.pan);
      osc.setPeriodicWave(this.waves[spec.wave]);
      osc.frequency.value = hz(spec.note);
      osc.detune.value = range(random, -3, 3);
      // The root keeps the palette's own bass band, so the sub stays round
      // under a stack colour that is opened wide for the bed.
      if (i) osc.connect(amp);
      else {
        const body = filter(ctx, "lowpass", range(random, ...bassCutoff), 0.8);
        osc.connect(body).connect(amp);
        nodes.push(body);
      }
      amp.connect(speaker).connect(color);
      osc.start(at);
      nodes.push(amp, speaker);
      sources.push(osc);
      // The bed keeps the palette's chorus drift; the root stays dry so the
      // sub never beats against itself.
      if (chorus && i) {
        const drift = lfo(
          ctx,
          osc.detune,
          chorus.rate * (1 + i * 0.13),
          chorus.depthCents,
          at,
        );
        nodes.push(drift.depth);
        sources.push(drift.oscillator);
      }
    }
    for (const source of sources) this.sources.add(source);
    for (const node of nodes) this.nodes.add(node);
    settle(sources, nodes, () => {
      for (const source of sources) this.sources.delete(source);
      for (const node of nodes) this.nodes.delete(node);
    });
    return {
      brighten: (amount) =>
        color.frequency.setTargetAtTime(
          bedCutoff.base + bedCutoff.shineGain * amount,
          this.ctx.currentTime,
          0.6,
        ),
      release: (when) => {
        bus.gain.cancelScheduledValues(when);
        bus.gain.setValueAtTime(1, when);
        bus.gain.exponentialRampToValueAtTime(floor, when + bloom.release);
        for (const source of sources) {
          try {
            source.stop(when + bloom.release + 0.05);
          } catch {}
        }
      },
    };
  }
  crossfade(at) {
    const frame = this.score.next(this.pressure);
    this.previous = this.frame;
    this.frame = frame;
    this.frameAt = at;
    for (const stack of this.stacks) stack.release(at);
    this.stacks = [this.stack(frame, at)];
    this.changeAt = at + this.hold(frame);
  }
  // A knock lifts the surf by a third and pulls the next crossfade closer.
  respond(pressure, now) {
    if (pressure === this.pressure) return;
    this.pressure = pressure;
    const { surf, pressure: response } = this.palette.bloom;
    this.surfAmp.gain.setTargetAtTime(
      surf.level * (pressure ? 1 + response.surfLift : 1),
      now,
      1.4,
    );
    const remaining = this.changeAt - now;
    if (pressure && remaining > 0)
      this.changeAt = now + remaining * response.hasten;
  }
  glint(at) {
    const random = this.random,
      { glint } = this.palette.bloom,
      { glintVoice, glintStrength } = this.palette;
    this.glintAt = at + range(random, glint.min, glint.max);
    if (this.shine <= 0.001) return;
    const note = pick(random, this.frame.stars);
    const hit = phrase(
      this.ctx,
      this.waves,
      random,
      [
        {
          at: 0,
          notes: [note],
          length: range(random, 0.5, 1.1),
          voice: glintVoice,
          strength: glint.strength * (0.5 + 0.7 * this.shine) * glintStrength,
        },
      ],
      at,
      this.glassBus,
      this.space.input,
      {
        level: glint.level,
        wet: 0.6,
        pan: range(random, -0.6, 0.6),
        shine: this.shine,
        patches: this.patches,
      },
    );
    this.glints.add(hit);
    hit.ended.then(() => this.glints.delete(hit));
  }
  setSparkle(amount) {
    this.shine = amount;
    const now = this.ctx.currentTime,
      { surf } = this.palette.bloom;
    this.glassBus.gain.setTargetAtTime(
      shelfLevel(this.palette, amount),
      now,
      0.12,
    );
    this.surfColor.frequency.setTargetAtTime(
      surf.cutoff + surf.brighten * amount,
      now,
      0.6,
    );
    for (const stack of this.stacks) stack.brighten(amount);
  }
  audible(at) {
    return this.previous && at < this.frameAt ? this.previous : this.frame;
  }
  schedule(through, pressure) {
    const now = this.ctx.currentTime;
    this.respond(pressure, now);
    for (const field of ["changeAt", "glintAt"])
      if (this[field] < now - 0.12) this[field] = now + 0.018;
    for (;;) {
      const at = Math.min(this.changeAt, this.glintAt);
      if (at > through) return;
      if (at === this.changeAt) this.crossfade(at);
      else this.glint(at);
    }
  }
  stop() {
    const now = this.ctx.currentTime;
    this.gate.gain.cancelScheduledValues(now);
    this.gate.gain.setTargetAtTime(0, now, 0.021);
    for (const glint of this.glints) glint.cancel(now);
    for (const source of this.sources) {
      try {
        source.stop(now + 0.1);
      } catch {}
    }
    setTimeout(() => {
      for (const node of [...this.nodes, this.gate]) node.disconnect();
      this.space.close();
    }, 125);
  }
}

// Mostly silence. One low chord swells out of the dark every 6-11s with a slow
// attack and a very long decay, and the dark echo carries the tail. Between
// swells only the 46bpm throb moves; a distant ping lands every few swells.
// The character is restraint: one sounding event at a time, plus the throb.
class AbyssCanopy {
  constructor(ctx, output, score, waves, random, at, shine, palette, patches) {
    this.ctx = ctx;
    this.waves = waves;
    this.random = random;
    this.shine = shine;
    this.score = score;
    this.palette = palette;
    this.patches = patches;
    this.nodes = new Set();
    this.sources = new Set();
    this.glints = new Set();
    this.pressure = false;
    this.lift = 1;
    const { echo: room, abyss, pulse } = palette;
    this.gate = volume(ctx, 0, output);
    this.gate.gain.setTargetAtTime(1, at, palette.gateRamp);
    this.space = echo(
      ctx,
      this.gate,
      room.leftTime,
      room.rightTime,
      room.feedback,
      room.brightness,
    );
    this.swellBus = volume(ctx, 1, this.gate);
    this.pulseBus = volume(ctx, 1, this.gate);
    for (const node of [this.swellBus, this.pulseBus]) this.nodes.add(node);
    const frame = score.current();
    this.frame = frame;
    this.frameAt = at;
    this.swellAt = at + abyss.first;
    this.pulseAt = at + 60 / pulse.bpm;
    this.pingAt = Infinity;
    this.swells = 0;
    this.pingEvery = this.pingGap();
  }
  pingGap() {
    const [low, high] = this.palette.abyss.ping.every;
    return low + Math.floor(this.random() * (high - low + 1));
  }
  swell(at) {
    const ctx = this.ctx,
      random = this.random;
    const {
      abyss,
      bassWave,
      bedVoices,
      bedCutoff,
      openCutoffs,
      detunePairs,
    } = this.palette;
    const frame = this.score.next(this.pressure);
    this.previous = this.frame;
    this.frame = frame;
    this.frameAt = at;
    const attack = range(random, ...abyss.attack),
      decay = range(random, ...abyss.decay),
      level = abyss.level * this.lift;
    // The lift belongs to this one swell; the next opens at the palette level.
    this.lift = 1;
    const body = volume(ctx, floor, this.swellBus),
      dark = filter(ctx, "lowpass", openCutoffs.bass, 0.92);
    dark.connect(body);
    body.gain.setValueAtTime(floor, at);
    body.gain.exponentialRampToValueAtTime(level, at + attack);
    body.gain.exponentialRampToValueAtTime(floor, at + attack + decay);
    const cutoff = Math.max(
      120,
      bedCutoff.base * 0.62 + bedCutoff.shineGain * this.shine * 0.4,
    );
    dark.frequency.setValueAtTime(
      openCutoffs.bass * (1 + 0.35 * this.shine),
      at,
    );
    dark.frequency.exponentialRampToValueAtTime(
      cutoff,
      at + attack + decay * 0.7,
    );
    const specs = [
      [bassWave, frame.root, abyss.rootLevel, 0],
      ...bedVoices.map((voice, i) => [
        voice.wave,
        frame.bed[i],
        voice.level * abyss.bedTrim,
        voice.pan,
      ]),
    ];
    const sources = [],
      nodes = [body, dark],
      stop = at + attack + decay + 0.08;
    for (const [i, [wave, note, gain, position]] of specs.entries()) {
      const osc = ctx.createOscillator(),
        amp = volume(ctx, gain),
        speaker = pan(ctx, position);
      osc.setPeriodicWave(this.waves[wave]);
      osc.frequency.value = hz(note);
      // Reef splits its chord off-unison; every other engine jitters instead.
      osc.detune.value = detunePairs
        ? (i % 2 ? 1 : -1) * detunePairs
        : range(random, -3, 3);
      osc.connect(amp).connect(speaker).connect(dark);
      osc.start(at);
      osc.stop(stop);
      nodes.push(amp, speaker);
      sources.push(osc);
    }
    for (const source of sources) this.sources.add(source);
    for (const node of nodes) this.nodes.add(node);
    settle(sources, nodes, () => {
      for (const source of sources) this.sources.delete(source);
      for (const node of nodes) this.nodes.delete(node);
    });
    this.swells++;
    if (this.swells >= this.pingEvery) {
      this.swells = 0;
      this.pingEvery = this.pingGap();
      this.pingAt = at + range(random, ...abyss.ping.delay);
    }
    // Restraint: the next swell never starts inside this one's tail, so the
    // reef is silent between swells even when the draw is short and the decay
    // is long (1.4 + 7 + 0.4 is still inside the 6-11s window).
    this.swellAt =
      at + Math.max(range(random, ...abyss.every), attack + decay + 0.4);
  }
  // The distant ping: one note of the swell that just passed, very quiet, in
  // the theme's own ping voice.
  ping(at) {
    const { ping } = this.palette.abyss,
      { glintVoice, glintStrength } = this.palette;
    this.pingAt = Infinity;
    if (this.shine <= 0.001) return;
    const note = pick(this.random, this.frame.stars);
    const hit = phrase(
      this.ctx,
      this.waves,
      this.random,
      [
        {
          at: 0,
          notes: [note],
          length: range(this.random, 0.6, 1.2),
          voice: glintVoice,
          strength: ping.strength * (0.6 + 0.5 * this.shine) * glintStrength,
        },
      ],
      at,
      this.gate,
      this.space.input,
      {
        level: ping.level,
        wet: 0.72,
        pan: range(this.random, -0.7, 0.7),
        shine: this.shine,
        patches: this.patches,
      },
    );
    this.glints.add(hit);
    hit.ended.then(() => this.glints.delete(hit));
  }
  // The throb: one sub hit on the frame root, felt more than heard.
  beat(at) {
    const { bpm, wave, level, offset } = this.palette.pulse;
    const ctx = this.ctx;
    const osc = ctx.createOscillator(),
      amp = volume(ctx, floor, this.pulseBus);
    osc.setPeriodicWave(this.waves[wave]);
    osc.frequency.value = hz(this.frame.root + offset);
    osc.connect(amp);
    amp.gain.setValueAtTime(floor, at);
    amp.gain.exponentialRampToValueAtTime(level, at + 0.005);
    amp.gain.exponentialRampToValueAtTime(floor, at + 0.21);
    osc.onended = () => {
      osc.disconnect();
      amp.disconnect();
    };
    osc.start(at);
    osc.stop(at + 0.26);
    this.pulseAt = at + 60 / bpm;
  }
  // A knock halves the wait for the next swell and makes it a quarter louder.
  respond(pressure, now) {
    if (pressure === this.pressure) return;
    this.pressure = pressure;
    if (!pressure) return;
    const response = this.palette.abyss.pressure;
    this.lift = response.lift;
    const remaining = this.swellAt - now;
    if (remaining > 0) this.swellAt = now + remaining * response.hasten;
  }
  // Sparkle reaches the reef through the next swell's brightness and the ping,
  // both read when they are scheduled rather than retuned in place.
  setSparkle(amount) {
    this.shine = amount;
  }
  audible(at) {
    return this.previous && at < this.frameAt ? this.previous : this.frame;
  }
  schedule(through, pressure) {
    const now = this.ctx.currentTime;
    this.respond(pressure, now);
    for (const field of ["swellAt", "pulseAt", "pingAt"])
      if (this[field] < now - 0.12) this[field] = now + 0.018;
    for (;;) {
      let at = Infinity,
        due;
      for (const field of ["swellAt", "pulseAt", "pingAt"])
        if (this[field] < at) {
          at = this[field];
          due = field;
        }
      if (at > through) return;
      if (due === "swellAt") this.swell(at);
      else if (due === "pulseAt") this.beat(at);
      else this.ping(at);
    }
  }
  stop() {
    const now = this.ctx.currentTime;
    this.gate.gain.cancelScheduledValues(now);
    this.gate.gain.setTargetAtTime(0, now, 0.021);
    for (const glint of this.glints) glint.cancel(now);
    for (const source of this.sources) {
      try {
        source.stop(now + 0.1);
      } catch {}
    }
    setTimeout(() => {
      for (const node of [...this.nodes, this.gate]) node.disconnect();
      this.space.close();
    }, 125);
  }
}

// The groove is the pulse. An eighth-note ostinato on the frame root with
// alternating octave accents, offbeat chord stabs on the second half of every
// second bar, and a noise tick on every eighth. The grid re-voices when the
// harmony moves. There is no pad bed and no separate heartbeat.
class PulseCanopy {
  constructor(ctx, output, score, waves, random, at, shine, palette, patches) {
    this.ctx = ctx;
    this.waves = waves;
    this.random = random;
    this.shine = shine;
    this.score = score;
    this.palette = palette;
    this.patches = patches;
    this.nodes = new Set();
    this.sources = new Set();
    this.stabs = new Set();
    this.pressure = false;
    this.hatScale = 0.6 + 0.8 * shine;
    const { echo: room, groove } = palette;
    this.gate = volume(ctx, 0, output);
    this.gate.gain.setTargetAtTime(1, at, palette.gateRamp);
    this.space = echo(
      ctx,
      this.gate,
      room.leftTime,
      room.rightTime,
      room.feedback,
      room.brightness,
    );
    this.bassBus = volume(ctx, 1, this.gate);
    this.stabBus = volume(ctx, 1, this.gate);
    this.hatBus = volume(ctx, 1, this.gate);
    for (const node of [this.bassBus, this.stabBus, this.hatBus])
      this.nodes.add(node);
    if (palette.tremolo)
      this.modulate(
        this.stabBus.gain,
        palette.tremolo.rate,
        palette.tremolo.depth,
        at,
      );
    this.noise = noiseBuffer(ctx, random, groove.noise);
    this.frame = score.current();
    this.frameAt = at;
    this.eighth = 60 / groove.bpm / 2;
    this.cycle = groove.bars * 8;
    this.stepIndex = 0;
    this.nextStepAt = at + this.eighth;
  }
  modulate(param, rate, depth, at) {
    const mod = lfo(this.ctx, param, rate, depth, at);
    this.sources.add(mod.oscillator);
    this.nodes.add(mod.depth);
  }
  // One bass hit of the ostinato. The pattern entry names its interval over the
  // frame root and its octave accent; the level varies per hit, which draws a
  // random value this engine is free to use.
  bass(at, index, pressure) {
    const groove = this.palette.groove,
      [offset, octave] = groove.pattern[index];
    const accent = pressure && (index === 0 || index === 4) ? 12 : 0;
    const ctx = this.ctx;
    const osc = ctx.createOscillator(),
      body = filter(
        ctx,
        "lowpass",
        groove.cutoff + groove.brighten * this.shine,
        0.9,
      ),
      amp = volume(ctx, floor, this.bassBus);
    osc.setPeriodicWave(this.waves[this.palette.bassWave]);
    osc.frequency.value = hz(this.frame.root + offset + octave + accent);
    osc.detune.value = range(this.random, -4, 4);
    osc.connect(body).connect(amp);
    amp.gain.setValueAtTime(floor, at);
    amp.gain.exponentialRampToValueAtTime(
      groove.level * range(this.random, ...groove.swing),
      at + groove.attack,
    );
    amp.gain.exponentialRampToValueAtTime(floor, at + groove.length);
    osc.onended = () => {
      osc.disconnect();
      body.disconnect();
      amp.disconnect();
    };
    osc.start(at);
    osc.stop(at + groove.length + 0.02);
  }
  // One noise tick, sliced from the buffer the canopy built at start-up.
  tick(at, level, position) {
    const ctx = this.ctx,
      hat = this.palette.groove.hat;
    const source = ctx.createBufferSource(),
      high = filter(ctx, "highpass", hat.cutoff, 0.86),
      amp = volume(ctx, floor, this.hatBus),
      speaker = pan(ctx, position);
    source.buffer = this.noise;
    source.connect(high).connect(amp).connect(speaker).connect(this.hatBus);
    amp.gain.setValueAtTime(floor, at);
    amp.gain.exponentialRampToValueAtTime(level * this.hatScale, at + 0.002);
    amp.gain.exponentialRampToValueAtTime(floor, at + hat.length);
    source.onended = () => {
      source.disconnect();
      high.disconnect();
      amp.disconnect();
      speaker.disconnect();
    };
    const offset = range(this.random, 0, this.palette.groove.noise - 0.12);
    source.start(at, offset, hat.length + 0.01);
  }
  // An offbeat chord stab: three voices of the frame bed in the cue patch.
  stab(at) {
    const stab = this.palette.groove.stab;
    const hit = phrase(
      this.ctx,
      this.waves,
      this.random,
      [
        {
          at: 0,
          notes: this.frame.bed.slice(0, 3),
          length: range(this.random, ...stab.length),
          voice: stab.voice,
          strength: stab.strength,
        },
      ],
      at,
      this.stabBus,
      this.space.input,
      {
        level: 0.62,
        wet: 0.18,
        pan: range(this.random, -0.34, 0.34),
        shine: this.shine,
        patches: this.patches,
      },
    );
    this.stabs.add(hit);
    hit.ended.then(() => this.stabs.delete(hit));
  }
  revoice(at) {
    this.previous = this.frame;
    this.frame = this.score.next(this.pressure);
    this.frameAt = at;
  }
  step(at, pressure) {
    const groove = this.palette.groove;
    const index = this.stepIndex % 8,
      bar = Math.floor(this.stepIndex / 8);
    if (this.stepIndex && this.stepIndex % this.cycle === 0) this.revoice(at);
    this.bass(at, index, pressure);
    this.tick(at, groove.hat.levels[index % 2], groove.hat.pan[index % 2]);
    // Double-time hats and an octave lift on the downbeats while a knock bites.
    if (pressure)
      this.tick(
        at + this.eighth / 2,
        groove.hat.levels[(index + 1) % 2],
        groove.hat.pan[(index + 1) % 2],
      );
    if (bar % groove.stab.every === 0 && (index === 3 || index === 7))
      this.stab(at);
    this.stepIndex++;
    this.nextStepAt = at + this.eighth;
  }
  setSparkle(amount) {
    this.shine = amount;
    // Sparkle is the hat presence and the bass colour, not a pad shelf: this
    // engine has no pad bus to open.
    this.hatScale = 0.6 + 0.8 * amount;
  }
  audible(at) {
    return this.previous && at < this.frameAt ? this.previous : this.frame;
  }
  schedule(through, pressure) {
    const now = this.ctx.currentTime;
    this.pressure = pressure;
    if (this.nextStepAt < now - 0.12) this.nextStepAt = now + 0.018;
    while (this.nextStepAt <= through) this.step(this.nextStepAt, pressure);
  }
  stop() {
    const now = this.ctx.currentTime;
    this.gate.gain.cancelScheduledValues(now);
    this.gate.gain.setTargetAtTime(0, now, 0.021);
    for (const stab of this.stabs) stab.cancel(now);
    for (const source of this.sources) {
      try {
        source.stop(now + 0.1);
      } catch {}
    }
    setTimeout(() => {
      for (const node of [...this.nodes, this.gate]) node.disconnect();
      this.space.close();
    }, 125);
  }
}

// Which machine plays a palette. An unknown engine id keeps the ambient
// canopy, mirroring resolvePalette's fallback to alley.
export const ENGINES = Object.freeze({
  ambient: Canopy,
  bloom: BloomCanopy,
  abyss: AbyssCanopy,
  pulse: PulseCanopy,
});

export function resolveEngine(palette) {
  const id = palette?.engine;
  return (id && Object.hasOwn(ENGINES, id) ? ENGINES[id] : ENGINES.ambient);
}

// The browser clock and OfflineAudioContext use the same score, envelopes,
// oscillators and mix. The player only has to keep the short horizon fed.
export class TableSynth {
  constructor(
    ctx,
    destination,
    { random = Math.random, sparkle = 0.78, theme = fallbackTheme } = {},
  ) {
    this.ctx = ctx;
    this.random = random;
    this.waves = initWaves(ctx);
    this.theme = resolveThemeId(theme);
    this.score = createScore(random, this.theme);
    this.palette = resolvePalette(this.theme);
    this.patches = soundPatches(this.palette);
    this.sparkle = sparkle;
    this.tension = false;
    this.knockUntil = 0;
    this.effects = new Set();
    this.musicBus = volume(ctx, 0.64, destination);
    this.fxBus = volume(ctx, 0.91, destination);
    this.fxSpace = echo(ctx, this.fxBus, 0.109, 0.183, 0.2, 5200);
    this.nextQuietChange = ctx.currentTime + this.score.current().seconds;
  }
  startAmbient(at = this.ctx.currentTime + 0.018) {
    if (!this.canopy) {
      const Engine = resolveEngine(this.palette);
      this.canopy = new Engine(
        this.ctx,
        this.musicBus,
        this.score,
        this.waves,
        this.random,
        at,
        this.sparkle,
        this.palette,
        this.patches,
      );
    }
  }
  schedule(through) {
    this.canopy?.schedule(
      through,
      this.tension || this.knockUntil > this.ctx.currentTime,
    );
  }
  harmony(at = this.ctx.currentTime) {
    return this.canopy?.audible(at) ?? this.score.current();
  }
  setSparkle(amount) {
    this.sparkle = limit(amount, 0, 1);
    this.canopy?.setSparkle(this.sparkle);
  }
  // The score is pure data, so a theme swap only restarts the canopy that
  // reads it. stopAmbient fades the old voices out and releases their nodes.
  setTheme(theme) {
    const next = resolveThemeId(theme);
    if (next === this.theme) return;
    this.theme = next;
    this.palette = resolvePalette(next);
    this.patches = soundPatches(this.palette);
    this.stopAmbient();
    this.score = createScore(this.random, next);
    this.nextQuietChange = this.ctx.currentTime + this.score.current().seconds;
  }
  play(
    name,
    { at = this.ctx.currentTime + 0.009, position = 0, preview = false } = {},
  ) {
    if (!this.canopy && at >= this.nextQuietChange) {
      this.score.next(this.tension);
      this.nextQuietChange = at + this.score.current().seconds;
    }
    const strikes = this.score.cue(name, this.harmony(at));
    if (!strikes.length) return Promise.resolve();
    if (preview) this.audition?.cancel();
    else if (name === "knock") this.knockUntil = at + 7.5;
    else if (["blitz", "win", "lose", "safe", "deal"].includes(name))
      this.knockUntil = 0;
    // Keep pathological bursts from room sync or very fast touch input bounded.
    if (this.effects.size >= 9) {
      const oldest = this.effects.values().next().value;
      oldest.cancel();
      this.effects.delete(oldest);
    }
    const group = phrase(
      this.ctx,
      this.waves,
      this.random,
      strikes,
      at,
      this.fxBus,
      this.fxSpace.input,
      {
        level: name === "ui" ? 0.68 : 1,
        wet: name === "throw" ? 0.026 : name === "ui" ? 0.06 : 0.16,
        pan: limit(position, -0.78, 0.78),
        shine: this.sparkle,
        dry: name === "throw",
        patches: this.patches,
      },
    );
    this.effects.add(group);
    if (preview) this.audition = group;
    if (this.canopy) {
      const accent = ["knock", "win", "blitz", "lose", "safe"].includes(name);
      const duck = this.musicBus.gain;
      // Keep current level on browsers with hold support. Fallback retains
      // the current target; no linear ramp is interrupted mid-flight.
      if (duck.cancelAndHoldAtTime) duck.cancelAndHoldAtTime(at);
      else duck.cancelScheduledValues(at);
      duck.setTargetAtTime(accent ? 0.43 : 0.55, at, 0.018);
      const end = Math.max(...strikes.map((s) => s.at + s.length));
      duck.setTargetAtTime(0.64, at + end * 0.76, 0.21);
    }
    return group.ended.then(() => {
      this.effects.delete(group);
      if (this.audition === group) this.audition = null;
    });
  }
  stopAmbient() {
    if (!this.canopy) return;
    this.canopy.stop();
    this.canopy = null;
    this.nextQuietChange = this.ctx.currentTime + this.score.current().seconds;
  }
  quiet() {
    this.stopAmbient();
    for (const group of this.effects) group.cancel();
    this.effects.clear();
    this.audition = null;
  }
  close() {
    this.quiet();
    this.fxSpace.close();
    this.fxBus.disconnect();
    this.musicBus.disconnect();
  }
}

// The default id, exported so settings defaults never re-spell it.
TableSynth.defaultTheme = fallbackTheme;
