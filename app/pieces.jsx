"use client";
import { createContext, useContext, useEffect, useRef } from "react";
import { ChevronLeft, X, Trophy, Zap } from "lucide-react";
import {
  suits,
  suitNames,
  ranks,
  fullCard,
  handValue,
  cardText,
} from "../public/game/table.mjs";

export const sprites = ["card-cat.png", "mochi.webp", "pip.webp", "hex.webp"];
export const seatName = (v, id) =>
  id === v.self ? "You" : v.seats[id]?.name || "Player";
export const fmtScore = (n) => (n === 30.5 ? "30½" : String(n));
export const percent = (n) =>
  n > 0 && n < 0.005
    ? "<1%"
    : n < 1 && n > 0.995
      ? ">99%"
      : `${Math.round(n * 100)}%`;
export const moveLabels = {
  stock: "Draw stock",
  discard: "Take discard",
  knock: "Knock now",
};
export function Hearts({ n, total = 3 }) {
  return (
    <span className="hearts" aria-label={`${n} lives remaining`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} aria-hidden="true" className={i < n ? "full" : ""} />
      ))}
    </span>
  );
}
export function Sprite({ id, className = "", alt = "" }) {
  return (
    <img
      className={`sprite ${className}`}
      src={`/art/${sprites[id % 4]}`}
      alt={alt}
      draggable="false"
    />
  );
}
export function Back() {
  return <span className="card-back" aria-hidden="true" />;
}

// Coordinates describe only the central pip field. The two index gutters
// belong to the rank and its suit, including the double-width ten.
const positions = {
  1: [[50, 50]],
  2: [
    [50, 28],
    [50, 72],
  ],
  3: [
    [50, 25],
    [50, 50],
    [50, 75],
  ],
  4: [
    [12, 28],
    [88, 28],
    [12, 72],
    [88, 72],
  ],
  5: [
    [12, 25],
    [88, 25],
    [50, 50],
    [12, 75],
    [88, 75],
  ],
  6: [
    [12, 24],
    [88, 24],
    [12, 50],
    [88, 50],
    [12, 76],
    [88, 76],
  ],
  7: [
    [12, 23],
    [88, 23],
    [50, 36],
    [12, 50],
    [88, 50],
    [12, 77],
    [88, 77],
  ],
  8: [
    [12, 23],
    [88, 23],
    [50, 36],
    [12, 50],
    [88, 50],
    [50, 64],
    [12, 77],
    [88, 77],
  ],
  9: [
    [12, 20],
    [88, 20],
    [12, 40],
    [88, 40],
    [50, 50],
    [12, 60],
    [88, 60],
    [12, 80],
    [88, 80],
  ],
  10: [
    [12, 18],
    [88, 18],
    [50, 29],
    [12, 39],
    [88, 39],
    [12, 61],
    [88, 61],
    [50, 71],
    [12, 82],
    [88, 82],
  ],
};
export function Card({ id, mini = false }) {
  if (!Number.isInteger(id)) return <span className="card-face empty">–</span>;
  const suit = Math.floor(id / 13),
    rank = id % 13,
    label = ranks[rank],
    glyph = suits[suit] + "\uFE0E";
  return (
    <span
      role="img"
      aria-label={fullCard(id)}
      data-rank={label}
      className={`card-face ${suit % 2 ? "red" : "black"} ${mini ? "mini" : ""}`}
    >
      <span className="card-frame" />
      <span className="card-index tl" aria-hidden="true">
        <b>{label}</b>
        <i>{glyph}</i>
      </span>
      <span className="card-index br" aria-hidden="true">
        <b>{label}</b>
        <i>{glyph}</i>
      </span>
      {rank < 10 ? (
        <span
          className={`pip-area ${rank === 0 ? "ace" : ""}`}
          aria-hidden="true"
        >
          {positions[rank + 1].map(([x, y], i) => (
            <i
              key={i}
              className={y > 50 ? "invert" : ""}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              {glyph}
            </i>
          ))}
        </span>
      ) : (
        <span aria-hidden="true" className="court">
          <span className="court-diamond" />
          <Sprite id={{ 10: 3, 11: 1, 12: 2 }[rank]} />
          <i>{glyph}</i>
        </span>
      )}
    </span>
  );
}
export function Seat({ view, p }) {
  const active = view.phase !== "end" && view.turn === p.id,
    dead = !view.active.includes(p.id);
  return (
    <div
      className={`seat seat-${p.id} ${active ? "acting" : ""} ${dead ? "out" : ""}`}
    >
      <span className="avatar" data-loc={`seat-${p.id}`}>
        <Sprite id={p.id} />
      </span>
      <span className="seat-info">
        <b>{seatName(view, p.id)}</b>
        <Hearts
          n={p.lives}
          total={view.rules.lives + Number(view.rules.freeRide)}
        />
        {dead ? (
          <span className="seat-mark">Out</span>
        ) : view.phase === "end" ? (
          <span className="seat-mark">
            {fmtScore(view.result.scores[p.id])} pts
          </span>
        ) : view.knocker === p.id ? (
          <span className="seat-mark knocked">Knocked</span>
        ) : (
          <span className="microhand" aria-label={`${p.count} hidden cards`}>
            {Array.from({ length: p.count }, (_, i) => (
              <i key={i} />
            ))}
          </span>
        )}
      </span>
    </div>
  );
}
export function HandScore({ view }) {
  let best = handValue(view.hand, view.rules);
  if (view.hand.length === 4) {
    const choices = view.hand
      .filter((c) => view.drawSource !== "discard" || view.drawn !== c)
      .map((c) =>
        handValue(
          view.hand.filter((x) => x !== c),
          view.rules,
        ),
      );
    best = choices.reduce((a, b) => (a.score >= b.score ? a : b));
  }
  if (!view.hand.length) return null;
  return (
    <span className="score-block">
      <small>{view.hand.length === 4 ? "Best keep" : "Hand score"}</small>
      <strong>
        {fmtScore(best.score)}
        <i className={best.suit % 2 === 1 ? "red-suit" : ""}>
          {best.suit === -1 ? "✦" : suits[best.suit]}
        </i>
      </strong>
      <span className="sr-only">
        {best.suit < 0 ? "three of a kind" : suitNames[best.suit]}
      </span>
    </span>
  );
}
export const SheetBack = createContext(null);

export function Modal({ title, children, onClose, wide = false }) {
  const back = useContext(SheetBack);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current,
      prior = document.activeElement;
    el.showModal();
    return () => {
      el.close();
      prior?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-top">
        {back && (
          <button
            className="icon-btn sheet-back"
            aria-label={`Back to ${back.label}`}
            onClick={back.go}
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-btn"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function logLine(view, e) {
  const who = e.seat == null ? "" : seatName(view, e.seat);
  if (e.kind === "stock") return `${who} drew a face-down stock card.`;
  if (e.kind === "take")
    return `${who} took ${cardText(e.card)} from the discard pile.`;
  if (e.kind === "throw")
    return `${who} discarded ${cardText(e.card)} from hand.`;
  if (e.kind === "deal")
    return `Round ${view.round} dealt. ${cardText(view.openingDiscard)} opens the pile.`;
  if (e.kind === "knock") return `${who} knocked. One last turn each.`;
  if (e.kind === "blitz") return `${who} hit 31!`;
  if (e.kind === "showdown") return "Cards up. The round is over.";
  if (e.kind === "play")
    return `${who} ${e.source === "stock" ? "drew stock" : "took the discard"} and discarded ${cardText(e.card)}.`;
  return `${e.seat === view.self ? "Your" : who + "’s"} turn.`;
}
export function Showdown({ view, onNext, busy, host = true }) {
  const r = view.result,
    complete = r.winner != null;
  const title = complete
    ? r.winner === view.self
      ? "You won the match!"
      : `${seatName(view, r.winner)} won the match!`
    : r.kind === "blitz"
      ? r.blitz.includes(view.self)
        ? "You hit Blitz!"
        : `${r.blitz.map((id) => seatName(view, id)).join(" & ")} hit Blitz!`
      : "Round showdown";
  const line = r.replay
    ? "This tied deal is replayed at the same token counts."
    : r.kind === "blitz"
      ? "A suited 31 ends the round immediately."
      : r.kind === "stock"
        ? "The stock ran out. Compare the final hands."
        : `${seatName(view, view.knocker)} knocked. All final hands are in.`;
  return (
    <div
      className={`showdown outcome-${complete ? "match" : r.kind === "blitz" ? "blitz" : "reveal"}`}
      role="region"
      aria-label="Round result"
    >
      <div className="end-title">
        <span className="outcome-emblem" aria-hidden="true">
          {complete ? (
            <Trophy size={25} />
          ) : r.kind === "blitz" ? (
            "31"
          ) : (
            <Zap size={23} />
          )}
        </span>
        <h2>{title}</h2>
      </div>
      <p>{line}</p>
      <div className="result-list">
        {view.active.map((i, index) => {
          const p = view.seats[i],
            paid = r.paid[i];
          return (
            <div
              className={`result-row ${i === view.self ? "mine" : ""} ${paid ? "paid" : ""}`}
              style={{ "--reveal-order": index }}
              key={i}
            >
              <span className="result-seat">
                <Sprite id={i} />
                <b>{seatName(view, i)}</b>
              </span>
              <span
                className="result-hand"
                aria-label={p.hand.map(fullCard).join(", ")}
              >
                {p.hand.map((c) => (
                  <span
                    className={Math.floor(c / 13) % 2 ? "ink-red" : ""}
                    key={c}
                  >
                    <b>{ranks[c % 13]}</b>
                    <i>{suits[Math.floor(c / 13)]}︎</i>
                  </span>
                ))}
              </span>
              <b className="result-score">{fmtScore(r.scores[i])}</b>
              <span className={paid ? "lost" : "safe"}>
                {p.lives === 0 ? "Out" : paid ? `−${paid} ♥` : "Safe"}
              </span>
            </div>
          );
        })}
      </div>
      <button
        className="action primary"
        disabled={busy || (complete && !host)}
        onClick={onNext}
      >
        {complete
          ? host
            ? "Play again"
            : "Waiting for host"
          : "Deal next round"}
      </button>
    </div>
  );
}
