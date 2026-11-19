import { test } from "node:test";
import assert from "node:assert/strict";
import { ArcadeMixer } from "../app/arcade-audio.js";

test("a pending mobile audio resume never blocks the next gesture", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false } });
  let resumes = 0;
  let wakes = 0;
  const engine = new ArcadeMixer({ enabled: true, music: true, volume: 75 }, () => {});
  engine.context = {
    state: "suspended",
    sampleRate: 44100,
    destination: {},
    resume() {
      resumes++;
      // Reproduce WebKit leaving an earlier resume promise unresolved.
      return new Promise(() => {});
    },
    createBuffer: () => ({}),
    createBufferSource: () => ({ connect() {}, start() { wakes++; } }),
  };
  try {
    engine.unlock();
    engine.unlock();
    assert.equal(resumes, 2);
    assert.equal(wakes, 2);
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  }
});
