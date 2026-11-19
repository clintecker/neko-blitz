// Exercise rare terminal conditions through the exact same settlement function
// as the live coach, without adding a testing export to its public API.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../../public/game/coach.mjs", import.meta.url),
  "utf8",
);
const instrumented =
  source +
  `
export function inspectCharges(hands,lives,knocker,config){
  const rules=rulesOf(config),p={n:hands.length,rules,t:tables(rules.triples),lives,
    tag:ruleTag(rules),equityCache:new Map()};
  return settle(hands,p,knocker,-1);
}
`;
const { inspectCharges } = await import(
  "data:text/javascript;base64," + Buffer.from(instrumented).toString("base64")
);
const hands = [
  [9, 10, 14],
  [22, 23, 27],
  [35, 36, 40],
  [48, 49, 1],
]; // tied 20s
function progress(knocker, tieSafe, lives) {
  return hands.map((_, i) => {
    const seq = hands.slice(i).concat(hands.slice(0, i));
    const current = knocker < 0 ? -1 : (knocker - i + 4) % 4;
    return inspectCharges(seq, lives, current, {
      payout: "lowest",
      triples: false,
      failedKnock: 1,
      tieSafe,
    }).safe;
  });
}
assert.deepEqual(progress(-1, true, [1, 1, 1, 1]), [1, 1, 1, 1]); // replay the stock-out
assert.deepEqual(progress(-1, true, [4, 4, 4, 4]), [0, 0, 0, 0]); // ordinary unknocked tied-low
assert.deepEqual(progress(0, true, [1, 1, 1, 1]), [1, 0, 0, 0]); // protected knocker
assert.deepEqual(progress(0, false, [1, 1, 1, 1]), [0, 1, 1, 1]); // knocker bears low tie
console.log("Four tied-low settlement edge cases passed.");
