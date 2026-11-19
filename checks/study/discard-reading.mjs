// Paired public-evidence example. Node discard-reading.mjs 4000.
import assert from "node:assert/strict";
import { analyzeDiscard, analyze } from "../../public/game/coach.mjs";
const samples = Number(process.argv[2] ?? 4000);
const hand = [9, 11, 51, 25],
  watch = [];
for (const pair of [
  [13, 24],
  [39, 50],
]) {
  const openingDiscard = pair[0];
  const events = [
    { seat: 1, source: "discard", picked: pair[0], discard: 28 },
    { seat: 2, source: "stock", discard: 42 },
    { seat: 3, source: "stock", discard: 31 },
    { seat: 0, source: "stock", discard: pair[1] },
    { seat: 1, source: "discard", picked: pair[1], discard: 45 },
    { seat: 2, source: "stock", discard: 27 },
    { seat: 3, source: "stock", discard: 41 },
  ];
  const pile = [openingDiscard];
  for (const e of events) {
    if (e.source === "discard") pile.pop();
    pile.push(e.discard);
  }
  const view = {
    active: [0, 1, 2, 3],
    self: 0,
    hand,
    drawSource: "stock",
    drawn: 25,
    openingDiscard,
    events,
    discard: pile,
    stockCount: 33,
    lives: [4, 4, 4, 4],
  };
  // 39 stock before any turns - five prior stock draws - our private draw.
  const a = analyzeDiscard(view, { samples, seed: 2389, objective: "match" });
  const dangerous = pair[0] === 13 ? 25 : 51,
    defensive = pair[0] === 13 ? 51 : 25;
  assert.equal(a.discardCard, defensive);
  const risky = a.candidates.find((c) => c.card === dangerous),
    safe = a.candidates.find((c) => c.card === defensive);
  assert.equal(risky.keptScore, 20);
  assert.equal(safe.keptScore, 20);
  assert.equal(risky.nextBlitzChance, 1);
  assert.equal(safe.nextBlitzChance, 0);
  assert.equal(a.reads[0].certainSuit, Math.floor(pair[0] / 13));
  assert.ok(
    Math.abs(a.reads[0].suitChances.reduce((s, x) => s + x, 0) - 1) < 1e-10,
  );
  watch.push({
    known: pair,
    discard: a.discardCard,
    reads: a.reads[0],
    safe,
    risky,
    reason: a.reason,
  });
  const pickedView = {
    ...view,
    hand: [...view.hand.slice(0, 3), 41],
    drawn: 41,
    drawSource: "discard",
    stockCount: 34,
    discard: pile.slice(0, -1),
  };
  assert.equal(
    analyzeDiscard(pickedView, { samples: 160, seed: 31 }).candidates.length,
    3,
  );
}
const instant = {
  active: [0, 1, 2, 3],
  self: 0,
  hand: [0, 12, 20, 10],
  drawn: 10,
  drawSource: "discard",
  discard: [],
  openingDiscard: 10,
  stockCount: 39,
  lives: [4, 4, 4, 4],
  events: [],
};
const a = analyzeDiscard(instant, { samples: 120 });
assert.equal(a.exact, true);
assert.equal(a.discardCard, 20);
assert.equal(a.candidates.find((c) => c.card === 20).nextSeat, null);
assert.equal(
  a.candidates.some((c) => c.card === 10),
  false,
);
const final = analyzeDiscard({ ...instant, knocker: 1 }, { samples: 120 });
assert.ok(
  final.candidates.every((c) => c.nextTurnChance === 0 && c.nextSeat === null),
);
const base = {
  active: [0, 1, 2, 3],
  self: 0,
  hand: [0, 12, 20],
  openingDiscard: 27,
  discard: [27],
};
const z = analyze(base, { samples: 600, seed: 2389 });
assert.equal(z.reads.length, 3);
assert.ok(z.actions.knock.nextTakeChance >= 0);
console.log(JSON.stringify(watch));
