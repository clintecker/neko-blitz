"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TableSynth } from "../public/game/night-synth.mjs";

const initial = { enabled: true, music: true, volume: 75, sparkle: 78 };
const storageKey = "neko-blitz.mixer";
const clamp = (value, fallback) =>
  Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;

function storedPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved === "object") {
      return {
        enabled: typeof saved.enabled === "boolean" ? saved.enabled : initial.enabled,
        music: typeof saved.music === "boolean" ? saved.music : initial.music,
        volume: clamp(saved.volume, initial.volume),
        sparkle: clamp(saved.sparkle, initial.sparkle),
      };
    }
    return {
      ...initial,
      enabled: localStorage.getItem("neko-blitz.sound") !== "off",
    };
  } catch {
    return initial;
  }
}

// The audio clock owns the music. React only hears from it when an open
// mixer is displaying a new chord name. Game renders never advance a note.
export class ArcadeMixer {
  constructor(settings, publish, report = () => {}) {
    this.settings = settings;
    this.publish = publish;
    this.report = report;
    this.pressure = false;
    this.epoch = 0;
    this.lanes = { game: 0, ui: 0, preview: 0 };
    this.closed = false;
  }
  level() {
    return this.settings.enabled ? (this.settings.volume / 100) ** 1.3 : 0;
  }
  unlock() {
    if (this.closed || !this.settings.enabled || !this.settings.volume || document.hidden)
      return;
    if (!this.context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) {
        this.report("Audio unavailable in this browser");
        return;
      }
      try {
        // Request the media route on iOS, including when the ringer is muted.
        try {
          if (navigator.audioSession) navigator.audioSession.type = "playback";
        } catch {}
        let ctx;
        try {
          ctx = new Audio({ latencyHint: "interactive" });
        } catch {
          ctx = new Audio();
        }
        this.context = ctx;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 12;
        limiter.ratio.value = 3;
        limiter.attack.value = 0.007;
        limiter.release.value = 0.21;
        this.master = ctx.createGain();
        this.master.gain.value = this.level();
        limiter.connect(this.master).connect(ctx.destination);
        this.synth = new TableSynth(ctx, limiter, { sparkle: this.settings.sparkle / 100 });
        this.synth.tension = this.pressure;
        ctx.onstatechange = () => {
          if (ctx.state === "running") this.sync();
          else {
            this.stopClock();
            this.report(this.settings.enabled && this.settings.music ? "Tap to resume music" : "Music off");
          }
        };
      } catch {
        if (this.context?.state !== "closed") this.context?.close().catch(() => {});
        this.context = null;
        this.report("Tap to retry music");
        return;
      }
    }
    const ctx = this.context;
    if (ctx.state === "running") this.sync();
    else if (ctx.state !== "closed") {
      // A pre-touchend resume can remain pending on WebKit. Each real gesture
      // gets a fresh attempt, including after a call or background interruption.
      this.report("Tap to resume music");
      this.resuming = ctx.resume()
        .then(() => {
          if (this.context === ctx) this.sync();
        })
        .catch(() => {
          if (this.context === ctx) this.report("Tap to retry music");
        });
      const wake = ctx.createBufferSource();
      wake.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      wake.connect(ctx.destination);
      wake.onended = () => wake.disconnect();
      wake.start();
    }
    return this.resuming;
  }
  sync() {
    if (
      !this.synth ||
      this.closed ||
      this.context.state !== "running" ||
      !this.settings.enabled ||
      document.hidden
    )
      return;
    if (!this.settings.music || this.settings.volume === 0) {
      this.stopClock();
      this.report("Music off");
      return;
    }
    this.report("Music playing");
    if (this.timer != null) return;
    this.synth.startAmbient();
    const tick = () => {
      if (this.context.state !== "running" || this.closed || document.hidden)
        return;
      this.synth.schedule(this.context.currentTime + 0.37);
      this.publish(this.synth.harmony().label);
    };
    tick();
    this.timer = setInterval(tick, 140);
  }
  stopClock() {
    clearInterval(this.timer);
    this.timer = null;
    this.synth?.stopAmbient();
    this.publish("");
  }
  set(settings) {
    this.settings = settings;
    const ctx = this.context;
    if (!settings.enabled || !settings.music || !settings.volume) this.report("Music off");
    if (!ctx || !this.synth) return;
    this.master.gain.setTargetAtTime(this.level(), ctx.currentTime, 0.014);
    this.synth.setSparkle(settings.sparkle / 100);
    clearTimeout(this.idle);
    if (!settings.enabled || !settings.volume) {
      this.quiet();
      this.idle = setTimeout(() => {
        if (
          (!this.settings.enabled || !this.settings.volume) &&
          ctx.state === "running"
        )
          void ctx.suspend().catch(() => {});
      }, 145);
    } else this.sync();
  }
  setPressure(value) {
    this.pressure = value;
    if (this.synth) this.synth.tension = value;
  }
  async play(name, pan = 0, preview = false) {
    const ctx = this.context;
    if (
      !ctx ||
      !this.settings.enabled ||
      !this.settings.volume ||
      document.hidden
    )
      return;
    const lane = preview ? "preview" : name === "ui" ? "ui" : "game";
    const ticket = ++this.lanes[lane],
      epoch = this.epoch;
    try {
      if (ctx.state !== "running") await this.resuming;
      if (
        ctx.state !== "running" ||
        this.closed ||
        this.epoch !== epoch ||
        this.lanes[lane] !== ticket ||
        document.hidden
      )
        return;
      return await this.synth.play(name, { position: pan, preview });
    } catch {
      // Losing a hardware audio route must never interrupt a turn.
    }
  }
  quiet() {
    this.epoch++;
    this.stopClock();
    this.synth?.quiet();
  }
  restart() {
    // A phone can lose its hardware route while the page is backgrounded.
    // A fresh context is an explicit recovery from the sound settings button.
    this.quiet();
    const old = this.context;
    if (old) old.onstatechange = null;
    this.synth?.close();
    this.context = null;
    this.synth = null;
    this.resuming = null;
    if (old && old.state !== "closed") void old.close().catch(() => {});
    this.unlock();
  }
  close() {
    this.closed = true;
    clearTimeout(this.idle);
    this.quiet();
    this.synth?.close();
    if (this.context) {
      this.context.onstatechange = null;
      if (this.context.state !== "closed")
        void this.context.close().catch(() => {});
    }
  }
}

export function useArcadeSound(pressure = false) {
  const [settings, setSettings] = useState(initial);
  const mixer = useRef(null),
    chord = useRef(""),
    playback = useRef("Tap to start music"),
    listeners = useRef(new Set());
  const subscribe = useCallback((listener) => {
    const subs = listeners.current;
    subs.add(listener);
    return () => subs.delete(listener);
  }, []);
  const getChord = useCallback(() => chord.current, []);
  const getPlayback = useCallback(() => playback.current, []);
  useEffect(() => {
    const prefs = storedPreferences();
    const engine = new ArcadeMixer(prefs, (name) => {
      if (chord.current === name) return;
      chord.current = name;
      for (const listener of listeners.current) listener();
    }, (status) => {
      if (playback.current === status) return;
      playback.current = status;
      for (const listener of listeners.current) listener();
    });
    mixer.current = engine;
    setSettings(prefs);
    playback.current = prefs.enabled && prefs.music && prefs.volume ? "Tap to start music" : "Music off";
    const wake = () => engine.unlock();
    const visibility = () => {
      if (document.hidden) {
        engine.quiet();
        if (engine.context?.state === "running")
          void engine.context.suspend().catch(() => {});
      } else if (engine.context) engine.unlock();
    };
    document.addEventListener("pointerdown", wake, true);
    document.addEventListener("keydown", wake, true);
    document.addEventListener("click", wake, true);
    document.addEventListener("touchend", wake, true);
    window.addEventListener("pageshow", visibility);
    window.addEventListener("focus", visibility);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("pointerdown", wake, true);
      document.removeEventListener("keydown", wake, true);
      document.removeEventListener("click", wake, true);
      document.removeEventListener("touchend", wake, true);
      window.removeEventListener("pageshow", visibility);
      window.removeEventListener("focus", visibility);
      document.removeEventListener("visibilitychange", visibility);
      engine.close();
      mixer.current = null;
    };
  }, []);
  useEffect(() => {
    mixer.current?.setPressure(pressure);
  }, [pressure]);
  const change = useCallback((patch) => {
    const engine = mixer.current;
    if (!engine) return;
    const next = { ...engine.settings, ...patch };
    engine.set(next);
    engine.unlock();
    setSettings(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      localStorage.setItem("neko-blitz.sound", next.enabled ? "on" : "off");
    } catch {}
  }, []);
  const play = useCallback((name, pan = 0) => {
    void mixer.current?.play(name, pan);
  }, []);
  const preview = useCallback(
    (name) => {
      const engine = mixer.current;
      if (!engine) return;
      if (!engine.settings.enabled) change({ enabled: true });
      else engine.unlock();
      return engine.play(name, 0, true);
    },
    [change],
  );
  const toggle = () => {
    const enabled = !mixer.current?.settings.enabled;
    change({ enabled });
    if (enabled) preview("ui");
  };
  const restartMusic = useCallback(() => {
    const engine = mixer.current;
    if (!engine) return;
    change({ enabled: true, music: true, volume: engine.settings.volume || initial.volume });
    engine.restart();
  }, [change]);
  return { settings, change, play, preview, toggle, subscribe, getChord, getPlayback, restartMusic };
}

// Use the on-screen motion queue for both human and bot turns. A card lands
// once regardless of how many polling updates arrive during its flight.
export function useTableSounds(view, frame, play) {
  const seen = useRef({ deal: null, cue: null, result: null });
  const dealKey = [view.matchId, view.round, view.self].join("/");
  const cue = frame.cue;
  const playing = frame.active;
  const landed = frame.landed;
  useEffect(() => {
    const s = seen.current;
    if (s.deal === dealKey) return;
    const first = s.deal === null;
    s.deal = dealKey;
    if (first && view.phase === "end") s.result = dealKey;
    if (view.phase !== "end" && view.log.length === 1) play("deal");
  }, [dealKey, view.phase, view.log.length, play]);
  useEffect(() => {
    if (
      !cue ||
      !playing ||
      seen.current.cue === cue.key ||
      (cue.kind === "throw" && !landed)
    )
      return;
    seen.current.cue = cue.key;
    const position =
      (cue.seat - view.self + view.seats.length) % view.seats.length;
    const pan =
      position > 0 && view.seats.length > 2
        ? -0.38 + (0.76 * (position - 1)) / (view.seats.length - 2)
        : 0;
    play(cue.kind, pan);
  }, [cue, playing, landed, play, view.self, view.seats.length]);
  useEffect(() => {
    if (view.phase !== "end" || playing || seen.current.result === dealKey)
      return;
    const timer = setTimeout(() => {
      const r = view.result;
      seen.current.result = dealKey;
      const name =
        r.winner === view.self
          ? "win"
          : r.kind === "blitz" && r.blitz?.includes(view.self)
            ? "blitz"
            : r.paid[view.self]
              ? "lose"
              : "safe";
      play(name);
    }, 45);
    return () => clearTimeout(timer);
  }, [view.phase, view.result, view.self, dealKey, playing, play]);
}
