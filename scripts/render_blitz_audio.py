#!/usr/bin/env python3
"""Render the BLITZ card-table instrument and its 20-second backing track.

Run `python scripts/render_blitz_audio.py` to write to public/audio, or use
`--out-dir PATH` to render elsewhere. Requires NumPy, SciPy and ffmpeg.
"""

import argparse
import subprocess
from dataclasses import dataclass, replace
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from scipy import signal
from scipy.io import wavfile


SAMPLE_RATE = 48_000
TAU = 2 * np.pi
SECONDS_PER_BEAT = 0.625
LOOP_FRAMES = round(SAMPLE_RATE * 20.0)
SEED = 403108
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "public" / "audio"


def timeline(seconds):
    return np.arange(round(seconds * SAMPLE_RATE), dtype=float) / SAMPLE_RATE


def stereo_buffer(seconds):
    return np.zeros((round(seconds * SAMPLE_RATE), 2))


def midi_frequency(note):
    return 440 * 2 ** ((note - 69) / 12)


def pan_mono(samples, position):
    angle = (np.clip(position, -1, 1) + 1) * np.pi / 4
    return np.column_stack((samples * np.cos(angle), samples * np.sin(angle)))


def low_pass(samples, cutoff):
    sections = signal.butter(2, cutoff, fs=SAMPLE_RATE, output="sos")
    return signal.sosfilt(sections, samples, axis=0)


def fade_tail(samples, seconds=0.012):
    count = min(round(seconds * SAMPLE_RATE), len(samples))
    shape = (-1,) + (1,) * (samples.ndim - 1)
    samples[-count:] *= np.linspace(1, 0, count).reshape(shape)
    return samples


def mix_at(bus, clip, start, gain=1, pan=0, loop=False):
    """Mix a voice into a stereo buffer, preserving a looping track's tails."""
    if clip.ndim == 1:
        clip = pan_mono(clip, pan)
    clip = gain * clip
    offset = round(start * SAMPLE_RATE)
    if loop:
        offset %= len(bus)
    if offset >= len(bus):
        return
    count = min(len(clip), len(bus) - offset)
    bus[offset : offset + count] += clip[:count]
    if loop and count < len(clip):
        bus[: len(clip) - count] += clip[count:]


@dataclass(frozen=True)
class Patch:
    """Voice envelopes are in seconds, filter cutoffs in Hz, and detune in cents."""

    attack: float
    gate: float
    release: float
    sustain: float
    envelope_decay: float
    cutoff_start: float
    cutoff_end: float
    filter_decay: float
    resonance: float
    pulse_width: float
    detune: float = 2.1
    vibrato: float = 0.40
    partials: int = 14


# Each row specifies the amplitude envelope, filter envelope and oscillator mix.
VELVET = Patch(0.006, 0.153, 0.053, 0.67, 0.076, 2270, 640, 0.085, 0.75, 0.29)
LIFT = Patch(0.009, 0.185, 0.050, 0.75, 0.085, 730, 2390, 0.056, 0.88, 0.36, 3.1)
SLAP = Patch(0.0018, 0.052, 0.026, 0.33, 0.023, 3120, 370, 0.025, 1.04, 0.49, 1.2)
KNUCKLE = Patch(0.0018, 0.066, 0.043, 0.36, 0.038, 2650, 465, 0.040, 1.18, 0.44, 1.0)
SILK = Patch(0.010, 0.17, 0.070, 0.67, 0.12, 1750, 670, 0.14, 0.44, 0.26, 3.3)
BRASS = Patch(0.005, 0.23, 0.070, 0.68, 0.065, 3390, 1150, 0.135, 0.87, 0.38, 2.9)
BLOOM = Patch(0.011, 0.50, 0.100, 0.70, 0.21, 1670, 2750, 0.13, 0.69, 0.31, 3.8)
DARK = Patch(0.010, 0.137, 0.066, 0.57, 0.07, 1320, 440, 0.077, 0.75, 0.42, 1.4)
PAD = Patch(0.080, 1.0, 0.15, 0.70, 0.40, 680, 1540, 0.45, 0.24, 0.22, 4.5, 0.65, partials=10)
DUB = Patch(0.009, 0.185, 0.065, 0.55, 0.10, 2020, 630, 0.11, 0.85, 0.41, 2.5, partials=11)


def render_chord(notes, patch, rng, length=None, spread=0.35, pan_bias=0.0):
    """Play all MIDI notes together using a filtered saw/pulse oscillator pair."""
    seconds = length if length is not None else patch.gate + 4.5 * patch.release
    time = timeline(seconds)
    mix = np.zeros((len(time), 2))
    envelope = (1 - np.exp(-time / patch.attack)) * (
        patch.sustain + (1 - patch.sustain) * np.exp(-time / patch.envelope_decay)
    )
    envelope *= np.exp(-np.maximum(0, time - patch.gate) / patch.release)

    for voice_index, note in enumerate(notes):
        frequency = midi_frequency(note)
        phase = rng.uniform(0.03, 0.96)
        drift = rng.uniform(-0.50, 0.50)
        vibrato = patch.vibrato * (
            np.sin(TAU * (0.55 + 0.04 * voice_index) * time + phase * 3) - np.sin(phase * 3)
        )
        saw_phase = TAU * (frequency * time + phase + vibrato * frequency * 0.00030)
        pulse_phase = TAU * (
            frequency * (2 ** ((patch.detune + drift) / 1200)) * time + phase + 0.115
            - 0.00022 * frequency * np.sin(TAU * 0.56 * time + phase)
        )
        cutoff = patch.cutoff_end + (patch.cutoff_start - patch.cutoff_end) * np.exp(
            -time / patch.filter_decay
        )
        cutoff *= 2 ** ((note - 60) * 0.009)
        voice = np.zeros_like(time)
        width = patch.pulse_width + 0.03 * np.sin(TAU * 0.73 * time + 0.76 * voice_index)
        last_partial = min(patch.partials, int(17000 / frequency))

        # Apply the moving filter to each harmonic before summing the oscillators.
        for harmonic in range(1, last_partial + 1):
            ratio = (frequency * harmonic) / cutoff
            lowpass = 1 / np.sqrt(1 + ratio**6)
            resonance = 1 + patch.resonance * np.exp(
                -0.5 * (np.log2(np.maximum(ratio, 0.0001)) / 0.34) ** 2
            )
            triangle = (
                0.30 * (-1) ** ((harmonic - 1) // 2) / (harmonic * harmonic)
                if harmonic % 2 else 0
            )
            saw = (0.54 / harmonic + triangle) * np.sin(harmonic * saw_phase)
            pulse = (
                0.47 * np.sin(np.pi * harmonic * width) / harmonic
                * np.cos(harmonic * pulse_phase - np.pi * harmonic * width)
            )
            voice += (saw + pulse) * lowpass * resonance

        # Keep fundamentals present when the part is summed to a phone speaker.
        voice += 0.24 * np.sin(saw_phase)
        pan = pan_bias + spread * ((voice_index * 2 / max(len(notes) - 1, 1)) - 1)
        voice_gain = 0.83 if voice_index == 0 else 1
        mix += pan_mono(voice * envelope * voice_gain, pan)

    mix /= max(1, np.sqrt(len(notes))) * 0.96
    return fade_tail(np.tanh(mix * 1.12) / 1.12)


def chorus(samples, amount, depth=0.002):
    frames = np.arange(len(samples))
    time = frames / SAMPLE_RATE
    result = samples.copy()
    for channel in range(2):
        delay_frames = (
            0.013 + 0.0025 * channel
            + depth * np.sin(TAU * (0.61 + 0.12 * channel) * time + channel * 1.9)
        ) * SAMPLE_RATE
        wet = np.interp(frames - delay_frames, frames, samples[:, channel], left=0, right=0)
        result[:, channel] = (samples[:, channel] + amount * wet) / (1 + amount * 0.45)
    return result


def stereo_delay(samples, taps, loop=False):
    """Tap settings are delay seconds, linear gain, and low-pass cutoff."""
    result = samples.copy()
    for index, (seconds, gain, cutoff) in enumerate(taps):
        source = samples[:, ::-1] if index % 2 == 0 else samples
        filtered = low_pass(source, cutoff)
        frames = round(seconds * SAMPLE_RATE)
        if loop:
            result += gain * np.roll(filtered, frames, axis=0)
        elif frames < len(samples):
            result[frames:] += gain * filtered[:-frames]
    return result


def room(samples, amount, seconds=0.25):
    """Add a repeatable stereo room with three reflections and a diffuse tail."""
    result = samples.copy()
    time = timeline(seconds)
    for channel in range(2):
        room_rng = np.random.default_rng(7701 + channel)
        impulse = low_pass(room_rng.normal(0, 1, len(time)), 3800) * np.exp(
            -time / (seconds * 0.24)
        )
        impulse[: round(0.012 * SAMPLE_RATE)] = 0
        impulse /= np.sqrt(np.sum(impulse**2)) + 1e-10
        reflections = [(0.016 + 0.002 * channel, 0.35), (0.029 - 0.002 * channel, 0.26),
                       (0.041 + 0.002 * channel, 0.21)]
        for delay, gain in reflections:
            impulse[round(delay * SAMPLE_RATE)] += gain
        send = 0.78 * samples[:, channel] + 0.22 * samples[:, 1 - channel]
        result[:, channel] += amount * signal.fftconvolve(send, impulse)[: len(samples)]
    return result


def pitched_impact(note, duration=0.1, gain=0.16):
    time = timeline(duration)
    phase = TAU * (midi_frequency(note) * time + 0.23 * (1 - np.exp(-time / 0.011)))
    voice = (np.sin(phase) + 0.33 * np.sin(2 * phase) + 0.08 * np.sin(4 * phase)) * (
        1 - np.exp(-time / 0.0018)
    ) * np.exp(-time / 0.027)
    return fade_tail(voice * gain)


def noise_grain(rng, duration, low_hz, high_hz, decay):
    time = timeline(duration)
    sections = signal.butter(2, [low_hz, high_hz], fs=SAMPLE_RATE, btype="bandpass", output="sos")
    noise = signal.sosfilt(sections, rng.normal(size=len(time)), axis=0)
    noise /= np.sqrt(np.mean(noise * noise))
    return fade_tail(noise * (1 - np.exp(-time / 0.0011)) * np.exp(-time / decay))


def render_cues(rng):
    """Return cue name, stereo audio and target peak dBFS in score order."""
    cues = {}

    def chord(bus, start, notes, patch, gain=1, spread=0.35, pan=0):
        clip = render_chord(notes, patch, rng, spread=spread, pan_bias=pan)
        mix_at(bus, clip, start, gain)

    # Stock slides down a D suspension and leaves two quiet panned reflections.
    bus = stereo_buffer(0.405)
    chord(bus, 0.002, [50, 57, 62, 64, 67], VELVET, 0.95, 0.25, -0.10)
    mix_at(bus, noise_grain(rng, 0.07, 330, 2040, 0.014), 0.003, 0.035)
    bus = stereo_delay(chorus(bus, 0.23), [(0.067, 0.15, 2000), (0.109, 0.08, 1350)])
    cues["stock"] = room(bus, 0.08, 0.17), -8.0

    # Take opens the filter on Dmaj9 and widens the stereo ensemble.
    bus = stereo_buffer(0.473)
    chord(bus, 0.002, [50, 57, 61, 64, 66], LIFT, 1, 0.46, 0.07)
    bus = stereo_delay(chorus(bus, 0.35, 0.0026), [(0.081, 0.21, 2380), (0.149, 0.095, 1800)])
    cues["take"] = room(bus, 0.14, 0.27), -7.3

    # Throw is a dry D9 stab with a short low impact on card contact.
    bus = stereo_buffer(0.215)
    chord(bus, 0, [50, 57, 60, 64, 66], SLAP, 1, 0.17)
    mix_at(bus, pitched_impact(45, 0.12, 0.36), 0)
    mix_at(bus, noise_grain(rng, 0.047, 580, 2120, 0.0052), 0.001, 0.085)
    cues["throw"] = room(bus, 0.045, 0.09), -5.9

    # Knock voices three altered D strikes with seconds and tritones.
    bus = stereo_buffer(0.821)
    strikes = [
        (0.004, [50, 56, 60, 62, 63], KNUCKLE, 0.83, -0.17),
        (0.196, [50, 56, 60, 65, 66], replace(KNUCKLE, gate=0.054, cutoff_start=2140), 0.71, 0.20),
        (0.419, [50, 57, 60, 62, 63, 66],
         replace(KNUCKLE, gate=0.095, release=0.058, cutoff_start=2940), 1, 0.01),
    ]
    for start, notes, patch, gain, pan in strikes:
        chord(bus, start, notes, patch, gain, 0.19, pan)
        mix_at(bus, pitched_impact(43, 0.13, 0.30), start, gain)
    cues["knock"] = room(stereo_delay(bus, [(0.058, 0.095, 1130)]), 0.105, 0.20), -4.9

    # Deal fans three chord shapes across the stereo field as the filter opens.
    bus = stereo_buffer(0.538)
    fan = [
        (0, [50, 57, 59, 64], 0, -0.22, 0.77),
        (0.112, [50, 55, 59, 64], 1, 0, 0.65),
        (0.237, [50, 57, 62, 64, 67], 2, 0.20, 0.89),
    ]
    for start, notes, step, pan, gain in fan:
        patch = replace(VELVET, attack=0.005, gate=0.044 + 0.014 * step, release=0.033,
                        cutoff_start=1350 + 440 * step, cutoff_end=610 + 70 * step)
        chord(bus, start, notes, patch, gain, 0.33, pan)
    cues["deal"] = room(stereo_delay(chorus(bus, 0.23), [(0.083, 0.16, 2050)]), 0.10, 0.18), -8.4

    # Blitz resolves A7 flat-nine into a wide D6/9 after 171 milliseconds.
    bus = stereo_buffer(1.32)
    chord(bus, 0, [45, 55, 57, 58, 61, 64], replace(BRASS, gate=0.095, release=0.037), 0.82, 0.24, -0.09)
    chord(bus, 0.171, [50, 57, 59, 62, 64, 66, 69], replace(BLOOM, gate=0.44), 1, 0.58, 0.03)
    mix_at(bus, pitched_impact(38, 0.18, 0.45), 0.172)
    bus = stereo_delay(chorus(bus, 0.26), [(0.121, 0.17, 3100), (0.246, 0.095, 2280)])
    cues["blitz"] = room(bus, 0.195, 0.42), -4.6

    # Match victory takes a longer cadence through Gmaj9/D and A7 flat-nine.
    bus = stereo_buffer(1.91)
    chord(bus, 0.001, [50, 55, 59, 62, 66, 69], replace(SILK, gate=0.193), 0.70, 0.40, -0.09)
    chord(bus, 0.310, [45, 52, 55, 57, 58, 61], replace(BRASS, gate=0.168), 0.74, 0.35, 0.09)
    chord(bus, 0.610, [50, 57, 59, 62, 64, 66, 74],
          replace(BLOOM, gate=0.63, release=0.13), 1, 0.57, 0.01)
    bus = stereo_delay(chorus(bus, 0.31), [(0.143, 0.16, 2800), (0.286, 0.085, 1980)])
    cues["win"] = room(bus, 0.19, 0.43), -4.5

    # Safe releases the suspension into Dmaj9.
    bus = stereo_buffer(0.534)
    chord(bus, 0.001, [50, 57, 62, 64, 67], replace(SILK, gate=0.083, release=0.033), 0.76, 0.30)
    chord(bus, 0.142, [50, 57, 61, 64, 66], replace(SILK, gate=0.102, release=0.048), 0.92, 0.37)
    cues["safe"] = room(chorus(bus, 0.19), 0.105, 0.20), -8.7

    # Lose closes the filter as E and F fall into a lower Dm9.
    bus = stereo_buffer(0.545)
    chord(bus, 0.001, [50, 57, 62, 64, 65], replace(DARK, gate=0.080, release=0.049), 0.88, 0.19, 0.08)
    chord(bus, 0.167, [50, 53, 57, 60, 64], replace(DARK, gate=0.105, cutoff_end=345), 0.71, 0.28, -0.06)
    cues["lose"] = room(stereo_delay(bus, [(0.081, 0.095, 1420)]), 0.12, 0.19), -8.3

    # UI confirmation is a single soft D6 with A in the bass.
    bus = stereo_buffer(0.147)
    chord(bus, 0.001, [57, 59, 62, 66],
          replace(SLAP, gate=0.032, release=0.017, cutoff_start=1600, cutoff_end=615), 1, 0.14)
    cues["ui"] = bus, -12.8
    return cues


def bass_note(note, duration, bend=0):
    time = timeline(duration + 0.12)
    frequency = midi_frequency(note)
    phase = TAU * (
        frequency * time + frequency * (2 ** (bend / 12) - 1) * 0.028 * (1 - np.exp(-time / 0.028))
    )
    tone = (
        np.sin(phase) + 0.41 * np.sin(2 * phase + 0.09)
        + 0.22 * np.sin(3 * phase + 0.15) * np.exp(-time / 0.23)
    )
    envelope = (
        (1 - np.exp(-time / 0.006)) * (0.78 + 0.22 * np.exp(-time / 0.13))
        * np.exp(-np.maximum(0, time - duration) / 0.030)
    )
    return fade_tail(np.tanh(1.1 * tone) * envelope)


def kick():
    time = timeline(0.30)
    phase = TAU * (51.8 * time + 88 * 0.032 * (1 - np.exp(-time / 0.032)))
    return fade_tail(
        (np.sin(phase) + 0.19 * np.sin(2 * phase) * np.exp(-time / 0.035))
        * (1 - np.exp(-time / 0.002)) * np.exp(-time / 0.074)
    )


def rim(rng, ghost=False):
    time = timeline(0.165)
    body = (np.sin(TAU * 191 * time) + 0.35 * np.sin(TAU * 360 * time)) * np.exp(-time / 0.024)
    body *= 1 - np.exp(-time / 0.0016)
    grain = noise_grain(rng, 0.165, 510, 3650, 0.027)
    return fade_tail(0.36 * body + grain * (0.22 if ghost else 0.39))


def hi_hat(rng, open_hat=False):
    duration = 0.14 if open_hat else 0.078
    return noise_grain(rng, duration, 2350, 6650, 0.032 if open_hat else 0.011)


# Notes are MIDI pitches. Each accented keyboard event is (beat, gate in beats, gain).
CHORDS = [
    [50, 57, 59, 64, 66], [50, 55, 59, 62, 69], [47, 54, 57, 61, 64], [45, 52, 55, 59, 62],
    [54, 57, 61, 64, 69], [52, 55, 59, 62, 66], [43, 50, 57, 59, 64], [45, 52, 55, 59, 62],
]
BASS_ROOTS = [38, 38, 35, 33, 42, 40, 43, 33]
CHORD_RHYTHMS = [
    [(0.05, 0.20, 0.77), (1.58, 0.12, 0.51), (2.72, 0.31, 0.79)],
    [(0.56, 0.18, 0.69), (2.04, 0.32, 0.83), (3.58, 0.10, 0.42)],
    [(0.06, 0.22, 0.82), (1.80, 0.11, 0.47), (2.61, 0.22, 0.68)],
    [(0.55, 0.23, 0.70), (2.28, 0.29, 0.72)],
    [(0.04, 0.24, 0.81), (1.57, 0.13, 0.55), (2.73, 0.32, 0.86)],
    [(0.56, 0.20, 0.76), (2.02, 0.31, 0.81), (3.57, 0.13, 0.46)],
    [(0.06, 0.20, 0.74), (1.79, 0.12, 0.48), (2.61, 0.24, 0.73)],
    [(0.55, 0.23, 0.76), (2.52, 0.25, 0.73)],
]
# Beat, semitone offset, duration in beats, gain, initial pitch bend.
BASS_RHYTHM = [
    (0, 0, 0.68, 1, 0), (1.04, 0, 0.29, 0.65, 0), (1.77, 7, 0.17, 0.58, -2),
    (2.27, 0, 0.48, 0.90, 0), (3.19, 12, 0.19, 0.54, 0),
]


def render_music(rng):
    """Render eight bars of dub comping, with the melody in the highest chord voice."""
    drums = np.zeros((LOOP_FRAMES, 2))
    bass = drums.copy()
    pads = drums.copy()
    accents = drums.copy()
    for bar, notes in enumerate(CHORDS):
        def play(bus, clip, beat, gain, pan=0, late=0):
            start = (4 * bar + beat) * SECONDS_PER_BEAT + late
            mix_at(bus, clip, start, gain, pan, loop=True)

        pad = replace(PAD, gate=3.7 * SECONDS_PER_BEAT)
        play(pads, render_chord(notes[1:], pad, rng, length=4 * SECONDS_PER_BEAT + 0.24,
                                spread=0.47), 0, 0.245)
        for index, (beat, duration, gain) in enumerate(CHORD_RHYTHMS[bar]):
            harmony = notes if bar != 7 or index == 0 else [45, 52, 55, 57, 58, 61]
            patch = replace(DUB, gate=duration * SECONDS_PER_BEAT,
                            cutoff_start=1790 + 350 * np.sin(bar + index * 0.83))
            voice = render_chord(harmony, patch, rng, spread=0.40, pan_bias=0.075 * (-1) ** index)
            play(accents, voice, beat, gain * 0.40)

        for beat, offset, length, gain, glide in BASS_RHYTHM:
            voice = bass_note(BASS_ROOTS[bar] + offset, length * SECONDS_PER_BEAT, glide)
            play(bass, voice, beat, 0.43 * gain)
        if bar in (1, 3, 7):
            next_root = BASS_ROOTS[(bar + 1) % 8]
            play(bass, bass_note(next_root, 0.17 * SECONDS_PER_BEAT, -1.4), 3.78, 0.22)

        kick_beats = [(0, 1), (1.76, 0.59), (2.45, 0.79)]
        if bar in (2, 5, 7):
            kick_beats.append((3.50, 0.47))
        for beat, gain in kick_beats:
            play(drums, kick(), beat, 0.47 * gain)
        for beat, gain in [(1, 0.69), (3, 0.88)]:
            play(drums, rim(rng), beat, 0.31 * gain, 0.07, 0.011)
        if bar in (1, 4, 6, 7):
            play(drums, rim(rng, ghost=True), 2.80, 0.095, -0.24, 0.014)
        for eighth in range(8):
            beat = eighth * 0.5 + (0.045 if eighth % 2 else 0)
            if eighth != 4 or bar % 2 == 0:
                voice = hi_hat(rng, open_hat=eighth == 7 and bar % 2 == 1)
                play(drums, voice, beat, 0.063 if eighth % 2 else 0.038, 0.18 * (-1) ** eighth)

    echoes = [(SECONDS_PER_BEAT * 0.75, 0.23, 2200), (SECONDS_PER_BEAT * 1.5, 0.115, 1450),
              (SECONDS_PER_BEAT * 2.25, 0.04, 1000)]
    accents = stereo_delay(accents, echoes, loop=True)
    room_send = accents * 0.7 + pads
    reflections = [(0.026, 0.073), (0.047, 0.062), (0.079, 0.055), (0.119, 0.037), (0.196, 0.028)]
    for index, (seconds, gain) in enumerate(reflections):
        reflected = room_send[:, ::-1] if index % 2 else room_send
        accents += gain * np.roll(reflected, round(seconds * SAMPLE_RATE), axis=0)

    # Periodic EQ and beat ducking keep playback continuous at the loop boundary.
    beat_phase = np.arange(LOOP_FRAMES) / SAMPLE_RATE % SECONDS_PER_BEAT
    duck = (1 - 0.055 * np.exp(-beat_phase / 0.090))[:, None]
    mix = drums + bass + (pads + accents) * duck
    hz = np.fft.rfftfreq(LOOP_FRAMES, 1 / SAMPLE_RATE)
    eq = (1 - np.exp(-(hz / 28) ** 4)) / np.sqrt(1 + (hz / 7850) ** 6)
    eq *= 1 - 0.15 / (1 + (hz / 145) ** 4)
    mix = np.fft.irfft(np.fft.rfft(mix, axis=0) * eq[:, None], n=LOOP_FRAMES, axis=0)
    return np.tanh(1.10 * mix) / 1.10


def write_pcm(path, samples, peak_dbfs, loop=False):
    """Write normalized stereo PCM. Trim only one-shots to protect the music seam."""
    if not loop:
        silence = np.max(np.abs(samples)) * 10 ** (-53 / 20)
        active = np.flatnonzero(np.max(np.abs(samples), axis=1) > silence)
        if len(active):
            end = min(len(samples), active[-1] + round(0.010 * SAMPLE_RATE) + 1)
            samples = samples[:end].copy()
        attack = round(0.00075 * SAMPLE_RATE)
        samples[:attack] *= np.linspace(0, 1, attack)[:, None]
        fade_tail(samples, 0.011)
    samples -= np.mean(samples, axis=0)
    if not loop:
        fade_tail(samples, 0.0045)
    samples *= 10 ** (peak_dbfs / 20) / np.max(np.abs(samples))
    wavfile.write(path, SAMPLE_RATE, np.rint(samples * 32767).astype(np.int16))


def render_assets(out_dir):
    """Use one seeded oscillator/noise sequence to reproduce the approved mix."""
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    for name, (samples, peak_dbfs) in render_cues(rng).items():
        write_pcm(out_dir / f"{name}.wav", samples, peak_dbfs)

    metadata = [
        "-fflags", "+bitexact", "-flags:a", "+bitexact",
        "-metadata", "title=Afterimage at Table 31", "-metadata", "artist=Neko Arcade",
        "-metadata", "LOOPSTART=0", "-metadata", f"LOOPEND={LOOP_FRAMES}",
    ]
    encoders = {
        "ogg": ["-c:a", "libvorbis", "-q:a", "5"],
        "mp3": ["-c:a", "libmp3lame", "-q:a", "3", "-write_xing", "1"],
    }
    with TemporaryDirectory(prefix="blitz-audio-") as temp_dir:
        master = Path(temp_dir) / "night-arcade.wav"
        write_pcm(master, render_music(rng), -7.4, loop=True)
        for extension, encoder in encoders.items():
            target = out_dir / f"night-arcade.{extension}"
            command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(master),
                       *metadata, *encoder, str(target)]
            subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUTPUT,
                        help="Output directory (default: the project's public/audio)")
    args = parser.parse_args()
    render_assets(args.out_dir)


if __name__ == "__main__":
    main()
