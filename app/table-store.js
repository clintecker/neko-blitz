// Browser persistence for the solo table, the room session, and the last rules.

export const SOLO = "neko-blitz.solo.family.v2",
  SESSION = "neko-blitz.room.family.v1",
  // The player deliberately returned to the lobby, so do not resume the saved solo hand.
  HOME = "neko-blitz.lobby",
  RULES = "neko-blitz.last-rules";

export function read(storage, key) {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null;
  }
}

export function save(storage, key, thing) {
  try {
    if (thing == null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(thing));
  } catch {
    /* A full or private store still allows play. */
  }
}

// The remembered session for one room code, so a revisit can rejoin that seat.
export const sessionKey = (code) => SESSION + "." + code;

// A saved solo table resumes only when it still looks like a dealt match.
export const savedSolo = (saved) =>
  saved?.seats?.length >= 2 &&
  saved?.rules &&
  Array.isArray(saved?.stock) &&
  saved?.phase
    ? saved
    : null;
