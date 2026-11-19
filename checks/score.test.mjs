import { test } from "node:test";
import assert from "node:assert/strict";
import { createScore } from "../public/game/night-score.mjs";

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
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

test("card actions vary within a chord and preserve the three strikes of a knock", () => {
  const score = createScore(seeded(2389));
  for (const name of moves) {
    const variants = new Set();
    for (let i = 0; i < 18; i++) {
      const phrase = score.cue(name);
      assert.equal(phrase[0].at, 0);
      assert.ok(
        phrase.every(
          (e, j) =>
            (!j || e.at >= phrase[j - 1].at) &&
            e.notes.length >= 2 &&
            e.notes.length <= 5 &&
            e.length > 0 &&
            e.notes.every((n) => Number.isInteger(n) && n >= 32 && n <= 95),
        ),
      );
      if (name === "knock") {
        assert.equal(phrase.length, 3);
        assert.ok(
          phrase.every((e) => e.notes.some((n) => e.notes.includes(n + 1))),
        );
      }
      variants.add(JSON.stringify(phrase.map((e) => e.notes)));
    }
    assert.ok(variants.size >= 2, name);
  }
});

test("the drone ranges through related harmonies independent of game or audition traffic", () => {
  const live = createScore(seeded(31)),
    idle = createScore(seeded(31));
  const frames = new Set(),
    labels = new Set();
  let prior = live.current(),
    held = 0;
  for (let i = 0; i < 125; i++) {
    moves.forEach((move) => live.cue(move));
    const frame = live.next(i % 9 === 4);
    assert.deepEqual(frame, idle.next(i % 9 === 4));
    assert.ok(Math.abs(frame.root - prior.root) <= 7);
    assert.ok(
      frame.bed.length === 3 && frame.bed.every((n) => n >= 48 && n <= 76),
    );
    assert.ok(
      frame.stars.length >= 4 && frame.stars.every((n) => n >= 76 && n <= 95),
    );
    assert.ok(frame.seconds >= 4 && frame.seconds <= 6.5);
    if (frame.root === prior.root) held++;
    frames.add(JSON.stringify([frame.root, frame.bed, frame.stars]));
    labels.add(frame.label);
    prior = frame;
  }
  assert.ok(frames.size > 120 && labels.size >= 12);
  assert.ok(held > 20 && held < 110);
});
