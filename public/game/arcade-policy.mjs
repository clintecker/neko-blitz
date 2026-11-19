// The house policy for room bots: pip-greedy, no evidence read, no sampling,
// no lookup tables. It exists so a bot tick on the request path never builds
// coach.mjs's tables(). It must only ever return moves act() accepts, since a
// rejected move leaves the room waiting on a seat nobody holds.
import { cardPips } from "./rules.mjs";
import { handValue } from "./table.mjs";

// Knock on an already strong one-lower; below this the policy keeps drawing,
// because a failed knock costs a token.
const KNOCK_AT = 26;
// Taking the upcard forbids throwing it back, so it has to lift the best
// three-card score by this much to be worth the pick.
const TAKE_GAIN = 2;

// Score of the three cards left after dropping the card at `drop`.
function keptScore(four, drop) {
  return handValue(four.slice(0, drop).concat(four.slice(drop + 1))).score;
}

// The throw that leaves the best hand. Ties give away the lower pip, then the
// lower card id, so the same four cards always produce the same throw.
// `forbidden` is the card just taken from the discard pile.
function throwIndex(four, forbidden) {
  let best = -1;
  for (let i = 0; i < four.length; i++) {
    if (four[i] === forbidden) continue;
    if (best === -1) {
      best = i;
      continue;
    }
    const score = keptScore(four, i);
    const bestScore = keptScore(four, best);
    if (
      score > bestScore ||
      (score === bestScore &&
        (cardPips(four[i]) < cardPips(four[best]) ||
          (cardPips(four[i]) === cardPips(four[best]) &&
            four[i] < four[best])))
    )
      best = i;
  }
  return best === -1 ? 0 : best;
}

// Draw-phase choice with the three-card hand and the face-up upcard. Returns
// only "knock", "stock" or "discard". A second knock is illegal, so the
// caller's context.final (someone has knocked) rules the knock out.
export function chooseTurn(hand, top, context = {}) {
  const held = handValue(hand).score;
  if (!context.final && held >= KNOCK_AT) return "knock";
  // No upcard to take (or a stock-out mid-round, which cannot reach a live
  // draw phase) means the stock is the only legal draw.
  if (!Number.isInteger(top)) return "stock";
  const four = hand.concat(top);
  return keptScore(four, throwIndex(four, top)) >= held + TAKE_GAIN
    ? "discard"
    : "stock";
}

// Throw-phase choice: always returns one of the four cards. The context
// argument botStep also passes is unused; the forbidden card is the whole of
// what the throw needs.
export function chooseDiscard(four, forbidden = null) {
  return four[throwIndex(four, forbidden)];
}
