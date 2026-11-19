"use client";
import { Eye, ChevronRight } from "lucide-react";
import {
  cardText,
  handValue,
  suits,
  suitNames,
} from "../public/game/table.mjs";
import { Modal, Sprite, seatName, percent } from "./pieces";

import { observed, nextAfterSelf } from "../public/game/reads.mjs";

export function ReadChip({ v, advice, open }) {
  if (!v || v.phase === "end") return null;
  const next = nextAfterSelf(v),
    f = observed(v).get(next),
    cards = f ? [...f.known] : [],
    estimate = advice?.reads?.find((r) => r.seat === next);
  const detail = cards.length
    ? `${seatName(v, next)} holds ${cards.map(cardText).join(", ")}.`
    : estimate && v.events.length > 0 && estimate.primaryChance >= 0.52
      ? `${seatName(v, next)} may be collecting ${suitNames[estimate.primarySuit]}.`
      : "Track public pickups and likely suits.";
  return (
    <button className="read-chip" onClick={open}>
      <span className="heading-icon">
        <Eye size={17} />
      </span>
      <span>
        <strong>Opponent reads</strong>
        <small>{detail}</small>
      </span>
      <ChevronRight size={15} />
    </button>
  );
}
export function Reads({ v, advice, close }) {
  if (!v) return null;
  const facts = observed(v),
    next = nextAfterSelf(v);
  return (
    <Modal title="Opponent reads" onClose={close} wide>
      <p>
        A face-up pickup stays known until its owner discards it. Suit estimates
        combine that evidence with the cards still possible and the opponents’
        decisions.
      </p>
      <div className="read-list">
        {[...facts.entries()].map(([id, f]) => {
          const est = advice?.reads?.find((r) => r.seat === id),
            cards = [...f.known];
          return (
            <section key={id} className="read-seat">
              <div className="read-seat-title">
                <Sprite id={id} />
                <h3>{seatName(v, id)}</h3>
                {id === next && <small>After you</small>}
              </div>
              <p>
                <b>Known in hand</b>{" "}
                {cards.length
                  ? cards.map(cardText).join(" · ")
                  : "No revealed cards."}
                {cards.length > 0 &&
                  ` · At least ${handValue(cards, v.rules).score} points.`}
              </p>
              <div className="evidence-grid">
                {suits.map((s, i) => (
                  <div key={s} title={suitNames[i]}>
                    <b className={i % 2 ? "pink-text" : ""}>{s}</b>
                    <span>{f.picks[i]} taken</span>
                    <span>{f.drops[i]} thrown</span>
                    <span>{f.passes[i]} passed</span>
                  </div>
                ))}
              </div>
              {est?.suitChances && (
                <div className="suit-read">
                  <span>Estimated strongest suit</span>
                  <div>
                    {suits.map((s, i) => (
                      <b
                        key={s}
                        className={est.primarySuit === i ? "likely" : ""}
                      >
                        {s} {percent(est.suitChances[i])}
                      </b>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <p className="method-note">
        “Passed” means they chose stock while that suit was face up. Their
        hidden stock card stays unknown. Repeated face-up picks and discards can
        strengthen a read. During an opponent’s draw, suit estimates describe
        their last three-card hand. Equal-strength suits split the model’s
        probability.
      </p>
    </Modal>
  );
}
export function DiscardRows({ a, v, objective }) {
  const metric = {
    match: "matchWinChance",
    safe: "safeChance",
    round: "value",
  }[objective];
  const next =
    a.nextSeat != null && a.candidates.some((c) => c.nextTurnChance > 0)
      ? seatName(v, a.nextSeat)
      : null;
  const candidates = [...a.candidates].sort((x, y) => y[metric] - x[metric]);
  return (
    <>
      <div className="data-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Throw</th>
              <th>Keep score</th>
              <th>Win match</th>
              <th>Keep token</th>
              <th>Next takes</th>
              <th>Helps next</th>
              <th>Gives 31</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr
                key={c.card}
                className={c.card === a.discardCard ? "best" : ""}
              >
                <th>{cardText(c.card)}</th>
                <td>{c.keptScore}</td>
                <td>{(c.matchWinChance * 100).toFixed(1)}%</td>
                <td>{percent(c.safeChance)}</td>
                <td>
                  {c.nextTurnChance > 0 ? percent(c.nextTakeChance) : "—"}
                </td>
                <td>
                  {c.nextTurnChance > 0 ? percent(c.nextImproveChance) : "—"}
                </td>
                <td>
                  {c.nextTurnChance > 0 ? percent(c.nextBlitzChance) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="method-note">
        {next
          ? `The next seat is ${next}. “Next takes” is the estimated chance they take that specific discard. “Helps next” counts a higher score from taking it. “Gives 31” counts an immediate blitz made with it.`
          : "The round ends on your throw. Nobody gets to take it."}
      </p>
    </>
  );
}
export function throwReason(v, a, card) {
  const pick = a?.candidates?.find((c) => c.card === card);
  if (!pick) return null;
  if (pick.keptScore === 31)
    return "The three cards you keep make 31 immediately.";
  if (pick.nextTurnChance === 0 || a.nextSeat == null)
    return `You keep ${pick.keptScore}. Nobody gets another draw after this throw.`;
  const next = seatName(v, a.nextSeat);
  const alternatives = a.candidates
    .filter((c) => c.card !== card && c.keptScore === pick.keptScore)
    .sort((x, y) => y.nextImproveChance - x.nextImproveChance);
  const worse = alternatives[0];
  if (worse && worse.nextBlitzChance - pick.nextBlitzChance > 0.15)
    return `Both throws keep ${pick.keptScore}. ${cardText(worse.card)} would give ${next} an estimated ${percent(worse.nextBlitzChance)} chance of a blitz on the next turn.`;
  if (worse && worse.nextImproveChance - pick.nextImproveChance > 0.08)
    return `Both throws keep ${pick.keptScore}. ${next} improves by taking ${cardText(card)} in ${percent(pick.nextImproveChance)} of deals, versus ${percent(worse.nextImproveChance)} for ${cardText(worse.card)}.`;
  return `You keep ${pick.keptScore} points. ${next} takes ${cardText(card)} in an estimated ${percent(pick.nextTakeChance)} of deals.`;
}
