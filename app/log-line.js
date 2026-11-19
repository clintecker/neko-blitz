import { cardText } from "../public/game/table.mjs";
import { seatName } from "./format.js";

const prose = {
  stock: (v, e, who) => `${who} drew a face-down stock card.`,
  take: (v, e, who) => `${who} took ${cardText(e.card)} from the discard pile.`,
  throw: (v, e, who) => `${who} discarded ${cardText(e.card)} from hand.`,
  deal: (v) =>
    `Round ${v.round} dealt. ${cardText(v.openingDiscard)} opens the pile.`,
  knock: (v, e, who) => `${who} knocked. One last turn each.`,
  blitz: (v, e, who) => `${who} hit 31!`,
  showdown: () => "Cards up. The round is over.",
  play: (v, e, who) =>
    `${who} ${e.source === "stock" ? "drew stock" : "took the discard"} and discarded ${cardText(e.card)}.`,
  // No table path logs a bare turn; kept so such a row still reads.
  turn: (v, e, who) => `${e.seat === v.self ? "Your" : who + "’s"} turn.`,
};

// Unknown kinds render nothing rather than a guess at whose turn it was.
export function logLine(view, e) {
  const line = prose[e.kind];
  if (!line) return "";
  return line(view, e, e.seat == null ? "" : seatName(view, e.seat));
}
