import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createTableHandler } from "../app/api/table/handler.js";
import { postTable } from "./lib/api-request.mjs";

// Exercise the real handler with an in-memory D1 adapter and an injected clock,
// including authentication and revision checks.
const rows = new Map();
const start = Date.UTC(2026, 0, 1);
let clock = start;
// Tests set this to bump the stored revision while a write is in flight.
let interrupt = null;
const db = {
  prepare(sql) {
    return {
      bind(...args) {
        return {
          async first() { return rows.get(args[0]) || null; },
          async run() {
            let changes = 0;
            if (sql.startsWith("INSERT")) {
              const [code, updated, body] = args;
              if (!rows.has(code)) {
                rows.set(code, { revision: 1, updated, body });
                changes = 1;
              }
            } else if (sql.startsWith("UPDATE")) {
              interrupt?.();
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
const table = createTableHandler({ db, now: () => clock });
const request = postTable("https://blitz.test", table);

beforeEach(() => {
  rows.clear();
  clock = start;
  interrupt = null;
});

test("host ending a running room ends it for every player and survives retries", async () => {
  const host = (await request("create", { name: "Host", rules: { players: 3 } })).data;
  const guest = (await request("join", { code: host.code, name: "Guest" })).data;
  const started = await request("start", { code: host.code, revision: guest.revision }, host.token);
  assert.equal(started.status, 200);
  const denied = await request("end", { code: host.code, revision: started.data.revision }, guest.token);
  assert.equal(denied.status, 403);
  // A stale UI revision should not prevent an authorized host from ending.
  const ended = await request("end", { code: host.code, revision: 1 }, host.token);
  assert.equal(ended.status, 200);
  assert.equal(ended.data.ended, true);
  assert.equal(ended.data.view, null);
  const remote = await request("state", { code: host.code }, guest.token);
  assert.equal(remote.data.ended, true);
  assert.equal(remote.data.view, null);
  const repeated = await request("end", { code: host.code, revision: 1 }, host.token);
  assert.equal(repeated.data.ended, true);
  assert.equal((await request("join", { code: host.code })).status, 409);
});

test("a departing guest is replaced by a bot and loses access to the seat", async () => {
  const host = (await request("create", { name: "Host" })).data;
  const guest = (await request("join", { code: host.code, name: "Guest" })).data;
  await request("start", { code: host.code, revision: guest.revision }, host.token);
  const left = await request("leave", { code: host.code, revision: 1 }, guest.token);
  assert.equal(left.status, 200);
  const stored = JSON.parse(rows.get(host.code).body);
  assert.equal(stored.table.seats[guest.seat].human, false);
  assert.equal(stored.members.some(m => m.id === guest.seat), false);
  assert.equal((await request("state", { code: host.code }, guest.token)).status, 403);
  assert.equal((await request("state", { code: host.code }, host.token)).data.ended, false);
});

test("an opaque Origin: null request is refused with 403 instead of an uncaught throw", async () => {
  const post = (headers) => table(new Request("https://blitz.test/api/table", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ op: "create", name: "Host" }),
  }));
  // Sandboxed iframes and some privacy modes send the literal string "null".
  const opaque = await post({ Origin: "null", "Sec-Fetch-Site": "cross-site" });
  assert.equal(opaque.status, 403);
  assert.equal((await opaque.json()).error, "Open the table in its own tab.");
  const foreign = await post({ Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" });
  assert.equal(foreign.status, 403);
  // A same-host origin still reaches the handler.
  const same = await post({ Origin: "https://blitz.test", "Sec-Fetch-Site": "cross-site" });
  assert.equal(same.status, 201);
});

test("leaving a waiting room frees the correct seat for the next guest", async () => {
  const host = (await request("create", { name: "Host" })).data;
  const first = (await request("join", { code: host.code, name: "First" })).data;
  await request("join", { code: host.code, name: "Second" });
  await request("leave", { code: host.code }, first.token);
  const replacement = (await request("join", { code: host.code, name: "Replacement" })).data;
  assert.equal(replacement.seat, first.seat);
  assert.equal(new Set(replacement.members.map(m => m.id)).size, 3);
});

test("a missing D1 binding answers 503 instead of throwing", async () => {
  const offline = createTableHandler({ db: undefined });
  const response = await offline(new Request("https://blitz.test/api/table", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "create", name: "Host" }),
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "The online table is temporarily unavailable.");
});

test("a room idle past the expiry window is refused as missing", async () => {
  const host = (await request("create", { name: "Host" })).data;
  clock = start + 49 * 60 * 60 * 1000;
  const late = await request("state", { code: host.code }, host.token);
  assert.equal(late.status, 404);
  assert.equal(late.data.error, "This room has expired or the code is incorrect.");
});

test("an unknown op is refused without touching the room", async () => {
  const host = (await request("create", { name: "Host" })).data;
  const unknown = await request("dance", { code: host.code, revision: host.revision }, host.token);
  assert.equal(unknown.status, 400);
  assert.equal(unknown.data.error, "Unknown table action.");
});

test("a body that is not JSON is refused before the room is read", async () => {
  const send = (body) => table(new Request("https://blitz.test/api/table", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }));
  const broken = await send("{not json");
  assert.equal(broken.status, 400);
  assert.equal((await broken.json()).error, "Invalid table request.");
  const primitive = await send("null");
  assert.equal(primitive.status, 400);
  assert.equal((await primitive.json()).error, "Invalid table request.");
});

test("a bot poll that loses the revision race still answers 200 with the fresh room", async () => {
  const host = (await request("create", { name: "Host", rules: { players: 2 } })).data;
  const dealt = await request("start", { code: host.code, revision: host.revision }, host.token);
  // Draw and throw so the bot seat owns the turn.
  const drawn = await request("move", { code: host.code, revision: dealt.data.revision, action: "stock" }, host.token);
  const thrown = await request("move", { code: host.code, revision: drawn.data.revision, action: "throw", card: drawn.data.view.hand[0] }, host.token);
  assert.equal(thrown.status, 200);
  clock += 1150;
  // Another tab commits between this poll's read and its write.
  interrupt = () => { rows.get(host.code).revision += 1; };
  const raced = await request("state", { code: host.code }, host.token);
  assert.equal(raced.status, 200);
  assert.equal(raced.data.stale, true);
  assert.equal(raced.data.revision, rows.get(host.code).revision);
});
