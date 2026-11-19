"use client";
import { useCallback, useRef, useState } from "react";
import {
  newTable,
  defaults,
  act,
  deal,
  projectTable,
} from "../public/game/table.mjs";
import { SOLO, RULES, SESSION, HOME, read, save } from "./table-store";
import { useRoomSession } from "./room-session";
import { useSoloOpponent } from "./solo-opponent";

export { useAdvice } from "./use-advice";

export function useTable(paused = false) {
  // Shared explicitly with the split hooks: the solo table, the room seat, the
  // live snapshot, and the guard against a stale restore reviving a session.
  const solo = useRef(null),
    session = useRef(null),
    live = useRef(null),
    generation = useRef(0);
  const refs = { solo, session, live, generation };
  const [packet, setPacket] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [invite, setInvite] = useState("");
  const [entryRoute, setEntryRoute] = useState(null);
  const publish = useCallback((p) => {
    live.current = p;
    setPacket(p);
  }, []);
  const displaySolo = useCallback(() => {
    save(localStorage, SOLO, solo.current);
    publish({
      view: solo.current ? projectTable(solo.current, 0) : null,
      rules: solo.current?.rules || read(localStorage, RULES) || defaults,
      seat: 0,
      host: true,
      code: null,
      members: [],
    });
  }, [publish]);
  const { run, fetchRoom, applyRoom, enter, endGame } = useRoomSession({
    code: packet?.code,
    refs,
    publish,
    setBusy,
    setError,
    setInvite,
    setEntryRoute,
    displaySolo,
  });
  useSoloOpponent({ packet, paused, refs, displaySolo });
  const operate = (op, fields = {}) =>
    run(async () => {
      if (session.current) {
        const update = await fetchRoom(op, {
          ...fields,
          revision: live.current?.revision,
        });
        applyRoom(update);
        if (update.stale)
          setError(
            "The table changed before that move arrived. Check your hand and try again.",
          );
        return;
      }
      if (op === "move") act(solo.current, 0, fields.action, fields.card);
      else if (op === "next") deal(solo.current);
      else if (op === "rematch") solo.current = newTable(solo.current.rules);
      displaySolo();
    });
  function goSolo(rules) {
    generation.current++;
    session.current = null;
    save(sessionStorage, SESSION, null);
    setInvite("");
    const u = new URL(location.href);
    u.searchParams.delete("room");
    history.replaceState(null, "", u);
    save(localStorage, HOME, false);
    if (rules) solo.current = newTable(rules);
    else if (!solo.current) solo.current = newTable(defaults);
    setError("");
    displaySolo();
  }
  return {
    endGame,
    packet,
    entryRoute,
    busy,
    error,
    setError,
    operate,
    enter,
    goSolo,
    invite,
    setInvite,
  };
}
