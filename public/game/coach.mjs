// Public-information strategy model for three-card Thirty-One.
// Card IDs: 13 cards per suit, with A=0 through K=12. No I/O or dependencies.
const DECK = Array.from({ length: 52 }, (_, i) => i);
const PIPS = DECK.map((c) => (c % 13 === 0 ? 11 : Math.min(10, (c % 13) + 1)));
const SUIT = DECK.map((c) => Math.floor(c / 13));
const RANK = DECK.map((c) => c % 13);
const C2 = DECK.map((c) => (c * (c - 1)) / 2);
const C3 = DECK.map((c) => (c * (c - 1) * (c - 2)) / 6);
const COUNT = 22100;
const CACHE = new Map();
const DEFAULTS = Object.freeze({
  payout: "lowest",
  triples: false,
  tieSafe: true,
  failedKnock: 1,
});

function rulesOf(rules = {}) {
  return { ...DEFAULTS, ...rules };
}

// A combination rank gives each one of the 22,100 different hands one slot.
function key(a, b, c) {
  let t;
  if (a > b) {
    t = a;
    a = b;
    b = t;
  }
  if (b > c) {
    t = b;
    b = c;
    c = t;
  }
  if (a > b) {
    t = a;
    a = b;
    b = t;
  }
  return a + C2[b] + C3[c];
}

function rawScore(a, b, c, triples) {
  if (triples && RANK[a] === RANK[b] && RANK[b] === RANK[c]) return 30.5;
  let x = PIPS[a],
    y = PIPS[b],
    z = PIPS[c];
  if (SUIT[a] === SUIT[b]) {
    x += y;
    y = 0;
  }
  if (SUIT[a] === SUIT[c]) {
    x += z;
    z = 0;
  } else if (SUIT[b] === SUIT[c]) {
    y += z;
    z = 0;
  }
  return Math.max(x, y, z);
}

export function score(hand, rules = DEFAULTS) {
  return rawScore(hand[0], hand[1], hand[2], rules.triples ?? DEFAULTS.triples);
}

// Generate generic one-draw expectations once. Enumerating four-card sets also
// counts every possible stock draw for each of their four three-card subsets.
function gatherOneDraw(values, totals) {
  for (let d = 3; d < 52; d++) {
    for (let c = 2; c < d; c++) {
      const cd = C3[d] + C2[c];
      for (let b = 1; b < c; b++) {
        const bc = C3[c] + C2[b],
          bd = C3[d] + C2[b],
          bcd = cd + b;
        for (let a = 0; a < b; a++) {
          const abc = bc + a,
            abd = bd + a,
            acd = cd + a;
          const best = Math.max(
            values[abc],
            values[abd],
            values[acd],
            values[bcd],
          );
          totals[abc] += best;
          totals[abd] += best;
          totals[acd] += best;
          totals[bcd] += best;
        }
      }
    }
  }
}

function tables(triples = DEFAULTS.triples) {
  if (CACHE.has(triples)) return CACHE.get(triples);
  const raw = new Float64Array(COUNT),
    finish = new Float64Array(COUNT);
  const hold = new Float64Array(COUNT),
    stockFinal = new Float64Array(COUNT);
  const stockNormal = new Float64Array(COUNT);
  for (let c = 2; c < 52; c++) {
    for (let b = 1; b < c; b++) {
      for (let a = 0; a < b; a++) {
        const i = a + C2[b] + C3[c];
        raw[i] = rawScore(a, b, c, triples);
        // A blitz charges every rival even at a multiway table.
        finish[i] = raw[i] + (raw[i] === 31 ? 7 : 0);
      }
    }
  }
  gatherOneDraw(finish, stockFinal);
  for (let i = 0; i < COUNT; i++) {
    stockFinal[i] /= 49;
    hold[i] = finish[i] + 0.65 * (stockFinal[i] - finish[i]);
  }
  gatherOneDraw(hold, stockNormal);
  for (let i = 0; i < COUNT; i++) stockNormal[i] /= 49;
  const t = { raw, finish, hold, stockNormal, stockFinal };
  CACHE.set(triples, t);
  return t;
}

function leaveOut(hand, cardIndex) {
  switch (cardIndex) {
    case 0:
      return key(hand[1], hand[2], hand[3]);
    case 1:
      return key(hand[0], hand[2], hand[3]);
    case 2:
      return key(hand[0], hand[1], hand[3]);
    default:
      return key(hand[0], hand[1], hand[2]);
  }
}

// When several discards retain equal value, give away the lower card first.
function discardIndex(four, forbidden, grades) {
  let best = -1,
    bestGrade = -Infinity;
  for (let i = 0; i < 4; i++) {
    if (four[i] === forbidden) continue;
    const grade = grades[leaveOut(four, i)];
    if (
      grade > bestGrade ||
      (grade === bestGrade &&
        (PIPS[four[i]] < PIPS[four[best]] ||
          (PIPS[four[i]] === PIPS[four[best]] && four[i] < four[best])))
    ) {
      best = i;
      bestGrade = grade;
    }
  }
  return best;
}

export function chooseDiscard(four, forbiddenCard = null, context = {}) {
  const t = tables(context.rules?.triples ?? DEFAULTS.triples);
  return four[
    discardIndex(four, forbiddenCard, context.final ? t.finish : t.hold)
  ];
}

// This is the announced reference opponent/continuation policy. It can be used
// by the game bots directly. Only the actor's cards and public context enter it.
function policy(
  hand,
  top,
  players,
  turns,
  finalTurn,
  rules,
  t,
  mode = "table",
) {
  const four = [hand[0], hand[1], hand[2], top];
  const ownKey = key(hand[0], hand[1], hand[2]);
  const grades = finalTurn ? t.finish : t.hold;
  const bestIndex = discardIndex(four, top, grades);
  const upKey = leaveOut(four, bestIndex);
  if (t.raw[upKey] === 31) return "discard";
  if (mode === "next" && !finalTurn) return "knock";
  const up = grades[upKey],
    scoreNow = t.raw[ownKey];
  const bias = mode === "early" ? -3.5 : mode === "patient" ? 4 : 0;
  // When only leaders survive, adding a rival raises the score worth locking.
  // Lowest-only scoring instead rewards beating any one of several rivals.
  const base =
    rules.payout === "highest"
      ? players === 2
        ? 22
        : players === 3
          ? 24
          : 25.5
      : (players === 2 ? 25.5 : players === 3 ? 23 : 21.5) +
        (rules.tieSafe ? 0 : 0.65) -
        (rules.failedKnock === 1 ? 0.85 : 0);
  const knockAt = Math.min(30.5, bias + base + Math.min(turns, 4) * 0.65);
  const bigGain = t.raw[upKey] >= Math.max(25, scoreNow + 3) && scoreNow < 27;
  if (!finalTurn && scoreNow >= knockAt && !bigGain) return "knock";
  // The known upcard cannot be in the stock. Remove that one outcome from the
  // otherwise uniform 49-card stock benchmark; the coach itself samples from
  // the actual public pool and is not restricted to this generic heuristic.
  const stock =
    ((finalTurn ? t.stockFinal : t.stockNormal)[ownKey] * 49 -
      Math.max(grades[ownKey], up)) /
    48;
  return up > stock + 0.05 ? "discard" : "stock";
}

export function chooseTurn(hand, top, context = {}) {
  const rules = rulesOf(context.rules);
  return policy(
    hand,
    top,
    context.players ?? 4,
    context.turns ?? 0,
    Boolean(context.final),
    rules,
    tables(rules.triples),
  );
}

function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(pool, rnd) {
  const cards = pool.slice();
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function prepare(view) {
  if (
    !Array.isArray(view.hand) ||
    view.hand.length !== 3 ||
    !view.discard?.length
  )
    throw new Error("A three-card hand and a face-up discard are required.");
  const offset = view.active.indexOf(view.self);
  if (offset < 0 || view.active.length < 2 || view.active.length > 4)
    throw new Error("The acting seat must be at a two- to four-player table.");
  const seats = view.active.slice(offset).concat(view.active.slice(0, offset));
  const known = seats.map(() => new Set());
  const turns = seats.map(() => 0);
  const firstSeen = new Int16Array(52).fill(32767);
  const events = [];
  const publicStack = [];
  if (view.openingDiscard != null) {
    publicStack.push(view.openingDiscard);
    firstSeen[view.openingDiscard] = -1;
  }
  for (const e of view.events ?? []) {
    const seat = seats.indexOf(e.seat);
    if (seat < 0) continue;
    const i = events.length,
      top = publicStack.at(-1) ?? e.picked;
    let picked = null;
    if (e.source === "discard") {
      picked = e.picked ?? top;
      publicStack.pop();
      if (picked != null) {
        known[seat].add(picked);
        firstSeen[picked] = Math.min(firstSeen[picked], i);
      }
    }
    known[seat].delete(e.discard);
    events.push({
      seat,
      source: e.source,
      discarded: e.discard,
      picked,
      top,
      turn: turns[seat],
      index: i,
    });
    turns[seat]++;
    firstSeen[e.discard] = Math.min(firstSeen[e.discard], i);
    publicStack.push(e.discard);
  }
  known[0] = new Set(view.hand);
  const fixed = known.map((s) => [...s]);
  const unavailable = new Set([...view.discard, ...fixed.flat()]);
  const pool = DECK.filter((c) => !unavailable.has(c));
  const rules = rulesOf(view.rules);
  const knocker = view.knocker == null ? -1 : seats.indexOf(view.knocker);
  // Starting at the knocker, every seat strictly before us has already had its
  // final action. This also locates the knock within the public draw history.
  const observedTurn = seats.indexOf(
    view.currentSeat ?? view.turnSeat ?? view.self,
  );
  const distance =
    (Math.max(0, observedTurn) - knocker + seats.length) % seats.length;
  const finalStart =
    knocker < 0
      ? events.length
      : Math.max(0, events.length - Math.max(0, distance - 1));
  return {
    seats,
    n: seats.length,
    known: fixed,
    turns,
    events,
    firstSeen,
    pool,
    rules,
    t: tables(rules.triples),
    hand: view.hand,
    top: view.discard.at(-1),
    knocker,
    finalStart,
    lives: seats.map((seat) => Math.max(1, view.lives?.[seat] ?? 4)),
    tag: ruleTag(rules),
    equityCache: new Map(),
    stockCount:
      view.stockCount ??
      pool.length - fixed.reduce((s, h) => s + 3 - h.length, 0),
  };
}

// Reverse the public exchanges to check history and infer hidden strength. A
// public-pile pickup is deterministic backwards. A past stock draw must be one
// of that turn's four cards which had never previously appeared in public.
// The number of legal reverse proposals corrects for their sampling density.
function historyWeight(finalHands, p, rnd) {
  const { t, rules, firstSeen, n, events } = p;
  const hands = finalHands.map((h) => h.slice());
  let logWeight = 0;
  if (p.knocker >= 0) {
    // The knocker's current hand is exactly the hand they chose to lock.
    const knockTop = events[p.finalStart]?.top ?? p.top;
    if (
      policy(
        hands[p.knocker],
        knockTop,
        n,
        p.turns[p.knocker],
        false,
        rules,
        t,
      ) !== "knock"
    )
      logWeight -= 1.8;
  }
  for (let k = events.length - 1; k >= 0; k--) {
    const e = events[k],
      hand = hands[e.seat],
      put = e.discarded;
    let drawn, slot;
    if (e.source === "discard") {
      drawn = e.picked;
      slot = hand.indexOf(drawn);
      if (slot < 0) return -Infinity;
    } else {
      // Choosing the very card discarded means it was drawn and thrown back.
      const allowed = [];
      for (let j = 0; j < 3; j++) if (firstSeen[hand[j]] >= k) allowed.push(j);
      if (firstSeen[put] >= k) allowed.push(3);
      if (!allowed.length) return -Infinity;
      slot = allowed[Math.floor(rnd() * allowed.length)];
      drawn = slot === 3 ? put : hand[slot];
      logWeight += Math.log(allowed.length);
    }
    const afterKey = key(hand[0], hand[1], hand[2]);
    if (slot !== 3) hand[slot] = put;
    const beforeKey = key(hand[0], hand[1], hand[2]);
    if (t.raw[beforeKey] === 31) return -Infinity;
    if (e.seat === 0 || e.top == null) continue;
    // Recency-tempered behavioral evidence keeps real humans' unusual
    // decisions possible. Opponent choices are observations; our own past
    // action selection is deliberately not evidence about hidden rivals.
    const age = events.length - 1 - k;
    if (age >= n * 3) continue;
    const temper = Math.pow(0.76, Math.floor(age / n));
    const predicted = policy(
      hand,
      e.top,
      n,
      e.turn,
      k >= p.finalStart,
      rules,
      t,
    );
    if (predicted !== e.source)
      logWeight -= temper * (predicted === "knock" ? 1.3 : 0.9);
    const four = [hand[0], hand[1], hand[2], drawn];
    const preferred = discardIndex(
      four,
      e.source === "discard" ? drawn : null,
      t.hold,
    );
    const gap = Math.max(
      0,
      t.hold[leaveOut(four, preferred)] - t.hold[afterKey],
    );
    logWeight -= temper * Math.min(4, gap * 0.55);
  }
  return logWeight;
}

function sampleWorld(p, rnd) {
  const cards = shuffled(p.pool, rnd),
    hands = p.known.map((h) => h.slice());
  let pos = 0;
  for (const hand of hands) {
    while (hand.length < 3) hand.push(cards[pos++]);
    if (hand.length !== 3 || p.t.raw[key(...hand)] === 31) return null;
  }
  const logWeight = historyWeight(hands, p, rnd);
  if (!Number.isFinite(logWeight)) return null;
  return { hands, stock: cards.slice(pos, pos + p.stockCount), logWeight };
}

// 60,000 fresh shuffled rounds per (rule combination, table size). The keys
// encode triples / tie protection / failed-knock cost. Within a table entry,
// "double" counts one seat losing twice; integer k means k seats each lost one.
// Generated by calibrate.mjs with fixed seeds; no live network/model is used.
const FUTURE_FREQUENCIES = {
  101: {
    2: { 1: 60000, 2: 0, double: 0 },
    3: { 1: 49610, 2: 10390, 3: 0, double: 0 },
    4: { 1: 48639, 2: 4304, 3: 7057, 4: 0, double: 0 },
  },
  102: {
    2: { 1: 55625, 2: 1, double: 4374 },
    3: { 1: 46322, 2: 11490, 3: 0, double: 2188 },
    4: { 1: 46924, 2: 4294, 3: 7757, 4: 0, double: 1025 },
  },
  111: {
    2: { 1: 60000, 2: 0, double: 0 },
    3: { 1: 50307, 2: 9693, 3: 0, double: 0 },
    4: { 1: 50030, 2: 4411, 3: 5559, 4: 0, double: 0 },
  },
  112: {
    2: { 1: 57696, 2: 0, double: 2304 },
    3: { 1: 47671, 2: 10559, 3: 0, double: 1770 },
    4: { 1: 47605, 2: 4469, 3: 7209, 4: 0, double: 717 },
  },
  "001": {
    2: { 1: 60000, 2: 0, double: 0 },
    3: { 1: 48775, 2: 11225, 3: 0, double: 0 },
    4: { 1: 48020, 2: 4430, 3: 7550, 4: 0, double: 0 },
  },
  "002": {
    2: { 1: 55463, 2: 3, double: 4534 },
    3: { 1: 45746, 2: 12156, 3: 0, double: 2098 },
    4: { 1: 46420, 2: 4341, 3: 8418, 4: 0, double: 821 },
  },
  "011": {
    2: { 1: 60000, 2: 0, double: 0 },
    3: { 1: 49780, 2: 10220, 3: 0, double: 0 },
    4: { 1: 49329, 2: 4696, 3: 5975, 4: 0, double: 0 },
  },
  "012": {
    2: { 1: 58029, 2: 1, double: 1970 },
    3: { 1: 47241, 2: 11280, 3: 0, double: 1479 },
    4: { 1: 46877, 2: 4556, 3: 7939, 4: 0, double: 628 },
  },
  H0: {
    2: { 1: 57248, 2: 0, double: 0 },
    3: { 1: 5088, 2: 54712, 3: 0, double: 0 },
    4: { 1: 515, 2: 6700, 3: 52764, 4: 0, double: 0 },
  },
  H1: {
    2: { 1: 57439, 2: 0, double: 0 },
    3: { 1: 4742, 2: 55085, 3: 0, double: 0 },
    4: { 1: 417, 2: 5960, 3: 53606, 4: 0, double: 0 },
  },
};
const FUTURE_PATTERNS = new Map();
const EQUITIES = new Map();

function ruleTag(rules) {
  return rules.payout === "highest"
    ? "H" + Number(rules.triples)
    : String(+rules.triples) +
        String(+rules.tieSafe) +
        String(rules.failedKnock);
}

function chargePatterns(n, tag) {
  const cacheKey = tag + "/" + n;
  if (FUTURE_PATTERNS.has(cacheKey)) return FUTURE_PATTERNS.get(cacheKey);
  const frequency = FUTURE_FREQUENCIES[tag][n];
  const patterns = [];
  if (frequency.double) {
    for (let i = 0; i < n; i++)
      patterns.push({
        loss: Array.from({ length: n }, (_, j) => +(i === j) * 2),
        mass: frequency.double / n,
      });
  }
  for (let k = 1; k <= n; k++) {
    if (!frequency[k]) continue;
    const subsets = [];
    for (let bits = 1; bits < 1 << n; bits++) {
      const loss = Array.from({ length: n }, (_, i) => (bits >> i) & 1);
      if (loss.reduce((a, b) => a + b, 0) === k) subsets.push(loss);
    }
    for (const loss of subsets)
      patterns.push({ loss, mass: frequency[k] / subsets.length });
  }
  FUTURE_PATTERNS.set(cacheKey, patterns);
  return patterns;
}

// Future deals use exchangeable seats and the reference bots' calibrated loss
// patterns. Every non-replay transition decreases total lives, making the
// win-probability recurrence a finite dynamic program on the remaining ledger.
function equity(lives, tag) {
  if (lives[0] <= 0) return 0;
  const others = lives
    .slice(1)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (!others.length) return 1;
  const ledger = [lives[0], ...others],
    name = tag + "/" + ledger.join(",");
  if (EQUITIES.has(name)) return EQUITIES.get(name);
  let sum = 0,
    total = 0;
  for (const { loss, mass } of chargePatterns(ledger.length, tag)) {
    const after = ledger.map((v, i) => Math.max(0, v - loss[i]));
    if (after.every((v) => v === 0)) continue; // all-out tie replays this ledger
    total += mass;
    sum += mass * equity(after, tag);
  }
  const result = sum / total;
  EQUITIES.set(name, result);
  return result;
}

export function matchEquity(lives, rules = DEFAULTS) {
  return equity(lives, ruleTag(rulesOf(rules)));
}

function equityAfterCharge(actual, p) {
  let code = 0;
  for (const cost of actual) code = 3 * code + cost;
  if (p.equityCache.has(code)) return p.equityCache.get(code);
  const after = p.lives.map((v, i) => v - actual[i]);
  const chance = equity(after.some((v) => v > 0) ? after : p.lives, p.tag);
  p.equityCache.set(code, chance);
  return chance;
}

// Enumerate the exact knock outcome on the first move of a heads-up hand,
// conditional on no dealt blitz. The defender has 48 choose 3 possible hands;
// each stock-taking response has exactly 45 equally likely first stock cards.
// The defender uses the same imperfect-information final-turn policy as a bot.
function exactOpeningKnock(p) {
  if (
    p.n !== 2 ||
    p.events.length ||
    p.knocker >= 0 ||
    p.pool.length !== 48 ||
    p.stockCount !== 45 ||
    p.known[1].length
  )
    return null;
  const hero = p.t.raw[key(...p.hand)],
    pool = p.pool;
  let total = 0,
    lost = 0,
    rivalBlitzes = 0,
    value = 0,
    chance = 0;
  const loseCost = Math.min(p.lives[0], p.rules.failedKnock);
  const outcome = (scoreOther) => {
    if (scoreOther === 31) return [1, -1, equityAfterCharge([1, 0], p)];
    if (p.rules.payout === "highest") {
      if (hero === scoreOther) return [0, 0, equityAfterCharge([0, 0], p)];
      return hero > scoreOther
        ? [0, 1, equityAfterCharge([0, 1], p)]
        : [1, -1, equityAfterCharge([1, 0], p)];
    }
    if (hero < scoreOther || (hero === scoreOther && !p.rules.tieSafe))
      return [1, -loseCost, equityAfterCharge([loseCost, 0], p)];
    return [0, 1, equityAfterCharge([0, 1], p)];
  };
  const byScore = new Map();
  function add(raw, weight) {
    let result = byScore.get(raw);
    if (!result) {
      result = outcome(raw);
      byScore.set(raw, result);
    }
    total += weight;
    if (raw === 31) rivalBlitzes += weight;
    lost += weight * result[0];
    value += weight * result[1];
    chance += weight * result[2];
  }
  for (let k = 2; k < 48; k++)
    for (let j = 1; j < k; j++)
      for (let i = 0; i < j; i++) {
        const hand = [pool[i], pool[j], pool[k]];
        if (p.t.raw[key(...hand)] === 31) continue;
        const move = policy(hand, p.top, 2, 0, true, p.rules, p.t);
        if (move === "discard") {
          const four = [...hand, p.top];
          add(
            p.t.raw[leaveOut(four, discardIndex(four, p.top, p.t.finish))],
            45,
          );
        } else {
          const base = p.t.raw[key(...hand)];
          // The stock card can always be thrown back. Taking the best numeric
          // score also maximizes the defender's terminal grade.
          for (let x = 0; x < 48; x++) {
            if (x === i || x === j || x === k) continue;
            const c = pool[x];
            add(
              Math.max(
                base,
                p.t.raw[key(hand[0], hand[1], c)],
                p.t.raw[key(hand[0], hand[2], c)],
                p.t.raw[key(hand[1], hand[2], c)],
              ),
              1,
            );
          }
        }
      }
  return {
    value: value / total,
    ownLossChance: lost / total,
    safeChance: 1 - lost / total,
    opponentBlitzChance: rivalBlitzes / total,
    showdownLossChance: (lost - rivalBlitzes) / total,
    matchWinChance: chance / total,
  };
}

function settle(hands, p, knocker, blitz) {
  const n = p.n,
    charges = Array(n).fill(0);
  if (blitz >= 0) {
    for (let i = 0; i < n; i++) if (i !== blitz) charges[i] = 1;
  } else if (p.rules.payout === "highest") {
    const scores = hands.map((h) => p.t.raw[key(...h)]),
      high = Math.max(...scores);
    for (let i = 0; i < n; i++) charges[i] = +(scores[i] < high);
  } else {
    const scores = hands.map((h) => p.t.raw[key(...h)]);
    const low = Math.min(...scores);
    const lows = scores
      .map((s, i) => (s === low ? i : -1))
      .filter((i) => i >= 0);
    if (lows.includes(knocker)) {
      if (lows.length === 1 || !p.rules.tieSafe)
        charges[knocker] = p.rules.failedKnock;
      else for (const seat of lows) if (seat !== knocker) charges[seat] = 1;
    } else for (const seat of lows) charges[seat] = 1;
  }
  const actual = charges.map((v, i) => Math.min(p.lives[i], v));
  // All remaining seats at their last token replay a fully tied stock-out.
  if (knocker < 0 && blitz < 0 && actual.every((loss, i) => loss >= p.lives[i]))
    actual.fill(0);
  const theirs = actual.slice(1).reduce((a, b) => a + b, 0) / (n - 1);
  return {
    value: theirs - actual[0],
    equity: equityAfterCharge(actual, p),
    safe: +(actual[0] === 0),
    lost: actual[0] > 0,
    blitz: blitz === 0,
    opponentBlitz: blitz > 0,
    showdownLoss: blitz < 0 && actual[0] > 0,
  };
}

function rollout(world, p, action, plan) {
  const hands = world.hands.map((h) => h.slice()),
    turns = p.turns.slice();
  let actor = 0,
    knocker = p.knocker,
    pos = 0,
    top = p.top,
    first = true;
  // A top-pile choice in the reference policy always increases the actor's
  // retained value. The ordinary stock/knock conditions terminate the round.
  for (;;) {
    const finalTurn = knocker >= 0,
      hand = hands[actor];
    if (action === "knock") knocker = actor;
    else {
      if (action === "stock" && pos >= world.stock.length)
        return settle(hands, p, knocker, -1);
      const drawn = action === "stock" ? world.stock[pos++] : top;
      const four = [hand[0], hand[1], hand[2], drawn];
      const discard =
        first && plan.initialDrop != null
          ? plan.initialDrop
          : discardIndex(
              four,
              action === "discard" ? drawn : null,
              finalTurn || pos === world.stock.length ? p.t.finish : p.t.hold,
            );
      top = four[discard];
      if (discard !== 3) hand[discard] = drawn;
      if (p.t.raw[key(...hand)] === 31) return settle(hands, p, knocker, actor);
      if (pos === world.stock.length) return settle(hands, p, knocker, -1);
    }
    turns[actor]++;
    first = false;
    actor = (actor + 1) % p.n;
    if (actor === knocker) return settle(hands, p, knocker, -1);
    action = policy(
      hands[actor],
      top,
      p.n,
      turns[actor],
      knocker >= 0,
      p.rules,
      p.t,
      actor === 0 ? plan.mode : "table",
    );
  }
}

function summarize(rows, weights, total, ess, extract) {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) sum += weights[i] * extract(rows[i]);
  const mean = sum / total;
  let square = 0;
  for (let i = 0; i < rows.length; i++) {
    const delta = weights[i] * (extract(rows[i]) - mean);
    square += delta * delta;
  }
  return {
    mean,
    se: Math.sqrt(square * (ess > 1 ? ess / (ess - 1) : 1)) / total,
  };
}

function immediateOuts(p) {
  const hand = p.hand;
  const makes31 = (card) =>
    [0, 1, 2].some((i) => {
      const x = hand.slice();
      x[i] = card;
      return p.t.raw[key(...x)] === 31;
    });
  return {
    unseenOuts: p.pool.filter(makes31).length,
    unseenCards: p.pool.length,
    faceupBlitz: makes31(p.top),
  };
}

// A long draw history can leave a handful of high-weight compatible deals.
// Expand the proposal bank when needed, with a bounded work budget on phones.
// Effective sample size, rather than the number of raw proposals, governs the
// confidence flag and the self-normalized Monte Carlo standard errors.
function effectiveCount(logs) {
  const largest = Math.max(...logs);
  let total = 0,
    squared = 0;
  for (const log of logs) {
    const w = Math.exp(log - largest);
    total += w;
    squared += w * w;
  }
  return (total * total) / squared;
}

function collectWorlds(p, count, rng, maxCount, targetEss) {
  const worlds = [],
    logs = [];
  let target = count,
    attempts = 0;
  for (;;) {
    while (worlds.length < target && attempts++ < target * 12) {
      const world = sampleWorld(p, rng);
      if (world) {
        worlds.push(world);
        logs.push(world.logWeight);
      }
    }
    if (!worlds.length)
      throw new Error("No possible hidden deal matches this round history.");
    if (
      target >= maxCount ||
      worlds.length < target ||
      effectiveCount(logs) >= targetEss
    )
      break;
    target = Math.min(maxCount, target + count);
  }
  return { worlds, logs };
}

// Use an independent pilot to tune the actor's continuation. Each policy is
// executable from that actor's own cards and public information. A separate
// sample evaluates the chosen plan, so no action picks the best hidden-world
// outcome and the displayed advantage does not get an in-sample winner bonus.
function canProveBlitzOptimal(p) {
  if (p.metric === "safe") return true;
  // For match odds, compare against a superset of all legal post-round
  // ledgers. This proves the immediate decision within the stated future
  // model without assuming that its equity is monotone in a rival's lives.
  if (p.metric === "equity") {
    const blitz = Array.from({ length: p.n }, (_, i) => +(i !== 0));
    const target = equityAfterCharge(blitz, p);
    for (let bits = 0; bits < 1 << p.n; bits++) {
      const loss = Array.from({ length: p.n }, (_, i) => (bits >> i) & 1);
      if (equityAfterCharge(loss, p) > target + 1e-12) return false;
    }
    if (p.rules.payout !== "highest" && p.rules.failedKnock === 2) {
      for (let i = 0; i < p.n; i++) {
        const loss = Array(p.n).fill(0);
        loss[i] = Math.min(p.lives[i], 2);
        if (equityAfterCharge(loss, p) > target + 1e-12) return false;
      }
    }
    return true;
  }
  return (
    p.rules.payout === "highest" ||
    p.rules.failedKnock === 1 ||
    p.n > 2 ||
    p.lives[1] === 1
  );
}

function trainPlans(p, moves, pilot, rnd) {
  const four = [...p.hand, p.top];
  const exactDrops = [0, 1, 2].filter((i) => p.t.raw[leaveOut(four, i)] === 31);
  // Heads-up, beating a rival's failed double-cost knock can pay two.
  // A certain blitz pays one, so retain non-blitz choices in that case.
  const exactBlitz = exactDrops.length > 0 && canProveBlitzOptimal(p);
  const faceDrops = exactBlitz ? [exactDrops[0]] : [0, 1, 2];
  const choices = {};
  for (const move of moves) {
    const modes =
      move === "knock" || p.knocker >= 0 || (move === "discard" && exactBlitz)
        ? ["table"]
        : ["table", "next", "early", "patient"];
    const drops = move === "discard" ? faceDrops : [null];
    choices[move] = modes.flatMap((mode) =>
      drops.map((initialDrop) => ({ mode, initialDrop })),
    );
  }
  const sums = Object.fromEntries(
    moves.map((m) => [m, choices[m].map(() => 0)]),
  );
  const budget =
    p.events.length < 4 ? pilot : Math.max(pilot, Math.min(2400, pilot * 3));
  const { worlds: bank } = collectWorlds(
    p,
    pilot,
    rnd,
    budget,
    Math.min(50, pilot / 4),
  );
  const largest = Math.max(...bank.map((w) => w.logWeight));
  for (const world of bank) {
    const weight = Math.exp(world.logWeight - largest);
    for (const move of moves) {
      if (choices[move].length === 1) continue;
      for (let j = 0; j < choices[move].length; j++)
        sums[move][j] +=
          weight * rollout(world, p, move, choices[move][j])[p.metric];
    }
  }
  return Object.fromEntries(
    moves.map((move) => {
      const best = sums[move].indexOf(Math.max(...sums[move]));
      return [move, choices[move][best]];
    }),
  );
}

// Solve the paired, one-decision comparison against the announced policy().
// The default objective is tournament victory. 'safe' maximizes the chance
// of keeping this round's token and 'round' maximizes mean rival tokens spent
// minus one's own, capped at every seat's remaining tokens.
// The reported uncertainty covers sampled worlds only, not policy misspecification.
export function analyze(view, options = {}) {
  const p = prepare(view);
  const objective =
    options.objective === "safe"
      ? "safe"
      : options.objective === "round"
        ? "round"
        : "match";
  p.metric = { match: "equity", safe: "safe", round: "value" }[objective];
  const n = Math.max(1, Math.min(50000, Math.round(options.samples ?? 480)));
  const rnd = generator(options.seed ?? 31);
  const moves = [
    ...(p.knocker < 0 ? ["knock"] : []),
    ...(p.stockCount > 0 ? ["stock"] : []),
    "discard",
  ];
  const pilot = Math.max(120, Math.min(1600, Math.ceil(n / 4)));
  const plans = trainPlans(
    p,
    moves,
    pilot,
    generator((options.seed ?? 31) ^ 0xade2389),
  );
  const budget = p.events.length < 4 ? n : Math.max(n, Math.min(7200, 4 * n));
  const { worlds, logs } = collectWorlds(
    p,
    n,
    rnd,
    budget,
    Math.min(100, n / 3),
  );
  const rows = worlds.map((world) => {
    const row = {};
    for (const move of moves)
      row[move] = {
        ...rollout(world, p, move, plans[move]),
        ...firstFeed(world, p, move, plans[move]),
      };
    return row;
  });
  const largest = Math.max(...logs),
    weights = logs.map((w) => Math.exp(w - largest));
  const total = weights.reduce((x, y) => x + y, 0);
  const ess = (total * total) / weights.reduce((s, w) => s + w * w, 0);
  const moments = (fn) => summarize(rows, weights, total, ess, fn);
  const actions = {};
  for (const move of moves) {
    const { mean, se } = moments((row) => row[move].value);
    const match = moments((row) => row[move].equity);
    const safety = moments((row) => row[move].safe);
    actions[move] = {
      value: mean,
      matchWinChance: match.mean,
      matchStandardError: match.se,
      safeChance: safety.mean,
      safeStandardError: safety.se,
      ownLossChance: moments((row) => +row[move].lost).mean,
      opponentBlitzChance: moments((row) => +row[move].opponentBlitz).mean,
      showdownLossChance: moments((row) => +row[move].showdownLoss).mean,
      blitzChance: moments((row) => +row[move].blitz).mean,
      standardError: se,
      continuation: plans[move].mode,
      ...feedMeans(rows, (r) => r[move], weights, total, p.seats[1]),
    };
  }
  actions.discard.discardCard = p.hand[plans.discard.initialDrop];
  const outs = immediateOuts(p);
  const exactKnock = exactOpeningKnock(p);
  if (exactKnock)
    Object.assign(actions.knock, exactKnock, {
      standardError: 0,
      matchStandardError: 0,
      safeStandardError: 0,
      exact: true,
    });
  const metricName = {
    match: "matchWinChance",
    safe: "safeChance",
    round: "value",
  }[objective];
  const errorName = {
    match: "matchStandardError",
    safe: "safeStandardError",
    round: "standardError",
  }[objective];
  const ranked = moves
    .slice()
    .sort((a, b) => actions[b][metricName] - actions[a][metricName]);
  // With multiple rivals, a double-cost failure charges at most two rivals'
  // lives in total. Heads-up it can be worth more than taking a certain blitz.
  const exact = outs.faceupBlitz && canProveBlitzOptimal(p);
  if (exact)
    ranked.splice(
      0,
      ranked.length,
      "discard",
      ...ranked.filter((m) => m !== "discard"),
    );
  const best = ranked[0],
    second = ranked[1];
  let gap = second
    ? moments((row) => row[best][p.metric] - row[second][p.metric])
    : { mean: 0, se: 0 };
  if (second && exactKnock && (best === "knock" || second === "knock")) {
    const simulated = best === "knock" ? second : best;
    gap = {
      mean: actions[best][metricName] - actions[second][metricName],
      se: actions[simulated][errorName],
    };
  }
  const confidence = exact
    ? "certain"
    : ess < 20
      ? "limited"
      : gap.mean <= 1.96 * gap.se + 0.002
        ? "close"
        : "clear";
  const reason = exact
    ? "The face-up card makes 31 immediately."
    : best === "knock"
      ? "End the round after each rival gets one last turn."
      : best === "discard"
        ? "The visible card gives the better continuation."
        : "The stock gives the better continuation on the sampled deals.";
  return {
    action: best,
    actions,
    objective,
    reads: worldsRead(p, worlds, weights, total),
    nextSeat: p.seats[1],
    samples: rows.length,
    effectiveSamples: Math.round(ess),
    margin: gap.mean,
    marginSE: gap.se,
    confidence,
    exact,
    reason,
    ...outs,
  };
}

// Describe only the next seat's immediate opportunity. A later blitz or an
// improvement from stock is never charged to the specific card we discarded.
function feedOpportunity(world, p, top, knocker) {
  const hand = world.hands[1];
  const move = policy(hand, top, p.n, p.turns[1], knocker >= 0, p.rules, p.t);
  const four = [...hand, top];
  const drop = discardIndex(four, top, knocker >= 0 ? p.t.finish : p.t.hold);
  const before = p.t.raw[key(...hand)],
    after = p.t.raw[leaveOut(four, drop)];
  const take = move === "discard";
  return {
    nextTurn: 1,
    nextTake: +take,
    nextImprove: +(take && after > before),
    nextBlitz: +(take && after === 31),
    nextCanImprove: +[0, 1, 2].some((i) => p.t.raw[leaveOut(four, i)] > before),
  };
}

function firstFeed(world, p, action, plan) {
  const none = {
    nextTurn: 0,
    nextTake: 0,
    nextImprove: 0,
    nextBlitz: 0,
    nextCanImprove: 0,
    deniedBlitz: 0,
    deniedImprove: 0,
  };
  const knocker = action === "knock" ? 0 : p.knocker;
  if (knocker === 1) return none;
  let top = p.top;
  if (action !== "knock") {
    const remaining = world.stock.length - +(action === "stock");
    if (remaining <= 0) return none;
    const drawn = action === "stock" ? world.stock[0] : p.top;
    const four = [...world.hands[0], drawn];
    const drop =
      plan.initialDrop ??
      discardIndex(
        four,
        action === "discard" ? drawn : null,
        knocker >= 0 ? p.t.finish : p.t.hold,
      );
    if (p.t.raw[leaveOut(four, drop)] === 31) return none;
    top = four[drop];
  }
  const feed = feedOpportunity(world, p, top, knocker);
  // Both sorts of draw cover the old upcard. Compare like-for-like with the
  // same next player's hypothetical response if that card remained visible.
  const exposed =
    top === p.top ? feed : feedOpportunity(world, p, p.top, knocker);
  return {
    ...feed,
    deniedBlitz: +(exposed.nextBlitz && !feed.nextBlitz),
    deniedImprove: +(exposed.nextImprove && !feed.nextImprove),
  };
}

const FEED_FIELDS = [
  "nextTurn",
  "nextTake",
  "nextImprove",
  "nextBlitz",
  "nextCanImprove",
  "deniedBlitz",
  "deniedImprove",
];
const CARD_RANK = [
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
const CARD_SUIT = ["♠", "♥", "♣", "♦"];
function cardLabel(c) {
  return CARD_RANK[RANK[c]] + CARD_SUIT[SUIT[c]];
}

function feedMeans(rows, take, weights, total, nextSeat) {
  const sums = Object.fromEntries(FEED_FIELDS.map((name) => [name, 0]));
  for (let j = 0; j < rows.length; j++) {
    const r = take(rows[j]);
    for (const f of FEED_FIELDS) sums[f] += weights[j] * r[f];
  }
  return {
    nextSeat: sums.nextTurn > 0 ? nextSeat : null,
    ...Object.fromEntries(
      FEED_FIELDS.map((f) => [f + "Chance", sums[f] / total]),
    ),
  };
}

function worldsRead(p, worlds, weights, total) {
  const reads = [];
  for (let seat = 1; seat < p.n; seat++) {
    const holding = p.known[seat],
      floor = [0, 0, 0, 0],
      split = [0, 0, 0, 0];
    const picks = [0, 0, 0, 0],
      puts = [0, 0, 0, 0];
    for (const c of holding) floor[SUIT[c]] += PIPS[c];
    for (const e of p.events)
      if (e.seat === seat) {
        if (e.picked != null) picks[SUIT[e.picked]]++;
        puts[SUIT[e.discarded]]++;
      }
    const slots = 3 - holding.length;
    const upper = floor.map(
      (b, s) =>
        b +
        p.pool
          .filter((c) => SUIT[c] === s)
          .map((c) => PIPS[c])
          .sort((a, b) => b - a)
          .slice(0, slots)
          .reduce((a, b) => a + b, 0),
    );
    const certain = floor.findIndex((b, s) =>
      upper.every((v, i) => i === s || b > v),
    );
    for (let j = 0; j < worlds.length; j++) {
      const sums = [0, 0, 0, 0];
      for (const c of worlds[j].hands[seat]) sums[SUIT[c]] += PIPS[c];
      const peak = Math.max(...sums),
        divisions = sums.filter((v) => v === peak).length;
      for (let s = 0; s < 4; s++)
        if (sums[s] === peak) split[s] += weights[j] / divisions;
    }
    const chances = split.map((v) => v / total),
      best = chances.indexOf(Math.max(...chances));
    reads.push({
      seat: p.seats[seat],
      knownCards: holding.slice(),
      knownMinScore:
        holding.length === 3 ? p.t.raw[key(...holding)] : Math.max(...floor),
      primarySuit: best,
      primaryChance: chances[best],
      certainSuit: certain < 0 ? null : certain,
      suitChances: chances,
      picksBySuit: picks,
      discardsBySuit: puts,
    });
  }
  return reads;
}

function prepareDrawn(view) {
  if (
    !Array.isArray(view.hand) ||
    view.hand.length !== 4 ||
    !view.hand.includes(view.drawn) ||
    !["stock", "discard"].includes(view.drawSource)
  )
    throw new Error("A four-card hand and its draw source are required.");
  const drawn = view.drawn,
    source = view.drawSource;
  const before = view.hand.filter((c) => c !== drawn);
  const discard =
    source === "discard" ? [...view.discard, drawn] : view.discard.slice();
  const beforeCount =
    view.stockCount == null
      ? undefined
      : view.stockCount + +(source === "stock");
  const p = prepare({
    ...view,
    hand: before,
    discard,
    stockCount: beforeCount,
  });
  // A private stock draw is known to us and was unavailable to every rival.
  // Restore it to the front only during a rollout, after sampling the rest.
  if (source === "stock") {
    if (!p.pool.includes(drawn))
      throw new Error("The drawn stock card was already visible.");
    p.pool = p.pool.filter((c) => c !== drawn);
    p.stockCount--;
  }
  const four = [...before, drawn];
  const possible = four
    .map((_, i) => i)
    .filter((i) => source === "stock" || i !== 3);
  return { p, drawn, source, four, possible };
}

function withDraw(world, source, drawn) {
  return source === "stock"
    ? { ...world, stock: [drawn, ...world.stock] }
    : world;
}

// Every candidate is evaluated against the same compatible hidden deals.
// The plan after each candidate is selected on a separate, independent pilot.
export function analyzeDiscard(view, options = {}) {
  const { p, drawn, source, four, possible } = prepareDrawn(view);
  const objective =
    options.objective === "safe"
      ? "safe"
      : options.objective === "round"
        ? "round"
        : "match";
  p.metric = { match: "equity", safe: "safe", round: "value" }[objective];
  const n = Math.max(1, Math.min(50000, Math.round(options.samples ?? 480)));
  const seed = options.seed ?? 31,
    pilot = Math.max(120, Math.min(1600, Math.ceil(n / 4)));
  const samples = collectWorlds(
    p,
    pilot,
    generator(seed ^ 0xade2389),
    p.events.length < 4 ? pilot : Math.max(pilot, Math.min(2400, pilot * 3)),
    Math.min(50, pilot / 4),
  );
  const mx = Math.max(...samples.logs),
    modes = ["table", "next", "early", "patient"];
  const plans = {};
  for (const initialDrop of possible) {
    const scoreAfter = p.t.raw[leaveOut(four, initialDrop)];
    const available =
      p.knocker >= 0 || p.stockCount === 0 || scoreAfter === 31
        ? ["table"]
        : modes;
    const sums = available.map(() => 0);
    if (available.length > 1)
      for (let j = 0; j < samples.worlds.length; j++) {
        const world = withDraw(samples.worlds[j], source, drawn),
          weight = Math.exp(samples.logs[j] - mx);
        for (let m = 0; m < available.length; m++)
          sums[m] +=
            weight *
            rollout(world, p, source, { initialDrop, mode: available[m] })[
              p.metric
            ];
      }
    plans[initialDrop] = {
      initialDrop,
      mode: available[sums.indexOf(Math.max(...sums))],
    };
  }
  const { worlds, logs } = collectWorlds(
    p,
    n,
    generator(seed),
    p.events.length < 4 ? n : Math.max(n, Math.min(7200, 4 * n)),
    Math.min(100, n / 3),
  );
  const maximum = Math.max(...logs),
    weights = logs.map((v) => Math.exp(v - maximum));
  const total = weights.reduce((a, b) => a + b, 0),
    ess = (total * total) / weights.reduce((a, b) => a + b * b, 0);
  const rows = worlds.map((undrawn) => {
    const world = withDraw(undrawn, source, drawn),
      row = {};
    for (const d of possible)
      row[d] = {
        ...rollout(world, p, source, plans[d]),
        ...firstFeed(world, p, source, plans[d]),
      };
    return row;
  });
  const moments = (fn) => summarize(rows, weights, total, ess, fn);
  const candidates = possible.map((d) => {
    const match = moments((row) => row[d].equity),
      safe = moments((row) => row[d].safe);
    const edge = moments((row) => row[d].value);
    return {
      card: four[d],
      keptScore: p.t.raw[leaveOut(four, d)],
      matchWinChance: match.mean,
      matchStandardError: match.se,
      safeChance: safe.mean,
      safeStandardError: safe.se,
      ownLossChance: 1 - safe.mean,
      value: edge.mean,
      standardError: edge.se,
      blitzChance: moments((row) => +row[d].blitz).mean,
      opponentBlitzChance: moments((row) => +row[d].opponentBlitz).mean,
      showdownLossChance: moments((row) => +row[d].showdownLoss).mean,
      ...feedMeans(rows, (r) => r[d], weights, total, p.seats[1]),
      continuation: plans[d].mode,
    };
  });
  const metric = {
    match: "matchWinChance",
    safe: "safeChance",
    round: "value",
  }[objective];
  const ordered = candidates
    .slice()
    .sort(
      (a, b) =>
        b[metric] - a[metric] ||
        b.keptScore - a.keptScore ||
        a.nextBlitzChance - b.nextBlitzChance ||
        a.nextImproveChance - b.nextImproveChance,
    );
  const proven = possible.filter((d) => p.t.raw[leaveOut(four, d)] === 31);
  const exact = proven.length > 0 && canProveBlitzOptimal(p);
  if (exact) {
    const at = ordered.findIndex((c) => c.keptScore === 31);
    ordered.unshift(...ordered.splice(at, 1));
  }
  const [best, second] = ordered,
    idx = four.indexOf(best.card),
    next = four.indexOf(second.card);
  const gap = moments((row) => row[idx][p.metric] - row[next][p.metric]);
  const alt = ordered.find(
    (c) =>
      c.keptScore === best.keptScore &&
      c.nextImproveChance > best.nextImproveChance + 0.015,
  );
  const percent = (v) => Math.round(v * 100) + "%";
  const reason = exact
    ? "Discard " + cardLabel(best.card) + " to keep an instant 31."
    : alt
      ? "Both " +
        cardLabel(best.card) +
        " and " +
        cardLabel(alt.card) +
        " keep " +
        best.keptScore +
        ". The next seat improves by taking them on " +
        percent(best.nextImproveChance) +
        " and " +
        percent(alt.nextImproveChance) +
        " of modeled deals, respectively."
      : "Discard " +
        cardLabel(best.card) +
        " to keep " +
        best.keptScore +
        " points.";
  return {
    action: "throw",
    discardCard: best.card,
    candidates,
    objective,
    reads: worldsRead(p, worlds, weights, total),
    nextSeat: best.nextSeat,
    margin: gap.mean,
    marginSE: gap.se,
    confidence: exact
      ? "certain"
      : ess < 20
        ? "limited"
        : gap.mean <= 1.96 * gap.se + 0.002
          ? "close"
          : "clear",
    exact,
    reason,
    samples: worlds.length,
    effectiveSamples: Math.round(ess),
  };
}

// Public suit estimates can also be obtained between decision prompts.
export function readOpponents(view, options = {}) {
  const p = view.hand.length === 4 ? prepareDrawn(view).p : prepare(view);
  const n = Math.max(1, Math.min(50000, Math.round(options.samples ?? 480)));
  const { worlds, logs } = collectWorlds(
    p,
    n,
    generator(options.seed ?? 31),
    n,
    n,
  );
  const mx = Math.max(...logs),
    w = logs.map((v) => Math.exp(v - mx)),
    total = w.reduce((s, v) => s + v, 0);
  return worldsRead(p, worlds, w, total);
}
