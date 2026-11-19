import test from "node:test";
import assert from "node:assert/strict";
import {
  OBJECTIVE_METRIC,
  bestKeep,
  fmtScore,
  percent,
  seatName,
  signed,
  totalLives,
} from "../app/format.js";

const rules = { lives: 4, freeRide: false, triples: false };

test("whole percents clamp near-certainty and decimals print raw", () => {
  assert.equal(percent(0.004), "<1%");
  assert.equal(percent(0.996), ">99%");
  assert.equal(percent(1), "100%");
  assert.equal(percent(0), "0%");
  assert.equal(percent(0.4), "40%");
  assert.equal(percent(0.004, 1), "0.4%");
  assert.equal(percent(0.996, 1), "99.6%");
  assert.equal(percent(0.5321, 1), "53.2%");
});

test("scores, deltas, seats and token totals read the same as before", () => {
  assert.equal(fmtScore(30.5), "30½");
  assert.equal(fmtScore(21), "21");
  assert.equal(signed(0.5), "+0.50");
  assert.equal(signed(0), "0.00");
  assert.equal(signed(-1), "-1.00");
  assert.equal(
    seatName({ self: 0, seats: [{ name: "Nova" }, { name: "Pip" }] }, 0),
    "You",
  );
  assert.equal(
    seatName({ self: 0, seats: [{ name: "Nova" }, { name: "Pip" }] }, 1),
    "Pip",
  );
  assert.equal(totalLives({ lives: 4 }), 4);
  assert.equal(totalLives({ lives: 3 }), 3);
  assert.deepEqual(OBJECTIVE_METRIC, {
    match: "matchWinChance",
    safe: "safeChance",
    round: "value",
  });
});

test("bestKeep keeps the highest three-card hand and the pile card", () => {
  // A♠ 10♠ K♠ 8♥: dropping the heart keeps a suited 31.
  const hand = [0, 9, 12, 20];
  assert.deepEqual(bestKeep(hand, null, "stock", rules), {
    score: 31,
    suit: 0,
  });
  assert.deepEqual(bestKeep([0, 9, 12], null, "stock", rules), {
    score: 31,
    suit: 0,
  });
  // The same four cards with 2♥ taken from the pile: it has to stay, so the
  // best keep is 21 rather than the 31 that dropping it would score.
  const taken = [0, 9, 12, 14];
  assert.deepEqual(bestKeep(taken, 14, "discard", rules), {
    score: 21,
    suit: 0,
  });
  assert.deepEqual(bestKeep(taken, 14, "stock", rules), {
    score: 31,
    suit: 0,
  });
});
