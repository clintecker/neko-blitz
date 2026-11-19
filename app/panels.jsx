"use client";
import { useState } from "react";
import {
  BrainCircuit,
  ChartNoAxesColumnIncreasing,
  ChevronRight,
  Copy,
  Check,
  Radio,
  Users,
} from "lucide-react";
import { defaults, cardText, handValue } from "../public/game/table.mjs";
import { chooseDiscard } from "../public/game/coach.mjs";
import {
  fmtScore,
  percent,
  moveLabels,
  logLine,
  seatName,
  Sprite,
  Modal,
} from "./pieces";

import { DiscardRows, throwReason } from "./reads";

const signed = (v) => (v > 0 ? "+" : "") + v.toFixed(2);
function bestThrow(v, planned) {
  if (
    Number.isInteger(planned) &&
    v.hand.includes(planned) &&
    planned !== v.drawn
  )
    return planned;
  return chooseDiscard(v.hand, v.drawSource === "discard" ? v.drawn : null, {
    rules: v.rules,
    players: v.active.length,
    turns: v.events.filter((e) => e.seat === v.self).length,
    final: v.knocker != null || v.stockCount === 0,
  });
}
export function Coach({ view: v, advice: a, planned, compare }) {
  const playing = v && v.phase !== "end",
    mine = playing && v.turn === v.self,
    throwing = mine && v.phase === "throw";
  const action = mine && !throwing ? a?.action : null;
  let recommendation = "Reading the table…",
    tip =
      v?.knocker != null
        ? "Comparing your two draw options."
        : "Comparing knock, stock and the open pile.";
  if (!v) {
    recommendation = "Waiting for the deal";
    tip = "Your advice appears when the first hand is dealt.";
  } else if (v.phase === "end") {
    recommendation = "Cards on the table";
    tip = "The next deal brings a fresh read on the table.";
  } else if (!mine) {
    recommendation = `${seatName(v, v.turn)} is up`;
    tip = "I’ll compare your options when your turn begins.";
  } else if (throwing) {
    const drop = a?.action === "throw" ? a.discardCard : bestThrow(v, planned);
    recommendation = `Discard ${cardText(drop)}`;
    tip =
      throwReason(v, a, drop) ||
      `Keep the other three for ${fmtScore(
        handValue(
          v.hand.filter((c) => c !== drop),
          v.rules,
        ).score,
      )} points.`;
  } else if (a?.unavailable) {
    recommendation = "No estimate this turn";
    tip = "The strategy guide includes opening examples for your table rules.";
  } else if (action) {
    recommendation = moveLabels[action];
    if (action === "discard")
      tip = a.exact
        ? "The face-up card completes 31. Take it and keep the suited blitz."
        : `Take ${cardText(v.discard.at(-1))} and release ${cardText(a.actions.discard.discardCard)}.`;
    else if (action === "knock")
      tip =
        v.events.length === 0
          ? "Knock on the opening turn. Everyone else gets just one draw to catch up."
          : "Lock in this hand and give each rival one final turn.";
    else
      tip = {
        match:
          "Drawing blind gives you the best estimated chance to win the match.",
        safe: "Drawing blind gives you the best estimated chance to keep this token.",
        round:
          "Drawing blind has the highest estimated token advantage this round.",
      }[a.objective];
  }
  const risk = action ? a.actions?.knock?.ownLossChance : null;
  const knock = a?.actions?.knock;
  if (
    action &&
    action !== "knock" &&
    knock?.nextBlitzChance >= 0.15 &&
    a.nextSeat != null
  )
    tip += ` Knocking leaves ${cardText(v.discard.at(-1))} for ${seatName(v, a.nextSeat)}, with an estimated ${percent(knock.nextBlitzChance)} chance it makes their blitz.`;
  const qualifier =
    a?.confidence === "close"
      ? "Close call"
      : a?.confidence === "limited"
        ? "Low confidence"
        : a?.exact
          ? "Certain"
          : "Suggested move";
  return (
    <section className="side-panel coach">
      <div className="panel-heading">
        <span className="heading-icon mint">
          <BrainCircuit size={18} />
        </span>
        <h2>Knock coach</h2>
      </div>
      <div className="coach-inner">
        <div className="coach-terminal">
          <div className="crt">
            <Sprite id={0} />
          </div>
          <div>
            <span className="micro-label">
              {mine && !throwing
                ? action
                  ? qualifier
                  : "Calculating"
                : throwing
                  ? "Suggested discard"
                  : "Table read"}
            </span>
            <strong>{recommendation}</strong>
          </div>
        </div>
        <p className="coach-tip" aria-live="polite">
          {tip}
        </p>
        {risk != null && (
          <div className="risk">
            <div>
              <span>Life-loss risk if you knock</span>
              <b>{percent(risk)}</b>
            </div>
            <div
              className="risk-track"
              role="meter"
              aria-label="Chance of losing at least one life if you knock"
              aria-valuenow={Math.round(100 * risk)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i style={{ width: `${Math.max(0, risk * 100)}%` }} />
            </div>
          </div>
        )}
        {mine && (
          <button
            className="panel-link"
            disabled={!a || a.unavailable}
            onClick={compare}
          >
            <ChartNoAxesColumnIncreasing size={15} />
            {throwing ? "Compare discards" : "Compare moves"}
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    </section>
  );
}
export function Feed({ view }) {
  const entries = view ? view.log.slice().reverse() : [];
  return (
    <section className="side-panel feed">
      <div className="panel-heading">
        <span className="heading-icon pink">
          <Radio size={18} />
        </span>
        <h2>Table feed</h2>
      </div>
      <div
        className="feed-items"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {!entries.length ? (
          <p>The table is waiting for a deal.</p>
        ) : (
          entries.map((e, i) => (
            <div
              className={`feed-item ${i === 0 ? "latest" : ""}`}
              key={`${view.round}-${entries.length - i}`}
            >
              <span className={`feed-dot dot-${e.seat ?? "deal"}`} />
              <span>{logLine(view, e)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
export function Odds({ v, advice: a, close, objective, setObjective }) {
  const metric = {
    match: "matchWinChance",
    safe: "safeChance",
    round: "value",
  }[objective];
  return (
    <Modal
      title={
        v?.phase === "throw" ? "Compare your discards" : "Compare your moves"
      }
      onClose={close}
      wide
    >
      <div className="segmented" aria-label="Coach objective" role="group">
        {Object.entries({
          match: "Win match",
          safe: "Keep my token",
          round: "Token edge",
        }).map(([id, label]) => (
          <button
            key={id}
            className={objective === id ? "selected" : ""}
            aria-pressed={objective === id}
            onClick={() => setObjective(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <p>
        {
          {
            match:
              "Choose the move with the highest estimated chance to be the last player standing.",
            safe: "Choose the move with the smallest chance of paying a token this round.",
            round:
              "Choose the move with the largest expected token edge this round. Taking one token from every rival earns a +1 edge.",
          }[objective]
        }
      </p>
      {a && !a.unavailable ? (
        <>
          {a.action === "throw" ? (
            <DiscardRows a={a} v={v} objective={objective} />
          ) : (
            <div className="data-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Move</th>
                    <th>Win match</th>
                    <th>Token edge</th>
                    <th>Pay a token</th>
                    <th>Make 31</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(a.actions)
                    .sort((x, y) => y[1][metric] - x[1][metric])
                    .map(([k, v]) => (
                      <tr className={k === a.action ? "best" : ""} key={k}>
                        <th>{moveLabels[k]}</th>
                        <td>{(100 * v.matchWinChance).toFixed(1)}%</td>
                        <td>{signed(v.value)}</td>
                        <td>{percent(v.ownLossChance)}</td>
                        <td>{percent(v.blitzChance)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {a.action !== "throw" &&
            a.actions?.knock?.nextTurnChance > 0 &&
            a.nextSeat != null && (
              <p className="method-note">
                Knocking leaves {cardText(v.discard.at(-1))} for{" "}
                {seatName(v, a.nextSeat)}. Under the model they take it in{" "}
                {percent(a.actions.knock.nextTakeChance)} of deals and improve
                their score with it in{" "}
                {percent(a.actions.knock.nextImproveChance)}.
              </p>
            )}
          <p className="method-note">
            Token edge is the average rival loss minus your loss. The coach
            tries each choice on the same possible deals, using your hand,
            public draws and discards, and the tokens left at every seat. The
            match estimate uses the standard arcade bots for future play. Table
            readers and human opponents can make different choices.
          </p>
          <p className="method-note">
            {a.samples.toLocaleString()} sampled deals ·{" "}
            {(a.effectiveSamples ?? a.samples).toLocaleString()} effective after
            weighting public evidence.{" "}
            {a.exact
              ? a.action === "throw"
                ? "The three cards you keep guarantee 31."
                : "The face-up 31 is guaranteed."
              : a.confidence === "close"
                ? "The leading moves are within sampling uncertainty."
                : a.confidence === "limited"
                  ? "Few sampled deals fit this history well. Treat this estimate cautiously."
                  : `The leading move is ahead by ${objective !== "round" ? (a.margin * 100).toFixed(1) + " percentage points" : a.margin.toFixed(2) + " tokens"}.`}
          </p>
        </>
      ) : (
        <p aria-live="polite">
          {a?.unavailable
            ? "There is no reliable estimate for this turn."
            : "Comparing your moves…"}
        </p>
      )}
    </Modal>
  );
}
export function Instructions({ rules: r, close, practice }) {
  return (
    <Modal title="How to play Blitz" onClose={close}>
      <button className="lesson-link" onClick={practice}>
        <Sprite id={0} />
        <span>Play a practice hand</span>
        <ChevronRight size={18} />
      </button>
      <p>
        Build your best three-card hand.{" "}
        {r.payout === "lowest"
          ? "At showdown, only the lowest score pays. If you beat even one other hand, you keep your token."
          : "At showdown, every player below the highest score pays one token. Tied leaders keep theirs."}{" "}
        The last player with a token wins the match.
      </p>
      <ol className="rule-steps">
        <li>
          <b>Count one suit.</b> Add the cards in your best suit. Aces are 11,
          faces are 10, and number cards use their printed value. A♠ K♠ 8♥
          scores 21.
        </li>
        <li>
          <b>Draw, then discard.</b> Take the top stock card or the face-up
          discard. Choose one of your four cards to throw it away. A card taken
          from the discard pile must stay in your hand for that turn.
        </li>
        <li>
          <b>Knock before drawing.</b> Your hand locks. Each other active player
          gets one last turn. Knocking on your first turn is allowed.
        </li>
        <li>
          <b>Show 31.</b> A suited ace and two ten-value cards end the round
          immediately. Every other player loses one life. A dealt 31 counts,
          too.
        </li>
      </ol>
      <h3>Your table rules</h3>
      <ul className="rule-details">
        <li>{r.lives} starting tokens. Spend your last one and you’re out.</li>
        <li>
          Three of a kind uses normal suit scoring. Three sevens of different
          suits score 7.
        </li>
        <li>
          {r.payout === "lowest"
            ? "You knock with 22. The other hands finish at 26, 20 and 17. Only the 17 pays one token. If you finish alone in last place, your failed knock costs one token."
            : "The knocker pays one token along with everyone else below the highest score."}
        </li>
        <li>
          {r.payout === "lowest"
            ? r.tieSafe
              ? "If the knocker ties someone for the lowest score, the knocker is safe. Everyone else tied for low pays one."
              : "If the knocker ties for lowest, only the knocker pays one token."
            : "Everyone tied for first is safe. For 25, 25, 19 and 14, the 19 and 14 each pay one."}
        </li>
        {r.payout === "lowest" && (
          <li>
            When the knocker is above a tie at the bottom, all players tied for
            low pay one. If an unknocked stock showdown would eliminate everyone
            together, replay the deal with the same tokens.
          </li>
        )}
        <li>When the stock runs out, compare hands after the final discard.</li>
      </ul>
      <p className="method-note">
        Traditional draw-and-knock rules{" "}
        <a
          href="https://www.pagat.com/draw/scat.html"
          target="_blank"
          rel="noreferrer"
        >
          Pagat’s Thirty-One / Scat
        </a>
        .
      </p>
    </Modal>
  );
}
function RuleFields({ r, edit }) {
  return (
    <div className="rule-fields">
      <label>
        Seats
        <select
          value={r.players}
          onChange={(e) => edit("players", +e.target.value)}
        >
          {[2, 3, 4].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <label>
        Starting tokens
        <select
          value={r.lives}
          onChange={(e) => edit("lives", +e.target.value)}
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <label className="rule-wide">
        Who pays at showdown?
        <select
          value={r.payout}
          onChange={(e) => edit("payout", e.target.value)}
        >
          <option value="lowest">Only the lowest hand</option>
          <option value="highest">Everyone below the highest</option>
        </select>
      </label>
      {r.payout === "lowest" && (
        <label className="rule-wide">
          If the knocker ties for lowest
          <select
            value={r.tieSafe ? "safe" : "pays"}
            onChange={(e) => edit("tieSafe", e.target.value === "safe")}
          >
            <option value="safe">
              Knocker is safe, other tied players pay
            </option>
            <option value="pays">Only the knocker pays</option>
          </select>
        </label>
      )}
      <label className="rule-wide">
        Bot play style
        <select
          value={r.botStyle || "arcade"}
          onChange={(e) => edit("botStyle", e.target.value)}
        >
          <option value="arcade">Arcade · standard opponents</option>
          <option value="reader">Table readers · use public clues</option>
        </select>
      </label>
      <div className="settings-summary">
        <b>House scoring</b>
        <p>
          {r.payout === "lowest"
            ? "An opening knock is legal. Beat one rival to keep your token after the final turns."
            : "Everyone below the highest score pays one."}{" "}
          A failed knock costs one token. Triples have no bonus.
        </p>
      </div>
    </div>
  );
}
export function Setup({ rules, close, deal }) {
  const [r, set] = useState({ ...defaults, ...rules });
  const edit = (key, val) => set({ ...r, [key]: val });
  return (
    <Modal title="Solo table setup" onClose={close}>
      <p>
        Choose your house rules and deal a fresh match with the arcade crew.
      </p>
      <RuleFields r={r} edit={edit} />
      <button className="action primary wide-action" onClick={() => deal(r)}>
        Deal new solo match
      </button>
    </Modal>
  );
}
export function Friends({
  rules,
  code: initial = "",
  close,
  enter,
  busy,
  error,
}) {
  const [tab, setTab] = useState(initial ? "join" : "create"),
    [name, setName] = useState(""),
    [code, setCode] = useState(initial),
    [r, set] = useState({ ...defaults, ...rules });
  const edit = (key, val) => set({ ...r, [key]: val });
  async function submit(e) {
    e.preventDefault();
    if (
      await enter(
        tab,
        tab === "create"
          ? { name: name || "Nova", rules: r }
          : { code: code.trim().toUpperCase(), name: name || "Pixel" },
      )
    )
      close();
  }
  return (
    <Modal title="Play with friends" onClose={close}>
      <div className="segmented" role="group" aria-label="Room action">
        <button
          className={tab === "create" ? "selected" : ""}
          onClick={() => setTab("create")}
        >
          Create room
        </button>
        <button
          className={tab === "join" ? "selected" : ""}
          onClick={() => setTab("join")}
        >
          Join room
        </button>
      </div>
      <form onSubmit={submit}>
        <label className="text-field">
          Your name
          <input
            placeholder={tab === "create" ? "Nova" : "Pixel"}
            maxLength={18}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {tab === "join" ? (
          <label className="text-field">
            Room code
            <input
              required
              minLength={7}
              maxLength={7}
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="7-character code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
        ) : (
          <>
            <p>
              Share the room link, then deal when everyone has joined. Arcade
              opponents fill empty seats.
            </p>
            <RuleFields r={r} edit={edit} />
          </>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button disabled={busy} className="action primary wide-action">
          {busy
            ? "Connecting…"
            : tab === "create"
              ? "Create room"
              : "Join room"}
        </button>
      </form>
    </Modal>
  );
}
export function Lobby({ packet, operate, busy, leave }) {
  const [copied, setCopied] = useState(false),
    [manual, setManual] = useState(false);
  const url =
    typeof window === "undefined"
      ? ""
      : `${location.origin}/?room=${packet.code}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setManual(true);
    }
  }
  return (
    <div className="lobby">
      <span className="large-icon">
        <Users size={30} />
      </span>
      <h2>Friends’ table</h2>
      <p>
        {packet.host
          ? "Send the room link to your crew. Empty seats become bots when you deal."
          : "You’re seated. The host will deal when everyone is ready."}
      </p>
      <div className="room-code">{packet.code}</div>
      <button className="panel-link" onClick={copy}>
        {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
        {copied ? "Copied" : "Copy room link"}
      </button>
      {manual && (
        <input
          className="copy-url"
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          aria-label="Room invite URL"
        />
      )}
      <div className="lobby-members">
        {Array.from({ length: packet.rules.players }, (_, i) => (
          <span key={i}>
            <Sprite id={i} />
            {packet.members.find(member => member.id === i)?.name || "Open seat"}
          </span>
        ))}
      </div>
      <div className="lobby-actions">
        {packet.host && (
          <button
            disabled={busy}
            className="action primary"
            onClick={() => operate("start")}
          >
            Deal match
          </button>
        )}
        <button className="action outline" onClick={leave}>
          {packet.host ? "End game and go to lobby" : "Leave game and go to lobby"}
        </button>
      </div>
    </div>
  );
}
