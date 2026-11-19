"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  AudioLines,
  Hand,
  Layers,
  Music2,
  SquareStack,
  Trophy,
  Volume2,
  Zap,
} from "lucide-react";
import { Modal } from "./pieces";

const samples = [
  [Layers, "stock", "Draw stock"],
  [Hand, "take", "Take discard"],
  [SquareStack, "throw", "Discard"],
  [AudioLines, "knock", "Knock"],
  [Zap, "blitz", "Blitz"],
  [Trophy, "win", "Match win"],
];

export function SoundPanel({ sound, close }) {
  const { settings, change, preview, toggle } = sound;
  const chord = useSyncExternalStore(sound.subscribe, sound.getChord, () => "");
  const playback = useSyncExternalStore(sound.subscribe, sound.getPlayback, () => "Tap to start music");
  const [playing, setPlaying] = useState(null);
  const latest = useRef(0);
  async function audition(id) {
    const ticket = ++latest.current;
    setPlaying(id);
    await preview(id);
    if (ticket === latest.current) setPlaying(null);
  }
  return (
    <Modal title="Arcade sound" onClose={close}>
      <div className="sound-options">
        <button
          className="audio-row"
          role="switch"
          aria-checked={settings.enabled}
          onClick={toggle}
        >
          <Volume2 size={19} />
          <span>Game audio</span>
          <i className="switch-track" aria-hidden="true" />
        </button>
        <label className="audio-volume">
          <span>
            Volume <output>{settings.volume}%</output>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={settings.volume}
            aria-label="Volume"
            onChange={(e) => change({ volume: Number(e.target.value) })}
          />
        </label>
        <button
          className="audio-row"
          role="switch"
          aria-label="Arcade music"
          aria-checked={settings.music}
          onClick={() =>
            change(
              settings.music
                ? { music: false }
                : { music: true, enabled: true },
            )
          }
        >
          <Music2 size={19} />
          <span className="music-title">
            Arcade music<small>Glass Canopy · live synth</small>
          </span>
          <i className="switch-track" aria-hidden="true" />
        </button>
        <label className="audio-volume">
          <span>
            Sparkle <output>{settings.sparkle}%</output>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            aria-label="Sparkle"
            value={settings.sparkle}
            onChange={(e) => change({ sparkle: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="live-harmony" role="status">
        <span>{playback}</span>
        <button className="action outline" onClick={sound.restartMusic}>
          {playback === "Music playing" ? "Restart music" : "Start music"}
        </button>
      </div>
      {chord && (
        <div className="live-harmony">
          <span>Current chord</span>
          <b>{chord}</b>
        </div>
      )}
      <fieldset className="sample-sounds">
        <legend>Tap again for a new voicing</legend>
        {samples.map(([Icon, id, label]) => (
          <button
            key={id}
            className="action outline"
            aria-label={`Preview ${label.toLowerCase()}`}
            data-playing={playing === id}
            onClick={() => audition(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </fieldset>
    </Modal>
  );
}
