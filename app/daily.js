// The daily deal: one seeded match per calendar date, dealt in the browser.
// There is no server and no leaderboard, so progress is only this browser's.
import { defaults, newTable } from "../public/game/table.mjs";
import { read, save } from "./table-store.js";

export const DAILY_KEY = "neko-blitz.daily.v1";

// Mixed into every seed. Bumping it moves the deals, so a future rules or deck
// change can start a new series instead of silently rewriting past hands.
export const DAILY_VERSION = 1;

const SEED_SALT = "neko-blitz-daily-v1/";

// The day boundary is local midnight. A late hand can land on the neighbouring
// UTC date for a travelling player; that skew is accepted.
export function localDateKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// FNV-1a over the versioned date, so the same date always seeds the same deck.
export function seedFor(key, version = DAILY_VERSION) {
  let hash = 0x811c9dc5;
  const text = `${SEED_SALT}${version}/${key}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// mulberry32. Small and fast, and the daily deck needs no cryptographic source.
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The random function newTable() wants, plus the seed behind it for replay.
export function dailyDeal(key, version = DAILY_VERSION) {
  const seed = seedFor(key, version);
  return { key, seed, random: seededRandom(seed) };
}

// Today's match: a solo four-seat arcade table on the default rules.
export function startDaily(key, version = DAILY_VERSION) {
  return newTable(defaults, [0], {}, dailyDeal(key, version).random);
}

// Yesterday for a date key, computed in UTC so the answer never depends on
// where this browser thinks the day starts.
function dayBefore(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export function readDaily(storage = globalThis.localStorage) {
  const saved = read(storage, DAILY_KEY);
  return typeof saved?.date === "string" && Number.isInteger(saved?.streak)
    ? saved
    : null;
}

export const isDailyDone = (key, storage) => readDaily(storage)?.date === key;

// One completion per date. A run that continues from yesterday extends the
// streak; a missed day starts it over.
export function recordDaily(key, result, storage = globalThis.localStorage) {
  const previous = readDaily(storage);
  if (previous?.date === key) return previous;
  const streak = previous?.date === dayBefore(key) ? previous.streak + 1 : 1;
  const next = { date: key, result, streak };
  save(storage, DAILY_KEY, next);
  return next;
}

// How the daily went for the seat the player holds.
export function dailyOutcome(view) {
  const lives = view.seats[view.self ?? 0].lives;
  return { lives, won: lives > 0 };
}

export function dailyShareText({ date, won, lives, streak }) {
  const days = `${streak}-day streak`;
  if (!won) return `Neko Blitz daily ${date}: went out, ${days}`;
  return `Neko Blitz daily ${date}: survived with ${lives} ${
    lives === 1 ? "life" : "lives"
  }, ${days}`;
}
