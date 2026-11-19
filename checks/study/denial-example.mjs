// Drawing stock also covers the old upcard. This take has a second advantage:
// the visible card improves our hand immediately while covering a rival blitz.
import assert from "node:assert/strict";
import { analyze } from "../../public/game/coach.mjs";
const events = [
  { seat: 1, source: "discard", picked: 13, discard: 28 },
  { seat: 2, source: "stock", discard: 42 },
  { seat: 3, source: "stock", discard: 31 },
  { seat: 0, source: "stock", discard: 24 },
  { seat: 1, source: "discard", picked: 24, discard: 45 },
  { seat: 2, source: "stock", discard: 27 },
  { seat: 3, source: "stock", discard: 23 },
];
const pile = [13];
for (const e of events) {
  if (e.source === "discard") pile.pop();
  pile.push(e.discard);
}
const r = analyze(
  {
    active: [0, 1, 2, 3],
    self: 0,
    hand: [22, 21, 0],
    openingDiscard: 13,
    discard: pile,
    events,
    stockCount: 34,
    lives: [4, 4, 4, 4],
  },
  { samples: Number(process.argv[2] ?? 4000), seed: 2389, objective: "match" },
);
assert.equal(r.action, "discard");
assert.equal(r.actions.discard.discardCard, 0);
assert.equal(r.actions.knock.nextBlitzChance, 1);
assert.equal(r.actions.discard.nextBlitzChance, 0);
console.log(
  JSON.stringify({ action: r.action, actions: r.actions, reads: r.reads[0] }),
);
