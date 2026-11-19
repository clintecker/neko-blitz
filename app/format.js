// Pure formatting shared by the table, the panels and Node checks.
import { handValue } from "../public/game/table.mjs";

export const fmtScore = (n) => (n === 30.5 ? "30½" : String(n));

// Whole percents clamp near-certainty so a rounded "100%" is never a lie.
// One or more digits print the raw decimal instead. Inputs are probabilities
// in [0, 1]; negatives are out of contract and clamped to zero.
export function percent(n, digits = 0) {
  if (n < 0) n = 0;
  if (digits === 0 && n > 0 && n < 0.005) return "<1%";
  if (digits === 0 && n < 1 && n > 0.995) return ">99%";
  return `${(n * 100).toFixed(digits)}%`;
}

export const signed = (n) => (n > 0 ? "+" : "") + n.toFixed(2);

export const seatName = (v, id) =>
  id === v.self ? "You" : v.seats[id]?.name || "Player";

export const totalLives = (rules) => rules.lives;

export const OBJECTIVE_METRIC = {
  match: "matchWinChance",
  safe: "safeChance",
  round: "value",
};

// The best three-card hand once the fourth card is dropped. A card taken
// from the discard pile has to stay in hand this turn.
export function bestKeep(hand, drawn, drawSource, rules) {
  if (hand.length !== 4) return handValue(hand);
  const options = hand
    .filter((c) => drawSource !== "discard" || drawn !== c)
    .map((c) => handValue(hand.filter((x) => x !== c)));
  return options.reduce((a, b) => (a.score >= b.score ? a : b), options[0]);
}
