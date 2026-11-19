// Both solo and room bots receive the same public view as a human in their seat.
import { botStep, handValue, projectTable } from "./table.mjs";
import { chooseDiscard, chooseTurn } from "./coach.mjs";
import { nextAfterSelf, observed } from "./reads.mjs";
import { cardPips, suitOf } from "./rules.mjs";

// Public evidence per card kept in a suit, then per pick, throw and pass in it.
// The cap stops a long history from outweighing a hand's own points.
const EVIDENCE = { kept: 1.4, pick: 0.5, drop: 0.5, pass: 0.22, cap: 5 };
// An exposure this high means the public cards already prove a blitz.
const BLITZ_PROOF = 40;

// A publicly held pair may prove a blitz. Picks, throws and passes in that suit
// provide weaker evidence, so they influence close choices by smaller amounts.
function exposure(card, facts) {
  if (!Number.isInteger(card) || !facts) return 0;
  const suit = suitOf(card);
  const kept = [...facts.known]
    .filter((c) => suitOf(c) === suit)
    .map(cardPips)
    .sort((a, b) => b - a);
  if (cardPips(card) + (kept[0] || 0) + (kept[1] || 0) === 31)
    return BLITZ_PROOF;
  const evidence = Math.max(
    0,
    Math.min(
      EVIDENCE.cap,
      kept.length * EVIDENCE.kept +
        facts.picks[suit] * EVIDENCE.pick -
        facts.drops[suit] * EVIDENCE.drop -
        facts.passes[suit] * EVIDENCE.pass,
    ),
  );
  return (evidence * cardPips(card)) / 12;
}

// A knock leaves the current upcard visible. Drawing stock lets us bury it.
function withholdFromKnock(standard, top, facts) {
  return standard === "knock" && exposure(top, facts) === BLITZ_PROOF
    ? "stock"
    : standard;
}

const keepScore = (four, card) =>
  handValue(four.filter((c) => c !== card)).score;

// Keep the baseline's future drawing value unless public evidence justifies
// changing it. There is nothing left to protect after the last draw or on the
// throw that answers the knock.
function protectedThrow(four, forbidden, baseline, view, facts) {
  if (view.stockCount === 0 || nextAfterSelf(view) === view.knocker)
    return baseline;
  const baselineScore = keepScore(four, baseline);
  if (baselineScore === 31) return baseline;
  let best = baseline;
  let bestValue = baselineScore + 1 - exposure(baseline, facts);
  for (const card of four) {
    if (card === forbidden || card === baseline) continue;
    const value = keepScore(four, card) - exposure(card, facts);
    if (value > bestValue) {
      best = card;
      bestValue = value;
    }
  }
  return best;
}

// The two knobs a table-reading bot turns around the announced choices: draw
// stock rather than knock on an upcard that proves a rival blitz, and expose
// the card a neighbour can least use.
function readerDialect(view, facts) {
  return {
    knockOrStock: (hand, top, context) =>
      withholdFromKnock(chooseTurn(hand, top, context), top, facts),
    keepFour: (four, forbidden, context) =>
      protectedThrow(
        four,
        forbidden,
        chooseDiscard(four, forbidden, context),
        view,
        facts,
      ),
  };
}

export function playBotStep(table) {
  if (table.rules.botStyle !== "reader")
    return botStep(table, chooseTurn, chooseDiscard);
  if (table.phase === "end" || table.seats[table.turn].human) return false;
  const view = projectTable(table, table.turn);
  const { knockOrStock, keepFour } = readerDialect(
    view,
    observed(view).get(nextAfterSelf(view)),
  );
  return botStep(table, knockOrStock, keepFour);
}
