// Seeded replay: the same seed must pick the same cards and the same cues, so
// every test file shares one LCG rather than its own copy.
export function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
