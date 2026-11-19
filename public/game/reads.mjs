// Facts come directly from public transfers. Probabilistic suit reads are supplied by the coach.
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
      f.passes[Math.floor(offered / 13)]++;
    if (e.source === "discard" && Number.isInteger(e.picked)) {
      f.known.add(e.picked);
      f.picks[Math.floor(e.picked / 13)]++;
    }
    f.known.delete(e.discard);
    f.drops[Math.floor(e.discard / 13)]++;
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
      f.picks[Math.floor(v.drawn / 13)]++;
    }
  }
  if (
    v.phase === "throw" &&
    v.drawSource === "stock" &&
    Number.isInteger(faceUp)
  ) {
    const f = facts.get(v.turn);
    if (f) f.passes[Math.floor(faceUp / 13)]++;
  }
  return facts;
}
export function nextAfterSelf(v) {
  const i = v.active.indexOf(v.self);
  return i < 0 ? null : v.active[(i + 1) % v.active.length];
}
