import { createScore } from "./night-score.mjs";

const hz = (note) => 440 * 2 ** ((note - 69) / 12);
const range = (random, low, high) => low + random() * (high - low);
const pick = (random, notes) => notes[Math.floor(random() * notes.length)];
const limit = (n, low, high) => Math.max(low, Math.min(high, n));
const floor = 0.0001;

// These spectra give the rack distinct instruments before filtering or FM.
// The bass's upper harmonics carry the pitch on a phone speaker.
const partials = {
  bass: [1, 0.44, 0.27, 0.07, 0.09, 0.02],
  pad: [1, 0.48, 0.26, 0.17, 0.11, 0.07, 0.045, 0.028, 0.022],
  reed: [1, 0.19, 0.37, 0.1, 0.24, 0.045, 0.09, 0.032, 0.04],
  pluck: [1, 0.61, 0.31, 0.24, 0.15, 0.1, 0.082, 0.059, 0.046, 0.033, 0.02],
  glass: [1, 0.29, 0.46, 0.053, 0.18, 0.09, 0.026, 0.075, 0.015, 0.03],
};
function initWaves(ctx) {
  return Object.fromEntries(
    Object.entries(partials).map(([name, spectrum]) => {
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

const patches = {
  bass: { attack: 0.015, cutoff: 1390, sustain: 0.59, tail: 0.08 },
  pluck: { attack: 0.005, cutoff: 5300, sustain: 0.23, tail: 0.06 },
  reed: { attack: 0.016, cutoff: 3550, sustain: 0.58, tail: 0.105 },
  glass: { attack: 0.006, cutoff: 8150, sustain: 0.27, tail: 0.24 },
};

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
    const patch = patches[hit.voice],
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
  constructor(ctx, output, score, waves, random, at, shine) {
    this.ctx = ctx;
    this.waves = waves;
    this.random = random;
    this.shine = shine;
    this.score = score;
    this.nodes = [];
    this.sources = [];
    this.glints = new Set();
    this.gate = volume(ctx, 0, output);
    this.gate.gain.setTargetAtTime(1, at, 0.28);
    this.space = echo(ctx, this.gate, 0.287, 0.419, 0.37, 4950);
    this.padBus = volume(ctx, 1, this.gate);
    // The sparkle control also moves a shelf on longer bell tails; turning
    // it has an audible effect even between the scheduler’s next glints.
    this.glassBus = filter(ctx, "highshelf", 3100);
    this.glassBus.gain.value = -3 + 7 * shine;
    this.glassBus.connect(this.gate);
    this.nodes.push(this.padBus, this.glassBus);
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
    this.bass = this.voice("bass", frame.root, 0.135, 0, 720, at, false);
    this.bed = frame.bed.map((note, i) =>
      this.voice(
        i === 1 ? "reed" : "pad",
        note,
        [0.061, 0.055, 0.049][i],
        [-0.36, 0.21, 0.42][i],
        1800,
        at,
        true,
      ),
    );
    this.vineNote = frame.bed[2];
    this.vine = this.voice("reed", this.vineNote, 0.003, -0.12, 1530, at, true);
    if (this.vine.speaker.pan)
      this.modulate(this.vine.speaker.pan, 0.041, 0.34, at);
    this.apply(frame, at, true);
    this.vineAt = at + 0.36;
    this.glintAt = at + 0.43;
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
    this.bass.color.frequency.setTargetAtTime(
      range(random, 495, 820),
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
        950 + this.shine * 1050 + range(random, 0, 720),
        at,
        0.91,
      );
    });
  }
  setSparkle(amount) {
    this.shine = amount;
    const now = this.ctx.currentTime;
    this.glassBus.gain.setTargetAtTime(-3 + 7 * amount, now, 0.12);
    this.bed.forEach((voice, i) =>
      voice.color.frequency.setTargetAtTime(
        1150 + 1450 * amount + i * 130,
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
      range(random, 1000, 1900) + 1000 * this.shine,
      at,
      0.29,
    );
    voice.amp.gain.setTargetAtTime(range(random, 0.035, 0.07), at, 0.24);
    voice.amp.gain.setTargetAtTime(0.0035, at + duration * 0.63, 0.27);
    this.vineAt = at + duration;
  }
  stars(at) {
    const random = this.random,
      shimmer = this.shine;
    this.glintAt = at + range(random, 0.7, 2.05) / (0.48 + 0.71 * shimmer);
    if (shimmer <= 0.001) return;
    const candidates = this.frame.stars;
    const note = pick(random, candidates);
    const noteHit = (at, pitch, strength) => ({
      at,
      notes: [pitch],
      length: range(random, 0.32, 0.71),
      voice: "glass",
      strength,
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
      },
    );
    this.glints.add(glint);
    glint.ended.then(() => this.glints.delete(glint));
  }
  schedule(through, pressure) {
    // Audio time drives all attacks. A backgrounded tab or busy worker must
    // never replay a pile of overdue events when the UI thread returns.
    const now = this.ctx.currentTime;
    for (const field of ["changeAt", "vineAt", "glintAt"]) {
      if (this[field] < now - 0.12) this[field] = now + 0.018;
    }
    for (;;) {
      const at = Math.min(this.changeAt, this.vineAt, this.glintAt);
      if (at > through) return;
      if (at === this.changeAt) this.apply(this.score.next(pressure), at);
      else if (at === this.vineAt) this.ribbon(at);
      else this.stars(at);
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

// The browser clock and OfflineAudioContext use the same score, envelopes,
// oscillators and mix. The player only has to keep the short horizon fed.
export class TableSynth {
  constructor(ctx, destination, { random = Math.random, sparkle = 0.78 } = {}) {
    this.ctx = ctx;
    this.random = random;
    this.waves = initWaves(ctx);
    this.score = createScore(random);
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
    if (!this.canopy)
      this.canopy = new Canopy(
        this.ctx,
        this.musicBus,
        this.score,
        this.waves,
        this.random,
        at,
        this.sparkle,
      );
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
