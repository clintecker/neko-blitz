// The host owns this state. Use projectTable() before sending anything to a seat.
import { defaults, scoreHand, settleRound } from "./rules.mjs";

export { defaults };
export const crew = ["Player", "Mochi", "Pip", "Hex"];
export const suits = ["♠", "♥", "♣", "♦"];
export const suitNames = ["spades", "hearts", "clubs", "diamonds"];
export const ranks = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];
export const cardText = (c) => `${ranks[c % 13]}${suits[Math.floor(c / 13)]}`;
export const fullCard = (c) =>
  `${{ A: "Ace", J: "Jack", Q: "Queen", K: "King" }[ranks[c % 13]] || ranks[c % 13]} of ${suitNames[Math.floor(c / 13)]}`;

// A caller broke a table rule. The message is user-facing copy, so routes map this type to 409.
export class RuleViolation extends Error {}

export function rulesFor(input = {}) {
  const integer = (v, min, max, fallback) =>
    Number.isInteger(v) && v >= min && v <= max ? v : fallback;
  return {
    players: integer(input.players, 2, 4, 4),
    lives: integer(input.lives, 1, 6, 4),
    botStyle: input.botStyle === "reader" ? "reader" : "arcade",
    payout: input.payout === "highest" ? "highest" : "lowest",
    tieSafe: input.tieSafe !== false,
  };
}

export function handValue(hand) {
  return scoreHand(hand);
}

// A shuffle function can be injected for replayable tests. A real table uses crypto entropy.
export function shuffled(
  random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296,
) {
  const cards = Array.from({ length: 52 }, (_, i) => i);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function newTable(
  input = defaults,
  humanSeats = [0],
  names = {},
  random,
) {
  const rules = rulesFor(input);
  const seats = Array.from({ length: rules.players }, (_, i) => ({
    id: i,
    name: names[i] || crew[i],
    human: humanSeats.includes(i),
    lives: rules.lives,
    hand: [],
  }));
  const table = {
    matchId: crypto.randomUUID(),
    rules,
    seats,
    round: 0,
    dealer: seats.length - 1,
  };
  return deal(table, random);
}

function nextSeat(table, id, ids = table.roundSeats) {
  for (let offset = 1; offset <= table.seats.length; offset++) {
    const candidate = (id + offset) % table.seats.length;
    if (ids.includes(candidate)) return candidate;
  }
  throw new RuleViolation("The table has no active seat.");
}

function log(table, seat, kind, card = null, source = null) {
  table.log.push({ seat, kind, card, source });
}

export function deal(table, random) {
  if (table.round && table.phase !== "end")
    throw new RuleViolation("Finish this round before dealing.");
  const active = table.seats.filter((p) => p.lives > 0).map((p) => p.id);
  if (active.length < 2) throw new RuleViolation("The match has a winner.");
  if (table.round) table.dealer = nextSeat(table, table.dealer, active);
  table.round++;
  table.roundSeats = active;
  table.stock = shuffled(random);
  table.discard = [];
  table.events = [];
  table.log = [];
  table.knocker = null;
  table.drawn = null;
  table.drawSource = null;
  table.result = null;
  table.phase = "draw";
  table.turn = nextSeat(table, table.dealer);
  for (const p of table.seats) p.hand = [];
  for (let i = 0; i < 3; i++) {
    let pos = table.turn;
    for (let j = 0; j < active.length; j++) {
      table.seats[pos].hand.push(table.stock.pop());
      pos = nextSeat(table, pos);
    }
  }
  table.openingDiscard = table.stock.pop();
  table.discard.push(table.openingDiscard);
  log(table, null, "deal");
  const blitz = active.filter(
    (i) => handValue(table.seats[i].hand).score === 31,
  );
  if (blitz.length) finish(table, "blitz", blitz);
  return table;
}

function finish(table, kind, blitz = []) {
  const ids = table.roundSeats;
  const scores = table.seats.map((p) =>
    ids.includes(p.id) ? handValue(p.hand).score : null,
  );
  const before = table.seats.map((p) => p.lives);
  const { leaders, paid, replay, winner } = settleRound({
    scores,
    lives: before,
    knocker: table.knocker,
    blitz,
    rules: table.rules,
  });
  table.seats.forEach((p, i) => {
    p.lives -= paid[i];
  });
  table.phase = "end";
  table.drawn = null;
  table.drawSource = null;
  table.result = {
    kind,
    blitz,
    leaders,
    scores,
    paid,
    before,
    replay,
    winner,
  };
  log(
    table,
    blitz[0] ?? table.knocker,
    kind === "blitz" ? "blitz" : "showdown",
  );
}

export function act(table, seat, action, card = null) {
  if (table.phase === "end" || table.turn !== seat)
    throw new RuleViolation("Wait for your turn.");
  const player = table.seats[seat];
  if (table.phase === "draw") {
    if (action === "knock") {
      if (table.knocker != null)
        throw new RuleViolation("Someone has already knocked.");
      table.knocker = seat;
      log(table, seat, "knock");
      table.turn = nextSeat(table, seat);
      return table;
    }
    if (action !== "stock" && action !== "discard")
      throw new RuleViolation("Choose the stock or discard pile.");
    const pile = action === "stock" ? table.stock : table.discard;
    if (!pile.length) throw new RuleViolation("That pile is empty.");
    table.drawn = pile.pop();
    table.drawSource = action;
    log(
      table,
      seat,
      action === "stock" ? "stock" : "take",
      action === "stock" ? null : table.drawn,
    );
    player.hand.push(table.drawn);
    table.phase = "throw";
    return table;
  }
  if (
    action !== "throw" ||
    !Number.isInteger(card) ||
    !player.hand.includes(card)
  )
    throw new RuleViolation("Select one card from your hand to discard.");
  if (table.drawSource === "discard" && table.drawn === card)
    throw new RuleViolation("Keep the card you just took from the discard pile.");
  player.hand.splice(player.hand.indexOf(card), 1);
  table.discard.push(card);
  const event = { seat, source: table.drawSource, discard: card };
  if (table.drawSource === "discard") event.picked = table.drawn;
  // Every events push needs a matching log row: events feed coach inference, log is UI narration.
  table.events.push(event);
  // Keep this log row in step with the events push above.
  log(table, seat, "throw", card, table.drawSource);
  table.drawn = null;
  table.drawSource = null;
  if (handValue(player.hand).score === 31) {
    finish(table, "blitz", [seat]);
    return table;
  }
  const next = nextSeat(table, seat);
  if (table.stock.length === 0) finish(table, "stock");
  else if (next === table.knocker) finish(table, "knock");
  else {
    table.turn = next;
    table.phase = "draw";
  }
  return table;
}

export function botStep(table, chooseTurn, chooseDiscard) {
  const p = table.seats[table.turn];
  if (table.phase === "end" || p.human) return false;
  const context = {
    rules: table.rules,
    players: table.roundSeats.length,
    turns: table.events.filter((e) => e.seat === p.id).length,
    final: table.knocker != null,
  };
  if (table.phase === "draw") {
    const action = chooseTurn(p.hand, table.discard.at(-1), context);
    act(table, p.id, action);
    return true;
  }
  const forbidden = table.drawSource === "discard" ? table.drawn : null;
  act(
    table,
    p.id,
    "throw",
    chooseDiscard(p.hand, forbidden, {
      ...context,
      final: context.final || table.stock.length === 0,
    }),
  );
  return true;
}

// A complete bot turn is useful for deterministic match replay. Live tables pace these two beats separately.
export function botTurn(table, chooseTurn, chooseDiscard) {
  const actor = table.turn;
  if (!botStep(table, chooseTurn, chooseDiscard)) return false;
  if (table.phase === "throw" && table.turn === actor)
    botStep(table, chooseTurn, chooseDiscard);
  return true;
}

export function projectTable(table, self) {
  // Even after a showdown only this round's three-card hands become public. The stock stays private.
  return {
    self,
    matchId: table.matchId,
    rules: table.rules,
    round: table.round,
    dealer: table.dealer,
    active: table.roundSeats,
    seats: table.seats.map((p) => ({
      id: p.id,
      name: p.name,
      human: p.human,
      lives: p.lives,
      count: p.hand.length,
      hand: p.id === self || table.phase === "end" ? p.hand.slice() : null,
    })),
    hand: table.seats[self].hand.slice(),
    openingDiscard: table.openingDiscard,
    discard: table.discard.slice(),
    stockCount: table.stock.length,
    phase: table.phase,
    turn: table.turn,
    knocker: table.knocker,
    drawn:
      table.phase === "throw" &&
      (self === table.turn || table.drawSource === "discard")
        ? table.drawn
        : null,
    drawSource: table.drawSource,
    events: table.events.slice(),
    log: table.log.slice(),
    result: table.result,
    lives: Object.fromEntries(table.seats.map((p) => [p.id, p.lives])),
  };
}
