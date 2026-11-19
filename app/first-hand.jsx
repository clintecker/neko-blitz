"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  GraduationCap,
  LockKeyhole,
  Zap,
} from "lucide-react";
import { cardText, fullCard, handValue } from "../public/game/table.mjs";
import { Back, Card, Hearts, Sprite } from "./pieces";

const SEEN = "neko-blitz.first-hand.v1";
const CLUB = "/art/club-doors.webp";
const opening = [22, 24, 28]; // Ten and queen of hearts, three of clubs.
const king = 25;
const lowClub = 28;
const gained = [...opening, king];
const finalHand = gained.filter((card) => card !== lowClub);
const rivals = [
  { id: 1, name: "Mochi", hand: [0, 6, 3] },
  { id: 2, name: "Pip", hand: [39, 44, 29] },
];
const steps = [
  {
    title: "Pick a suit",
    copy: "The 10♥ and Q♥ give you 20. Only one suit counts. Draw blind from stock or take the face-up discard. Try the K♥.",
  },
  {
    title: "Discard a card",
    copy: "The face-up king you took must stay this turn. Tap the 3♣ to put it on the discard pile and keep all three hearts.",
  },
  {
    title: "Make the knock",
    copy: "It’s your next turn. Knock before drawing to keep your 30 and give each rival one last turn. You can knock on your opening turn, too.",
  },
  {
    title: "See who pays",
    copy: "Mochi and Pip have taken their last turns. Pip has the lowest score and pays one token. You and Mochi keep all four.",
  },
];

// Image decode and table hydration drive startup. A slow illustration can
// finish after entry. A warm visit needs only a very short transition.
export function useLaunch(setStage, ready, directRoom) {
  const [entry, setEntry] = useState(null);
  useEffect(() => {
    let active = true;
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN) === "seen";
    } catch {}
    const sources = [
      "/art/blitz-logo.png",
      "/art/neko-card-back.webp",
      "/art/neko-playmat.webp",
    ];
    if (!seen && !directRoom) sources.push(CLUB);
    const images = sources.map(
      (src) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = img.onerror = resolve;
          img.src = src;
        }),
    );
    let minTimer, maxTimer;
    const minimum = new Promise((done) => {
      minTimer = setTimeout(done, seen || directRoom ? 140 : 450);
    });
    const deadline = new Promise((done) => {
      maxTimer = setTimeout(done, 2200);
    });
    Promise.all([minimum, Promise.race([Promise.all(images), deadline])]).then(
      () => {
        if (active) setEntry(seen || directRoom ? "table" : "welcome");
      },
    );
    return () => {
      active = false;
      clearTimeout(minTimer);
      clearTimeout(maxTimer);
    };
  }, [directRoom]);
  useEffect(() => {
    if (ready && entry)
      setStage((old) =>
        old === "loading" ? (directRoom ? "table" : entry) : old,
      );
  }, [ready, entry, directRoom, setStage]);
  function toTable() {
    try {
      localStorage.setItem(SEEN, "seen");
    } catch {}
    setStage("table");
  }
  return { start: () => setStage("practice"), toTable };
}

function Logo() {
  return (
    <img
      className="launch-logo"
      src="/art/blitz-logo.png"
      alt="BLITZ"
      width="332"
      height="88"
    />
  );
}

export function LoadingScreen() {
  return (
    <main
      className="launch-screen loading-screen"
      aria-label="Loading Blitz"
      aria-busy="true"
    >
      <div className="boot-content">
        <Logo />
        <div className="boot-deck" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <p role="status">
          Shuffling the deck<span aria-hidden="true">…</span>
        </p>
      </div>
    </main>
  );
}

export function Welcome({ practice, skip }) {
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <main className="launch-screen welcome-screen">
      <div className="welcome-card">
        <div className="welcome-art">
          <img
            src={CLUB}
            className="club-portrait"
            width="1152"
            height="623"
            alt="A lucky-cat dealer welcomes you into a neon-lit card club."
          />
          <Logo />
        </div>
        <div className="welcome-copy">
          <h1 tabIndex={-1} ref={heading}>
            Pull up a chair.
          </h1>
          <p>
            New to Blitz? Play one hand with the dealer and learn when to knock.
          </p>
          <button className="entry-action" onClick={practice}>
            <GraduationCap size={21} />
            Play a practice hand
            <ArrowRight size={19} />
          </button>
          <button className="entry-skip" onClick={skip}>
            Skip and play
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </main>
  );
}

function PracticeResult({ turns }) {
  const revealed = turns === rivals.length;
  const actions = [
    "Hand locked",
    turns === 0 ? "Drawing stock…" : "Discarded 6♦",
    turns === 0 ? "Waiting" : "Taking 6♦…",
  ];
  const players = [{ id: 0, name: "You", hand: finalHand }, ...rivals];
  return (
    <div className="practice-result" aria-label="Practice showdown">
      {players.map(({ id, name, hand }) => (
        <div
          key={id}
          className={revealed && id === 2 ? "practice-paid" : ""}
          data-acting={!revealed && id === turns + 1}
        >
          <Sprite id={id} />
          <div className="practice-player">
            <b>{name}</b>
            <small>
              {id === 0 || revealed
                ? hand.map(cardText).join("  ")
                : actions[id]}
            </small>
          </div>
          <strong>{id === 0 || revealed ? handValue(hand).score : "·"}</strong>
          <span>
            {revealed
              ? id === 2
                ? "−1 token"
                : "Safe"
              : id === 0
                ? "Knocked"
                : id === turns + 1
                  ? "Final turn"
                  : id <= turns
                    ? "Done"
                    : "Waiting"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Practice({ leave, play }) {
  // This hand belongs only to the lesson. Solo and room actions are never
  // reachable through these controls, even when the lesson is replayed.
  const [step, setStep] = useState(0);
  const [hint, setHint] = useState("");
  const [turns, setTurns] = useState(0);
  const showingTurns = step === 3 && turns < rivals.length;
  useEffect(() => {
    if (!showingTurns) return;
    const timer = setTimeout(() => {
      play(turns === 0 ? "take" : "safe");
      setTurns(turns + 1);
    }, 1250);
    return () => clearTimeout(timer);
  }, [turns, showingTurns, play]);
  const title = useRef(null);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, [step]);
  const advance = (cue) => {
    play(cue);
    setHint("");
    setStep(step + 1);
  };
  const cards = step === 0 ? opening : step === 1 ? gained : finalHand;
  const score = handValue(step < 1 ? opening : finalHand).score;
  return (
    <main className="launch-screen practice-screen">
      <section className="practice-box" aria-label="Practice hand">
        <div className="practice-top">
          <span>
            <GraduationCap size={19} />
            Practice hand
          </span>
          <button onClick={leave} aria-label="Skip practice">
            Skip
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="practice-dots" aria-label={`Step ${step + 1} of 4`}>
          {steps.map((item, i) => (
            <i key={item.title} className={i <= step ? "filled" : ""} />
          ))}
        </div>
        <div className="practice-copy">
          <h1 tabIndex={-1} ref={title}>
            {showingTurns ? "One last turn each" : steps[step].title}
          </h1>
          <p aria-live="polite">
            {showingTurns
              ? "Your 30 is locked. Watch Mochi and Pip take their final turns."
              : steps[step].copy}
          </p>
        </div>
        <div className={"practice-felt lesson-" + step}>
          <span className="playmat-frame" aria-hidden="true" />
          {step === 3 ? (
            <PracticeResult turns={turns} />
          ) : (
            <>
              <div className="practice-piles">
                <div className="practice-pile">
                  <span className="practice-card">
                    <Back />
                  </span>
                  <small>Stock</small>
                </div>
                {step === 0 ? (
                  <button
                    className="practice-pile prompted"
                    onClick={() => advance("take")}
                    aria-label="Take King of hearts from discard pile"
                  >
                    <span className="practice-card">
                      <Card id={king} />
                    </span>
                    <small>Take K♥</small>
                  </button>
                ) : (
                  <div className="practice-pile">
                    <span className="practice-card">
                      {step === 1 ? (
                        <span className="demo-empty" />
                      ) : (
                        <Card id={46} />
                      )}
                    </span>
                    <small>Discard</small>
                  </div>
                )}
              </div>
              <div className="practice-rack">
                <div className="practice-score">
                  <span>
                    Your hand <Hearts n={4} total={4} />
                  </span>
                  <b>
                    {step === 1 ? "Best keep" : "Score"}{" "}
                    <strong>{score}♥</strong>
                  </b>
                </div>
                <div
                  className="practice-cards"
                  style={{ "--count": cards.length }}
                >
                  {cards.map((c) =>
                    step === 1 ? (
                      <button
                        key={c}
                        disabled={c === king}
                        className={c === lowClub ? "prompted" : ""}
                        aria-label={
                          c === king
                            ? `${fullCard(c)}, must keep`
                            : `Discard ${fullCard(c)}`
                        }
                        onClick={() => {
                          if (c === lowClub) advance("throw");
                          else
                            setHint(
                              `Keep the ${cardText(c)} with your other hearts. Tap the 3♣.`,
                            );
                        }}
                      >
                        <Card id={c} />
                        {c === king && (
                          <span className="demo-keep">
                            <LockKeyhole size={10} />
                            Keep
                          </span>
                        )}
                      </button>
                    ) : (
                      <span key={c}>
                        <Card id={c} />
                      </span>
                    ),
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="practice-foot">
          {step === 0 && <p>Tap the glowing discard pile.</p>}
          {step === 1 && (
            <p role="status">{hint || "Tap the club in your hand."}</p>
          )}
          {step === 2 && (
            <button
              className="entry-action practice-knock"
              onClick={() => advance("knock")}
            >
              <Zap size={19} fill="currentColor" />
              Knock
            </button>
          )}
          {showingTurns && (
            <button
              className="entry-skip"
              onClick={() => setTurns(rivals.length)}
            >
              Reveal hands now
              <ChevronRight size={17} />
            </button>
          )}
          {step === 3 && !showingTurns && (
            <>
              <p>
                Aces are 11. An ace and two ten-value cards in one suit make 31
                and end the round immediately. The last player with a token
                wins.
              </p>
              <button className="entry-action" onClick={leave}>
                <Check size={19} />
                Play Blitz
                <ArrowRight size={18} />
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
