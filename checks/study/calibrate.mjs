// Rebuild the unordered future-round loss frequencies used by the match model.
// Run: node calibrate.mjs 60000 > calibration.json
import { chooseTurn, chooseDiscard, score } from "../../public/game/coach.mjs";
const per = Number(process.argv[2] ?? 60000);
function random(seed) {
  let x = seed >>> 0;
  return () => {
    x += 0x6d2b79f5;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function round(n, rules, rand) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const hands = Array.from({ length: n }, (_, i) =>
    deck.slice(3 * i, 3 * i + 3),
  );
  const initialBlitzes = hands.filter((h) => score(h) === 31).length;
  if (initialBlitzes) return n - initialBlitzes;
  let pos = 3 * n,
    top = deck[pos++],
    knocker = -1,
    actor = 0;
  const turns = Array(n).fill(0);
  for (;;) {
    const hand = hands[actor];
    const context = {
      rules,
      players: n,
      turns: turns[actor],
      final: knocker >= 0,
    };
    const move = chooseTurn(hand, top, context);
    if (move === "knock") knocker = actor;
    else {
      const picked = move === "stock" ? deck[pos++] : top;
      const four = [...hand, picked];
      const put = chooseDiscard(four, move === "discard" ? picked : null, {
        ...context,
        final: context.final || pos === 52,
      });
      const idx = four.indexOf(put);
      if (idx !== 3) hand[idx] = picked;
      top = put;
      if (score(hand) === 31) return n - 1;
      if (pos === 52) break;
    }
    turns[actor]++;
    actor = (actor + 1) % n;
    if (actor === knocker) break;
  }
  const scores = hands.map((h) => score(h)),
    low = Math.min(...scores);
  if (rules.payout === "highest") {
    const high = Math.max(...scores);
    return scores.filter((s) => s < high).length;
  }
  const lowCount = scores.filter((s) => s === low).length;
  if (knocker >= 0 && scores[knocker] === low) {
    // A failed knock costs the knocker one token, or every other low seat one.
    if (lowCount === 1 || !rules.tieSafe) return 1;
    return lowCount - 1;
  }
  return lowCount;
}
const output = {};
const variants = [];
for (const tieSafe of [false, true])
  variants.push({ payout: "lowest", tieSafe });
variants.push({ payout: "highest", tieSafe: true });
for (const rules of variants) {
  if (process.argv[3] && rules.payout !== process.argv[3]) continue;
  const tag =
    rules.payout === "highest" ? "H0" : "0" + Number(rules.tieSafe) + "1";
  output[tag] = {};
  for (const n of [2, 3, 4]) {
    const freq = {
      double: 0,
      ...Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 0])),
    };
    const r = random(
      238931 + (rules.payout === "highest" ? 500 : Number(tag)) * 7 + n,
    );
    for (let i = 0; i < per; i++) {
      const loss = round(n, rules, r);
      if (loss > 0) freq[loss]++;
      // A round that charges nobody returns to the same life ledger.
    }
    output[tag][n] = freq;
  }
}
console.log(JSON.stringify(output));
