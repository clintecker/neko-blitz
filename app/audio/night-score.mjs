/**
 * A generative score for a night-time card table. MIDI and seconds only.
 * Long phrases travel between a few related tonal centers. The lower pedal
 * may stay put while the three keyboard voices and upper harmonics change.
 */

const HOME = 2; // D
const NOTE_NAMES = [
  "C",
  "D♭",
  "D",
  "E♭",
  "E",
  "F",
  "F♯",
  "G",
  "A♭",
  "A",
  "B♭",
  "B",
];
const mod12 = (n) => ((n % 12) + 12) % 12;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n) => Math.round(n * 1000) / 1000;

// Root degree, quality, structural third/suspension, upper colors, all chord tones.
// The last two shapes are distant dominant colors reserved for a phrase approach.
const CHORDS = {
  sixth: [0, "6/9", 4, [2, 9], [0, 2, 4, 7, 9]],
  major: [0, "maj9", 4, [2, 11], [0, 2, 4, 7, 11]],
  lydian: [0, "maj9(♯11)", 4, [6, 11], [0, 2, 4, 6, 7, 11]],
  hollow: [0, "sus2/4", 5, [2, 9], [0, 2, 5, 7, 9]],
  violet: [0, "m(add9)", 3, [2, 10], [0, 2, 3, 7, 10]],
  garden: [5, "maj9(♯11)", 4, [6, 11], [0, 2, 4, 6, 7, 11]],
  fourth: [5, "6/9", 4, [2, 9], [0, 2, 4, 7, 9]],
  minor: [9, "m11", 3, [2, 5, 10], [0, 2, 3, 5, 7, 10]],
  second: [2, "m9", 3, [2, 10], [0, 2, 3, 7, 10]],
  mediant: [4, "m7(add11)", 3, [5, 10], [0, 3, 5, 7, 10]],
  borrowed: [10, "maj9(♯11)", 4, [6, 11], [0, 2, 4, 6, 7, 11]],
  bridge: [7, "9sus4", 5, [2, 10], [0, 2, 5, 7, 10]],
  amber: [7, "13", 4, [9, 10], [0, 2, 4, 7, 9, 10]],
  ember: [7, "7(♭9)", 4, [1, 10], [0, 1, 4, 7, 10]],
  prism: [7, "7(♯11)", 4, [6, 10], [0, 2, 4, 6, 10]],
};

const ROLES = {
  land: ["sixth", "major", "hollow", "violet"],
  open: ["major", "lydian", "garden", "fourth", "hollow", "minor"],
  roam: [
    "garden",
    "fourth",
    "minor",
    "second",
    "mediant",
    "borrowed",
    "lydian",
  ],
  turn: ["second", "minor", "bridge", "amber", "prism"],
  lean: ["bridge", "amber", "ember", "prism", "hollow"],
};

// Isolate the score clock from UI interaction. A burst of clicks cannot consume
// the random draws that would otherwise determine the next harmonic phrase.
function stream(source, salt) {
  let state = (Math.floor(source() * 0x100000000) ^ salt) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 0x100000000;
  };
}

function weighted(items, weight, random) {
  const weights = items.map(weight);
  let needle = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    needle -= weights[i];
    if (needle < 0) return items[i];
  }
  return items.at(-1);
}

function pitches(low, high, classes) {
  return Array.from({ length: high - low + 1 }, (_, i) => low + i).filter(
    (note) => classes.includes(mod12(note)),
  );
}

function nearestPitch(pitchClass, target) {
  return target + mod12(pitchClass - target + 6) - 6;
}

// Score the motion of individual voices, rather than taking a fresh random
// inversion each bar. Keep one guide tone and one extension in each voicing.
function leadBed(root, shape, previous, center, random) {
  const [, , guide, colors, tones] = shape;
  const allowed = pitches(
    48,
    76,
    tones.map((n) => mod12(n + root)),
  );
  const voicings = [];
  for (let i = 0; i < allowed.length; i++) {
    for (let j = i + 1; j < allowed.length; j++) {
      for (let k = j + 1; k < allowed.length; k++) {
        const chord = [allowed[i], allowed[j], allowed[k]];
        const pcs = chord.map((n) => mod12(n - root));
        if (
          new Set(pcs).size < 3 ||
          !pcs.includes(guide) ||
          !pcs.some((n) => colors.includes(n))
        )
          continue;
        const lower = chord[1] - chord[0],
          upper = chord[2] - chord[1];
        if (lower < 3 || lower > 11 || upper < 2 || upper > 11) continue;
        const motion = chord.map((n, v) => Math.abs(n - previous[v]));
        const travel = motion.reduce((a, b) => a + b, 0);
        const cost =
          travel +
          0.5 * Math.max(...motion) +
          0.31 * Math.abs(chord[1] - center) +
          0.12 * Math.abs(lower - 6) +
          (travel === 0 ? 2.8 : 0);
        voicings.push({ chord, cost });
      }
    }
  }
  voicings.sort((a, b) => a.cost - b.cost);
  // The constraints can reject every candidate. Fall back to the previous
  // voicing rather than throwing inside the scheduler.
  if (!voicings.length) return previous;
  const best = voicings[0].cost;
  return weighted(
    voicings.slice(0, 10),
    (v) => Math.exp(-(v.cost - best) / 2.2),
    random,
  ).chord;
}

function upperLights(root, shape, previous, random) {
  const colors = shape[3].map((n) => mod12(root + n));
  const pool = pitches(
    76,
    95,
    shape[4].map((n) => mod12(n + root)),
  );
  const count = weighted([4, 5, 6], (n) => (n === 5 ? 3 : 1), random);
  const notes = [];
  while (notes.length < count && pool.length) {
    const selected = weighted(
      pool,
      (n) => {
        const neighbor = notes.some((old) => Math.abs(n - old) <= 2);
        return (
          1 +
          1.5 * Number(colors.includes(mod12(n))) +
          1.2 * Number(previous.includes(n)) +
          0.6 * Number(neighbor) +
          0.6 * Number(n >= 86)
        );
      },
      random,
    );
    notes.push(selected);
    pool.splice(pool.indexOf(selected), 1);
  }
  // The order is a glint pattern, not an ascending arpeggio.
  return notes;
}

function nearBass(anchor, chordRoot, prior, pedalAge, phraseStep, random) {
  const available = pitches(36, 50, [anchor, chordRoot, mod12(chordRoot + 7)]);
  const nearby = available.filter((n) => Math.abs(n - prior) <= 7);
  return weighted(
    nearby.length ? nearby : available,
    (n) => {
      const home = mod12(n) === anchor,
        old = n === prior;
      const pedal = home ? (phraseStep < 2 ? 4.2 : 2.6) : 1;
      const hold = old ? (pedalAge >= 3 ? 0.24 : 2.1) : 1;
      return (
        pedal *
        hold *
        (mod12(n) === chordRoot ? 2.5 : 1) *
        Math.exp(-Math.abs(n - prior) / 3.1)
      );
    },
    random,
  );
}

// Keep each action's rhythm distinctive. Variation comes from small timing and
// articulation changes, register and inversions, all driven by the current frame.
function makeCue(name, frame, context, variant, random) {
  const lengthScale = 0.94 + 0.12 * random();
  const timeScale = 0.94 + 0.12 * random();
  const base = nearestPitch(context.chordRoot, 53);
  const tonic = nearestPitch(context.anchor, 52);
  const majorThird = context.minor ? 3 : 4;
  const bed = frame.bed;
  const upper = frame.stars.slice().sort((a, b) => a - b);
  const noteSet = (notes) =>
    [...new Set(notes.map((n) => clamp(Math.round(n), 32, 95)))].sort(
      (a, b) => a - b,
    );
  const voicing = (root, offsets) => offsets.map((n) => root + n);
  function strike(at, notes, length, voice, strength) {
    let selected = noteSet(notes);
    if (selected.length === 1) {
      // Register choices can fold a dyad into unison. Retain another harmonic.
      const pitch = selected[0];
      const partner = [...bed, ...upper]
        .filter((n) => n !== pitch)
        .sort((a, b) => Math.abs(a - pitch - 4) - Math.abs(b - pitch - 4))[0];
      selected = noteSet([pitch, partner]);
    }
    return {
      at: round(at * timeScale),
      notes: selected,
      length: round(length * lengthScale),
      voice,
      strength: round(clamp(strength * (0.95 + 0.09 * random()), 0.1, 1)),
    };
  }
  const pickUpper = upper[variant % upper.length];
  // Shift one chord tone by an octave while preserving the identity of the chord.
  const invert = (notes, choice) => {
    const copy = notes.slice().sort((a, b) => a - b);
    if (choice % 3 === 1) copy[0] += 12;
    else if (choice % 3 === 2) copy[copy.length - 1] -= 12;
    return noteSet(copy);
  };
  const color = [bed[0], bed[1], bed[2], pickUpper - 12];
  const dominant = nearestPitch(mod12(context.anchor + 7), tonic - 4);
  const resolved = voicing(tonic, [0, 4, 9, 14]);
  switch (name) {
    case "ui":
      return [strike(0, [bed[1], bed[2], pickUpper - 12], 0.09, "pluck", 0.31)];
    case "stock":
      return [
        strike(0, invert(color, variant), 0.18, "reed", 0.49),
        strike(0.105, [bed[2], pickUpper], 0.13, "glass", 0.23),
      ];
    case "take":
      return [
        strike(
          0,
          invert(
            [bed[1], bed[2], pickUpper, upper[(variant + 2) % upper.length]],
            variant,
          ),
          0.24,
          "glass",
          0.54,
        ),
        strike(
          0.113,
          [bed[2] + 12, upper[(variant + 1) % upper.length]],
          0.22,
          "pluck",
          0.3,
        ),
      ];
    case "throw":
      return [
        strike(
          0,
          invert([base - 5, bed[0], bed[1], bed[2]], variant),
          0.083,
          "pluck",
          0.73,
        ),
      ];
    case "deal":
      return [
        strike(0, invert(color.slice(0, 3), variant), 0.12, "pluck", 0.43),
        strike(
          0.1,
          invert([bed[1], bed[2], pickUpper - 12], variant + 1),
          0.14,
          "reed",
          0.39,
        ),
        strike(
          0.235,
          invert([bed[0], bed[2], pickUpper], variant + 2),
          0.21,
          "glass",
          0.51,
        ),
      ];
    case "knock": {
      // Root/tritone and adjacent upper notes stay audible in every inversion.
      const r = nearestPitch(context.chordRoot, variant % 2 ? 51 : 54);
      const clusters = [
        [0, 6, 12, 13],
        [0, 6, 15, 16],
        [0, 6, 10, 11],
      ];
      return [
        strike(0, voicing(r, clusters[variant % 3]), 0.115, "reed", 0.71),
        strike(
          0.179,
          voicing(r, clusters[(variant + 1) % 3]),
          0.1,
          "pluck",
          0.61,
        ),
        strike(
          0.405,
          voicing(r, clusters[(variant + 2) % 3]),
          0.205,
          "reed",
          0.84,
        ),
      ];
    }
    case "blitz":
      return [
        strike(0, voicing(dominant, [0, 4, 10, 13]), 0.16, "reed", 0.74),
        strike(0.184, invert(resolved, variant), 0.48, "reed", 0.81),
        strike(
          0.285,
          voicing(tonic + 12, variant % 2 ? [4, 9, 14] : [2, 4, 9]),
          0.48,
          "glass",
          0.42,
        ),
      ];
    case "safe":
      return [
        strike(0, voicing(base, [0, 7, 14, 17]), 0.15, "glass", 0.43),
        strike(
          0.155,
          invert(voicing(base, [0, majorThird, 9, 14]), variant),
          0.27,
          "reed",
          0.47,
        ),
      ];
    case "lose":
      return [
        strike(0, voicing(base, [0, 7, 14, 15]), 0.18, "reed", 0.44),
        strike(
          0.203,
          invert(voicing(base - 5, [0, 3, 7, 10]), variant),
          0.3,
          "bass",
          0.39,
        ),
      ];
    case "win": {
      const fourth = nearestPitch(mod12(context.anchor + 5), tonic + 3);
      return [
        strike(
          0,
          invert(voicing(fourth, [0, 4, 7, 11]), variant + 1),
          0.29,
          "reed",
          0.57,
        ),
        strike(0.324, voicing(dominant, [0, 4, 10, 13]), 0.23, "reed", 0.67),
        strike(0.592, invert(resolved, variant), 0.65, "reed", 0.82),
        strike(
          0.729,
          voicing(tonic + 12, variant % 2 ? [4, 9, 14] : [2, 9, 16]),
          0.62,
          "glass",
          0.46,
        ),
      ];
    }
    default:
      return [];
  }
}

export function createScore(random = Math.random) {
  const harmonyRandom = stream(random, 0x4e656b6f);
  const cueRandom = stream(random, 0x41726361);
  const frameInfo = new WeakMap();
  const counts = new Map();
  const recent = [];
  let anchor = HOME,
    age = 0,
    phrase = 0,
    step = 0,
    pedalAge = 0;
  let period = 7,
    currentFrame;

  function frameFor(name, tension) {
    const shape = CHORDS[name],
      chordRoot = mod12(anchor + shape[0]);
    const previous = currentFrame;
    const root = previous
      ? nearBass(
          anchor,
          chordRoot,
          previous.root,
          pedalAge,
          step,
          harmonyRandom,
        )
      : 38;
    pedalAge = previous && root === previous.root ? pedalAge + 1 : 0;
    const contour =
      61.5 + 2.5 * Math.sin(phrase * 0.68 + (step / period) * Math.PI);
    const bed = leadBed(
      chordRoot,
      shape,
      previous?.bed ?? [54, 59, 64],
      contour,
      harmonyRandom,
    );
    const stars = upperLights(
      chordRoot,
      shape,
      previous?.stars ?? [],
      harmonyRandom,
    );
    const desired =
      5.25 +
      0.65 * Math.sin(phrase + step * 0.69) +
      (harmonyRandom() - 0.5) * 0.8 -
      (tension ? 0.46 : 0);
    const seconds = round(
      clamp(
        previous ? 0.56 * previous.seconds + 0.44 * desired : desired,
        4.05,
        6.4,
      ),
    );
    const frame = Object.freeze({
      root,
      bed: Object.freeze(bed),
      stars: Object.freeze(stars),
      seconds,
      label: NOTE_NAMES[chordRoot] + shape[1],
    });
    frameInfo.set(frame, { anchor, chordRoot, minor: shape[2] === 3 });
    recent.unshift(name);
    recent.length = Math.min(recent.length, 6);
    return frame;
  }

  function next(tension = false) {
    step++;
    if (step >= period) {
      step = 0;
      phrase++;
      age++;
      period = weighted(
        [5, 6, 7, 8, 9],
        (n) => (n === 7 ? 2 : 1),
        harmonyRandom,
      );
      if (age >= 2 && harmonyRandom() < Math.min(0.85, 0.2 + age * 0.115)) {
        const nearby = [
          mod12(anchor + 5),
          mod12(anchor + 7),
          mod12(anchor + 2),
          HOME,
        ];
        anchor = weighted(
          nearby,
          (n) => (n === HOME && anchor !== HOME ? 2.1 : n === anchor ? 0.2 : 1),
          harmonyRandom,
        );
        age = 0;
      }
    }
    const role =
      step === 0
        ? "land"
        : step >= period - 1
          ? "lean"
          : step === period - 2
            ? "turn"
            : step < 3
              ? "open"
              : "roam";
    const choices =
      tension && step !== 0
        ? [...new Set([...ROLES[role], "ember", "prism", "bridge"])]
        : ROLES[role];
    const name = weighted(
      choices,
      (candidate) => {
        const last = recent.indexOf(candidate);
        const memory =
          last < 0 ? 1.7 : [0.025, 0.13, 0.28, 0.49, 0.68, 0.84][last];
        const pressure =
          tension && ["ember", "prism", "bridge"].includes(candidate) ? 2.1 : 1;
        return memory * pressure;
      },
      harmonyRandom,
    );
    currentFrame = frameFor(name, tension);
    return currentFrame;
  }

  currentFrame = frameFor("sixth", false);
  function cue(name, frameOverride = currentFrame) {
    const count = counts.get(name) ?? Math.floor(cueRandom() * 9);
    counts.set(name, count + 1);
    const pc = mod12(frameOverride.root);
    const prefix = NOTE_NAMES.filter((n) =>
      frameOverride.label?.startsWith(n),
    ).sort((a, b) => b.length - a.length)[0];
    const harmonicRoot = prefix ? NOTE_NAMES.indexOf(prefix) : pc;
    const fallback = {
      anchor: pc,
      chordRoot: harmonicRoot,
      minor: frameOverride.bed.some((note) => mod12(note - harmonicRoot) === 3),
    };
    return makeCue(
      name,
      frameOverride,
      frameInfo.get(frameOverride) ?? fallback,
      count,
      cueRandom,
    );
  }
  return { current: () => currentFrame, next, cue };
}
