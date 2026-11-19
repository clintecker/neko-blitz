import { useEffect, useMemo, useRef, useState } from "react";
import { analyzePosition, WATCH_PHASE } from "../public/game/analyze-position.mjs";

export function useAdvice(view, objective, showReads) {
  const [reply, setReply] = useState(null),
    serial = useRef(0);
  // The question and its serialized key are built together, so the whole view
  // is stringified once per change instead of once per render. The key
  // intentionally excludes room polling revisions and other seats' private
  // cards; the seed rides along because it hashes that same string.
  const advice = useMemo(() => {
    const watching = view && view.turn !== view.self,
      // While someone holds four cards, estimates describe the last
      // completed turn. Restore the public piles to the instant before their
      // draw. Known pickups and suit counts still update immediately in the
      // public ledger.
      pendingDraw = watching && view.phase === "throw";
    const ask =
      view &&
      // No advice at showdown: the hand is over and no play follows.
      view.phase !== "end" &&
      // No advice for eliminated seats: they can no longer act.
      view.active.includes(view.self) &&
      // No opponent-turn advice unless the reads sheet is open;
      // showReads is what makes the reads sheet pay the analysis cost.
      (!watching || showReads);
    if (!ask) return null;
    const payload = {
      phase: watching ? WATCH_PHASE : view.phase,
      currentSeat: view.turn,
      drawSource: watching ? null : view.drawSource,
      drawn: watching ? null : view.drawn,
      hand: view.hand,
      discard:
        pendingDraw && view.drawSource === "discard"
          ? [...view.discard, view.drawn]
          : view.discard,
      active: view.active,
      self: view.self,
      events: view.events,
      openingDiscard: view.openingDiscard,
      stockCount:
        view.stockCount + Number(pendingDraw && view.drawSource === "stock"),
      lives: view.lives,
      rules: view.rules,
      knocker: view.knocker,
    };
    const key = JSON.stringify(payload);
    let seed = 2166136261;
    for (let i = 0; i < key.length; i++)
      seed = Math.imul(seed ^ key.charCodeAt(i), 16777619);
    return { payload, key, seed: seed >>> 0 };
  }, [
    view?.phase,
    view?.turn,
    view?.self,
    view?.drawSource,
    view?.drawn,
    view?.hand,
    view?.discard,
    view?.active,
    view?.events,
    view?.openingDiscard,
    view?.stockCount,
    view?.lives,
    view?.rules,
    view?.knocker,
    showReads,
  ]);
  const key = advice?.key;
  useEffect(() => {
    if (!advice) return;
    const { payload, seed } = advice;
    const id = ++serial.current;
    let keep = true;
    let engine,
      timer,
      resolved = false;
    const receive = (result) => {
      if (!keep || resolved || serial.current !== id) return;
      resolved = true;
      clearTimeout(timer);
      setReply({ key, objective, result });
    };
    const fallback = () => {
      if (!keep || resolved) return;
      try {
        receive(analyzePosition(payload, { samples: 650, seed, objective }));
      } catch {
        receive({ unavailable: true, objective });
      }
    };
    // Each decision owns a cancellable worker. A discarded hand or changed objective
    // cannot leave a stale instance serving a later turn, including after hot reload.
    try {
      engine = new Worker("/game/analyze-worker.mjs", { type: "module" });
      engine.onmessage = ({ data: answer }) => {
        if (answer.id === id)
          answer.error ? fallback() : receive(answer.result);
      };
      engine.onerror = fallback;
      engine.postMessage({ id, view: payload, seed, objective });
      timer = setTimeout(fallback, 2500);
    } catch {
      timer = setTimeout(fallback, 5);
    }
    return () => {
      keep = false;
      clearTimeout(timer);
      engine?.terminate();
    };
  }, [advice?.key, objective]);
  return advice && reply?.key === key && reply.objective === objective
    ? reply.result
    : null;
}
