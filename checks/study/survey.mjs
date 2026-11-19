// Opening survey. Each accepted public position is uniform conditional on the
// target score and no legal immediate score improvement from the upcard.
import { analyze, score } from "../../public/game/coach.mjs";
const count = Number(process.argv[2] ?? 28),
  samples = Number(process.argv[3] ?? 480);
const seats = (process.argv[4] ?? "2,3,4").split(",").map(Number);
const objective = process.argv[5] ?? "match",
  payout = process.argv[6] ?? "lowest",
  metric =
    objective === "match"
      ? "matchWinChance"
      : objective === "safe"
        ? "safeChance"
        : "value";
const scores = process.argv[7]
  ? process.argv[7].split(",").map(Number)
  : [12, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
function random(seed) {
  let s = seed;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const base = Array.from({ length: 52 }, (_, i) => i),
  result = [];
for (const n of seats)
  for (const val of scores) {
    const rng = random(238931 + n * 201 + val),
      cases = [];
    while (cases.length < count) {
      const picked = [];
      while (picked.length < 4) {
        const c = base[Math.floor(rng() * 52)];
        if (!picked.includes(c)) picked.push(c);
      }
      const hand = picked.slice(0, 3),
        up = picked[3];
      if (score(hand) !== val) continue;
      const bestUp = Math.max(
        ...hand.map((_, drop) =>
          score([...hand.filter((_, i) => i !== drop), up]),
        ),
      );
      if (bestUp > val) continue;
      const opts = { objective, samples, seed: Math.floor(rng() * 0xffffffff) };
      const a = analyze(
        {
          hand,
          discard: [up],
          openingDiscard: up,
          active: base.slice(0, n),
          self: 0,
          lives: Array(n).fill(4),
          rules: { payout, triples: false, failedKnock: 1, tieSafe: true },
        },
        opts,
      );
      const k = a.actions.knock;
      cases.push({
        hand,
        up,
        seed: opts.seed,
        action: a.action,
        delta:
          k[metric] -
          Math.max(a.actions.stock[metric], a.actions.discard[metric]),
        risk: k.ownLossChance,
      });
    }
    const mean = (key) => cases.reduce((a, c) => a + c[key], 0) / count;
    const m = mean("delta"),
      se = Math.sqrt(
        cases.reduce((a, c) => a + (c.delta - m) ** 2, 0) /
          (count * (count - 1)),
      );
    result.push({
      n,
      score: val,
      knocks: cases.filter((c) => c.action === "knock").length,
      positions: count,
      meanDelta: m,
      seDelta: se,
      risk: mean("risk"),
      cases,
    });
    console.error(
      n,
      val,
      result.at(-1).knocks,
      m.toFixed(3),
      se.toFixed(3),
      mean("risk").toFixed(3),
    );
  }
console.log(JSON.stringify(result));
