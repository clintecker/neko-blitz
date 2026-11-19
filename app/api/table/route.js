import { env } from "cloudflare:workers";
import {
  newTable,
  rulesFor,
  deal,
  act,
  projectTable,
} from "../../../public/game/table.mjs";
import { playBotStep } from "../../../public/game/arcade-bots.mjs";

export const dynamic = "force-dynamic";
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const expiry = 48 * 60 * 60 * 1000;
const reply = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
const bytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const hex = (buffer) =>
  Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const digest = async (token) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
const newCode = () =>
  Array.from(bytes(7), (b) => alphabet[b % alphabet.length]).join("");
const nameFor = (n) =>
  typeof n === "string"
    ? n
        .trim()
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
        .slice(0, 18) || "Nova"
    : "Nova";

function snapshot(room, seat, code, revision) {
  return {
    code,
    ended: Boolean(room.ended),
    revision,
    seat,
    host: seat === 0,
    rules: room.rules,
    members: room.members.map(({ name, id }) => ({ id, name })),
    view: room.table ? projectTable(room.table, seat) : null,
  };
}

export async function POST(request) {
  let input;
  try {
    input = await request.json();
  } catch {
    return reply({ error: "Invalid table request." }, 400);
  }
  if (!input || typeof input !== "object")
    return reply({ error: "Invalid table request." }, 400);
  if (
    request.headers.get("origin") &&
    new URL(request.headers.get("origin")).host !== new URL(request.url).host &&
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return reply({ error: "Open the table in its own tab." }, 403);
  const db = env.DB;
  if (!db)
    return reply(
      { error: "The online table is temporarily unavailable." },
      503,
    );
  try {
    const now = Date.now();
    if (input.op === "create") {
      const token = hex(bytes(24)),
        member = {
          id: 0,
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
        .bind(now - expiry)
        .run();
      for (let i = 0; i < 4; i++) {
        const code = newCode();
        const insert = await db
          .prepare(
            "INSERT OR IGNORE INTO blitz_rooms (code,revision,updated,body) VALUES (?,1,?,?)",
          )
          .bind(code, now, JSON.stringify(room))
          .run();
        if (insert.meta.changes)
          return reply({ ...snapshot(room, 0, code, 1), token }, 201);
      }
      return reply({ error: "Try creating the room again." }, 503);
    }
    const code = String(input.code || "")
      .toUpperCase()
      .trim();
    if (!/^[A-HJ-NP-Z2-9]{7}$/.test(code))
      return reply({ error: "Enter the seven-character room code." }, 400);
    const row = await db
      .prepare("SELECT revision,updated,body FROM blitz_rooms WHERE code=?")
      .bind(code)
      .first();
    if (!row || row.updated < now - expiry)
      return reply(
        { error: "This room has expired or the code is incorrect." },
        404,
      );
    const room = JSON.parse(row.body);
    let member,
      token,
      changed = false;
    if (input.op === "join") {
      if (room.ended) return reply({ error: "This game has ended. Create a new room." }, 409);
      if (room.table)
        return reply({ error: "This match has already started." }, 409);
      if (room.members.length >= room.rules.players)
        return reply({ error: "Every seat at this table is taken." }, 409);
      token = hex(bytes(24));
      member = {
        id: Array.from({ length: room.rules.players }, (_, i) => i).find(
          id => !room.members.some(m => m.id === id),
        ),
        name: nameFor(input.name),
        hash: await digest(token),
      };
      room.members.push(member);
      changed = true;
    } else {
      const key =
        request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
      if (!/^[\da-f]{48}$/.test(key))
        return reply(
          { error: "This seat needs its original tab or a new room." },
          403,
        );
      const hash = await digest(key);
      member = room.members.find((p) => p.hash === hash);
      if (!member) return reply({ error: "This seat is unavailable." }, 403);
      if (input.op === "state") {
        if (
          !room.ended &&
          room.table &&
          room.table.phase !== "end" &&
          !room.table.seats[room.table.turn].human &&
          now - row.updated >= 1150
        )
          changed = playBotStep(room.table);
      } else {
        if (input.revision !== row.revision && !["end", "leave"].includes(input.op))
          return reply(
            { ...snapshot(room, member.id, code, row.revision), stale: true },
            409,
          );
        if (room.ended) return reply(snapshot(room, member.id, code, row.revision));
        if (input.op === "end") {
          if (member.id !== 0) return reply({ error: "Only the host can end the game for everyone." }, 403);
          room.table = null;
          room.ended = true;
        } else if (input.op === "leave") {
          if (member.id === 0) return reply({ error: "The host must end the game." }, 409);
          if (room.table) room.table.seats[member.id].human = false;
          room.members = room.members.filter(m => m.id !== member.id);
        } else if (input.op === "start" || input.op === "rematch") {
          if (member.id !== 0)
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
        } else if (input.op === "next") {
          if (!room.table || room.table.phase !== "end")
            return reply({ error: "The round is still in play." }, 409);
          deal(room.table);
        } else if (input.op === "move") {
          if (!room.table)
            return reply({ error: "The host has not dealt yet." }, 409);
          act(room.table, member.id, input.action, input.card);
        } else return reply({ error: "Unknown table action." }, 400);
        changed = true;
      }
    }
    if (changed) {
      // Parallel polling, taps and retries must never deal twice or advance two seats.
      const updated = await db
        .prepare(
          "UPDATE blitz_rooms SET body=?,revision=revision+1,updated=? WHERE code=? AND revision=?",
        )
        .bind(JSON.stringify(room), now, code, row.revision)
        .run();
      if (!updated.meta.changes) {
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
    }
    return reply({
      ...snapshot(room, member.id, code, row.revision + Number(changed)),
      ...(token ? { token } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      /^(Wait for|Someone has|Choose the|That pile|Select one|Keep the|The match|Finish this)/.test(
        message,
      )
    )
      return reply({ error: message }, 409);
    return reply({ error: "The table could not sync. Please try again." }, 503);
  }
}
