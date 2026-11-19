// First-turn spot checks for the confirmed four-token / lowest-only family table.
// node family-openings.mjs 40000 produces all three objective comparisons.
import { analyze } from "../../public/game/coach.mjs";
const samples = Number(process.argv[2] ?? 40000),
  result = [];
for (const entry of [
  ["10♠ 6♠ 3♠, 2♣ up", [9, 5, 2], 27],
  ["10♠ 8♠ 3♠, 2♣ up", [9, 7, 2], 27],
  ["A♠ K♠ 8♥, 2♣ up", [0, 12, 20], 27],
  ["A♠ K♠ 8♥, J♠ up", [0, 12, 20], 10],
]) {
  const [name, hand, up] = entry;
  for (const objective of ["match", "safe", "round"]) {
    const a = analyze(
      {
        active: [0, 1, 2, 3],
        self: 0,
        hand,
        openingDiscard: up,
        discard: [up],
        lives: [4, 4, 4, 4],
        rules: {
          payout: "lowest",
          tieSafe: true,
        },
      },
      { samples, seed: 2389, objective },
    );
    const m = Object.fromEntries(
      Object.entries(a.actions).map(([k, v]) => [
        k,
        [
          v.matchWinChance,
          v.safeChance,
          v.opponentBlitzChance,
          v.showdownLossChance,
        ]
          .map((x) => x.toFixed(5))
          .join("/"),
      ]),
    );
    console.error(name, objective, a.action, JSON.stringify(m));
    result.push({ name, ...a });
  }
}
console.log(JSON.stringify(result));
