// The /api/table handler with its Worker wiring left out: route.js hands in
// env.DB, tests hand in an in-memory D1 and a clock.
import {
  newTable,
  rulesFor,
  deal,
  act,
  projectTable,
  RuleViolation,
} from "../../../public/game/table.mjs";
import { playBotStep } from "../../../public/game/arcade-bots.mjs";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 7;
// Derived, so the validators can never drift from what newCode() emits.
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const TOKEN_BYTES = 24;
const TOKEN_HEX = TOKEN_BYTES * 2;
const TOKEN_PATTERN = new RegExp(`^[\\da-f]{${TOKEN_HEX}}$`);
const HOST_SEAT = 0;
// Rooms idle this long are deleted on write and refused on read.
const expiry = 48 * 60 * 60 * 1000;
// One bot move per ~1.15s of room idleness; the client polls at 650ms.
const BOT_THINK_MS = 1150;
// end and leave accept a stale revision: any tab may stop the game.
const REVISION_FREE = ["end", "leave"];

const reply = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
const hex = (buffer) =>
  Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const digest = async (token) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
const nameFor = (n) =>
  typeof n === "string"
    ? n
        .trim()
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
        .slice(0, 18) || "Nova"
    : "Nova";
const isHost = (member) => member.id === HOST_SEAT;
const expiredBefore = (now) => now - expiry;
// The lowest seat index nobody holds; seats stay dense across 0..players-1.
const freeSeat = (room) =>
  Array.from({ length: room.rules.players }, (_, id) => id).find(
    (id) => !room.members.some((m) => m.id === id),
  );

// Opaque origins such as "null" are real browser values and must not throw a 500.
function isCrossSite(request) {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") !== "cross-site")
    return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true; // malformed or opaque ("null") origin: treat as cross-site
  }
}

// member.hash must never leave the worker; member.id is the seat index in
// table.seats.
function snapshot(room, seat, code, revision) {
  return {
    code,
    ended: Boolean(room.ended),
    revision,
    seat,
    host: seat === HOST_SEAT,
    rules: room.rules,
    members: room.members.map(({ name, id }) => ({ id, name })),
    view: room.table ? projectTable(room.table, seat) : null,
  };
}

// Returns the parsed body, or the 400 reply when it is not a JSON object.
async function readRequest(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    return reply({ error: "Invalid table request." }, 400);
  }
  if (!input || typeof input !== "object")
    return reply({ error: "Invalid table request." }, 400);
  return input;
}

export function createTableHandler({
  db,
  now = Date.now,
  randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n)),
}) {
  const newToken = () => hex(randomBytes(TOKEN_BYTES));
  const newCode = () =>
    Array.from(
      randomBytes(CODE_LENGTH),
      (b) => CODE_ALPHABET[b % CODE_ALPHABET.length],
    ).join("");

  // A fresh code and the host's seat; idle rooms are swept on the way in.
  async function createRoom(input, at) {
    const token = newToken();
    const member = {
      id: HOST_SEAT,
      name: nameFor(input.name),
      hash: await digest(token),
    };
    const room = {
      rules: rulesFor(input.rules),
      members: [member],
      table: null,
    };
    await db
      .prepare(
        "DELETE FROM blitz_rooms WHERE code IN (SELECT code FROM blitz_rooms WHERE updated < ? LIMIT 30)",
      )
      .bind(expiredBefore(at))
      .run();
    for (let i = 0; i < 4; i++) {
      const code = newCode();
      const insert = await db
        .prepare(
          "INSERT OR IGNORE INTO blitz_rooms (code,revision,updated,body) VALUES (?,1,?,?)",
        )
        .bind(code, at, JSON.stringify(room))
        .run();
      if (insert.meta.changes)
        return reply({ ...snapshot(room, HOST_SEAT, code, 1), token }, 201);
    }
    return reply({ error: "Try creating the room again." }, 503);
  }

  // The stored row owns the revision; a missing or idle room reads as gone.
  async function loadRoom(code, at) {
    const row = await db
      .prepare("SELECT revision,updated,body FROM blitz_rooms WHERE code=?")
      .bind(code)
      .first();
    if (!row || row.updated < expiredBefore(at))
      return reply(
        { error: "This room has expired or the code is incorrect." },
        404,
      );
    return { row, room: JSON.parse(row.body) };
  }

  // Parallel polling, taps and retries must never deal twice or advance two seats.
  async function commitRoom(code, room, at, revision) {
    const updated = await db
      .prepare(
        "UPDATE blitz_rooms SET body=?,revision=revision+1,updated=? WHERE code=? AND revision=?",
      )
      .bind(JSON.stringify(room), at, code, revision)
      .run();
    return updated.meta.changes ? updated : null;
  }

  // A guest takes the lowest free seat and gets a token of their own.
  async function joinRoom(room, input) {
    if (room.ended)
      return reply({ error: "This game has ended. Create a new room." }, 409);
    if (room.table)
      return reply({ error: "This match has already started." }, 409);
    if (room.members.length >= room.rules.players)
      return reply({ error: "Every seat at this table is taken." }, 409);
    const token = newToken();
    const member = {
      id: freeSeat(room),
      name: nameFor(input.name),
      hash: await digest(token),
    };
    room.members.push(member);
    return { member, token };
  }

  // The bearer token is the only proof that a caller holds a seat.
  async function authenticate(request, room) {
    const key =
      request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
    if (!TOKEN_PATTERN.test(key))
      return reply(
        { error: "This seat needs its original tab or a new room." },
        403,
      );
    const hash = await digest(key);
    const member = room.members.find((p) => p.hash === hash);
    if (!member) return reply({ error: "This seat is unavailable." }, 403);
    return member;
  }

  // A poll only advances the bots, and only once per BOT_THINK_MS of idleness.
  function tickBots(room, row, at) {
    if (room.ended || !room.table || room.table.phase === "end") return false;
    if (room.table.seats[room.table.turn].human) return false;
    return at - row.updated >= BOT_THINK_MS && playBotStep(room.table);
  }

  // start and rematch deal the same table; only their gate on the old one differs.
  function startMatch({ room, member, input }) {
    if (!isHost(member))
      return reply({ error: "The host deals the match." }, 403);
    if (
      (input.op === "start" && room.table) ||
      (input.op === "rematch" && room.table?.result?.winner == null)
    )
      return reply({ error: "This match is already in play." }, 409);
    room.table = newTable(
      room.rules,
      room.members.map((m) => m.id),
      Object.fromEntries(room.members.map((m) => [m.id, m.name])),
    );
    return { changed: true };
  }

  // Each op mutates the loaded room or returns the authority error, which the
  // caller sends untouched.
  const OPS = {
    end({ room, member }) {
      if (!isHost(member))
        return reply(
          { error: "Only the host can end the game for everyone." },
          403,
        );
      room.table = null;
      room.ended = true;
      return { changed: true };
    },
    leave({ room, member }) {
      if (isHost(member))
        return reply({ error: "The host must end the game." }, 409);
      if (room.table) room.table.seats[member.id].human = false;
      room.members = room.members.filter((m) => m.id !== member.id);
      return { changed: true };
    },
    start: startMatch,
    rematch: startMatch,
    next({ room }) {
      if (!room.table || room.table.phase !== "end")
        return reply({ error: "The round is still in play." }, 409);
      deal(room.table);
      return { changed: true };
    },
    move({ room, member, input }) {
      if (!room.table)
        return reply({ error: "The host has not dealt yet." }, 409);
      act(room.table, member.id, input.action, input.card);
      return { changed: true };
    },
  };

  return async function tableHandler(request) {
    const input = await readRequest(request);
    if (input instanceof Response) return input;
    if (isCrossSite(request))
      return reply({ error: "Open the table in its own tab." }, 403);
    if (!db)
      return reply(
        { error: "The online table is temporarily unavailable." },
        503,
      );
    try {
      const at = now();
      if (input.op === "create") return await createRoom(input, at);
      const code = String(input.code || "")
        .toUpperCase()
        .trim();
      if (!CODE_PATTERN.test(code))
        return reply({ error: "Enter the seven-character room code." }, 400);
      const loaded = await loadRoom(code, at);
      if (loaded instanceof Response) return loaded;
      const { row, room } = loaded;
      let member,
        token,
        changed = false;
      if (input.op === "join") {
        const joined = await joinRoom(room, input);
        if (joined instanceof Response) return joined;
        ({ member, token } = joined);
        changed = true;
      } else {
        member = await authenticate(request, room);
        if (member instanceof Response) return member;
        if (input.op === "state") {
          // The fast path: polling never checks or writes a revision it read.
          changed = tickBots(room, row, at);
        } else {
          if (input.revision !== row.revision && !REVISION_FREE.includes(input.op))
            return reply(
              { ...snapshot(room, member.id, code, row.revision), stale: true },
              409,
            );
          if (room.ended) return reply(snapshot(room, member.id, code, row.revision));
          const op = OPS[input.op];
          if (!op) return reply({ error: "Unknown table action." }, 400);
          const result = op({ room, member, input, row });
          if (result instanceof Response) return result;
          changed = result.changed;
        }
      }
      if (changed && !(await commitRoom(code, room, at, row.revision))) {
        if (input.op === "join")
          return reply(
            { error: "Another player just joined. Try joining again." },
            409,
          );
        const fresh = await db
          .prepare("SELECT revision,body FROM blitz_rooms WHERE code=?")
          .bind(code)
          .first();
        return reply(
          {
            ...snapshot(
              JSON.parse(fresh.body),
              member.id,
              code,
              fresh.revision,
            ),
            stale: true,
          },
          input.op === "state" ? 200 : 409,
        );
      }
      // commitRoom bumps revision by exactly one when a write happened.
      return reply({
        ...snapshot(room, member.id, code, row.revision + Number(changed)),
        ...(token ? { token } : {}),
      });
    } catch (error) {
      // RuleViolation is the primary contract; the message regex stays until every caller is upgraded.
      const message = error instanceof Error ? error.message : "";
      if (
        error instanceof RuleViolation ||
        /^(Wait for|Someone has|Choose the|That pile|Select one|Keep the|The match|Finish this)/.test(
          message,
        )
      )
        return reply({ error: message }, 409);
      console.error(
        "Table request failed:",
        input && input.op,
        input && input.code,
        message || error,
      );
      return reply({ error: "The table could not sync. Please try again." }, 503);
    }
  };
}
