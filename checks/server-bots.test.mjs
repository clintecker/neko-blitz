import assert from "node:assert/strict";
import test from "node:test";
import {
  act,
  botStep,
  botTurn,
  deal,
  handValue,
  newTable,
} from "../public/game/table.mjs";
import { chooseDiscard, chooseTurn } from "../public/game/arcade-policy.mjs";
import { playBotStep } from "../public/game/arcade-bots.mjs";
import { cardPips } from "../public/game/rules.mjs";
import { createTableHandler } from "../app/api/table/handler.js";
import { postTable } from "./lib/api-request.mjs";
import { seeded } from "./lib/rng.mjs";

// The house policy must never hand act() a move it rejects: a violation leaves
// the room waiting on a seat nobody holds.
const MOVES = ["knock", "stock", "discard"];

// A table laid out by hand. act() only checks whose turn it is, the acting
// seat's own cards and the two piles, so an arbitrary layout is enough to ask
// whether a policy move would be accepted.
function laid({ players, hands, stock, discard, turn = 0, knocker = null }) {
  const t = newTable({ players }, [], {}, seeded(1));
  t.seats.forEach((p, i) => {
    p.hand = (hands[i] || []).slice();
    p.lives = 4;
  });
  Object.assign(t, {
    phase: "draw",
    turn,
    knocker,
    drawn: null,
    drawSource: null,
    result: null,
    events: [],
    log: [],
    stock: stock.slice(),
    discard: discard.slice(),
    openingDiscard: discard[0],
  });
  return t;
}

// A shuffled full deck, so every fuzz case draws from real, distinct cards.
function deckFor(seed) {
  const random = seeded(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// The policy's own context, shaped the way botStep builds it.
const contextFor = (t) => ({
  rules: t.rules,
  players: t.roundSeats.length,
  turns: 0,
  final: t.knocker != null || t.stock.length === 0,
});

// One half-turn for a seat no bot drives: the same policy, through act().
function playSeat(t) {
  const seat = t.turn;
  if (t.phase === "draw")
    act(
      t,
      seat,
      chooseTurn(t.seats[seat].hand, t.discard.at(-1), contextFor(t)),
    );
  else {
    const forbidden = t.drawSource === "discard" ? t.drawn : null;
    act(t, seat, "throw", chooseDiscard(t.seats[seat].hand, forbidden));
  }
}

test("every three-card hand draws only moves act() accepts", () => {
  const seen = new Set();
  const tops = [0, 13, 26, 39, 10, 23, 36, 49];
  for (let c = 2; c < 52; c++)
    for (let b = 1; b < c; b++)
      for (let a = 0; a < b; a++) {
        const hand = [a, b, c];
        for (const top of tops) {
          if (hand.includes(top)) continue;
          const t = laid({
            players: 4,
            hands: [hand, [1, 4, 7], [2, 5, 8], [3, 6, 9]],
            stock: [11, 12, 14, 15],
            discard: [top],
          });
          const move = chooseTurn(hand, top, contextFor(t));
          assert.ok(MOVES.includes(move), `${hand} +${top} -> ${move}`);
          seen.add(move);
          act(t, 0, move);
          if (t.phase === "throw" && t.turn === 0) {
            const four = t.seats[0].hand;
            const forbidden = t.drawSource === "discard" ? t.drawn : null;
            const card = chooseDiscard(four, forbidden);
            assert.ok(four.includes(card), `${four} threw ${card}`);
            assert.notEqual(card, forbidden);
            act(t, 0, "throw", card);
          }
        }
      }
  // All three branches have to be reachable, or the coverage above is empty.
  assert.deepEqual([...seen].sort(), MOVES.slice().sort());
});

test("random layouts, phases and piles meet act() without a violation", () => {
  const seen = { knock: 0, stock: 0, discard: 0 };
  for (let seed = 1; seed <= 1200; seed++) {
    const deck = deckFor(seed);
    const players = 2 + (seed % 3);
    const hands = Array.from({ length: players }, (_, i) =>
      deck.slice(3 * i, 3 * i + 3),
    );
    const stock = deck.slice(12, 24);
    // Every seventh case has an empty pile and no knocker history at all.
    const discard = seed % 7 === 0 ? [] : deck.slice(24, 40);
    // Every fourth case has already been knocked, so a second knock is illegal.
    const knocker = seed % 4 === 0 ? 1 : null;
    const t = laid({ players, hands, stock, discard, knocker });
    const hand = t.seats[0].hand;
    const move = chooseTurn(hand, t.discard.at(-1), contextFor(t));
    assert.ok(MOVES.includes(move), `${hand} -> ${move}`);
    if (!t.discard.length) assert.notEqual(move, "discard");
    if (knocker != null) assert.notEqual(move, "knock");
    seen[move]++;
    act(t, 0, move);
    if (t.phase === "throw" && t.turn === 0) {
      const four = t.seats[0].hand;
      const forbidden = t.drawSource === "discard" ? t.drawn : null;
      const card = chooseDiscard(four, forbidden, contextFor(t));
      assert.ok(Number.isInteger(card) && four.includes(card));
      assert.notEqual(card, forbidden);
      act(t, 0, "throw", card);
    }
  }
  assert.ok(seen.knock > 0 && seen.stock > 0 && seen.discard > 0, `${seen}`);
});

test("the throw keeps the best three cards and never returns the forbidden one", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const deck = deckFor(seed + 9000);
    const four = deck.slice(0, 4);
    for (const forbidden of [null, ...four]) {
      const card = chooseDiscard(four, forbidden, {});
      const kept = four.filter((c) => c !== card);
      const scored = four
        .filter((c) => c !== forbidden)
        .map((c) => ({
          card: c,
          score: handValue(four.filter((f) => f !== c)).score,
        }));
      const best = Math.max(...scored.map((s) => s.score));
      // Equal-score throws give away the lower pip, then the lower card id.
      const expected = scored
        .filter((s) => s.score === best)
        .map((s) => s.card)
        .sort((x, y) => cardPips(x) - cardPips(y) || x - y)[0];
      assert.equal(kept.length, 3);
      assert.equal(card, expected, `${four} minus ${forbidden}`);
      assert.equal(handValue(kept).score, best);
    }
  }
});

test("a room bot step runs the pair it is handed", () => {
  // 9 pips in spades and a king up: no gain worth taking, so the draw is stock.
  const t = laid({
    players: 4,
    hands: [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]],
    stock: [13, 14],
    discard: [51],
  });
  const calls = [];
  const turn = (hand, top, context) => (
    calls.push("turn"), chooseTurn(hand, top, context)
  );
  const discard = (four, forbidden, context) => (
    calls.push("discard"), chooseDiscard(four, forbidden, context)
  );
  assert.equal(playBotStep(t, turn, discard), true);
  assert.equal(playBotStep(t, turn, discard), true);
  assert.deepEqual(calls, ["turn", "discard"]);
});

test("a reader room keeps its own dialect instead of the injected pair", () => {
  const t = laid({
    players: 4,
    hands: [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]],
    stock: [13, 14],
    discard: [51],
  });
  t.rules.botStyle = "reader";
  const calls = [];
  const turn = () => (calls.push("turn"), "stock");
  const discard = () => (calls.push("discard"), 1);
  assert.equal(playBotStep(t, turn, discard), true);
  assert.deepEqual(calls, []);
});

test("matches driven only by the house policy conserve cards and crown one seat", () => {
  for (const players of [2, 3, 4])
    for (let seed = 1; seed <= 10; seed++) {
      const random = seeded(seed * 601 + players);
      const table = newTable({ players }, [], {}, random);
      for (let i = 0; i < 20000 && table.result?.winner == null; i++) {
        const cards = [
          ...table.stock,
          ...table.discard,
          ...table.seats.flatMap((p) => p.hand),
        ];
        assert.equal(cards.length, 52);
        assert.equal(new Set(cards).size, 52);
        if (table.phase === "end") {
          deal(table, random);
          continue;
        }
        assert.equal(botTurn(table, chooseTurn, chooseDiscard), true);
      }
      assert.equal(table.seats.filter((p) => p.lives > 0).length, 1);
      assert.ok(table.result.paid.every((n) => n === 0 || n === 1));
    }
});

test("a three-bot room with one human seat reaches a winner", () => {
  for (let seed = 1; seed <= 8; seed++) {
    const random = seeded(seed * 97);
    const human = seed % 4;
    const table = newTable({ players: 4 }, [human], {}, random);
    for (let i = 0; i < 20000 && table.result?.winner == null; i++) {
      if (table.phase === "end") deal(table, random);
      else if (table.seats[table.turn].human) playSeat(table);
      else assert.equal(botStep(table, chooseTurn, chooseDiscard), true);
    }
    assert.notEqual(table.result?.winner, null, `seed ${seed} stalled`);
    assert.ok(table.round <= 40, `seed ${seed} needed ${table.round} rounds`);
  }
});

// The in-memory D1 shape checks/room-exit.test.mjs uses: SELECT by code plus
// the INSERT/UPDATE the handler issues.
function fakeRoom() {
  const rows = new Map();
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              return rows.get(args[0]) || null;
            },
            async run() {
              let changes = 0;
              if (sql.startsWith("INSERT")) {
                const [code, updated, body] = args;
                if (!rows.has(code)) {
                  rows.set(code, { revision: 1, updated, body });
                  changes = 1;
                }
              } else if (sql.startsWith("UPDATE")) {
                const [body, updated, code, revision] = args;
                if (rows.get(code)?.revision === revision) {
                  rows.set(code, { body, updated, revision: revision + 1 });
                  changes = 1;
                }
              }
              return { meta: { changes } };
            },
          };
        },
      };
    },
  };
  return { rows, db };
}

// The move the house policy makes next, read off the stored room as a bot tick
// would see it, in the shape table.mjs log() writes.
function expectedMove(table) {
  const seat = table.seats[table.turn];
  if (table.phase === "draw") {
    const top = table.discard.at(-1);
    const action = chooseTurn(seat.hand, top, {
      rules: table.rules,
      players: table.roundSeats.length,
      final: table.knocker != null,
    });
    return action === "discard"
      ? { seat: seat.id, kind: "take", card: top, source: null }
      : { seat: seat.id, kind: action, card: null, source: null };
  }
  return {
    seat: seat.id,
    kind: "throw",
    card: chooseDiscard(
      seat.hand,
      table.drawSource === "discard" ? table.drawn : null,
    ),
    source: table.drawSource,
  };
}

test("a room poll plays the house policy, not the coach's", async () => {
  const { rows, db } = fakeRoom();
  let clock = Date.UTC(2026, 0, 1);
  const post = postTable(
    "https://blitz.test",
    createTableHandler({ db, now: () => clock }),
  );
  // Rooms disagree with the coach on roughly a third of beats, so a handful of
  // three-bot rooms makes a coach regression overwhelmingly clear.
  let beats = 0;
  for (let room = 0; room < 8 && beats < 30; room++) {
    const host = (await post("create", { name: "Host", rules: { players: 4 } }))
      .data;
    // Guests who leave turn their seats into bots: the host then faces three
    // bot seats, six beats in a row.
    for (const name of ["Bo", "Cy", "Di"]) {
      const guest = (await post("join", { code: host.code, name })).data;
      await post("leave", { code: host.code }, guest.token);
    }
    // Joins and leaves bumped the revision; a waiting room has no bots to
    // tick, so polling for it is free.
    const current = async () =>
      (await post("state", { code: host.code }, host.token)).data.revision;
    const dealt = await post(
      "start",
      { code: host.code, revision: await current() },
      host.token,
    );
    assert.equal(dealt.status, 200);
    // One deal in two hundred is a face-up blitz, which ends the round.
    const drawn = await post(
      "move",
      { code: host.code, revision: dealt.data.revision, action: "stock" },
      host.token,
    );
    if (drawn.status !== 200) continue;
    const thrown = await post(
      "move",
      {
        code: host.code,
        revision: drawn.data.revision,
        action: "throw",
        card: drawn.data.view.hand[0],
      },
      host.token,
    );
    assert.equal(thrown.status, 200);
    for (let beat = 0; beat < 6; beat++) {
      const before = JSON.parse(rows.get(host.code).body).table;
      // A blitz or a depleted stock can end the round mid-run.
      if (before.phase === "end" || before.seats[before.turn].human) break;
      const expected = expectedMove(before);
      clock += 2000;
      const polled = await post("state", { code: host.code }, host.token);
      assert.equal(polled.status, 200);
      const after = JSON.parse(rows.get(host.code).body).table;
      // One poll is one half-turn; a showdown row may follow the move.
      assert.deepEqual(after.log[before.log.length], expected);
      beats++;
    }
  }
  assert.ok(beats >= 24, `only ${beats} beats`);
});
