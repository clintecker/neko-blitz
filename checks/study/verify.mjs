// Local regression checks and an independently simulated tournament audit.
import assert from "node:assert/strict";
import {
  analyze,
  chooseDiscard,
  chooseTurn,
  score,
  matchEquity,
} from "../../public/game/coach.mjs";
function random(seed) {
  let x = seed >>> 0;
  return () => {
    x += 0x6d2b79f5;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(rng) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
const rules = {
  payout: process.argv[3] ?? "lowest",
  triples: false,
  tieSafe: true,
  failedKnock: 1,
};
for (const triples of [false, true]) {
  let count = 0;
  for (let c = 2; c < 52; c++)
    for (let b = 1; b < c; b++)
      for (let a = 0; a < b; a++) {
        const hand = [a, b, c],
          suit = [0, 0, 0, 0];
        for (const v of hand)
          suit[Math.floor(v / 13)] +=
            v % 13 === 0 ? 11 : Math.min(10, (v % 13) + 1);
        const legacyTriple = triples && a % 13 === b % 13 && b % 13 === c % 13;
        assert.equal(
          score(hand, { ...rules, triples }),
          legacyTriple ? 30.5 : Math.max(...suit),
        );
        count++;
      }
  assert.equal(count, 22100);
}
for (const n of [2, 3, 4]) {
  assert.ok(Math.abs(matchEquity(Array(n).fill(4), rules) - 1 / n) < 1e-12);
  const active = Array.from({ length: n }, (_, i) => i);
  const view = {
    hand: [0, 12, 20],
    active,
    self: 0,
    discard: [10],
    openingDiscard: 10,
    rules,
  };
  for (const objective of ["round", "match", "safe"]) {
    const a = analyze(view, { seed: 31, samples: 240, objective });
    assert.equal(a.action, "discard");
    assert.equal(a.exact, true);
    assert.equal(a.actions.discard.value, 1);
    assert.equal(a.actions.discard.ownLossChance, 0);
    assert.equal(a.actions.discard.blitzChance, 1);
    assert.equal(a.actions.discard.safeChance, 1);
    assert.equal(a.actions.discard.discardCard, 20);
  }
}
assert.notEqual(chooseDiscard([0, 12, 20, 27], 27), 27);
const basis = {
  hand: [0, 12, 20],
  active: [0, 1],
  self: 0,
  discard: [27],
  openingDiscard: 27,
  rules,
};
const hA = analyze(basis, { samples: 100, seed: 711 }),
  hB = analyze(basis, { samples: 200, seed: 691 });
assert.equal(hA.actions.knock.ownLossChance, hB.actions.knock.ownLossChance);
assert.equal(hA.actions.knock.standardError, 0);
function simulate(lives, rng, inspect) {
  let first = Math.floor(rng() * lives.length);
  const n = lives.length;
  while (lives.filter((v) => v > 0).length > 1) {
    const seats = Array.from({ length: n }, (_, i) => (first + i) % n).filter(
      (i) => lives[i] > 0,
    );
    const deck = shuffle(rng),
      hands = seats.map((_, i) => deck.slice(3 * i, 3 * i + 3)),
      turns = seats.map(() => 0);
    let pos = 3 * seats.length,
      opening = deck[pos++],
      stack = [opening],
      actor = 0,
      knocker = -1;
    const events = [];
    let scores = hands.map((h) => score(h)),
      blitz = scores.includes(31);
    if (!blitz)
      for (;;) {
        const top = stack.at(-1),
          hand = hands[actor];
        if (inspect && inspect.left > 0) {
          const view = {
            self: seats[actor],
            active: seats,
            hand,
            discard: stack,
            openingDiscard: opening,
            knocker: knocker >= 0 ? seats[knocker] : null,
            events,
            stockCount: 52 - pos,
            lives,
            rules,
          };
          const x = analyze(view, { samples: 40, seed: stats.turns + 11 });
          assert.ok(Number.isFinite(x.actions[x.action].value));
          assert.ok(x.effectiveSamples >= 1 && x.samples > 0);
          if (knocker >= 0) assert.equal(x.actions.knock, undefined);
          inspect.minEss = Math.min(inspect.minEss, x.effectiveSamples);
          inspect.longest = Math.max(inspect.longest, events.length);
          inspect.left--;
        }
        const ctx = {
          players: seats.length,
          turns: turns[actor],
          final: knocker >= 0,
          rules,
        };
        const act = chooseTurn(hand, top, ctx);
        stats.turns++;
        if (act === "knock") knocker = actor;
        else {
          const drawn = act === "stock" ? deck[pos++] : stack.pop(),
            four = [...hand, drawn];
          const drop = chooseDiscard(four, act === "discard" ? drawn : null, {
            ...ctx,
            final: ctx.final || pos === 52,
          });
          const i = four.indexOf(drop);
          if (i !== 3) hand[i] = drawn;
          stack.push(drop);
          events.push({
            seat: seats[actor],
            source: act,
            discard: drop,
            ...(act === "discard" ? { picked: drawn } : {}),
          });
          if (score(hand) === 31 || pos === 52) break;
        }
        turns[actor]++;
        actor = (actor + 1) % seats.length;
        if (actor === knocker) break;
      }
    scores = hands.map((h) => score(h));
    const high = Math.max(...scores),
      low = Math.min(...scores);
    let losses = seats.map((_, i) => +(scores[i] < high));
    if (rules.payout === "lowest" && high !== 31) {
      const lows = seats.map((_, i) => i).filter((i) => scores[i] === low);
      losses = seats.map((_, i) => +lows.includes(i));
      if (lows.includes(knocker) && lows.length > 1) losses[knocker] = 0;
    }
    if (seats.every((s, i) => lives[s] === losses[i])) losses.fill(0);
    for (let i = 0; i < seats.length; i++) lives[seats[i]] -= losses[i];
    first = (seats[0] + 1) % n;
  }
  return lives[0] > 0;
}
const stats = { turns: 0 },
  rng = random(43452),
  observer = { left: 100, minEss: Infinity, longest: 0 };
while (observer.left > 0) simulate([4, 4, 4, 4], rng, observer);
console.log(
  "100 legal public decision snapshots, longest history",
  observer.longest,
  "min ESS at 40 draws",
  observer.minEss,
);
for (const start of [
  [4, 4],
  [1, 3],
  [3, 2, 1],
  [4, 3, 2, 1],
  [1, 4, 4, 4],
]) {
  const rounds = Number(process.argv[2] ?? 18000);
  let wins = 0;
  for (let i = 0; i < rounds; i++) wins += simulate(start.slice(), rng);
  const empirical = wins / rounds,
    model = matchEquity(start, rules),
    se = Math.sqrt((empirical * (1 - empirical)) / rounds);
  console.log(
    start.join(","),
    "ledger",
    model.toFixed(5),
    "full simulation",
    empirical.toFixed(5),
    "MC SE",
    se.toFixed(5),
  );
  assert.ok(Math.abs(empirical - model) < 0.014 + 4 * se);
}
