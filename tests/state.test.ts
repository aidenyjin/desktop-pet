import { describe, expect, it } from "vitest";
import { FORMS, upgradeCost } from "../src/game/economy";
import {
  abandonPiece,
  applyKeys,
  buyUpgrade,
  canStart,
  dismissNotice,
  markInboxSeen,
  migrate,
  newGame,
  renamePiece,
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
