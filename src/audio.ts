/**
 * A soft, felt-piano sort of sound from a couple of oscillators. Nothing
 * plays unless the user turned sound on, and the AudioContext is only created
 * on first use so the app never touches the audio system silently.
 */
import type { Melody } from "./game/melody";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private playing: { stop: () => void } | null = null;
  private lastPlayAlongAt = 0;
  private playAlongIndex = 0;
  private _enabled = false;

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(v: boolean): void {
    this._enabled = v;
    if (!v) this.stop();
  }

  private ensure(): AudioContext | null {
    if (!this._enabled) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private tone(midi: number, at: number, dur: number, vel: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, vel * 0.5), at + 0.012);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0005, vel * 0.18), at + Math.min(0.5, dur * 0.4));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.25);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(Math.min(6000, freq * 5), at);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, freq * 1.5), at + dur);
    lp.connect(g);
    g.connect(this.master);
    const partials: Array<[number, number, OscillatorType]> = [
      [1, 1, "triangle"],
      [2, 0.28, "sine"],
      [3, 0.12, "sine"],
      [1.002, 0.35, "sine"],
    ];
    for (const [ratio, amp, type] of partials) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * ratio;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og);
      og.connect(lp);
      o.start(at);
      o.stop(at + dur + 0.3);
    }
  }

  /** Plays a melody; returns false if audio is off or unavailable. */
  play(melody: Melody, onEnd?: () => void): boolean {
    const ctx = this.ensure();
    if (!ctx) return false;
    this.stop();
    const start = ctx.currentTime + 0.05;
    const spb = 60 / melody.bpm;
    for (const n of melody.notes) this.tone(n.midi, start + n.at * spb, n.dur * spb, n.vel);
    const total = (melody.length * spb + 0.6) * 1000;
    const timer = window.setTimeout(() => {
      this.playing = null;
      onEnd?.();
    }, total);
    this.playing = {
      stop: () => {
        window.clearTimeout(timer);
        onEnd?.();
      },
    };
    return true;
  }

  isPlaying(): boolean {
    return this.playing !== null;
  }

  stop(): void {
    if (!this.playing) return;
    const p = this.playing;
    this.playing = null;
    p.stop();
    // Fade the master briefly so stopping mid-phrase does not click.
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(0.0001, t + 0.08);
      this.master.gain.setValueAtTime(0.5, t + 0.1);
    }
  }

  /** A little rising figure when a piece premieres. */
  chime(root: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const seq = [0, 4, 7, 12];
    seq.forEach((semi, i) => this.tone(root + semi, t + i * 0.11, 0.9, 0.55));
    this.tone(root + 16, t + 0.5, 1.6, 0.4);
  }

  /** Soft notes while typing, rate-limited so fast typing stays gentle. */
  playAlong(scale: number[], keys: number): void {
    const ctx = this.ensure();
    if (!ctx || !scale.length) return;
    const now = ctx.currentTime;
    if (now - this.lastPlayAlongAt < 0.11) return;
    this.lastPlayAlongAt = now;
    const step = keys > 2 ? 2 : 1;
    this.playAlongIndex = (this.playAlongIndex + step + Math.floor(Math.random() * 2)) % (scale.length * 2);
    const idx = this.playAlongIndex % scale.length;
    const octave = this.playAlongIndex >= scale.length ? 12 : 0;
    this.tone(scale[idx]! + octave, now, 0.5, 0.3);
  }
}
