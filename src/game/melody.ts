/**
 * Turns a piece's seed into a small tune: a scale in its key, a rhythm, and
 * a motif that gets varied. Nothing clever, but every piece sounds like itself.
 */
import type { FormId } from "./economy";
import { mulberry32, pick, type Rng } from "./rng";
import { KEYS, type KeyName, type Mode } from "./titles";

export interface NoteEvent {
  /** Beat offset from the start. */
  at: number;
  /** In beats. */
  dur: number;
  /** MIDI note number. */
  midi: number;
  /** 0..1 */
  vel: number;
}

export interface Melody {
  bpm: number;
  notes: NoteEvent[];
  /** Total length in beats. */
  length: number;
  root: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

const TEMPO_BY_FORM: Record<FormId, number> = {
  bagatelle: 112,
  etude: 132,
  nocturne: 66,
  sonata: 104,
  concerto: 120,
  symphony: 92,
  opera: 84,
};

export function rootMidi(key: KeyName): number {
  const i = KEYS.indexOf(key);
  // Circle-of-fifths order in KEYS; convert to semitones above C.
  const semis = [0, 7, 2, 9, 4, 11, 6, 1, 5, 10, 3, 8];
  return 60 + (semis[i] ?? 0);
}

export function generateMelody(seed: number, key: KeyName, mode: Mode, formId: FormId, bars = 4): Melody {
  const rng: Rng = mulberry32(seed ^ 0xa11ce);
  const scale = mode === "minor" ? MINOR : MAJOR;
  const root = rootMidi(key) - 12; // start an octave below middle C for warmth
  const bpm = TEMPO_BY_FORM[formId];
  const notes: NoteEvent[] = [];

  // A motif: 4–6 scale degrees with small steps, then varied per bar.
  const motifLen = 4 + Math.floor(rng() * 3);
  const motif: number[] = [];
  let deg = 7 + Math.floor(rng() * 3); // around the tonic an octave up
  for (let i = 0; i < motifLen; i++) {
    motif.push(deg);
    const step = pick(rng, [-2, -1, -1, 1, 1, 2, 3, -3]);
    deg = Math.max(2, Math.min(14, deg + step));
  }
  const rhythms: number[][] = [
    [1, 1, 1, 1],
    [1.5, 0.5, 1, 1],
    [1, 0.5, 0.5, 1, 1],
    [2, 1, 1],
    [0.5, 0.5, 1, 0.5, 0.5, 1],
  ];
  let t = 0;
  for (let bar = 0; bar < bars; bar++) {
    const rhythm = pick(rng, rhythms);
    const transpose = bar === bars - 1 ? 0 : pick(rng, [0, 0, 1, -1, 2]);
    let mi = 0;
    for (const dur of rhythm) {
      const degree = motif[mi % motif.length]! + transpose;
      mi++;
      const octave = Math.floor(degree / 7);
      const midi = root + octave * 12 + (scale[((degree % 7) + 7) % 7] ?? 0);
      notes.push({ at: t, dur: dur * 0.9, midi, vel: 0.55 + rng() * 0.3 });
      // A soft bass note on the downbeat.
      if (t % 4 === 0) notes.push({ at: t, dur: 3.5, midi: root - 12 + (scale[transpose >= 0 ? transpose % 7 : 0] ?? 0), vel: 0.32 });
      t += dur;
    }
    t = (bar + 1) * 4; // keep bars aligned
  }
  // Land on the tonic.
  notes.push({ at: t, dur: 3, midi: root + 12, vel: 0.7 });
  notes.push({ at: t, dur: 3, midi: root - 12, vel: 0.35 });
  return { bpm, notes, length: t + 3, root };
}

/** A few notes from the key's pentatonic set, for play-along. */
export function pentatonic(key: KeyName, mode: Mode): number[] {
  const root = rootMidi(key);
  const degrees = mode === "minor" ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  return degrees.map((d) => root + d);
}
