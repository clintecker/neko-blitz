// Board and coach derive the same turn flags. `mine` is the raw turn check:
// a finished round still reports the seat whose turn ended.
export function turnState(view) {
  const playing = Boolean(view && view.phase !== "end"),
    mine = Boolean(view && view.turn === view.self);
  return {
    playing,
    mine,
    drawing: playing && mine && view.phase === "draw",
    throwing: playing && mine && view.phase === "throw",
    finalTurn: Boolean(view && view.knocker != null),
  };
}
