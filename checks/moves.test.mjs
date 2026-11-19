import test from "node:test";
import assert from "node:assert/strict";
import { logLine } from "../app/log-line.js";
import { eventKinds, logKinds, moveCopy, moveKinds } from "../app/moves.js";

const view = {
  self: 0,
  seats: [
    { name: "Nova" },
    { name: "Mochi" },
    { name: "Pip" },
    { name: "Hex" },
  ],
  round: 2,
  openingDiscard: 0,
};
const line = (e) => logLine(view, e);

test("every log kind reads its own line", () => {
  assert.equal(
    line({ seat: null, kind: "deal" }),
    "Round 2 dealt. A♠ opens the pile.",
  );
  assert.equal(
    line({ seat: 1, kind: "stock", card: null }),
    "Mochi drew a face-down stock card.",
  );
  assert.equal(
    line({ seat: 1, kind: "take", card: 12 }),
    "Mochi took K♠ from the discard pile.",
  );
  assert.equal(
    line({ seat: 0, kind: "throw", card: 25 }),
    "You discarded K♥ from hand.",
  );
  assert.equal(
    line({ seat: 2, kind: "knock" }),
    "Pip knocked. One last turn each.",
  );
  assert.equal(line({ seat: 0, kind: "blitz" }), "You hit 31!");
  assert.equal(
    line({ seat: 2, kind: "showdown" }),
    "Cards up. The round is over.",
  );
  assert.equal(
    line({ seat: 0, kind: "play", card: 9, source: "stock" }),
    "You drew stock and discarded 10♠.",
  );
  assert.equal(
    line({ seat: 1, kind: "play", card: 9, source: "discard" }),
    "Mochi took the discard and discarded 10♠.",
  );
  assert.equal(line({ seat: 0, kind: "turn" }), "Your turn.");
  assert.equal(line({ seat: 3, kind: "turn" }), "Hex’s turn.");
});

test("unknown kinds narrate nothing instead of a wrong turn", () => {
  assert.equal(line({ seat: 1, kind: "shuffle" }), "");
  assert.equal(line({ seat: null, kind: undefined }), "");
});

// The two kind lists are the vocabulary the motion filter and the feed share.
test("every kind in the vocabulary narrates a line", () => {
  for (const kind of [...eventKinds, "turn"])
    assert.notEqual(
      line({ seat: 0, kind, card: 12, source: "stock" }),
      "",
      `${kind} narrates`,
    );
});

test("one kind list feeds the motion filter, captions and statuses", () => {
  assert.deepEqual(eventKinds, [...moveKinds, ...logKinds]);
  for (const kind of moveKinds) {
    const copy = moveCopy[kind];
    assert.ok(copy.status, `${kind} has a status`);
    assert.ok(copy.detail, `${kind} has a caption detail`);
    // Captions read in the second person on your own turn.
    assert.notEqual(
      copy.text("Mochi", false, 12),
      copy.text("Mochi", true, 12),
    );
  }
  assert.equal(moveCopy.stock.text("Mochi", false), "Mochi draws from stock");
  assert.equal(moveCopy.take.text("You", true, 12), "You take K♠");
  assert.equal(moveCopy.throw.text("Mochi", false, 25), "Mochi discards K♥");
  assert.equal(moveCopy.stock.status, "Drawing from stock…");
  assert.equal(moveCopy.stock.detail, "Face down");
  assert.equal(moveCopy.take.status, "Taking the face-up card…");
  assert.equal(moveCopy.take.detail, "From discard");
  assert.equal(moveCopy.throw.status, "Discarding from hand…");
  assert.equal(moveCopy.throw.detail, "From hand");
  assert.equal(moveCopy.knock.status, "Knocked. Final turns begin.");
  assert.equal(moveCopy.knock.detail, "One last turn");
  assert.equal(moveCopy.knock.text("You", true), "You knock");
});
