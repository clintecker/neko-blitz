"use client";
import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  CircleHelp,
  AudioLines,
  BrainCircuit,
  Eye,
  History,
  GraduationCap,
  Menu,
  Gamepad2,
  Layers,
  LibraryBig,
  LockKeyhole,
  SlidersHorizontal,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
  LogOut,
} from "lucide-react";
import { fullCard, defaults } from "../public/game/table.mjs";
import { useTable, useAdvice } from "./use-table";
import Strategy from "./strategy";
import { ReadChip, Reads } from "./reads";
import { useArcadeSound, useTableSounds } from "./arcade-audio";
import { SoundPanel } from "./sound-panel";
import { ClubLobby } from "./club-lobby";
import { LoadingScreen, Practice, Welcome, useLaunch } from "./first-hand";
import { CardFlight, MoveCaption, useTurnMotion } from "./turn-motion";
import {
  Back,
  Card,
  HandScore,
  Hearts,
  Modal,
  Seat,
  SheetBack,
  Showdown,
  Sprite,
  seatName,
} from "./pieces";
import {
  Coach,
  Feed,
  Friends,
  Instructions,
  Lobby,
  Odds,
  Setup,
} from "./panels";

function Board({ v: actual, room, act, next, busy, host, play }) {
  const frame = useTurnMotion(actual, room),
    field = useRef(null),
    origin = useRef(null);
  useTableSounds(actual, frame, play);
  const cue = frame.active ? frame.cue : null;
  const base = cue?.scene || actual;
  const v = cue ? { ...base, turn: cue.seat, stockCount: cue.stock } : base;
  const visibleTop = cue
    ? cue.kind === "throw" && !frame.landed
      ? cue.before
      : cue.after
    : v.discard.at(-1);
  const showOrigin = (card, element) => {
    const r = element.getBoundingClientRect(),
      b = field.current.getBoundingClientRect();
    origin.current = {
      card,
      width: element.offsetWidth,
      point: {
        x: r.left + r.width / 2 - b.left,
        y: r.top + r.height / 2 - b.top,
      },
    };
    act("throw", card);
  };
  const mine = v.turn === v.self,
    playing = v.phase !== "end",
    able = playing && mine && !busy && !frame.active;
  const drawing = able && v.phase === "draw",
    throwing = able && v.phase === "throw",
    top = visibleTop;
  const peers = Array.from(
    { length: v.seats.length - 1 },
    (_, offset) => v.seats[(v.self + 1 + offset) % v.seats.length],
  );
  const turn =
    v.phase === "end"
      ? "Round complete"
      : mine
        ? v.knocker != null
          ? "Your final turn"
          : "Your turn"
        : `${seatName(v, v.turn)}’s turn`;
  const prompt =
    v.phase === "end"
      ? "Hands revealed."
      : !mine
        ? v.knocker != null
          ? "Playing a final turn…"
          : "Choosing a move…"
        : v.phase === "throw"
          ? "Choose a card to discard."
          : v.knocker != null
            ? `${seatName(v, v.knocker)} knocked. Take your last draw.`
            : "Choose a pile or knock.";
  return (
    <>
      <div
        ref={field}
        className={`table-field ${cue ? `move-${cue.kind}` : ""} ${cue && frame.landed ? "move-landed" : ""}`}
        data-playing={playing}
        data-final={v.knocker != null && playing}
        data-mine={playing && mine}
      >
        <div className="felt" aria-hidden="true">
          <span className="playmat-frame" />
          <i className="felt-ring" />
          <i className="rail-light left" />
          <i className="rail-light right" />
          <span className="felt-suit left">♧</span>
          <span className="felt-suit right">♤</span>
        </div>
        {cue?.kind === "knock" && (
          <div key={cue.key} className="knock-waves" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        )}
        <div className={`opponents count-${peers.length}`}>
          {peers.map((p) => (
            <Seat key={p.id} p={p} view={v} />
          ))}
        </div>
        {playing ? (
          <>
            <MoveCaption v={v} frame={frame} />
            <div className="pile-area">
              <button
                className="pile-button"
                disabled={!drawing}
                onClick={() => act("stock")}
                aria-label={`Draw from stock pile, ${v.stockCount} cards`}
              >
                <span className="stack" data-loc="stock">
                  <Back />
                </span>
                <span className="pile-caption">
                  <span>
                    <span className="pile-verb">Draw </span>Stock
                  </span>
                  <b>{v.stockCount}</b>
                </span>
              </button>
              <i className="pile-separator" aria-hidden="true" />
              <button
                className="pile-button"
                disabled={!drawing || top == null}
                onClick={() => act("discard")}
                aria-label={
                  top == null
                    ? "Empty discard pile"
                    : `Take ${fullCard(top)} from discard pile`
                }
              >
                <span className="faceup-slot" data-loc="discard">
                  {top != null ? (
                    <Card id={top} />
                  ) : (
                    <span className="empty-slot" />
                  )}
                </span>
                <span className="pile-caption">
                  <span>
                    <span className="pile-verb">Take </span>Discard
                  </span>
                </span>
              </button>
            </div>
            <div className="rack">
              <div className="my-seat">
                <span className="you-label">
                  <i />
                  You
                </span>
                <Hearts
                  n={v.seats[v.self].lives}
                  total={v.rules.lives + Number(v.rules.freeRide)}
                />
              </div>
              <div
                key={`${v.matchId}/${v.round}`}
                className={`hand ${v.log.length === 1 ? "opening-hand" : ""} ${v.hand.length === 4 ? "four" : ""} ${throwing ? "choosing" : ""}`}
                data-loc={`seat-${v.self}`}
                aria-label="Your hand"
              >
                {v.hand.length ? (
                  v.hand.map((c, i) => {
                    const blocked =
                      v.drawSource === "discard" &&
                      v.drawn === c &&
                      v.phase === "throw";
                    return (
                      <button
                        key={c}
                        data-card={c}
                        style={{
                          "--index": i,
                          "--middle": (v.hand.length - 1) / 2,
                        }}
                        className={`hand-card ${cue && !frame.landed && cue.seat === v.self && (cue.kind === "stock" || cue.kind === "take") && v.drawn === c ? "arriving" : ""} ${v.drawn === c && v.phase === "throw" ? "new-card" : ""}`}
                        disabled={!throwing || blocked}
                        aria-label={
                          throwing
                            ? blocked
                              ? `${fullCard(c)}, must keep`
                              : `Discard ${fullCard(c)}`
                            : fullCard(c)
                        }
                        title={
                          throwing
                            ? blocked
                              ? "The face-up card you took must stay."
                              : `Discard ${fullCard(c)}`
                            : fullCard(c)
                        }
                        onClick={(e) => showOrigin(c, e.currentTarget)}
                      >
                        <Card id={c} />
                        {blocked && (
                          <span className="keep-tab" aria-hidden="true">
                            <LockKeyhole size={11} /> Keep
                          </span>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <span className="spectating">Spectating</span>
                )}
              </div>
              <HandScore view={v} />
            </div>
          </>
        ) : (
          <Showdown view={v} host={host} onNext={next} busy={busy} />
        )}
        <CardFlight field={field} frame={frame} origin={origin} v={v} />
      </div>
      {playing && (
        <div className="action-bay">
          <div className="turn-message" aria-live="polite">
            <span className={`turn-tag ${mine ? "yours" : ""}`}>
              <i />
              {turn}
            </span>
            <span>
              {cue
                ? {
                    stock: "Drawing from stock…",
                    take: "Taking the face-up card…",
                    throw: "Discarding from hand…",
                    knock: "Knocked. Final turns begin.",
                  }[cue.kind]
                : prompt}
            </span>
          </div>
          <div className="action-buttons">
            <button
              className="action primary"
              disabled={!drawing}
              onClick={() => act("stock")}
            >
              <Layers size={17} />
              Draw stock
            </button>
            <button
              className="action outline"
              disabled={!drawing || top == null}
              onClick={() => act("discard")}
            >
              <span className="draw-icon" aria-hidden="true">
                ♦
              </span>
              Take discard
            </button>
            <button
              className="action knock"
              disabled={!drawing || v.knocker != null}
              onClick={() => act("knock")}
            >
              <Zap size={17} fill="currentColor" />
              Knock
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default function Arcade() {
  const [stage, setStage] = useState("loading");
  const table = useTable(stage !== "table"),
    { packet, busy, operate, goSolo, enter } = table;
  const [modal, setModal] = useState(null),
    [objective, setObjective] = useState("match"),
    [parentSheet, setParentSheet] = useState(null);
  const sheetTrigger = useRef(null);
  const launch = useLaunch(
    setStage,
    Boolean(packet && table.entryRoute),
    table.entryRoute === "room",
  );
  const planned = useRef(null);
  const lastRoom = useRef(null);
  const v = packet?.view,
    r = packet?.rules || defaults,
    sound = useArcadeSound(stage === "table" && v?.knocker != null && v.phase !== "end"),
    advice = useAdvice(
      stage === "table" ? v : null,
      objective,
      modal === "reads",
    );
  useEffect(() => {
    // A host can end the room while another player has a tool sheet open.
    if (lastRoom.current && !packet?.code) {
      setModal(null);
      setParentSheet(null);
      planned.current = null;
    }
    lastRoom.current = packet?.code || null;
  }, [packet?.code]);
  useEffect(() => {
    if (table.invite) setModal("friends");
  }, [table.invite]);
  const close = () => {
    setModal(null);
    setParentSheet(null);
    const trigger = sheetTrigger.current;
    if (trigger)
      requestAnimationFrame(() => {
        if (trigger.isConnected) trigger.focus({ preventScroll: true });
      });
    if (table.invite) table.setInvite("");
  };
  const open = (x) => {
    table.setError("");
    if (!modal) sheetTrigger.current = document.activeElement;
    setParentSheet(modal === "menu" || modal === "coach" ? modal : null);
    if (x !== "sound") sound.play("ui");
    setModal(x);
  };
  function move(action, card) {
    if (busy) return;
    if (action === "discard" && advice?.actions?.discard && v)
      planned.current = {
        round: v.round,
        top: v.discard.at(-1),
        card: advice.actions.discard.discardCard,
      };
    else planned.current = null;
    void operate("move", { action, card });
  }
  const next = () => {
    void operate(v.result.winner != null ? "rematch" : "next");
  };
  const practice = () => {
    close();
    sound.play("ui");
    launch.start();
  };
  const finishLesson = () => {
    launch.toTable();
    requestAnimationFrame(() =>
      document.getElementById("table")?.focus({ preventScroll: true }),
    );
  };
  if (stage === "loading") return <LoadingScreen />;
  if (stage === "welcome")
    return <Welcome practice={practice} skip={finishLesson} />;
  if (stage === "practice")
    return <Practice leave={finishLesson} play={sound.play} />;

  const round = v?.round || 1;
  const roomPanel = packet?.code ? "roominfo" : "friends";
  const guest = Boolean(packet?.code && !packet.host);
  const exitLabel = guest ? "Leave game and go to lobby" : "End game and go to lobby";
  const musicOn = sound.settings.music && sound.settings.enabled && sound.settings.volume > 0;
  const exitGame = async () => {
    if (await table.endGame()) {
      planned.current = null;
      close();
      setStage("table");
    }
  };
  let exitCopy = "Your current match and saved hand will be cleared. You can start a fresh game from the lobby.";
  if (packet?.code) exitCopy = guest
    ? "You’ll leave this table and return to the lobby. A bot will take over your hand."
    : "This ends the game for everyone and returns each player to the lobby.";
  const plannedCard =
    v?.drawSource === "discard" &&
    v.round === planned.current?.round &&
    v.drawn === planned.current?.top
      ? planned.current.card
      : null;
  const coach = (
    <Coach
      view={v}
      advice={advice}
      planned={plannedCard}
      compare={() => open("odds")}
    />
  );
  return (
    <SheetBack.Provider
      value={
        parentSheet
          ? {
              label: parentSheet === "menu" ? "game menu" : "coach",
              go: () => {
                setModal(parentSheet);
                setParentSheet(null);
              },
            }
          : null
      }
    >
      <div className="game-app">
        <header className="topbar">
          <div className="nav-wrap">
            <div className="brand" aria-label="Blitz at Neko Arcade">
              <span className="brand-chip">
                <Sprite id={0} />
              </span>
              <img
                className="nav-wordmark"
                src="/art/blitz-logo.png"
                alt=""
                width="332"
                height="88"
              />
            </div>
            {v && <button
              className="hud-round"
              onClick={() => open(packet?.code ? "roominfo" : "setup")}
              aria-label={packet?.code ? "Room details" : "Table setup"}
            >
              <span>Round</span>
              <b>{String(round).padStart(2, "0")}</b>
            </button>}
            {v && <span className="hud-table">
              {packet?.code ? "Friends’ table" : "Solo table"} ·{" "}
              {r.payout === "lowest"
                ? "Lowest hand pays"
                : "Highest stays safe"}
            </span>}
            <div className="nav-right">
              <div className="sound-tools">
                <button
                  className="sound icon-btn"
                  aria-pressed={sound.settings.enabled}
                  aria-label={
                    sound.settings.enabled ? "Mute sound" : "Enable sound"
                  }
                  title={sound.settings.enabled ? "Mute sound" : "Enable sound"}
                  onClick={sound.toggle}
                >
                  {sound.settings.enabled ? (
                    <Volume2 size={19} />
                  ) : (
                    <VolumeX size={19} />
                  )}
                </button>
                <button
                  className="sound-settings icon-btn"
                  aria-label="Sound settings"
                  title="Sound settings"
                  aria-haspopup="dialog"
                  onClick={() => open("sound")}
                >
                  <AudioLines size={17} />
                </button>
              </div>
              <button
                className="hud-menu icon-btn"
                onClick={() => open("menu")}
                title="Game menu"
                aria-label="Game menu"
                aria-haspopup="dialog"
              >
                <Menu size={22} />
              </button>
              <button className="how" onClick={() => open("rules")}>
                <CircleHelp size={16} />
                How to play
              </button>
            </div>
          </div>
        </header>
        <main className="shell">
          <h1 className="sr-only">Blitz at Neko Arcade</h1>
          <div className="game-layout">
            <section
              className="cabinet"
              id="table"
              aria-label="Game table"
              tabIndex={-1}
            >
              {v ? (
                <Board
                  v={v}
                  room={packet.code}
                  act={move}
                  next={next}
                  busy={busy}
                  host={packet.host}
                  play={sound.play}
                />
              ) : packet?.code ? (
                <Lobby
                  packet={packet}
                  operate={operate}
                  busy={busy}
                  leave={() => open("end-game")}
                />
              ) : (
                <ClubLobby
                  solo={() => goSolo(r)}
                  friends={() => open("friends")}
                  practice={practice}
                  sound={sound}
                  musicOn={musicOn}
                  settings={() => open("sound")}
                  lives={r.lives}
                />
              )}
            </section>
            {v && <aside className="side">
              {v && coach}
              <ReadChip v={v} advice={advice} open={() => open("reads")} />
              <Feed view={v} />
              <button
                className="friends-link"
                onClick={() => open(packet?.code ? "roominfo" : "friends")}
              >
                <span className="heading-icon">
                  <Users size={17} />
                </span>
                <span>
                  {packet?.code ? "Room details" : "Play with friends"}
                </span>
                <ChevronRight size={15} />
              </button>
            </aside>}
          </div>
        </main>
        <nav className="game-dock" aria-label="Table tools">
          {[
            [null, v ? "Table" : "Lobby", Gamepad2],
            ["coach", "Coach", BrainCircuit],
            ["history", "History", History],
            [roomPanel, packet?.code ? "Room" : "Friends", Users],
          ].map(([target, label, Icon]) => (
            <button
              key={label}
              disabled={!v && (target === "coach" || target === "history")}
              aria-current={modal === target ? "page" : undefined}
              aria-haspopup={target ? "dialog" : undefined}
              onClick={() => (target ? open(target) : close())}
            >
              <Icon size={21} strokeWidth={2} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {modal === "menu" && (
          <Modal title="Game menu" onClose={close}>
            <div className="game-menu">
              {[
                [GraduationCap, "Play a practice hand", practice],
                [CircleHelp, "How to play", () => open("rules")],
                [LibraryBig, "Strategy guide", () => open("strategy")],
                [
                  Eye,
                  "Opponent reads",
                  () => open("reads"),
                  !v || v.phase === "end",
                ],
                [AudioLines, "Sound settings", () => open("sound")],
                ...(v || packet?.code
                  ? [[LogOut, exitLabel, () => open("end-game"), busy]]
                  : []),
                [
                  SlidersHorizontal,
                  packet?.code ? "Room details" : "Table setup",
                  () => open(packet?.code ? "roominfo" : "setup"),
                ],
              ].map(([Icon, label, act, disabled]) => (
                <button key={label} disabled={disabled} onClick={act}>
                  <Icon size={20} />
                  <span>{label}</span>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
          </Modal>
        )}
        {modal === "end-game" && (
          <Modal title={guest ? "Leave this game?" : "End this game?"} onClose={close}>
            <p>{exitCopy}</p>
            <div className="lobby-actions">
              <button className="action primary" disabled={busy} onClick={exitGame}>
                {busy ? "Leaving…" : guest ? "Leave game" : "End game"}
              </button>
              <button className="action outline" disabled={busy} onClick={close}>Keep playing</button>
            </div>
          </Modal>
        )}
        {modal === "coach" && (
          <Modal title="Knock coach" onClose={close}>
            <div className="tool-sheet">{coach}</div>
            <button
              className="lesson-link"
              onClick={() => open("reads")}
              disabled={!v || v.phase === "end"}
            >
              <Eye size={20} />
              <span>Opponent reads</span>
              <ChevronRight size={17} />
            </button>
          </Modal>
        )}
        {modal === "history" && (
          <Modal title="Table history" onClose={close}>
            <div className="tool-sheet">
              <Feed view={v} />
            </div>
          </Modal>
        )}
        {table.error && modal !== "friends" && (
          <div className="toast" role="alert">
            {table.error}
            <button
              className="icon-btn"
              aria-label="Dismiss message"
              onClick={() => table.setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {modal === "sound" && <SoundPanel sound={sound} close={close} />}
        {modal === "reads" && <Reads v={v} advice={advice} close={close} />}
        {modal === "rules" && (
          <Instructions rules={r} close={close} practice={practice} />
        )}
        {modal === "strategy" && <Strategy rules={r} close={close} />}
        {modal === "odds" && (
          <Odds
            v={v}
            advice={advice}
            close={close}
            objective={objective}
            setObjective={setObjective}
          />
        )}
        {modal === "setup" && (
          <Setup
            rules={r}
            close={close}
            deal={(rules) => {
              goSolo(rules);
              close();
            }}
          />
        )}
        {modal === "friends" && (
          <Friends
            rules={r}
            code={table.invite}
            close={close}
            enter={enter}
            busy={busy}
            error={table.error}
          />
        )}
        {modal === "roominfo" && (
          <RoomInfo packet={packet} close={close} leave={() => open("end-game")} />
        )}
      </div>
    </SheetBack.Provider>
  );
}
function RoomInfo({ packet, close, leave }) {
  const [copied, setCopied] = useState(false),
    url = `${location.origin}/?room=${packet.code}`;
  return (
    <Modal title="Room details" onClose={close}>
      <p>
        Room code <b className="mint-text">{packet.code}</b>. People with access
        to this game can join before the host deals.
      </p>
      <label className="text-field">
        Room link
        <input readOnly value={url} onFocus={(e) => e.target.select()} />
      </label>
      <div className="lobby-actions">
        <button
          className="action primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              document.querySelector("dialog input")?.select();
            }
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        <button
          className="action outline"
          onClick={leave}
        >
          {packet.host ? "End game and go to lobby" : "Leave game and go to lobby"}
        </button>
      </div>
    </Modal>
  );
}
