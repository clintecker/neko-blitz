"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  newTable,
  defaults,
  act,
  deal,
  projectTable,
} from "../public/game/table.mjs";
import { playBotStep } from "../public/game/arcade-bots.mjs";
import { analyzePosition } from "../public/game/analyze-position.mjs";

const SOLO = "neko-blitz.solo.family.v2",
  SESSION = "neko-blitz.room.family.v1",
  HOME = "neko-blitz.lobby",
  RULES = "neko-blitz.last-rules";
function read(storage, key) {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null;
  }
}
function save(storage, key, thing) {
  try {
    if (thing == null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(thing));
  } catch {
    /* A full or private store still allows play. */
  }
}

export function useTable(paused = false) {
  const solo = useRef(null),
    session = useRef(null),
    live = useRef(null),
    lock = useRef(false),
    generation = useRef(0);
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
    if (previous?.code) save(sessionStorage, SESSION + "." + previous.code, null);
    setInvite("");
    setError("");
    const url = new URL(location.href);
    url.searchParams.delete("room");
    history.replaceState(null, "", url);
    displaySolo();
  }, [displaySolo]);
  const fetchRoom = useCallback(
    async (op, fields = {}, userSession = session.current, signal) => {
      const r = await fetch("/api/table", {
        method: "POST",
        cache: "no-store",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(userSession
            ? { Authorization: "Bearer " + userSession.token }
            : {}),
        },
        body: JSON.stringify({ op, code: userSession?.code, ...fields }),
      });
      let d;
      try {
        d = await r.json();
      } catch {
        throw new Error("Could not reach the friends’ table.");
      }
      if (!r.ok && !d.stale) {
        const e = new Error(d.error || "Could not reach the table.");
        e.status = r.status;
        throw e;
      }
      return d;
    },
    [],
  );
  const applyRoom = useCallback(
    (d) => {
      if (!session.current || d.code !== session.current.code) return;
      if (d.ended) {
        returnToLobby();
        return;
      }
      if (live.current?.code === d.code && live.current.revision > d.revision)
        return;
      const { token: unused, ...safe } = d;
      publish(safe);
    },
    [publish, returnToLobby],
  );
  useEffect(() => {
    const saved = read(localStorage, SOLO);
    if (read(localStorage, HOME)) solo.current = null;
    else if (
      saved?.seats?.length >= 2 &&
      saved?.rules &&
      Array.isArray(saved?.stock) &&
      saved?.phase
    )
      solo.current = saved;
    else solo.current = null;
    displaySolo();
    const inviteCode =
      new URL(location.href).searchParams.get("room")?.trim().toUpperCase() ||
      "";
    const previous =
      (inviteCode ? read(sessionStorage, SESSION + "." + inviteCode) : null) ||
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
          if (e.status === 401 || e.status === 404)
            save(sessionStorage, SESSION, null);
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
    const view = packet?.view;
    if (
      paused ||
      !view ||
      packet.code ||
      view.phase === "end" ||
      view.seats[view.turn].human
    )
      return;
    const timer = setTimeout(
      () => {
        if (session.current || !solo.current || live.current?.code) return;
        if (playBotStep(solo.current)) displaySolo();
      },
      view.phase === "throw" ? 1180 : 1080,
    );
    return () => clearTimeout(timer);
  }, [packet, displaySolo, paused]);
  useEffect(() => {
    if (!packet?.code) return;
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
  }, [packet?.code, fetchRoom, applyRoom]);
  const run = useCallback(async (fn) => {
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
  }, []);
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
  const enter = (op, fields) =>
    run(async () => {
      const remembered =
        op === "join"
          ? read(sessionStorage, SESSION + "." + fields.code)
          : null;
      const d = remembered
        ? await fetchRoom("state", {}, remembered)
        : await fetchRoom(op, fields, null);
      generation.current++;
      session.current = remembered || { token: d.token, code: d.code };
      save(localStorage, HOME, false);
      save(sessionStorage, SESSION, session.current);
      save(sessionStorage, SESSION + "." + d.code, session.current);
      applyRoom(d);
      setInvite("");
      const url = new URL(location.href);
      url.searchParams.set("room", d.code);
      history.replaceState(null, "", url);
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
  const endGame = () => run(async () => {
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

export function useAdvice(view, objective, showReads) {
  const [reply, setReply] = useState(null),
    serial = useRef(0);
  // The dependency key intentionally excludes room polling revisions and other seats' private cards.
  const watching = view && view.turn !== view.self;
  // While someone holds four cards, estimates describe the last completed turn.
  // Restore the public piles to the instant before their draw. Known pickups
  // and suit counts still update immediately in the public ledger.
  const pendingDraw = watching && view.phase === "throw";
  const data =
    view &&
    view.phase !== "end" &&
    view.active.includes(view.self) &&
    (!watching || showReads)
      ? JSON.stringify({
          phase: watching ? "watch" : view.phase,
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
            view.stockCount +
            Number(pendingDraw && view.drawSource === "stock"),
          lives: view.lives,
          rules: view.rules,
          knocker: view.knocker,
        })
      : null;
  useEffect(() => {
    if (!data) return;
    const id = ++serial.current;
    let keep = true;
    const publicView = JSON.parse(data);
    let seed = 2166136261;
    for (let i = 0; i < data.length; i++)
      seed = Math.imul(seed ^ data.charCodeAt(i), 16777619);
    let engine,
      timer,
      resolved = false;
    const receive = (result) => {
      if (!keep || resolved || serial.current !== id) return;
      resolved = true;
      clearTimeout(timer);
      setReply({ key: data, objective, result });
    };
    const fallback = () => {
      if (!keep || resolved) return;
      try {
        receive(
          analyzePosition(publicView, {
            samples: 650,
            seed: seed >>> 0,
            objective,
          }),
        );
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
      engine.postMessage({ id, view: publicView, seed: seed >>> 0, objective });
      timer = setTimeout(fallback, 2500);
    } catch {
      timer = setTimeout(fallback, 5);
    }
    return () => {
      keep = false;
      clearTimeout(timer);
      engine?.terminate();
    };
  }, [data, objective]);
  return data && reply?.key === data && reply.objective === objective
    ? reply.result
    : null;
}
