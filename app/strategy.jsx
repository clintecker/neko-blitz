"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Modal } from "./pieces";
import study from "./study-data.json";

// Flipping only the public pickups reverses the defensive choice with the same four cards.
function DiscardExercise() {
  const [suit, setSuit] = useState("♥");
  const [choice, setChoice] = useState(null);
  return (
    <section className="read-exercise">
      <h3>Which king would you give Pip?</h3>
      <p>
        You hold <b>10♠ Q♠ K♦ K♥</b>. Throwing either king keeps 20. Pip
        acts next and has kept both of these public pickups.
      </p>
      <div className="segmented" role="group" aria-label="Pip’s known cards">
        {["♥", "♦"].map((s) => (
          <button
            key={s}
            className={suit === s ? "selected" : ""}
            aria-pressed={suit === s}
            onClick={() => {
              setSuit(s);
              setChoice(null);
            }}
          >
            A{s} + Q{s}
          </button>
        ))}
      </div>
      <div
        className="read-throws"
        role="group"
        aria-label="Choose a king to discard"
      >
        {["♥", "♦"].map((s) => (
          <button
            key={s}
            className="action outline"
            aria-pressed={choice === s}
            onClick={() => setChoice(s)}
          >
            Throw K{s}
          </button>
        ))}
      </div>
      <p className="read-result" aria-live="polite">
        {choice == null
          ? "Choose a discard to see what Pip can do."
          : choice === suit
            ? `Pip can take K${choice} for 31. You keep 20 and immediately pay one token.`
            : `You keep 20 and cover the pile with K${choice}. Pip can still try the stock, but this king gives them no blitz.`}
      </p>
    </section>
  );
}

export default function Strategy({ rules, close }) {
  const [size, setSize] = useState(rules.players),
    low = rules.payout === "lowest";
  const rows = study[rules.payout].filter((r) => r.n === size);
  return (
    <Modal title="When should you knock?" onClose={close} wide>
      <p className="intro-text">
        {low
          ? "An opening knock can be powerful. Your rivals get one last draw apiece, and you only need one of them to finish below you. If you knock on 22 against final scores of 26, 20 and 17, only the 17 pays."
          : "Your table protects only the highest hand. An opening knock freezes your score while every rival gets one last draw. A strong score, a poor visible discard and few ways to improve all favor knocking."}
      </p>
      {low && (
        <div className="guide-callout">
          <Sparkles size={21} />
          <div>
            <b>Two 21s can call for opposite moves.</b>
            <p>
              With 2♣ up, knock on 10♠ 8♠ 3♠. With A♠ K♠ 8♥, knocking
              keeps your token about 98.8% of the time, but the stock gives you
              a better chance to win the match. Three spades can turn that hand
              into a blitz.
            </p>
          </div>
        </div>
      )}
      <DiscardExercise />
      <h3>Opening knock guide</h3>
      <div
        className="segmented table-size"
        aria-label="Guide table size"
        role="group"
      >
        {[2, 3, 4].map((n) => (
          <button
            key={n}
            aria-pressed={size === n}
            className={size === n ? "selected" : ""}
            onClick={() => setSize(n)}
          >
            {n} players
          </button>
        ))}
      </div>
      <div className="data-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Score</th>
              <th>Keep token if you knock</th>
              <th>Hands that favor knocking</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.score}>
                <th>{r.score}</th>
                <td>{((1 - r.risk) * 100).toFixed(1)}%</td>
                <td>{r.knocks} / 32</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="method-note">
        Four tokens per seat,{" "}
        {low
          ? "lowest hand pays, knocker safe on a low tie"
          : "everyone below the highest pays"}
        . Each row samples 32 opening hands whose visible discard cannot raise
        the current score. Each decision compares 600 possible deals. The last
        column maximizes match wins.
      </p>
      <h3>Four-seat opening hands</h3>
      <div className="data-scroll">
        <table className="data guide-table">
          <thead>
            <tr>
              <th>Hand</th>
              <th>Upcard</th>
              <th>Win if knock</th>
              <th>Win if stock</th>
              <th>Best move</th>
            </tr>
          </thead>
          <tbody>
            {(low
              ? [
                  ["10♠ 6♠ 3♠", "2♣", "29.1%", "27.5%", "Knock"],
                  ["10♠ 8♠ 3♠", "2♣", "29.5%", "28.8%", "Knock"],
                  ["A♠ K♠ 8♥", "2♣", "29.6%", "31.5%", "Draw stock"],
                ]
              : [
                  ["A♠ K♠ 8♥", "A♣", "34.2%", "35.8%", "Draw stock"],
                  ["10♠ 8♠ 3♠", "A♣", "33.3%", "28.8%", "Knock"],
                  ["A♠ K♠ 8♥", "2♣", "36.1%", "34.9%", "Knock"],
                ]
            ).map(([h, u, k, s, b]) => (
              <tr key={h + u}>
                <th>{h}</th>
                <td>{u}</td>
                <td>{k}</td>
                <td>{s}</td>
                <td className="mint-text">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="method-note">
        40,000 matched simulated deals per opening, with four tokens apiece. The
        percentages estimate eventual match wins against the arcade opponents.
      </p>
      <h3>Read the next player</h3>
      <ul className="rule-details">
        <li>
          <b>Keep a ledger of public cards.</b> If Pip takes Q♥, he holds it
          until you see him discard it. Picking up a heart suggests a suit
          preference. Passing a heart is weaker evidence because another suit or
          a stock draw may be more valuable.
        </li>
        <li>
          <b>Look at what knocking leaves behind.</b> You have 10♥ 9♥ A♠ and
          J♥ is up. If Pip still holds A♥ Q♥, knocking lets him take J♥ for
          31. Take J♥ yourself and discard A♠ for 29. Drawing stock also lets
          you cover J♥ with your throw. If yours is the last turn after a
          knock, nobody gets your discard.
        </li>
        <li>
          <b>Check your own outs.</b> Holding A♠ K♠ 8♥ with J♠ up gives you
          a guaranteed 31. Take J♠ and discard 8♥. Every rival pays one token.
        </li>
      </ul>
      <p className="method-note">
        The live coach compares moves under three goals. Win match estimates the
        last player standing. Keep my token minimizes your chance of paying this
        round. Token edge measures average opponent losses minus yours. It uses
        public play and modeled opponent choices. A hidden suit read is an
        estimate.
      </p>
      <p className="method-note">
        <a href="/strategy-study.zip" download>
          Download the sampled positions, results and runnable study
        </a>{" "}
        (ZIP).
      </p>
    </Modal>
  );
}
