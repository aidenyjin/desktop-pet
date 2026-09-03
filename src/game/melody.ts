/**
 * Turns a piece's seed into a short piano piece.
 *
 * The shape is deliberately old-fashioned, because old-fashioned is what makes
 * a random seed sound like music: a diatonic chord progression underneath, a
 * left hand that voice-leads through it, and a right hand that lands on chord
 * tones at the strong beats and steps between them at the weak ones. A motif
 * (a rhythm plus a contour) is reused across bars so the piece sounds like
 * itself, and every phrase ends on a real cadence.
 */
import type { FormId } from "./economy";
import { mulberry32, pick, randInt, type Rng } from "./rng";
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
const BEATS_PER_BAR = 4;

/** Lowest and highest diatonic degree the right hand is allowed to wander to. */
const MELODY_LOW = 7;
const MELODY_HIGH = 17;

type Accompaniment = "block" | "bass-chord" | "alberti" | "arpeggio" | "sustain";

interface FormShape {
  bpm: number;
  /** Bars of music, before the closing chord. */
  bars: number;
  accompaniments: readonly Accompaniment[];
}

const FORM_SHAPE: Record<FormId, FormShape> = {
  bagatelle: { bpm: 112, bars: 8, accompaniments: ["block", "bass-chord"] },
  etude: { bpm: 132, bars: 8, accompaniments: ["alberti", "arpeggio"] },
  nocturne: { bpm: 66, bars: 8, accompaniments: ["arpeggio", "sustain"] },
  sonata: { bpm: 104, bars: 12, accompaniments: ["alberti", "bass-chord", "block"] },
  concerto: { bpm: 120, bars: 12, accompaniments: ["arpeggio", "block", "alberti"] },
  symphony: { bpm: 92, bars: 16, accompaniments: ["block", "sustain", "bass-chord"] },
  opera: { bpm: 84, bars: 16, accompaniments: ["sustain", "arpeggio", "block"] },
};

/**
 * Four-bar progressions, as diatonic chord degrees (0 = tonic). Each ends on a
 * chord that can be followed by the tonic, so any two can be chained.
 */
const PROGRESSIONS_MAJOR: ReadonlyArray<readonly number[]> = [
  [0, 3, 4, 0],
  [0, 5, 3, 4],
  [0, 4, 5, 3],
  [0, 3, 1, 4],
  [5, 3, 0, 4],
  [0, 2, 3, 4],
];
const PROGRESSIONS_MINOR: ReadonlyArray<readonly number[]> = [
  [0, 5, 2, 6],
  [0, 3, 4, 0],
  [0, 6, 5, 4],
  [0, 2, 5, 3],
  [0, 5, 3, 4],
];

/** Bar rhythms, in beats, each summing to a bar. */
const RHYTHMS: ReadonlyArray<readonly number[]> = [
  [1, 1, 1, 1],
  [1.5, 0.5, 1, 1],
  [1, 0.5, 0.5, 1, 1],
  [2, 1, 1],
  [0.5, 0.5, 1, 0.5, 0.5, 1],
  [1, 1, 0.5, 0.5, 1],
  [1.5, 0.5, 2],
];
/** Endings: longer notes, so a cadence has somewhere to settle. */
const CADENCE_RHYTHMS: ReadonlyArray<readonly number[]> = [[4], [2, 2], [3, 1], [2, 1, 1]];

const mod7 = (n: number) => ((n % 7) + 7) % 7;

export function rootMidi(key: KeyName): number {
  const i = KEYS.indexOf(key);
  // Circle-of-fifths order in KEYS; convert to semitones above C.
  const semis = [0, 7, 2, 9, 4, 11, 6, 1, 5, 10, 3, 8];
  return 60 + (semis[i] ?? 0);
}

/**
 * Harmonic-minor borrowing: the chords that want to pull back to the tonic get
 * a raised seventh, which is most of the difference between "a minor key" and
 * "notes that happen to be minor".
 */
function alteration(mode: Mode, chordDeg: number, degree: number): number {
  if (mode === "minor" && (chordDeg === 4 || chordDeg === 6) && mod7(degree) === 6) return 1;
  return 0;
}

function pitchAt(root: number, scale: readonly number[], degree: number, alter = 0): number {
  const octave = Math.floor(degree / 7);
  return root + octave * 12 + (scale[mod7(degree)] ?? 0) + alter;
}

/** The three diatonic degrees of the triad on `chordDeg`, as an octave-free set. */
function triadDegrees(chordDeg: number): number[] {
  return [chordDeg, chordDeg + 2, chordDeg + 4];
}

function isChordTone(chordDeg: number, degree: number): boolean {
  return triadDegrees(chordDeg).some((d) => mod7(d) === mod7(degree));
}

/**
 * Walks in `dir` from `from` until it reaches a chord tone, so the melody keeps
 * the motif's shape but still lands on the harmony.
 */
function nextChordTone(chordDeg: number, from: number, dir: number): number {
  let d = from;
  for (let i = 0; i < 7; i++) {
    d += dir;
    if (d < MELODY_LOW || d > MELODY_HIGH) {
      dir = -dir;
      d = from;
      continue;
    }
    if (isChordTone(chordDeg, d)) return d;
  }
  return from;
}

/** Picks the voicing of `chordDeg` whose top note sits closest to `near`. */
function voicing(root: number, scale: readonly number[], mode: Mode, chordDeg: number, near: number): number[] {
  let best: number[] = [];
  let bestDist = Infinity;
  for (let inv = 0; inv < 3; inv++) {
    const degrees = triadDegrees(chordDeg).map((d, i) => (i < inv ? d + 7 : d));
    const pitches = degrees.map((d) => pitchAt(root, scale, d, alteration(mode, chordDeg, d))).sort((a, b) => a - b);
    const dist = Math.abs((pitches[pitches.length - 1] ?? 0) - near);
    if (dist < bestDist) {
      bestDist = dist;
      best = pitches;
    }
  }
  return best;
}

function accompany(
  outNotes: NoteEvent[],
  pattern: Accompaniment,
  barStart: number,
  bass: number,
  chord: number[],
  vel: number,
): void {
  const low = clampMidi(bass);
  const out = { push: (n: NoteEvent) => outNotes.push({ ...n, midi: clampMidi(n.midi) }) };
  switch (pattern) {
    case "block":
      out.push({ at: barStart, dur: 3.6, midi: low, vel: vel * 0.85 });
      for (const p of chord) out.push({ at: barStart, dur: 3.4, midi: p, vel: vel * 0.55 });
      break;
    case "sustain":
      out.push({ at: barStart, dur: 3.8, midi: low, vel: vel * 0.8 });
      for (const p of chord) out.push({ at: barStart, dur: 3.8, midi: p, vel: vel * 0.4 });
      break;
    case "bass-chord":
      out.push({ at: barStart, dur: 0.9, midi: low, vel: vel * 0.85 });
      out.push({ at: barStart + 2, dur: 0.9, midi: low + 7, vel: vel * 0.6 });
      for (const p of chord) {
        out.push({ at: barStart + 1, dur: 0.8, midi: p, vel: vel * 0.45 });
        out.push({ at: barStart + 3, dur: 0.8, midi: p, vel: vel * 0.4 });
      }
      break;
    case "alberti": {
      // low – high – middle – high, the standard classical filigree.
      const [a, b, c] = [chord[0] ?? low, chord[1] ?? low, chord[2] ?? low];
      const order = [a, c, b, c, a, c, b, c];
      out.push({ at: barStart, dur: 3.6, midi: low, vel: vel * 0.7 });
      order.forEach((p, i) => out.push({ at: barStart + i * 0.5, dur: 0.45, midi: p, vel: vel * (i % 4 === 0 ? 0.42 : 0.32) }));
      break;
    }
    case "arpeggio": {
      const up = [...chord, (chord[0] ?? low) + 12];
      const shape = [...up, ...up.slice(0, -1).reverse()];
      out.push({ at: barStart, dur: 3.8, midi: low, vel: vel * 0.75 });
      shape.forEach((p, i) => out.push({ at: barStart + i * 0.5, dur: 0.55, midi: p, vel: vel * (i === 0 ? 0.45 : 0.3) }));
      break;
    }
  }
}

export function generateMelody(seed: number, key: KeyName, mode: Mode, formId: FormId, bars?: number): Melody {
  const rng: Rng = mulberry32(seed ^ 0xa11ce);
  const scale = mode === "minor" ? MINOR : MAJOR;
  const root = rootMidi(key) - 12; // an octave below middle C, so the bass has room
  const shape = FORM_SHAPE[formId];
  const bpm = shape.bpm;
  const totalBars = Math.max(4, bars ?? shape.bars);
  const pattern = pick(rng, shape.accompaniments);

  // Harmony: chain four-bar progressions, always closing on the dominant so the
  // final tonic chord arrives as a cadence.
  const table = mode === "minor" ? PROGRESSIONS_MINOR : PROGRESSIONS_MAJOR;
  const chords: number[] = [];
  while (chords.length < totalBars) chords.push(...pick(rng, table));
  chords.length = totalBars;
  chords[0] = 0;
  chords[totalBars - 1] = 4; // half cadence into the closing tonic

  // Motif: one rhythm and one contour, reused and varied.
  const motifRhythm = pick(rng, RHYTHMS);
  const altRhythm = pick(rng, RHYTHMS);
  const contour: number[] = [];
  for (let i = 0; i < 6; i++) contour.push(pick(rng, [1, 1, 1, -1, -1, 2, -2]));

  const notes: NoteEvent[] = [];
  let deg = randInt(rng, 9, 12);
  let contourAt = 0;
  let lastTop = pitchAt(root, scale, deg);

  for (let bar = 0; bar < totalBars; bar++) {
    const chordDeg = chords[bar] ?? 0;
    const barStart = bar * BEATS_PER_BAR;
    const phrasePos = bar % 4;
    const closing = bar === totalBars - 1;
    // Loudest in the middle of each phrase, softest as it settles.
    const arc = 0.5 + 0.16 * Math.sin((Math.PI * (bar + 0.5)) / totalBars) + (phrasePos === 3 ? -0.06 : 0.04);

    const chordPitches = voicing(root, scale, mode, chordDeg, lastTop - 12);
    lastTop = chordPitches[chordPitches.length - 1] ?? lastTop;
    accompany(notes, pattern, barStart, pitchAt(root, scale, chordDeg) - 12, chordPitches, arc);

    const rhythm = closing || phrasePos === 3 ? pick(rng, CADENCE_RHYTHMS) : rng() < 0.28 ? altRhythm : motifRhythm;
    let t = 0;
    for (const dur of rhythm) {
      const strong = t === 0 || t === 2;
      if (strong) {
        let dir = Math.sign(contour[contourAt % contour.length] ?? 1);
        contourAt++;
        if (deg <= MELODY_LOW + 1) dir = 1;
        if (deg >= MELODY_HIGH - 1) dir = -1;
        deg = nextChordTone(chordDeg, deg, dir);
      } else {
        // Passing or neighbour tone: a single step, kept in range.
        const dir = deg >= MELODY_HIGH ? -1 : deg <= MELODY_LOW ? 1 : Math.sign(contour[contourAt % contour.length] ?? 1);
        deg = deg + dir;
      }
      // Approach the last chord by its leading tone, wherever the line had got to.
      if (closing && t + dur >= BEATS_PER_BAR) deg = mod7(deg) === 6 ? deg : nextChordTone(chordDeg, deg, deg > 12 ? -1 : 1);
      const midi = pitchAt(root, scale, deg, alteration(mode, chordDeg, deg)) + 12;
      const vel = Math.min(0.95, arc + (strong ? 0.22 : 0.12) + rng() * 0.06);
      notes.push({ at: barStart + t, dur: Math.max(0.2, dur * 0.92), midi: clampMidi(midi), vel });
      t += dur;
    }
  }

  // The closing tonic chord, struck and let ring.
  const end = totalBars * BEATS_PER_BAR;
  const finalTriad = voicing(root, scale, mode, 0, lastTop);
  notes.push({ at: end, dur: 4, midi: clampMidi(pitchAt(root, scale, 0) - 12), vel: 0.6 });
  for (const p of finalTriad) notes.push({ at: end, dur: 4, midi: clampMidi(p), vel: 0.45 });
  notes.push({ at: end, dur: 4, midi: clampMidi(pitchAt(root, scale, 0) + 12), vel: 0.62 });

  notes.sort((a, b) => a.at - b.at || a.midi - b.midi);
  return { bpm, notes, length: end + 4, root };
}

function clampMidi(midi: number): number {
  return Math.max(36, Math.min(96, Math.round(midi)));
}

/** A few notes from the key's pentatonic set, for play-along. */
export function pentatonic(key: KeyName, mode: Mode): number[] {
  const root = rootMidi(key);
  const degrees = mode === "minor" ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  return degrees.map((d) => root + d);
}
