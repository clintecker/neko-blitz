import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Exercise the real API with an in-memory D1 adapter, including authentication
// and revision checks. Each test file has an isolated Node process.
const rows = new Map();
globalThis.__blitzRoomTest = {
  DB: {
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
  },
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") return {
      url: "data:text/javascript,export const env=globalThis.__blitzRoomTest",
      shortCircuit: true,
    };
    return next(specifier, context);
  },
});
const { POST } = await import("../app/api/table/route.js");
hooks.deregister();

async function request(op, fields = {}, token) {
  const response = await POST(new Request("https://blitz.test/api/table", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ op, ...fields }),
  }));
  return { status: response.status, data: await response.json() };
}

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

test("leaving a waiting room frees the correct seat for the next guest", async () => {
  const host = (await request("create", { name: "Host" })).data;
  const first = (await request("join", { code: host.code, name: "First" })).data;
  await request("join", { code: host.code, name: "Second" });
  await request("leave", { code: host.code }, first.token);
  const replacement = (await request("join", { code: host.code, name: "Replacement" })).data;
  assert.equal(replacement.seat, first.seat);
  assert.equal(new Set(replacement.members.map(m => m.id)).size, 3);
});
