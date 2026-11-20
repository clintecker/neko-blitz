import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THEMES,
  createScore,
  resolveTheme,
  themeList,
} from "../app/audio/night-score.mjs";
import { seeded } from "./lib/rng.mjs";

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
const moves = [
  "ui",
  "deal",
  "stock",
  "take",
  "throw",
  "knock",
  "blitz",
  "safe",
  "lose",
  "win",
];
const ids = Object.keys(THEMES);

// Read a labelled frame back through its theme's palette. The guide tone sits
// at index 2 and its minor flag has to agree with the tone set, because
// makeCue derives minorness from that index alone.
function palette(theme, id) {
  const tonesByQuality = new Map();
  for (const [key, [, quality, guide, colors, tones]] of Object.entries(
    theme.chords,
  )) {
    assert.ok(tones.includes(guide), `${id}.${key} guide`);
    assert.equal(guide === 3, tones.includes(3), `${id}.${key} minor flag`);
    assert.ok(
      colors.every((c) => tones.includes(c)),
      `${id}.${key} colors`,
    );
    const prior = tonesByQuality.get(quality);
    if (prior) assert.deepEqual(prior, tones, `${id}.${quality} tones`);
    tonesByQuality.set(quality, tones);
  }
  return (label) => {
    const name = NOTE_NAMES.filter((n) => label.startsWith(n)).sort(
      (a, b) => b.length - a.length,
    )[0];
    const tones = tonesByQuality.get(label.slice(name.length));
    assert.ok(tones, `${id} label ${label}`);
    return { root: NOTE_NAMES.indexOf(name), tones };
  };
}

function frames(id, seed, count) {
  const score = createScore(seeded(seed), id);
  return Array.from({ length: count }, (_, i) => score.next(i % 5 === 3));
}

test("theme ids list a stable selector payload for the UI", () => {
  assert.deepEqual(themeList(), [
    { id: "alley", name: "Neon Alley" },
    { id: "vapor", name: "Vapor Bay" },
    { id: "reef", name: "Sunken Reef" },
    { id: "ember", name: "Static Ember" },
  ]);
  assert.equal(resolveTheme("alley"), THEMES.alley);
  assert.equal(resolveTheme("no-such-bay"), THEMES.alley);
  assert.equal(resolveTheme(undefined), THEMES.alley);
  // An omitted theme is the alley table, not a fourth palette.
  assert.deepEqual(frames(undefined, 606, 24), frames("alley", 606, 24));
});

for (const id of ids) {
  test(`the ${id} theme replays identically while cues play`, () => {
    const live = createScore(seeded(77), id),
      idle = createScore(seeded(77), id);
    for (let i = 0; i < 30; i++) {
      moves.forEach((move) => live.cue(move));
      const played = live.next(i % 5 === 3),
        silent = idle.next(i % 5 === 3);
      assert.deepEqual(
        [played.label, played.root, played.bed, played.stars, played.seconds],
        [silent.label, silent.root, silent.bed, silent.stars, silent.seconds],
      );
    }
  });

  test(`the ${id} theme voices chord tones inside its own shape`, () => {
    const theme = THEMES[id],
      chordOf = palette(theme, id),
      band = theme.shape.phraseEma;
    const score = createScore(seeded(90210), id);
    const seen = [score.current()];
    for (let i = 0; i < 60; i++) seen.push(score.next(i % 6 === 2));
    const labels = new Set();
    for (const frame of seen) {
      const { root, tones } = chordOf(frame.label);
      const classes = tones.map((n) => mod12(n + root));
      assert.ok(frame.label, "labelled frame");
      assert.ok(
        frame.root >= 33 && frame.root <= 52,
        `${frame.label} root ${frame.root}`,
      );
      assert.equal(frame.bed.length, 3);
      assert.ok(
        frame.bed.every((n) => n >= 48 && n <= 76),
        `${frame.label} bed ${frame.bed}`,
      );
      assert.ok(frame.stars.length >= 4 && frame.stars.length <= 6);
      assert.ok(
        [...frame.bed, ...frame.stars].every((n) =>
          classes.includes(mod12(n)),
        ),
        `${frame.label} voices ${[...frame.bed, ...frame.stars]}`,
      );
      assert.ok(
        frame.seconds >= band.min - 0.001 && frame.seconds <= band.max + 0.001,
        `${frame.label} seconds ${frame.seconds}`,
      );
      labels.add(frame.label);
    }
    assert.ok(labels.size >= 8, `${id} labels ${labels.size}`);
  });

  test(`the ${id} theme keeps every cue and the three-strike knock`, () => {
    const score = createScore(seeded(1187), id);
    for (let i = 0; i < 4; i++) score.next(true);
    for (const name of moves) {
      for (let i = 0; i < 12; i++) {
        const phrase = score.cue(name);
        assert.equal(phrase[0].at, 0, `${id} ${name}`);
        assert.ok(
          phrase.every(
            (e, j) =>
              (!j || e.at >= phrase[j - 1].at) &&
              e.notes.length >= 2 &&
              e.notes.length <= 5 &&
              e.length > 0 &&
              e.notes.every((n) => Number.isInteger(n) && n >= 32 && n <= 95),
          ),
          `${id} ${name}`,
        );
        if (name === "knock") {
          assert.equal(phrase.length, 3);
          assert.ok(
            phrase.every((e) => e.notes.some((n) => e.notes.includes(n + 1))),
          );
        }
      }
    }
  });
}

test("no two themes drift into the same phrase opening", () => {
  const openings = Object.fromEntries(
    ids.map((id) => [
      id,
      frames(id, 5, 5).map((f) => JSON.stringify([f.label, f.root, f.bed])),
    ]),
  );
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      assert.notDeepEqual(
        openings[ids[i]],
        openings[ids[j]],
        `${ids[i]} ${ids[j]}`,
      );
});

// A golden sequence pins the alley theme against RNG-order drift: any edit
// that adds, removes, or reorders a random() draw changes the music but
// would otherwise pass every invariant here.
const GOLDEN_ALLEY = ["{\"root\":38,\"bed\":[52,59,67],\"stars\":[88,76,95,93],\"seconds\":5.44,\"label\":\"G6/9\"}","[{\"at\":0,\"notes\":[59,67,81],\"length\":0.09,\"voice\":\"pluck\",\"strength\":0.318}]","{\"root\":38,\"bed\":[54,61,69],\"stars\":[86,80,76,81],\"seconds\":5.597,\"label\":\"Dmaj9(♯11)\"}","{\"root\":38,\"bed\":[54,62,69],\"stars\":[85,78,93,86,81],\"seconds\":5.839,\"label\":\"Bm11\"}","{\"root\":36,\"bed\":[54,64,71],\"stars\":[95,90,79,86,78],\"seconds\":5.778,\"label\":\"Cmaj9(♯11)\"}","{\"root\":38,\"bed\":[55,62,71],\"stars\":[79,83,86,91,95],\"seconds\":5.29,\"label\":\"A9sus4\"}","[{\"at\":0,\"notes\":[52,55,59,62],\"length\":0.08,\"voice\":\"pluck\",\"strength\":0.708}]","{\"root\":38,\"bed\":[55,62,71],\"stars\":[83,88,91,86],\"seconds\":5.115,\"label\":\"Dsus2/4\"}","{\"root\":38,\"bed\":[57,65,72],\"stars\":[93,84,89,86,76],\"seconds\":5.508,\"label\":\"Dm(add9)\"}","{\"root\":38,\"bed\":[57,66,73],\"stars\":[88,86,92,85,93,78],\"seconds\":5.828,\"label\":\"Dmaj9(♯11)\"}","{\"root\":43,\"bed\":[57,67,71],\"stars\":[88,81,93,86,79],\"seconds\":5.901,\"label\":\"G6/9\"}","[{\"at\":0,\"notes\":[55,62,69,70],\"length\":0.177,\"voice\":\"reed\",\"strength\":0.444},{\"at\":0.193,\"notes\":[48,50,53,57],\"length\":0.294,\"voice\":\"bass\",\"strength\":0.393}]","{\"root\":43,\"bed\":[61,66,71],\"stars\":[91,90,86,95,78],\"seconds\":5.723,\"label\":\"Gmaj9(♯11)\"}","{\"root\":42,\"bed\":[59,66,69],\"stars\":[78,88,95,76,83],\"seconds\":5.408,\"label\":\"F♯m7(add11)\"}","{\"root\":42,\"bed\":[61,66,74],\"stars\":[90,76,83,93],\"seconds\":5.178,\"label\":\"Bm11\"}","{\"root\":40,\"bed\":[64,67,74],\"stars\":[90,91,76,95],\"seconds\":5.08,\"label\":\"Em9\"}","[{\"at\":0,\"notes\":[64,67,74,79],\"length\":0.18,\"voice\":\"reed\",\"strength\":0.504},{\"at\":0.099,\"notes\":[74,91],\"length\":0.13,\"voice\":\"glass\",\"strength\":0.232}]","{\"root\":40,\"bed\":[64,67,73],\"stars\":[88,82,79,94,85],\"seconds\":4.962,\"label\":\"A7(♭9)\"}","{\"root\":40,\"bed\":[63,69,73],\"stars\":[81,93,85,87,95,91],\"seconds\":5.205,\"label\":\"A7(♯11)\"}","{\"root\":45,\"bed\":[62,69,71],\"stars\":[93,95,83,78,81],\"seconds\":5.551,\"label\":\"Asus2/4\"}","{\"root\":45,\"bed\":[57,66,68],\"stars\":[81,88,92,86,93],\"seconds\":5.529,\"label\":\"Dmaj9(♯11)\"}","[{\"at\":0,\"notes\":[52,56,62,65],\"length\":0.161,\"voice\":\"reed\",\"strength\":0.764},{\"at\":0.179,\"notes\":[61,66,69,71],\"length\":0.483,\"voice\":\"reed\",\"strength\":0.776},{\"at\":0.278,\"notes\":[73,78,83],\"length\":0.483,\"voice\":\"glass\",\"strength\":0.422}]","{\"root\":45,\"bed\":[61,64,71],\"stars\":[88,95,93,92],\"seconds\":5.276,\"label\":\"Amaj9\"}","{\"root\":45,\"bed\":[61,66,71],\"stars\":[93,85,86,95,91],\"seconds\":4.986,\"label\":\"Gmaj9(♯11)\"}","{\"root\":47,\"bed\":[62,66,69],\"stars\":[81,93,78,90,86],\"seconds\":4.919,\"label\":\"E9sus4\"}","{\"root\":45,\"bed\":[62,66,69],\"stars\":[78,90,76,88],\"seconds\":4.77,\"label\":\"Asus2/4\"}","[{\"at\":0,\"notes\":[66,69,78],\"length\":0.09,\"voice\":\"pluck\",\"strength\":0.308}]","{\"root\":45,\"bed\":[59,64,72],\"stars\":[88,91,83,79,76,81],\"seconds\":5.152,\"label\":\"Am(add9)\"}","{\"root\":45,\"bed\":[61,64,75],\"stars\":[83,85,95,92,87],\"seconds\":4.986,\"label\":\"Amaj9(♯11)\"}","{\"root\":45,\"bed\":[64,68,73],\"stars\":[80,88,81,92],\"seconds\":4.846,\"label\":\"Amaj9\"}","{\"root\":45,\"bed\":[61,67,71],\"stars\":[81,90,95,86,85],\"seconds\":4.599,\"label\":\"Gmaj9(♯11)\"}","[{\"at\":0,\"notes\":[50,61,67,71],\"length\":0.084,\"voice\":\"pluck\",\"strength\":0.757}]","{\"root\":47,\"bed\":[62,68,70],\"stars\":[82,88,94,90,86,92],\"seconds\":4.623,\"label\":\"E7(♯11)\"}","{\"root\":47,\"bed\":[62,68,71],\"stars\":[89,76,86,83,77,92],\"seconds\":4.802,\"label\":\"E7(♭9)\"}","{\"root\":47,\"bed\":[64,68,73],\"stars\":[83,78,90,92,88],\"seconds\":4.953,\"label\":\"E6/9\"}","{\"root\":40,\"bed\":[61,66,69],\"stars\":[88,85,78,83],\"seconds\":4.902,\"label\":\"Esus2/4\"}","[{\"at\":0,\"notes\":[52,59,66,67],\"length\":0.188,\"voice\":\"reed\",\"strength\":0.423},{\"at\":0.203,\"notes\":[47,50,54,57],\"length\":0.313,\"voice\":\"bass\",\"strength\":0.397}]","{\"root\":40,\"bed\":[61,64,71],\"stars\":[90,78,95,93,88],\"seconds\":4.716,\"label\":\"A6/9\"}","{\"root\":40,\"bed\":[61,64,75],\"stars\":[95,92,76,87,93],\"seconds\":4.738,\"label\":\"Amaj9(♯11)\"}","{\"root\":40,\"bed\":[59,68,75],\"stars\":[87,88,92,80,94],\"seconds\":4.881,\"label\":\"Emaj9(♯11)\"}","{\"root\":40,\"bed\":[59,68,73],\"stars\":[92,90,78,87],\"seconds\":5.289,\"label\":\"A♭m7(add11)\"}","[{\"at\":0,\"notes\":[68,71,73,80],\"length\":0.176,\"voice\":\"reed\",\"strength\":0.504},{\"at\":0.099,\"notes\":[73,92],\"length\":0.127,\"voice\":\"glass\",\"strength\":0.238}]","{\"root\":40,\"bed\":[61,69,75],\"stars\":[87,80,90,81,92,78],\"seconds\":5.636,\"label\":\"B13\"}","{\"root\":40,\"bed\":[63,66,72],\"stars\":[78,81,84,90,87],\"seconds\":5.5,\"label\":\"B7(♭9)\"}","{\"root\":40,\"bed\":[62,67,76],\"stars\":[88,90,79,86,95],\"seconds\":5.067,\"label\":\"Em(add9)\"}","{\"root\":45,\"bed\":[61,66,76],\"stars\":[81,95,93,85,90],\"seconds\":5.043,\"label\":\"A6/9\"}","[{\"at\":0,\"notes\":[47,51,57,60],\"length\":0.154,\"voice\":\"reed\",\"strength\":0.749},{\"at\":0.174,\"notes\":[52,54,56,61],\"length\":0.463,\"voice\":\"reed\",\"strength\":0.814},{\"at\":0.269,\"notes\":[66,68,73],\"length\":0.463,\"voice\":\"glass\",\"strength\":0.416}]","{\"root\":40,\"bed\":[56,64,75],\"stars\":[90,95,87,78],\"seconds\":5.097,\"label\":\"Emaj9\"}","{\"root\":42,\"bed\":[57,66,76],\"stars\":[80,90,88,93,76],\"seconds\":5.443,\"label\":\"F♯m9\"}","{\"root\":40,\"bed\":[57,65,75],\"stars\":[93,87,89,77,85,81],\"seconds\":5.784,\"label\":\"B7(♯11)\"}"];

test("the alley theme matches its recorded golden sequence", () => {
  const s = createScore(seeded(31337));
  const replay = [];
  for (let i = 0; i < 40; i++) {
    replay.push(JSON.stringify(s.next(i % 9 === 4)));
    if (i % 4 === 0) replay.push(JSON.stringify(s.cue(moves[i % 10])));
  }
  assert.deepEqual(replay, GOLDEN_ALLEY);
});
