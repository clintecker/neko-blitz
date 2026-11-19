// Verify the built Worker and real local D1 together without account credentials.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { postTable } from "./lib/api-request.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const run = promisify(execFile);
const environment = {
  ...process.env,
  CLOUDFLARE_CF_FETCH_ENABLED: "false",
  WRANGLER_SEND_METRICS: "false",
};

async function availablePort() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return port;
}

function ready(worker) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Worker startup timed out.\n" + output)), 45000);
    const read = chunk => {
      output = (output + chunk.toString()).slice(-6000);
      if (output.includes("Ready on http://127.0.0.1:")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    worker.stdout.on("data", read);
    worker.stderr.on("data", read);
    worker.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once("exit", code => {
      clearTimeout(timeout);
      reject(new Error(`Worker exited with code ${code}.\n${output}`));
    });
  });
}

test("built Worker serves the game and versioned D1 rooms", { timeout: 90000 }, async () => {
  const state = await mkdtemp(path.join(tmpdir(), "neko-blitz-smoke-"));
  let worker;
  try {
    const migrate = [wrangler, "d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.jsonc", "--persist-to", state];
    await run(process.execPath, migrate, { cwd: root, env: environment, timeout: 30000 });
    // A second application must be a no-op against Wrangler's migration ledger.
    await run(process.execPath, migrate, { cwd: root, env: environment, timeout: 30000 });
    const port = await availablePort();
    worker = spawn(process.execPath, [wrangler, "dev", "--config", "dist/server/wrangler.json", "--local", "--persist-to", state, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0"], {
      cwd: root,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await ready(worker);
    const origin = `http://127.0.0.1:${port}`;
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /BLITZ/);
    for (const asset of ["/art/club-doors.webp", "/game/night-synth.mjs", "/fonts/inter.woff2"]) {
      const response = await fetch(origin + asset);
      assert.equal(response.status, 200, asset);
      assert.ok((await response.arrayBuffer()).byteLength > 1000, asset);
    }

    const send = postTable(origin);
    async function request(op, fields = {}, token, status = 200) {
      const { status: got, data } = await send(op, fields, token);
      assert.equal(got, status, `${op}: ${data.error || "unexpected status"}`);
      return data;
    }

    const host = await request("create", { name: "Smoke host", rules: { players: 2 } }, undefined, 201);
    const guest = await request("join", { code: host.code, name: "Smoke guest" });
    const game = await request("start", { code: host.code, revision: guest.revision }, host.token);
    const other = await request("state", { code: host.code }, guest.token);
    assert.equal(other.view.hand.length, 3);
    // Opening Blitz legitimately reveals the round's hands immediately.
    if (game.view.phase !== "end") {
      assert.equal(game.view.seats[guest.seat].hand, null);
      assert.equal(other.view.seats[0].hand, null);
    }
    const ended = await request("end", { code: host.code, revision: 1 }, host.token);
    assert.equal(ended.ended, true);
    assert.equal(ended.view, null);
    const remote = await request("state", { code: host.code }, guest.token);
    assert.equal(remote.ended, true);
  } finally {
    if (worker && worker.exitCode === null) {
      const exited = once(worker, "exit");
      worker.kill("SIGTERM");
      await Promise.race([exited, delay(5000)]);
      if (worker.exitCode === null) {
        worker.kill("SIGKILL");
        await exited;
      }
    }
    await rm(state, { recursive: true, force: true });
  }
});
