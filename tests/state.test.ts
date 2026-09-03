import { describe, expect, it } from "vitest";
import { FORMS, REPAIR_COST, cupboardCapacity, notesPerKey, upgradeCost } from "../src/game/economy";
import {
  abandonPiece,
  applyKeys,
  buyUpgrade,
  canRepair,
  canStart,
  dismissNotice,
  markInboxSeen,
  migrate,
  newGame,
  observeTyping,
  renamePiece,
  repairPiano,
  seededRandom,
  serialize,
  setSettings,
  startPiece,
  unseenCount,
} from "../src/game/state";

const NOW = 1_700_000_000_000;

describe("starting pieces", () => {
  it("only allows unlocked forms and one piece at a time", () => {
    const s = newGame(NOW);
    expect(canStart(s, "bagatelle")).toBe(true);
    expect(canStart(s, "etude")).toBe(false);
    const t = startPiece(s, "bagatelle", NOW, 42);
    expect(t.state.current?.formId).toBe("bagatelle");
    expect(t.state.current?.title).toMatch(/Op\. 1$/);
    expect(t.events[0]?.type).toBe("started");
    expect(canStart(t.state, "bagatelle")).toBe(false);
    expect(startPiece(t.state, "bagatelle", NOW).state).toBe(t.state);
  });
  it("generates the same title from the same seed", () => {
    const a = startPiece(newGame(NOW), "bagatelle", NOW, 7).state.current!;
    const b = startPiece(newGame(NOW), "bagatelle", NOW, 7).state.current!;
    expect(a.title).toBe(b.title);
    expect(a.key).toBe(b.key);
  });
});

describe("typing", () => {
  it("turns keys into notes at the tempo level", () => {
    let s = startPiece(newGame(NOW), "bagatelle", NOW, 1).state;
    s = applyKeys(s, 10, NOW).state;
    expect(s.current?.notes).toBe(10);
    expect(s.keysConsumed).toBe(10);
    s = { ...s, upgrades: { ...s.upgrades, tempo: 5 } }; // Allegro, 120 bpm = 2 notes per key
    s = applyKeys(s, 10, NOW).state;
    expect(s.current?.notes).toBe(30);
    expect(s.lifetimeNotes).toBe(30);
  });
  it("ignores non-positive deltas", () => {
    const s = startPiece(newGame(NOW), "bagatelle", NOW, 1).state;
    expect(applyKeys(s, 0, NOW).state).toBe(s);
    expect(applyKeys(s, -5, NOW).state).toBe(s);
  });
  it("premieres when the target is reached and pays out", () => {
    const rng = seededRandom(3);
    let s = startPiece(newGame(NOW), "bagatelle", NOW, 1).state;
    const t = applyKeys(s, 500, NOW + 1000, rng);
    s = t.state;
    const premiere = t.events.find((e) => e.type === "premiere");
    expect(premiere?.type).toBe("premiere");
    expect(s.current).toBeNull();
    expect(s.repertoire).toHaveLength(1);
    expect(s.money).toBeGreaterThanOrEqual(Math.round(500 * 0.88));
    expect(s.money).toBeLessThanOrEqual(Math.round(500 * 1.18));
    expect(s.renown).toBe(1);
    expect(s.inbox).toHaveLength(1);
    expect(unseenCount(s)).toBe(1);
    expect(s.stats.premieres).toBe(1);
    expect(s.stats.totalEarned).toBe(s.money);
  });
  it("keeps overflow notes in the drawer and applies them to the next piece", () => {
    let s = startPiece(newGame(NOW), "bagatelle", NOW, 1).state;
    s = applyKeys(s, 620, NOW, seededRandom(1)).state;
    expect(s.spareNotes).toBe(120);
    s = startPiece(s, "bagatelle", NOW, 2).state;
    expect(s.current?.notes).toBe(120);
    expect(s.spareNotes).toBe(0);
  });
  it("never auto-completes a piece from the drawer", () => {
    let s = newGame(NOW);
    s = { ...s, spareNotes: 5000 };
    s = startPiece(s, "bagatelle", NOW, 1).state;
    expect(s.current?.notes).toBe(499);
  });
  it("bounds the drawer", () => {
    let s = newGame(NOW);
    s = applyKeys(s, 100_000, NOW).state; // nothing on the stand
    expect(s.spareNotes).toBe(FORMS[0]!.notes);
    expect(s.keysConsumed).toBe(100_000);
  });
});

describe("daily count", () => {
  it("accumulates within a day and rolls over at midnight", () => {
    const day1 = new Date(2026, 5, 10, 14).getTime();
    const day2 = new Date(2026, 5, 11, 9).getTime();
    let s = startPiece(newGame(day1), "bagatelle", day1, 1).state;
    s = applyKeys(s, 30, day1).state;
    s = applyKeys(s, 20, day1 + 3600_000).state;
    expect(s.stats.todayNotes).toBe(50);
    s = applyKeys(s, 5, day2).state;
    expect(s.stats.todayNotes).toBe(5);
    expect(s.stats.today).toBe("2026-06-11");
  });
});

describe("upgrades", () => {
  it("cost money and raise the level", () => {
    let s = { ...newGame(NOW), money: 1000 };
    const cost = upgradeCost("tempo", 1)!;
    s = buyUpgrade(s, "tempo");
    expect(s.upgrades.tempo).toBe(2);
    expect(s.money).toBe(1000 - cost);
    expect(s.stats.spent).toBe(cost);
  });
  it("refuse when broke or maxed", () => {
    const s = newGame(NOW);
    expect(buyUpgrade(s, "artistry")).toBe(s);
    const maxed = { ...s, money: 1e12, upgrades: { ...s.upgrades, ambition: FORMS.length } };
    expect(buyUpgrade(maxed, "ambition")).toBe(maxed);
  });
});

describe("housekeeping", () => {
  it("renames with sanitised titles", () => {
    let s = startPiece(newGame(NOW), "bagatelle", NOW, 1).state;
    s = renamePiece(s, "   Sonata   for   my thesis  ");
    expect(s.current?.title).toBe("Sonata for my thesis");
    expect(renamePiece(s, "   ").current?.title).toBe("Sonata for my thesis");
  });
  it("abandoning keeps half the sketches", () => {
    let s = startPiece(newGame(NOW), "bagatelle", NOW, 1).state;
    s = applyKeys(s, 200, NOW).state;
    s = abandonPiece(s);
    expect(s.current).toBeNull();
    expect(s.spareNotes).toBe(100);
  });
  it("marks and dismisses notices", () => {
    let s = startPiece(newGame(NOW), "bagatelle", NOW, 1).state;
    s = applyKeys(s, 500, NOW, seededRandom(9)).state;
    expect(unseenCount(s)).toBe(1);
    s = markInboxSeen(s);
    expect(unseenCount(s)).toBe(0);
    s = dismissNotice(s, s.inbox[0]!.id);
    expect(s.inbox).toHaveLength(0);
  });
  it("patches settings", () => {
    const s = setSettings(newGame(NOW), { theme: "night" });
    expect(s.settings.theme).toBe("night");
    expect(s.settings.sound).toBe(true);
  });
});

describe("migration", () => {
  it("round-trips a live state", () => {
    let s = startPiece({ ...newGame(NOW), composerName: "Wren", onboarded: true }, "bagatelle", NOW, 5).state;
    s = applyKeys(s, 500, NOW, seededRandom(2)).state;
    s = startPiece(s, "bagatelle", NOW, 6).state;
    const back = migrate(JSON.parse(serialize(s)));
    expect(back).toEqual(s);
  });
  it("rejects garbage and repairs partial documents", () => {
    expect(migrate(null)).toBeNull();
    expect(migrate("nope")).toBeNull();
    const repaired = migrate({ money: -5, upgrades: { tempo: 99 }, current: { formId: "sonata", notes: 1e9 }, repertoire: [{}, { formId: "etude" }] })!;
    expect(repaired.money).toBe(0);
    expect(repaired.upgrades.tempo).toBe(8);
    expect(repaired.current?.notes).toBe(FORMS[3]!.notes);
    expect(repaired.repertoire).toHaveLength(1);
    expect(repaired.repertoire[0]?.title).toMatch(/Op\. 1$/);
    expect(repaired.settings.theme).toBe("auto");
  });
});

describe("spamming, breaking and repair", () => {
  it("pays full value for ordinary typing, even a quick burst", () => {
    let s = startPiece(newGame(NOW), "bagatelle", NOW, 1).state;
    // A quick 5-key burst looks fast in that one instant, but the smoothed
    // rate the engine reports is under the threshold — the whole point of
    // judging spam by a smoothed rate.
    s = { ...s, typing: { ...s.typing, baselineWpm: 72 } };
    const before = s.current!.notes;
    s = applyKeys(s, 5, NOW, Math.random, 6).state;
    expect(s.current!.notes - before).toBeCloseTo(5 * notesPerKey(s.upgrades), 5);
    expect(s.overspeedSeconds).toBe(0);
    expect(s.pianoBroken).toBe(false);
  });

  it("pays less per key while mashing, and full value again once you slow down", () => {
    const base = { ...startPiece(newGame(NOW), "bagatelle", NOW, 1).state, typing: { ...newGame(NOW).typing, baselineWpm: 60 } };
    const gained = (rate: number) => {
      const t = applyKeys(base, 20, NOW, Math.random, rate);
      return t.state.current!.notes - base.current!.notes;
    };
    const normal = gained(4);
    const fast = gained(14);
    const mashing = gained(40);
    expect(fast).toBeLessThan(normal);
    expect(mashing).toBeLessThan(fast);
    // Nothing is remembered: the same keys at a calm rate pay full value
    // again immediately, with no recovery period.
    expect(gained(4)).toBe(normal);
  });

  it("breaks only after five continuous seconds above the threshold", () => {
    let s = { ...newGame(NOW), typing: { ...newGame(NOW).typing, baselineWpm: 50 } };
    const fast = 30;
    for (let i = 0; i < 4; i++) s = observeTyping(s, fast, 1);
    expect(s.pianoBroken).toBe(false);
    expect(s.overspeedSeconds).toBeCloseTo(4, 5);
    s = observeTyping(s, fast, 1);
    expect(s.pianoBroken).toBe(true);
  });

  it("wipes the count the moment you slow down — nothing accumulates", () => {
    let s = { ...newGame(NOW), typing: { ...newGame(NOW).typing, baselineWpm: 50 } };
    // Four seconds of mashing, a breath, then four more: never five in a row.
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 4; i++) s = observeTyping(s, 30, 1);
      expect(s.pianoBroken).toBe(false);
      s = observeTyping(s, 1, 0.2);
      expect(s.overspeedSeconds).toBe(0);
    }
    expect(s.pianoBroken).toBe(false);
  });

  it("judges the same rate differently for a fast and a slow typist", () => {
    const base = newGame(NOW);
    const slow = { ...base, typing: { ...base.typing, baselineWpm: 35 } };
    const fast = { ...base, typing: { ...base.typing, baselineWpm: 120 } };
    expect(observeTyping(slow, 9, 1).overspeedSeconds).toBeGreaterThan(0);
    expect(observeTyping(fast, 9, 1).overspeedSeconds).toBe(0);
  });

  it("mostly wastes keystrokes once broken, but never all of them", () => {
    let s = { ...startPiece(newGame(NOW), "bagatelle", NOW, 1).state, pianoBroken: true };
    const before = s.current!.notes;
    const t = applyKeys(s, 100, NOW, Math.random, 0);
    s = t.state;
    expect(s.current!.notes).toBeGreaterThan(before);
    expect(s.current!.notes - before).toBeLessThan(100 * 0.2); // a trickle, not full production
    expect(s.keysConsumed).toBe(100);
    expect(t.events.find((e) => e.type === "wasted")).toBeTruthy();
  });

  it("can never fully soft-lock: broke and broken still earns a way out", () => {
    // The worst case there is: no money, piano broken, and mashing flat out
    // so both penalties land at once and every keystroke is worth the least
    // it can be. It must still pay for a repair in finite time — no state in
    // this game produces zero income forever. In practice this is about 70
    // minutes of solid mashing, or 15 of simply typing normally.
    for (const rate of [60, 4]) {
      let s = { ...startPiece(newGame(NOW), "bagatelle", NOW, 1).state, pianoBroken: true, money: 0 };
      let ticks = 0;
      for (; ticks < 40_000 && s.money < REPAIR_COST; ticks++) {
        s = applyKeys(s, Math.max(1, Math.round(rate * 0.2)), NOW + ticks * 200, seededRandom(ticks), rate).state;
        if (!s.current) s = startPiece(s, "bagatelle", NOW + ticks * 200, ticks).state;
      }
      expect(s.money).toBeGreaterThanOrEqual(REPAIR_COST);
      expect(canRepair(s)).toBe(true);
    }
  });

  it("repair costs a flat price and puts the piano right", () => {
    let s = { ...newGame(NOW), pianoBroken: true, money: 0 };
    expect(canRepair(s)).toBe(false);
    expect(repairPiano(s)).toBe(s); // too poor to repair
    s = { ...s, money: REPAIR_COST };
    expect(canRepair(s)).toBe(true);
    s = repairPiano(s);
    expect(s.pianoBroken).toBe(false);
    expect(s.money).toBe(0);
    expect(s.stats.spent).toBe(REPAIR_COST);
  });

  it("does nothing on an unbroken piano", () => {
    const s = { ...newGame(NOW), money: 1e9 };
    expect(canRepair(s)).toBe(false);
    expect(repairPiano(s)).toBe(s);
  });

  it("carries a broken piano through a save/load round trip", () => {
    const s = { ...newGame(NOW), pianoBroken: true };
    expect(migrate(JSON.parse(serialize(s)))!.pianoBroken).toBe(true);
    expect(migrate(JSON.parse(serialize(newGame(NOW))))!.pianoBroken).toBe(false);
  });

  it("loads a legacy save: only a fully jammed piano comes back broken", () => {
    expect(migrate({ ...JSON.parse(serialize(newGame(NOW))), pianoBroken: undefined, pianoWear: 1000 })!.pianoBroken).toBe(true);
    expect(migrate({ ...JSON.parse(serialize(newGame(NOW))), pianoBroken: undefined, pianoWear: 720 })!.pianoBroken).toBe(false);
  });
});

describe("the cupboard", () => {
  it("bounds sketches by cupboard size, not by the forms unlocked", () => {
    let s = newGame(NOW);
    s = applyKeys(s, 100_000, NOW).state; // nothing on the stand
    expect(s.spareNotes).toBe(cupboardCapacity(1));
    // Unlocking bigger forms must not quietly raise the limit any more.
    s = { ...s, upgrades: { ...s.upgrades, ambition: 7 } };
    s = applyKeys(s, 100_000, NOW).state;
    expect(s.spareNotes).toBe(cupboardCapacity(1));
  });
  it("upgrading the cupboard makes room for more", () => {
    let s = { ...newGame(NOW), upgrades: { ...newGame(NOW).upgrades, cupboard: 3 } };
    s = applyKeys(s, 1_000_000, NOW).state;
    expect(s.spareNotes).toBe(cupboardCapacity(3));
    expect(cupboardCapacity(3)).toBeGreaterThan(cupboardCapacity(1));
  });
  it("clamps an oversized saved pile down to the cupboard on load", () => {
    const s = { ...newGame(NOW), spareNotes: 999_999 };
    expect(migrate(JSON.parse(serialize(s)))!.spareNotes).toBe(cupboardCapacity(1));
  });
});
