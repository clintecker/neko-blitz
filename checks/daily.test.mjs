import assert from "node:assert/strict";
import test from "node:test";
import {
  DAILY_VERSION,
  dailyOutcome,
  dailyShareText,
  isDailyDone,
  localDateKey,
  readDaily,
  recordDaily,
  seedFor,
  startDaily,
} from "../app/daily.js";

// localStorage stand-in: the daily record only needs get, set and remove.
function store() {
  const items = new Map();
  return {
    items,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

const hands = (table) => table.seats.map((p) => p.hand);

test("the same date deals the same match", () => {
  const one = startDaily("2026-11-19"),
    two = startDaily("2026-11-19");
  assert.deepEqual(one.stock, two.stock);
  assert.deepEqual(hands(one), hands(two));
  assert.equal(one.discard.at(-1), two.discard.at(-1));
  assert.equal(one.turn, two.turn);
  // Two live tables still get their own match id.
  assert.notEqual(one.matchId, two.matchId);
});

test("a different date deals a different match", () => {
  assert.notEqual(seedFor("2026-11-19"), seedFor("2026-11-20"));
  assert.notDeepEqual(startDaily("2026-11-19").stock, startDaily("2026-11-20").stock);
});

test("the daily table is the default solo match with one human seat", () => {
  const table = startDaily("2026-11-19");
  assert.equal(table.seats.length, 4);
  assert.equal(table.rules.lives, 4);
  assert.deepEqual(
    table.seats.map((p) => p.human),
    [true, false, false, false],
  );
});

test("localDateKey reads the local calendar date", () => {
  // Late evening local time still belongs to that local date.
  assert.equal(localDateKey(new Date(2026, 10, 19, 23, 30)), "2026-11-19");
  assert.equal(localDateKey(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
});

test("a streak counts once per date and resets after a missed day", () => {
  const storage = store();
  assert.equal(isDailyDone("2026-11-19", storage), false);
  assert.deepEqual(recordDaily("2026-11-19", "win", storage), {
    date: "2026-11-19",
    result: "win",
    streak: 1,
  });
  assert.equal(isDailyDone("2026-11-19", storage), true);
  // A replay on the same date keeps the first result and the same streak.
  assert.equal(recordDaily("2026-11-19", "loss", storage).streak, 1);
  assert.equal(readDaily(storage).result, "win");
  assert.equal(recordDaily("2026-11-20", "win", storage).streak, 2);
  assert.equal(recordDaily("2026-11-21", "loss", storage).streak, 3);
  // Skipping 2026-11-22 starts the streak over.
  assert.equal(recordDaily("2026-11-23", "win", storage).streak, 1);
});

test("a streak crosses a month boundary", () => {
  const storage = store();
  recordDaily("2026-11-30", "win", storage);
  assert.equal(recordDaily("2026-12-01", "win", storage).streak, 2);
});

test("an unreadable record starts a fresh streak", () => {
  const storage = store();
  storage.setItem("neko-blitz.daily.v1", "{not json");
  assert.equal(readDaily(storage), null);
  assert.equal(recordDaily("2026-11-19", "win", storage).streak, 1);
});

test("a new daily version seeds a different deck", () => {
  assert.equal(seedFor("2026-11-19", DAILY_VERSION), seedFor("2026-11-19"));
  assert.notEqual(
    seedFor("2026-11-19", DAILY_VERSION + 1),
    seedFor("2026-11-19"),
  );
  assert.notDeepEqual(
    startDaily("2026-11-19", DAILY_VERSION + 1).stock,
    startDaily("2026-11-19").stock,
  );
});

test("the outcome reads the player's remaining lives", () => {
  const view = { self: 0, seats: [{ lives: 2 }, { lives: 0 }] };
  assert.deepEqual(dailyOutcome(view), { lives: 2, won: true });
  assert.deepEqual(dailyOutcome({ ...view, seats: [{ lives: 0 }, { lives: 3 }] }), {
    lives: 0,
    won: false,
  });
});

test("share copy names the date, lives and streak", () => {
  assert.equal(
    dailyShareText({ date: "2026-11-19", won: true, lives: 2, streak: 3 }),
    "Neko Blitz daily 2026-11-19: survived with 2 lives, 3-day streak",
  );
  assert.equal(
    dailyShareText({ date: "2026-11-19", won: true, lives: 1, streak: 2 }),
    "Neko Blitz daily 2026-11-19: survived with 1 life, 2-day streak",
  );
  assert.equal(
    dailyShareText({ date: "2026-11-19", won: false, lives: 0, streak: 1 }),
    "Neko Blitz daily 2026-11-19: went out, 1-day streak",
  );
});
