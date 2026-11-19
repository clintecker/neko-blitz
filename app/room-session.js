import { useCallback, useEffect, useRef } from "react";
import { defaults } from "../public/game/table.mjs";
import { fetchRoom as requestRoom } from "./room-api";
import {
  HOME,
  RULES,
  SESSION,
  SOLO,
  read,
  save,
  savedSolo,
  sessionKey,
} from "./table-store";

// The room half of the table: seat session, boot restore, polling, and the
// operations that join or leave a seat. The refs it shares with the solo half
// are supplied by the owner so neither half recreates them.
export function useRoomSession({
  code,
  refs,
  publish,
  setBusy,
  setError,
  setInvite,
  setEntryRoute,
  displaySolo,
}) {
  const { solo, session, live, generation } = refs;
  // Serializes room operations against each other and against polling.
  const lock = useRef(false);
  // Every room call defaults to the seat the session ref holds.
  const fetchRoom = useCallback(
    (op, fields, userSession = session.current, signal) =>
      requestRoom(op, fields, userSession, signal),
    [],
  );
  const returnToLobby = useCallback(() => {
    generation.current++;
    const previous = session.current;
    const rules = live.current?.rules || solo.current?.rules || defaults;
    session.current = null;
    solo.current = null;
    save(localStorage, RULES, rules);
    save(localStorage, HOME, true);
    save(localStorage, SOLO, null);
    save(sessionStorage, SESSION, null);
    if (previous?.code) save(sessionStorage, sessionKey(previous.code), null);
    setInvite("");
    setError("");
    const url = new URL(location.href);
    url.searchParams.delete("room");
    history.replaceState(null, "", url);
    displaySolo();
  }, [displaySolo]);
  const applyRoom = useCallback(
    (d) => {
      if (!session.current || d.code !== session.current.code) return;
      if (d.ended) {
        returnToLobby();
        return;
      }
      if (live.current?.code === d.code && live.current.revision > d.revision)
        return;
      // The bearer token proves this seat; it must never enter React state or the UI
      // and stays only in the session ref, so drop it before publishing.
      const { token: unused, ...publicState } = d;
      publish(publicState);
    },
    [publish, returnToLobby],
  );
  useEffect(() => {
    const saved = read(localStorage, SOLO);
    if (read(localStorage, HOME)) solo.current = null;
    else solo.current = savedSolo(saved);
    displaySolo();
    const inviteCode =
      new URL(location.href).searchParams.get("room")?.trim().toUpperCase() ||
      "";
    const previous =
      (inviteCode ? read(sessionStorage, sessionKey(inviteCode)) : null) ||
      read(sessionStorage, SESSION);
    if (inviteCode && inviteCode !== previous?.code) {
      setEntryRoute("room");
      setInvite(inviteCode);
      return;
    }
    if (previous?.code && previous?.token) {
      session.current = previous;
      const key = generation.current;
      let current = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6500);
      fetchRoom("state", {}, previous, controller.signal)
        .then((d) => {
          if (current && generation.current === key) applyRoom(d);
        })
        .catch((e) => {
          if (!current || generation.current !== key) return;
          session.current = null;
          if (e.status === 401 || e.status === 404) {
            // The room is gone or the token is void; drop both so no dead token is retried.
            save(sessionStorage, SESSION, null);
            save(sessionStorage, sessionKey(previous.code), null);
          }
          setError(
            e.name === "AbortError"
              ? "The room is taking too long to answer. Your solo hand is ready."
              : e.message,
          );
        })
        .finally(() => {
          clearTimeout(timeout);
          if (current) setEntryRoute("room");
        });
      return () => {
        current = false;
        clearTimeout(timeout);
        controller.abort();
      };
    } else {
      setEntryRoute("solo");
    }
  }, [displaySolo, fetchRoom, applyRoom]);
  useEffect(() => {
    if (!code) return;
    let canceled = false,
      timer,
      failCount = 0;
    const poll = async () => {
      if (!lock.current) {
        try {
          const d = await fetchRoom("state");
          if (!canceled) {
            applyRoom(d);
            if (failCount) setError("");
            failCount = 0;
          }
        } catch (e) {
          if (!canceled && ++failCount >= 2) setError(e.message);
        }
      }
      if (!canceled) timer = setTimeout(poll, document.hidden ? 2200 : 650);
    };
    timer = setTimeout(poll, 850);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [code, fetchRoom, applyRoom]);
  const run = useCallback(
    async (fn) => {
      if (lock.current) return false;
      lock.current = true;
      setBusy(true);
      setError("");
      try {
        await fn();
        return true;
      } catch (e) {
        setError(e.message || "The move could not be saved.");
        return false;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [setBusy, setError],
  );
  const enter = (op, fields) =>
    run(async () => {
      let remembered =
        op === "join" ? read(sessionStorage, sessionKey(fields.code)) : null;
      let d;
      try {
        d = remembered
          ? await fetchRoom("state", {}, remembered)
          : await fetchRoom(op, fields, null);
      } catch (e) {
        if (!remembered || (e.status !== 401 && e.status !== 404)) throw e;
        // The remembered token outlived its room: forget it and join once as a fresh seat.
        save(sessionStorage, sessionKey(fields.code), null);
        // Only drop the live session key when it is this same room, not a room the player is seated in elsewhere.
        if (read(sessionStorage, SESSION)?.code === fields.code)
          save(sessionStorage, SESSION, null);
        remembered = null;
        d = await fetchRoom(op, fields, null);
      }
      generation.current++;
      session.current = remembered || { token: d.token, code: d.code };
      save(localStorage, HOME, false);
      save(sessionStorage, SESSION, session.current);
      save(sessionStorage, sessionKey(d.code), session.current);
      applyRoom(d);
      setInvite("");
      const url = new URL(location.href);
      url.searchParams.set("room", d.code);
      history.replaceState(null, "", url);
    });
  const endGame = () =>
    run(async () => {
      if (session.current) {
        const op = live.current?.host ? "end" : "leave";
        let revision = live.current?.revision;
        // A bot turn or another player's move can race the final request.
        for (let attempt = 0; attempt < 3; attempt++) {
          const result = await fetchRoom(op, { revision });
          if (!result.stale || result.ended) break;
          if (attempt === 2) throw new Error("The table is busy. Try leaving again.");
          revision = result.revision;
        }
      }
      returnToLobby();
    });
  return { run, fetchRoom, applyRoom, enter, endGame };
}
