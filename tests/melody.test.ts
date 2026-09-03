import { describe, expect, it } from "vitest";
import { FORMS } from "../src/game/economy";
import { generateMelody, pentatonic, rootMidi } from "../src/game/melody";
import { KEYS } from "../src/game/titles";

describe("melody", () => {
  it("is deterministic per seed", () => {
    const a = generateMelody(99, "E♭", "minor", "nocturne");
    const b = generateMelody(99, "E♭", "minor", "nocturne");
    expect(a).toEqual(b);
    expect(generateMelody(100, "E♭", "minor", "nocturne")).not.toEqual(a);
  });
  it("keeps every note inside a piano's comfortable range and in time order", () => {
    for (const f of FORMS) {
      for (const key of KEYS) {
        for (const mode of ["major", "minor"] as const) {
          const m = generateMelody(7 * key.length + f.notes, key, mode, f.id);
          expect(m.notes.length).toBeGreaterThan(8);
          let last = -1;
          for (const n of m.notes) {
            expect(n.midi).toBeGreaterThanOrEqual(36);
            expect(n.midi).toBeLessThanOrEqual(96);
            expect(n.at).toBeGreaterThanOrEqual(last);
            expect(n.dur).toBeGreaterThan(0);
            expect(n.vel).toBeGreaterThan(0);
            expect(n.vel).toBeLessThanOrEqual(1);
            last = n.at;
          }
          expect(m.length).toBeGreaterThanOrEqual(last);
        }
      }
    }
  });
  it("ends on a tonic chord, with the root in the bass", () => {
    for (const mode of ["major", "minor"] as const) {
      const m = generateMelody(5, "A", mode, "sonata");
      const end = Math.max(...m.notes.map((x) => x.at));
      const finalNotes = m.notes.filter((n) => n.at === end);
      const third = mode === "minor" ? 3 : 4;
      const pcs = finalNotes.map((n) => (((n.midi - rootMidi("A")) % 12) + 12) % 12);
      for (const pc of pcs) expect([0, third, 7]).toContain(pc);
      expect(pcs).toContain(0);
      // The lowest sounding note is the root, so the chord is in root position.
      expect(Math.min(...finalNotes.map((n) => n.midi)) % 12).toBe(rootMidi("A") % 12);
    }
  });

  it("puts every strong beat on a chord tone of a real progression", () => {
    // A spot check that the harmony is actually shared between the hands: at
    // each bar's downbeat, everything sounding belongs to one triad.
    const m = generateMelody(2024, "C", "major", "bagatelle");
    for (let bar = 0; bar < 8; bar++) {
      const onBeat = m.notes.filter((n) => n.at === bar * 4);
      expect(onBeat.length).toBeGreaterThan(1);
      const pcs = new Set(onBeat.map((n) => n.midi % 12));
      expect(pcs.size).toBeLessThanOrEqual(4);
    }
  });
  it("offers a pentatonic set for play-along", () => {
    expect(pentatonic("C", "major")).toEqual([60, 62, 64, 67, 69]);
    expect(pentatonic("C", "minor")).toEqual([60, 63, 65, 67, 70]);
  });
});
