"use client";
import { useState } from "react";
import { AudioLines, Gamepad2, GraduationCap, Users } from "lucide-react";
import { Card, Sprite } from "./pieces";

const crew = [
  { id: 1, name: "Mochi", greeting: "Your deal!" },
  { id: 2, name: "Pip", greeting: "Feeling froggy?" },
  { id: 3, name: "Hex", greeting: "One more hand!" },
];
const suits = ["♥", "♠", "♦", "♣", "✦"];

export function ClubLobby({ solo, friends, practice, sound, musicOn, settings, lives }) {
  const [burst, setBurst] = useState(null);
  function boop(id) {
    sound.play("ui");
    setBurst(previous => ({ id, key: (previous?.key || 0) + 1 }));
  }
  return (
    <div className="lobby home-lobby club-lobby">
      <div className="club-scenery" aria-hidden="true" />
      <div className="club-scanlines" aria-hidden="true" />
      <div className="club-confetti" aria-hidden="true">
        {Array.from({ length: 26 }, (_, i) => (
          <i key={i} style={{ "--x": `${(i * 37 + 9) % 100}%`, "--delay": `${-(i * 1.7)}s`, "--duration": `${10 + i % 8}s`, "--drift": `${(i % 2 ? 1 : -1) * (20 + i % 5 * 15)}px` }}>{suits[i % suits.length]}</i>
        ))}
      </div>
      <div className="club-marquee" aria-hidden="true">
        {[0, 1].map(copy => (
          <span key={copy}>♥ {lives} LIVES ♥ DRAW · DISCARD · KNOCK ♠ 31 WINS INSTANTLY ♦ NEKO CARD CLUB ♣</span>
        ))}
      </div>
      <div className="club-title">
        <img src="/art/blitz-logo.png" alt="BLITZ" width="332" height="88" />
        <h2>Neko Card Club</h2>
      </div>
      <div className="club-neon club-neon-left" aria-hidden="true"><b>31</b><span>♥ ♦ ♣ ♠</span></div>
      <div className="club-neon club-neon-right" aria-hidden="true"><span>LET’S</span><b>PLAY</b></div>
      <div className="club-card-fan club-card-fan-left" aria-hidden="true">
        {[0, 11, 12].map((id, i) => <span key={id} style={{ "--fan": i - 1 }}><Card id={id} /></span>)}
      </div>
      <div className="club-card-fan club-card-fan-right" aria-hidden="true">
        {[13, 24, 25].map((id, i) => <span key={id} style={{ "--fan": i - 1 }}><Card id={id} /></span>)}
      </div>
      <button className="club-dealer-boop" aria-label="Boop the cat dealer" onClick={() => boop(0)} />
      <div className="club-crew">
        {crew.map(member => (
          <button key={member.id} className={`club-critter club-critter-${member.id}`} aria-label={`Boop ${member.name}`} onClick={() => boop(member.id)}>
            <Sprite id={member.id} />
            <span>{member.name}</span>
          </button>
        ))}
      </div>
      {burst && <div key={burst.key} className={`club-burst club-burst-${burst.id}`} aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--angle": `${i * 30}deg`, "--travel": `${70 + i % 3 * 28}px` }}>{suits[i % 5]}</i>)}
        <b>{crew.find(member => member.id === burst.id)?.greeting || "Lucky you!"}</b>
      </div>}
      <div className="club-menu">
        <div className="club-menu-lights" aria-hidden="true" />
        <div className="lobby-actions">
          <button className="club-play action primary" onClick={solo}><Gamepad2 size={25} />Play solo<span aria-hidden="true">✦</span></button>
          <button className="club-friends action outline" onClick={friends}><Users size={22} />Play with friends</button>
          <div className="club-utilities">
            <button className="action outline" onClick={practice}><GraduationCap size={19} />Learn Blitz</button>
            <button className="action outline club-music" onClick={() => {
              if (musicOn) settings();
              else sound.change({ music: true, enabled: true, volume: sound.settings.volume || 75 });
            }}>
              <AudioLines size={19} />{musicOn ? "Music on" : "Turn on music"}
            </button>
          </div>
        </div>
      </div>
      <div className="club-floor" aria-hidden="true" />
      <div className="club-coins" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ "--coin": i }} />)}</div>
    </div>
  );
}
