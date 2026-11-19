// Exercise rare terminal conditions through the same settlement function the
// table and the coach both use.
import assert from "node:assert/strict";
import { scoreHand, settleRound } from "../../public/game/rules.mjs";
const hands = [
  [9, 10, 14],
  [22, 23, 27],
  [35, 36, 40],
  [48, 49, 1],
]; // tied 20s
function progress(knocker, tieSafe, lives) {
  return hands.map((_, i) => {
    const seq = hands.slice(i).concat(hands.slice(0, i));
    const current = knocker < 0 ? null : (knocker - i + 4) % 4;
    const { paid } = settleRound({
      scores: seq.map((hand) => scoreHand(hand).score),
      lives,
      knocker: current,
      blitz: [],
      rules: { payout: "lowest", tieSafe },
    });
    // Seat 0 is the one being asked about; a zero charge keeps its token.
    return +(paid[0] === 0);
  });
}
assert.deepEqual(progress(-1, true, [1, 1, 1, 1]), [1, 1, 1, 1]); // replay the stock-out
assert.deepEqual(progress(-1, true, [4, 4, 4, 4]), [0, 0, 0, 0]); // ordinary unknocked tied-low
assert.deepEqual(progress(0, true, [1, 1, 1, 1]), [1, 0, 0, 0]); // protected knocker
assert.deepEqual(progress(0, false, [1, 1, 1, 1]), [0, 1, 1, 1]); // knocker bears low tie
console.log("Four tied-low settlement edge cases passed.");
