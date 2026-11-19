import assert from "node:assert/strict";
import test from "node:test";
import {
  act,
  botTurn,
  botStep,
  deal,
  defaults,
  handValue,
  newTable,
  projectTable,
  rulesFor,
} from "../public/game/table.mjs";
import {
  analyze,
  chooseTurn,
  chooseDiscard,
  score,
} from "../public/game/coach.mjs";

import { playBotStep } from "../public/game/arcade-bots.mjs";
import { seeded } from "./lib/rng.mjs";

// Deterministic hands make the difference between highest-pays and lowest-pays visible.
function fixed(hands, stock, payout = "highest") {
  const n = hands.length;
  const t = newTable(
    { players: n, payout },
    Array.from({ length: n }, (_, i) => i),
    {},
    seeded(7),
  );
  const used = new Set([...hands.flat(), ...stock]);
  const rest = Array.from({ length: 52 }, (_, i) => i).filter(
    (i) => !used.has(i),
  );
  t.seats.forEach((p, i) => {
    p.hand = hands[i].slice();
    p.lives = 4;
  });
  Object.assign(t, {
    phase: "draw",
    turn: 0,
    knocker: null,
    drawn: null,
    drawSource: null,
    result: null,
    events: [],
    log: [],
    stock: stock.slice(),
    discard: rest,
    openingDiscard: rest[0],
  });
  return t;
}
test("all 22,100 hands score identically in the coach and at the table", () => {
  assert.equal(defaults.lives, 4);
  assert.equal(rulesFor({ lives: 6 }).lives, 6);
  assert.equal(handValue([6, 19, 32]).score, 7);
  for (let c = 2; c < 52; c++)
    for (let b = 1; b < c; b++)
      for (let a = 0; a < b; a++)
        assert.equal(handValue([a, b, c]).score, score([a, b, c]));
});
test("only tied leaders stay safe, with no extra charge for a failed knock", () => {
  // 25,25,19,14. Seat 2 knocks. The other seats discard their fresh stock card.
  const t = fixed(
    [
      [12, 9, 4],
      [25, 22, 17],
      [38, 34, 2],
      [51, 42, 1],
    ],
    [29, 30, 31, 32],
  );
  t.turn = 2;
  act(t, 2, "knock");
  for (const [pos, id] of [3, 0, 1].entries()) {
    assert.equal(t.turn, id);
    act(t, id, "stock");
    act(t, id, "throw", t.drawn);
    if (pos < 2) assert.equal(t.phase, "draw");
  }
  assert.deepEqual(t.result.scores, [25, 25, 19, 14]);
  assert.deepEqual(t.result.paid, [0, 0, 1, 1]);
  assert.equal(t.phase, "end");
});
test("tied top knocker and all-table ties pay zero", () => {
  const t = fixed(
    [
      [12, 9, 4],
      [25, 22, 17],
    ],
    [29, 30],
  );
  act(t, 0, "knock");
  act(t, 1, "stock");
  act(t, 1, "throw", t.drawn);
  assert.deepEqual(t.result.paid, [0, 0]);
  assert.equal(t.result.replay, true);
  deal(t, seeded(11));
  assert.equal(t.round, 2);
});
test("face-up blitz trumps a pending knock and the card taken cannot be thrown back", () => {
  const t = fixed(
    [
      [25, 22, 17],
      [0, 12, 20],
    ],
    [2, 3],
  );
  const j = t.discard.indexOf(10);
  t.discard.splice(j, 1);
  t.discard.push(10);
  act(t, 0, "knock");
  act(t, 1, "discard");
  assert.throws(() => act(t, 1, "throw", 10));
  act(t, 1, "throw", 20);
  assert.equal(t.result.kind, "blitz");
  assert.deepEqual(t.result.paid, [1, 0]);
});
test("an empty stock scores the three-card hands after discarding", () => {
  const t = fixed(
    [
      [12, 9, 4],
      [25, 22, 16],
    ],
    [29],
  );
  act(t, 0, "stock");
  assert.equal(t.phase, "throw");
  act(t, 0, "throw", 29);
  assert.equal(t.result.kind, "stock");
  assert.deepEqual(t.result.paid, [0, 1]);
});
test("a seat receives its hand and public events only", () => {
  const t = fixed(
    [
      [12, 9, 4],
      [25, 22, 17],
    ],
    [29, 30],
  );
  act(t, 0, "stock");
  const seen = projectTable(t, 1);
  assert.equal(seen.drawn, null);
  assert.equal(seen.seats[0].hand, null);
  assert.equal("stock" in seen, false);
  act(t, 0, "throw", 30);
  assert.deepEqual(projectTable(t, 1).events, [
    { seat: 0, source: "stock", discard: 30 },
  ]);
});
test("the live coach proves the face-up blitz using public input", () => {
  const v = {
    active: [0, 1, 2, 3],
    self: 0,
    hand: [0, 12, 20],
    discard: [10],
    openingDiscard: 10,
    stockCount: 39,
    events: [],
    rules: defaults,
    lives: { 0: 4, 1: 4, 2: 4, 3: 4 },
  };
  const a = analyze(v, { samples: 120, seed: 12, objective: "match" });
  assert.equal(a.action, "discard");
  assert.equal(a.exact, true);
  assert.equal(a.actions.discard.discardCard, 20);
});
test("complete matches conserve all cards, cap token losses, and finish with one survivor", () => {
  for (const n of [2, 3, 4])
    for (let m = 0; m < 55; m++) {
      const random = seeded(711 * n + m),
        t = newTable(
          { players: n, lives: 4, payout: "highest" },
          [],
          {},
          random,
        );
      for (let k = 0; k < 1800; k++) {
        const cards = [
          ...t.stock,
          ...t.discard,
          ...t.seats.flatMap((s) => s.hand),
        ];
        assert.equal(cards.length, 52);
        assert.equal(new Set(cards).size, 52);
        if (t.phase === "end") {
          const top = Math.max(...t.roundSeats.map((i) => t.result.scores[i]));
          for (const i of t.roundSeats)
            assert.equal(t.result.paid[i], Number(t.result.scores[i] < top));
          if (t.result.winner != null) break;
          deal(t, random);
          continue;
        }
        assert.equal(botTurn(t, chooseTurn, chooseDiscard), true);
      }
      assert.equal(t.seats.filter((p) => p.lives > 0).length, 1);
    }
});

test("family payout: a knocker on 22 safely beats 20 and only the 17 pays", () => {
  // 22,26,20,17 in the four suits. Each final turn throws back its fresh stock card.
  const t = fixed(
    [
      [12, 8, 2],
      [25, 22, 18],
      [38, 35, 1],
      [51, 45, 27],
    ],
    [3, 4, 5, 6],
    "lowest",
  );
  act(t, 0, "knock");
  for (const i of [1, 2, 3]) {
    act(t, i, "stock");
    act(t, i, "throw", t.drawn);
  }
  assert.deepEqual(t.result.scores, [22, 26, 20, 17]);
  assert.deepEqual(t.result.paid, [0, 0, 0, 1]);
});
test("family payout: failed knock is one token and tied-low behavior follows table setup", () => {
  for (const safe of [true, false]) {
    const t = fixed(
      [
        [12, 9, 4],
        [25, 22, 17],
      ],
      [29, 30],
      "lowest",
    );
    t.rules.tieSafe = safe;
    act(t, 0, "knock");
    act(t, 1, "stock");
    act(t, 1, "throw", t.drawn);
    assert.deepEqual(t.result.paid, safe ? [0, 1] : [1, 0]);
  }
  const t = fixed(
    [
      [12, 9, 3],
      [25, 22, 17],
    ],
    [29, 30],
    "lowest",
  );
  act(t, 0, "knock");
  act(t, 1, "stock");
  act(t, 1, "throw", t.drawn);
  assert.deepEqual(t.result.paid, [1, 0]);
});

test("both draw sources and a separate face-up throw are visible across seats", () => {
  for (const source of ["stock", "discard"]) {
    const t = fixed(
      [
        [9, 11, 51],
        [13, 24, 4],
        [41, 37, 7],
      ],
      [2, 25],
      "lowest",
    );
    t.seats[0].human = false;
    const before = t.discard.at(-1);
    const face = source === "stock" ? null : before;
    botStep(
      t,
      () => source,
      (cards) => cards[0],
    );
    const other = projectTable(t, 1);
    assert.equal(other.phase, "throw");
    assert.equal(other.seats[0].count, 4);
    assert.equal(other.seats[0].hand, null);
    assert.equal(other.drawn, face);
    assert.deepEqual(other.log.at(-1), {
      seat: 0,
      kind: source === "stock" ? "stock" : "take",
      card: face,
      source: null,
    });
    botStep(
      t,
      () => source,
      (cards) => cards[0],
    );
    const after = projectTable(t, 1);
    assert.equal(after.log.at(-1).kind, "throw");
    assert.equal(after.log.at(-1).card, 9);
    assert.equal(after.discard.at(-1), 9);
    assert.equal(after.seats[0].count, 3);
  }
});

test("a table-reading bot protects the same 20 by withholding the king its neighbor needs", () => {
  for (const [ace, queen, danger, safe] of [
    [13, 24, 25, 51],
    [39, 50, 51, 25],
  ]) {
    const t = fixed(
      [
        [9, 11, safe],
        [ace, queen, 4],
        [41, 37, 7],
      ],
      [2, danger],
      "lowest",
    );
    t.seats[0].human = false;
    t.rules.botStyle = "reader";
    // These were visible exchanges. The reader receives only its own projected seat.
    t.events = [
      { seat: 1, source: "discard", picked: ace, discard: 3 },
      { seat: 2, source: "stock", discard: queen },
      { seat: 1, source: "discard", picked: queen, discard: 5 },
    ];
    act(t, 0, "stock");
    assert.equal(playBotStep(t), true);
    assert.equal(t.discard.at(-1), safe);
    assert.equal(handValue(t.seats[0].hand).score, 20);
  }
});

test("both bot styles complete lowest-only matches with conserved cards and a single survivor", () => {
  for (const botStyle of ["arcade", "reader"])
    for (const players of [2, 3, 4]) {
      for (let seed = 1; seed <= 10; seed++) {
        const random = seeded(seed * 301 + players);
        const table = newTable({ players, botStyle }, [], {}, random);
        for (let i = 0; i < 2400 && table.result?.winner == null; i++) {
          if (table.phase === "end") {
            const cards = [
              ...table.stock,
              ...table.discard,
              ...table.seats.flatMap((p) => p.hand),
            ];
            assert.equal(new Set(cards).size, 52);
            assert.ok(table.result.paid.every((n) => n === 0 || n === 1));
            deal(table, random);
          } else assert.equal(playBotStep(table), true);
        }
        assert.equal(table.seats.filter((p) => p.lives > 0).length, 1);
      }
    }
});
