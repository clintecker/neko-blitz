// Both solo and room bots receive the same public view as a human in their seat.
import { botStep, handValue, projectTable } from "./table.mjs";
import { chooseDiscard, chooseTurn } from "./coach.mjs";
import { nextAfterSelf, observed } from "./reads.mjs";

const pip = (card) => (card % 13 === 0 ? 11 : Math.min(10, (card % 13) + 1));

// A publicly held pair may prove a blitz. Picks, throws and passes in that suit
// provide weaker evidence, so they influence close choices by smaller amounts.
function exposure(card, facts) {
  if (!Number.isInteger(card) || !facts) return 0;
  const suit = Math.floor(card / 13);
  const kept = [...facts.known]
    .filter((c) => Math.floor(c / 13) === suit)
    .map(pip)
    .sort((a, b) => b - a);
  if (pip(card) + (kept[0] || 0) + (kept[1] || 0) === 31) return 40;
  const evidence = Math.max(
    0,
    Math.min(
      5,
      kept.length * 1.4 +
        facts.picks[suit] * 0.5 -
        facts.drops[suit] * 0.5 -
        facts.passes[suit] * 0.22,
    ),
  );
  return (evidence * pip(card)) / 12;
}

export function playBotStep(table) {
  if (table.rules.botStyle !== "reader")
    return botStep(table, chooseTurn, chooseDiscard);
  if (table.phase === "end" || table.seats[table.turn].human) return false;
  const view = projectTable(table, table.turn);
  const receiver = nextAfterSelf(view);
  const facts = observed(view).get(receiver);
  const readerTurn = (hand, top, context) => {
    const standard = chooseTurn(hand, top, context);
    // A knock leaves the current upcard visible. Drawing stock lets us bury it.
    return standard === "knock" && exposure(top, facts) === 40
      ? "stock"
      : standard;
  };
  const readerDiscard = (four, forbidden, context) => {
    const baseline = chooseDiscard(four, forbidden, context);
    if (view.stockCount === 0 || receiver === view.knocker) return baseline;
    const keep = (card) =>
      handValue(
        four.filter((c) => c !== card),
        view.rules,
      ).score;
    const baselineScore = keep(baseline);
    if (baselineScore === 31) return baseline;
    // Preserve the baseline's future drawing value unless public evidence justifies changing.
    let best = baseline;
    let bestValue = baselineScore + 1 - exposure(baseline, facts);
    for (const card of four) {
      if (card === forbidden || card === baseline) continue;
      const value = keep(card) - exposure(card, facts);
      if (value > bestValue) {
        best = card;
        bestValue = value;
      }
    }
    return best;
  };
  return botStep(table, readerTurn, readerDiscard);
}
