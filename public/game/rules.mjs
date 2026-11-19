// Card arithmetic and round settlement shared by the table, the coach and the
// browser bots.
// Card IDs: 13 cards per suit, A=0 through K=12, suits in blocks of 13.
// Pure values only, so this file also runs on the request path and in Node.
export const defaults = Object.freeze({
  players: 4,
  lives: 4,
  tieSafe: true,
  botStyle: "arcade",
  payout: "lowest",
});

export const cardPips = (card) =>
  card % 13 === 0 ? 11 : Math.min(10, (card % 13) + 1);

export const suitOf = (card) => Math.floor(card / 13);

// The best single-suit total.
export function scoreHand(hand) {
  const sums = [0, 0, 0, 0];
  for (const c of hand) sums[suitOf(c)] += cardPips(c);
  const score = Math.max(...sums);
  return { score, suit: sums.indexOf(score) };
}

// One round's token charges, computed the same way for the live table and the
// coach's rollouts. Scores are indexed by seat, with null for a seat that sat
// the round out. `blitz` lists the seats that made 31 and is empty otherwise.
// A round nobody pays, or one that would empty every remaining stack, replays.
export function settleRound({ scores, lives, knocker, blitz = [], rules }) {
  const active = scores.flatMap((s, i) => (s == null ? [] : [i]));
  const charges = lives.map(() => 0);
  const high = Math.max(...active.map((i) => scores[i]));
  const leaders = blitz.length
    ? blitz
    : active.filter((i) => scores[i] === high);
  if (blitz.length || rules.payout === "highest") {
    for (const i of active) charges[i] = Number(!leaders.includes(i));
  } else {
    const low = Math.min(...active.map((i) => scores[i]));
    const tied = active.filter((i) => scores[i] === low);
    // With a knocker in a bottom tie, the table selects which side of the tie
    // pays. A round with no knocker charges every low seat.
    const payers =
      tied.length > 1 && tied.includes(knocker)
        ? rules.tieSafe
          ? tied.filter((i) => i !== knocker)
          : [knocker]
        : tied;
    for (const i of payers) charges[i] = 1;
  }
  const replay =
    active.every((i) => charges[i] === 0) ||
    active.every((i) => charges[i] >= lives[i]);
  const paid = charges.map((v, i) => (replay ? 0 : Math.min(v, lives[i])));
  const survivors = lives.flatMap((v, i) => (v - paid[i] > 0 ? [i] : []));
  return {
    charges,
    paid,
    replay,
    leaders,
    winner: survivors.length === 1 ? survivors[0] : null,
  };
}
