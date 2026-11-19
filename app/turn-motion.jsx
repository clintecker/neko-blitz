"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Hand, Layers, SquareStack, Zap } from "lucide-react";
import { Back, Card, seatName } from "./pieces";
import { moveKinds, moveCopy } from "./moves.js";
import { cardText } from "../public/game/table.mjs";

const FLIGHT = 610,
  HOLD = 310;
const supported = new Set(moveKinds);
const moveIcons = { stock: Layers, take: Hand, throw: SquareStack, knock: Zap };

// A room poll may include both halves of somebody's turn. Queue public log entries
// so both seats see source → hand, then hand → discard, in the same order.
export function useTurnMotion(view, room) {
  const runner = useRef({
    timers: [],
    queue: [],
    current: null,
    key: null,
    cursor: 0,
  });
  const [frame, setFrame] = useState({
    cue: null,
    active: false,
    landed: false,
  });
  useLayoutEffect(() => {
    const m = runner.current;
    if (!view) return;
    const key = [
      room || "solo",
      view.matchId || "old",
      view.round,
      view.openingDiscard,
      view.self,
    ].join("/");
    if (m.key !== key || view.log.length < m.cursor) {
      m.timers.forEach(clearTimeout);
      m.timers = [];
      m.queue = [];
      m.current = null;
      m.key = key;
      m.cursor = view.log.length;
      m.pile = view.discard.slice();
      m.stock = view.stockCount;
      m.live = view.phase === "end" ? null : view;
      setFrame({ cue: null, active: false, landed: false });
      return;
    }
    const scene = view.phase === "end" ? m.live || view : view;
    if (view.phase !== "end") m.live = view;
    for (let i = m.cursor; i < view.log.length; i++) {
      const e = view.log[i];
      if (!supported.has(e.kind)) continue;
      const before = m.pile.at(-1);
      if (e.kind === "stock") m.stock--;
      if (e.kind === "take") m.pile.pop();
      if (e.kind === "throw") m.pile.push(e.card);
      m.queue.push({
        ...e,
        key: `${key}:${i}`,
        before,
        after: m.pile.at(-1),
        stock: m.stock,
        scene,
      });
    }
    m.cursor = view.log.length;
    // Resume a background tab on the recent turn rather than replaying a whole match.
    if (m.queue.length > 8) m.queue = m.queue.slice(-4);
    const tick = () => {
      if (m.current || m.key !== key || !m.queue.length) return;
      const cue = m.queue.shift();
      m.current = cue;
      setFrame({ cue, active: true, landed: false });
      const finish = () => {
        if (m.current !== cue) return;
        m.current = null;
        m.timers = [];
        if (m.queue.length) tick();
        else setFrame({ cue, active: false, landed: true });
      };
      m.timers = [
        setTimeout(() => {
          if (m.current === cue) setFrame({ cue, active: true, landed: true });
        }, FLIGHT),
        setTimeout(finish, FLIGHT + HOLD),
      ];
    };
    tick();
  }, [view, room]);
  useEffect(
    () => () => {
      const m = runner.current;
      m.timers.forEach(clearTimeout);
      m.key = null;
      m.current = null;
    },
    [],
  );
  return frame;
}

export function MoveCaption({ v, frame }) {
  const cue = frame.cue,
    actor = cue ? seatName(v, cue.seat) : "",
    self = cue?.seat === v.self,
    copy = cue && moveCopy[cue.kind],
    message = copy ? copy.text(actor, self, cue.card) : "Opening discard",
    detail = copy ? copy.detail : cardText(v.openingDiscard),
    Icon = moveIcons[cue?.kind] || SquareStack;
  return (
    <div
      className="motion-line"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        key={cue?.key || "opening"}
        className={`motion-caption ${cue?.kind || "opening"} ${frame.active ? "current" : ""}`}
      >
        <Icon size={13} />
        <b>{message}</b>
        <i /> <span>{detail}</span>
      </span>
    </div>
  );
}

export function CardFlight({ field, frame, origin, v }) {
  const fly = useRef(null),
    trail = useRef(null);
  const cue = frame.cue;
  useLayoutEffect(() => {
    if (!cue || !frame.active || frame.landed || cue.kind === "knock") return;
    const board = field.current,
      card = fly.current,
      line = trail.current;
    if (!board || !card || !line) return;
    const bounds = board.getBoundingClientRect(),
      loc = (id) => board.querySelector(`[data-loc="${id}"]`);
    const center = (el) => {
      const r = el?.getBoundingClientRect();
      return r
        ? {
            x: r.left + r.width / 2 - bounds.left,
            y: r.top + r.height / 2 - bounds.top,
          }
        : null;
    };
    const self = cue.seat === v.self,
      seat = loc(`seat-${cue.seat}`),
      fromHand = cue.kind === "throw";
    const pile = loc(cue.kind === "stock" ? "stock" : "discard");
    const newCard =
      self && !fromHand && v.drawn != null
        ? board.querySelector(`[data-card="${v.drawn}"]`)
        : null;
    const ownOrigin =
      fromHand && self && origin.current?.card === cue.card
        ? origin.current.point
        : null;
    const a = fromHand ? ownOrigin || center(seat) : center(pile),
      b = fromHand ? center(pile) : center(newCard || seat);
    if (!a || !b) return;
    // Match the real pile at one end and the actual hand card at the other,
    // including when four cards share a narrow row after a draw.
    const w = pile.offsetWidth,
      h = pile.offsetHeight;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dist = Math.hypot(dx, dy);
    const handScale = self
      ? (newCard?.offsetWidth || (ownOrigin && origin.current.width) || w) / w
      : 0.64;
    const scaleA = fromHand ? handScale : 1,
      scaleB = fromHand ? 1 : handScale;
    const transform = (x, y, rot, scale) =>
      `translate3d(${x - w / 2}px,${y - h / 2}px,0) rotate(${rot}deg) scale(${scale})`;
    card.style.width = `${w}px`;
    card.style.height = `${h}px`;
    line.style.width = `${dist}px`;
    line.style.transform = `translate(${a.x}px,${a.y}px) rotate(${Math.atan2(dy, dx)}rad)`;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const targetHighlights = [pile, seat]
      .filter(Boolean)
      .map((el) =>
        el.animate(
          [{ filter: "brightness(1.32)" }, { filter: "brightness(1)" }],
          { duration: FLIGHT + 90 },
        ),
      );
    if (reduced) {
      card.style.opacity = "0";
      line.style.opacity = "0";
      return () => targetHighlights.forEach((a) => a.cancel());
    }
    const midX = (a.x + b.x) / 2 + (Math.abs(dx) < 30 ? 19 : 0),
      midY = (a.y + b.y) / 2 - Math.min(49, dist * 0.18);
    const motion = card.animate(
      [
        {
          transform: transform(a.x, a.y, fromHand ? -7 : 0, scaleA),
          opacity: 1,
        },
        {
          transform: transform(
            midX, midY, dx < 0 ? -10 : 10, Math.max(scaleA, scaleB) * 1.07,
          ),
          opacity: 1,
          offset: 0.48,
        },
        {
          transform: transform(b.x, b.y, fromHand ? 0 : 4, scaleB),
          opacity: 1,
        },
      ],
      { duration: FLIGHT, fill: "both", easing: "cubic-bezier(.31,.04,.25,1)" },
    );
    const ray = line.animate(
      [{ opacity: 0.1 }, { opacity: 0.78, offset: 0.45 }, { opacity: 0.08 }],
      { duration: FLIGHT, fill: "both" },
    );
    return () => {
      motion.cancel();
      ray.cancel();
      targetHighlights.forEach((a) => a.cancel());
    };
  }, [cue?.key, frame.active, frame.landed, field, origin, v.self, v.drawn]);
  if (!cue || !frame.active || frame.landed || cue.kind === "knock")
    return null;
  return (
    <div aria-hidden="true" className={`motion-overlay ${cue.kind}`}>
      <span ref={trail} className="motion-trail" />
      <span ref={fly} className="flying-card">
        {cue.kind === "stock" ? <Back /> : <Card id={cue.card} />}
      </span>
    </div>
  );
}
