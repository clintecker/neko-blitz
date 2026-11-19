// Facts come directly from public transfers. Probabilistic suit reads are supplied by the coach.
import { suitOf } from "./rules.mjs";

export function observed(v) {
  const facts = new Map(
    v.active
      .filter((id) => id !== v.self)
      .map((id) => [
        id,
        {
          known: new Set(),
          picks: [0, 0, 0, 0],
          drops: [0, 0, 0, 0],
          passes: [0, 0, 0, 0],
        },
      ]),
  );
  let faceUp = v.openingDiscard;
  for (const e of v.events) {
    const f = facts.get(e.seat),
      offered = faceUp;
    faceUp = e.discard;
    if (!f) continue;
    if (e.source === "stock" && Number.isInteger(offered))
      f.passes[suitOf(offered)]++;
    if (e.source === "discard" && Number.isInteger(e.picked)) {
      f.known.add(e.picked);
      f.picks[suitOf(e.picked)]++;
    }
    f.known.delete(e.discard);
    f.drops[suitOf(e.discard)]++;
  }
  if (
    v.phase === "throw" &&
    v.turn !== v.self &&
    v.drawSource === "discard" &&
    Number.isInteger(v.drawn)
  ) {
    const f = facts.get(v.turn);
    if (f) {
      f.known.add(v.drawn);
      f.picks[suitOf(v.drawn)]++;
    }
  }
  if (
    v.phase === "throw" &&
    v.drawSource === "stock" &&
    Number.isInteger(faceUp)
  ) {
    const f = facts.get(v.turn);
    if (f) f.passes[suitOf(faceUp)]++;
  }
  return facts;
}
export function nextAfterSelf(v) {
  const i = v.active.indexOf(v.self);
  return i < 0 ? null : v.active[(i + 1) % v.active.length];
}
