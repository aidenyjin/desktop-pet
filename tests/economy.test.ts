import { describe, expect, it } from "vitest";
import {
  FORMS,
  UPGRADES,
  safeKeysPerSec,
  wpmToKeysPerSec,
  keysPerSecToWpm,
  DEFAULT_BASELINE_WPM,
  MIN_SAFE_KEYS_PER_SEC,
  MAX_SAFE_KEYS_PER_SEC,
  WEAR_BROKEN_AT,
  WEAR_STUTTER_AT,
  artistryMultiplier,
  drawReception,
  formatMoney,
  niceRound,
  payoutFor,
  rankFor,
  nextRank,
  upgradeCost,
  formUnlocked,
  tempoName,
  notesPerKey,
  wearFromTyping,
  repairCost,
} from "../src/game/economy";

describe("forms", () => {
  it("are ordered by tier and grow monotonically", () => {
    for (let i = 1; i < FORMS.length; i++) {
      expect(FORMS[i]!.tier).toBe(FORMS[i - 1]!.tier + 1);
      expect(FORMS[i]!.notes).toBeGreaterThan(FORMS[i - 1]!.notes);
      expect(FORMS[i]!.payout).toBeGreaterThan(FORMS[i - 1]!.payout);
    }
  });
  it("pay better per note as they get larger", () => {
    for (let i = 1; i < FORMS.length; i++) {
      const a = FORMS[i - 1]!.payout / FORMS[i - 1]!.notes;
      const b = FORMS[i]!.payout / FORMS[i]!.notes;
      expect(b).toBeGreaterThanOrEqual(a);
    }
  });
  it("only the first form is unlocked at ambition 1", () => {
    const up = { tempo: 1, artistry: 1, ambition: 1 };
    expect(FORMS.filter((f) => formUnlocked(f, up)).map((f) => f.id)).toEqual(["bagatelle"]);
  });
});

describe("upgrade costs", () => {
  it("increase with level and end at max", () => {
    for (const u of UPGRADES) {
      let prev = 0;
      for (let l = 1; l < u.max; l++) {
        const c = upgradeCost(u.id, l)!;
        expect(c).toBeGreaterThan(prev);
        prev = c;
      }
      expect(upgradeCost(u.id, u.max)).toBeNull();
    }
  });
  it("first tempo upgrade is affordable after one bagatelle", () => {
    expect(upgradeCost("tempo", 1)).toBeLessThanOrEqual(FORMS[0]!.payout);
  });
  it("tempo levels read as metronome markings and speed up", () => {
    expect(tempoName(1)).toBe("Adagio");
    expect(tempoName(99)).toBe("Prestissimo");
    expect(notesPerKey({ tempo: 1, artistry: 1, ambition: 1 })).toBe(1);
    expect(notesPerKey({ tempo: 5, artistry: 1, ambition: 1 })).toBe(2);
  });
  it("ambition to unlock étude costs less than a couple of bagatelles", () => {
    expect(upgradeCost("ambition", 1)).toBeLessThanOrEqual(FORMS[0]!.payout * 2);
  });
  it("rounds to readable prices", () => {
    expect(niceRound(53)).toBe(50);
    expect(niceRound(1234)).toBe(1200);
    expect(niceRound(123456)).toBe(120000);
  });
});

describe("payouts", () => {
  it("scale with artistry", () => {
    const form = FORMS[2]!;
    const base = payoutFor(form, { tempo: 1, artistry: 1, ambition: 3 }, 1);
    const better = payoutFor(form, { tempo: 1, artistry: 3, ambition: 3 }, 1);
    expect(base).toBe(form.payout);
    expect(better).toBe(Math.round(form.payout * artistryMultiplier(3)));
  });
  it("reception stays inside its band and skews up with artistry", () => {
    let lowSum = 0;
    let highSum = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const a = drawReception(u, 0.5, 1);
      const b = drawReception(u, 0.5, 6);
      expect(a.factor).toBeGreaterThanOrEqual(0.88);
      expect(a.factor).toBeLessThanOrEqual(1.18);
      expect(a.line.length).toBeGreaterThan(0);
      lowSum += a.factor;
      highSum += b.factor;
    }
    expect(highSum / n).toBeGreaterThan(lowSum / n);
    expect(lowSum / n).toBeCloseTo(1.03, 1);
  });
});

describe("renown", () => {
  it("ranks climb", () => {
    expect(rankFor(0).title).toBe("Unknown");
    expect(rankFor(3).title).toBe("Neighbourhood favourite");
    expect(rankFor(1000).title).toBe("Legendary");
    expect(nextRank(0)!.min).toBe(3);
    expect(nextRank(1000)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats money like the reference", () => {
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(2275.7)).toBe("$2,275");
    expect(formatMoney(12068)).toBe("$12,068");
  });
});

describe("typing pace", () => {
  it("converts between wpm and keys per second at five keys a word", () => {
    expect(wpmToKeysPerSec(60)).toBeCloseTo(5);
    expect(keysPerSecToWpm(5)).toBeCloseTo(60);
    expect(keysPerSecToWpm(wpmToKeysPerSec(83))).toBeCloseTo(83);
  });
  it("sets the spam threshold above the player's own pace", () => {
    const own = wpmToKeysPerSec(60);
    expect(safeKeysPerSec(60)).toBeGreaterThan(own);
  });
  it("gives a faster typist more headroom than a slower one", () => {
    expect(safeKeysPerSec(90)).toBeGreaterThan(safeKeysPerSec(40));
  });
  it("clamps the threshold at both ends", () => {
    expect(safeKeysPerSec(1)).toBe(MIN_SAFE_KEYS_PER_SEC);
    expect(safeKeysPerSec(1000)).toBe(MAX_SAFE_KEYS_PER_SEC);
  });
  it("falls back to the default pace for nonsense input", () => {
    expect(safeKeysPerSec(NaN)).toBe(safeKeysPerSec(DEFAULT_BASELINE_WPM));
    expect(safeKeysPerSec(0)).toBe(safeKeysPerSec(DEFAULT_BASELINE_WPM));
  });
  it("is far stricter than the old fixed 15 keys/sec threshold", () => {
    // The regression this feature fixes: 15 keys/sec is 180 wpm, so mashing
    // used to cost nothing at all.
    expect(safeKeysPerSec(DEFAULT_BASELINE_WPM)).toBeLessThan(15);
  });
});

describe("piano wear", () => {
  it("adds no wear at or under a safe typing rate", () => {
    expect(wearFromTyping(safeKeysPerSec(DEFAULT_BASELINE_WPM), 1)).toBe(0);
    expect(wearFromTyping(3, 1)).toBe(0);
    expect(wearFromTyping(0, 1)).toBe(0);
  });
  it("wears faster the more the rate exceeds safe typing", () => {
    const safe = safeKeysPerSec(DEFAULT_BASELINE_WPM);
    const mild = wearFromTyping(safe + 2, 1);
    const wild = wearFromTyping(safe + 20, 1);
    expect(mild).toBeGreaterThan(0);
    expect(wild).toBeGreaterThan(mild * 5);
  });
  it("judges the same rate against the player's own pace", () => {
    // 10 keys/sec is a hammering for a 40 wpm typist and a good run for a
    // 110 wpm one.
    expect(wearFromTyping(10, 1, 40)).toBeGreaterThan(0);
    expect(wearFromTyping(10, 1, 110)).toBe(0);
  });
  it("mashing shows cracks in well under a minute", () => {
    // 20 keys/sec against a default pace: stutter, then a full jam.
    const perSecond = wearFromTyping(20, 1, DEFAULT_BASELINE_WPM);
    expect(WEAR_STUTTER_AT / perSecond).toBeLessThan(60);
    expect(WEAR_BROKEN_AT / perSecond).toBeLessThan(120);
  });
  it("ignores a non-positive duration", () => {
    expect(wearFromTyping(50, 0)).toBe(0);
    expect(wearFromTyping(50, -1)).toBe(0);
  });
  it("repair is free at zero wear and expensive near broken", () => {
    expect(repairCost(0)).toBe(0);
    expect(repairCost(WEAR_BROKEN_AT * 0.1)).toBeGreaterThan(0);
    expect(repairCost(WEAR_BROKEN_AT)).toBeGreaterThan(repairCost(WEAR_BROKEN_AT * 0.05) * 2);
  });
  it("clamps repair cost to the broken ceiling", () => {
    expect(repairCost(WEAR_BROKEN_AT * 1.5)).toBe(repairCost(WEAR_BROKEN_AT));
  });
});
