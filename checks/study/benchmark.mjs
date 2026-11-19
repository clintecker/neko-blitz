// Representative openings for the family table. Values use the same visible
// position, deterministic seed and paired hidden deals for all three actions.
import { analyze } from "../../public/game/coach.mjs";
const samples = Number(process.argv[2] ?? 40000),
  objective = process.argv[3] ?? "match",
  payout = process.argv[4] ?? "lowest",
  results = [];
for (const n of (process.argv[5] ?? "4,3,2").split(",").map(Number)) {
  for (const game of [
    ["A-K live / two up", [0, 12, 20], 27],
    ["A-K live / ace up", [0, 12, 20], 26],
    ["dry suited 21 / ace up", [9, 7, 2], 26],
    ["dry suited 25 / two up", [11, 8, 5], 27],
    ["A-K / jack makes blitz", [0, 12, 20], 10],
    ["dry suited 21 / jack improves", [9, 7, 2], 10],
  ]) {
    const [name, hand, up] = game;
    const view = {
      active: Array.from({ length: n }, (_, i) => i),
      self: 0,
      hand,
      discard: [up],
      openingDiscard: up,
      lives: Array(n).fill(4),
      rules: { payout, triples: false, failedKnock: 1, tieSafe: true },
    };
    const a = analyze(view, { samples, seed: 2389, objective });
    results.push({ n, name, hand, up, ...a });
    console.error(
      n,
      name,
      a.action,
      a.exact ? "exact" : "",
      a.margin.toFixed(4),
      a.marginSE.toFixed(4),
      Object.values(a.actions)
        .map((m) =>
          [m.value, m.ownLossChance, m.matchWinChance]
            .map((v) => v.toFixed(3))
            .join("/"),
        )
        .join(" "),
    );
  }
}
console.log(JSON.stringify(results));
