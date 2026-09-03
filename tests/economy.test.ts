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
  BREAK_AFTER_SECONDS,
  MIN_SPAM_THROUGHPUT,
  REPAIR_COST,
  cupboardCapacity,
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
  spamEfficiency,
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
    const up = { tempo: 1, artistry: 1, ambition: 1, cupboard: 1 };
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
    expect(notesPerKey({ tempo: 1, artistry: 1, ambition: 1, cupboard: 1 })).toBe(1);
    expect(notesPerKey({ tempo: 5, artistry: 1, ambition: 1, cupboard: 1 })).toBe(2);
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
    const base = payoutFor(form, { tempo: 1, artistry: 1, ambition: 3, cupboard: 1 }, 1);
    const better = payoutFor(form, { tempo: 1, artistry: 3, ambition: 3, cupboard: 1 }, 1);
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

describe("spam efficiency", () => {
  it("pays full value at or under a safe typing rate", () => {
    expect(spamEfficiency(safeKeysPerSec(DEFAULT_BASELINE_WPM), DEFAULT_BASELINE_WPM)).toBe(1);
    expect(spamEfficiency(3, DEFAULT_BASELINE_WPM)).toBe(1);
    expect(spamEfficiency(0, DEFAULT_BASELINE_WPM)).toBe(1);
  });
  it("falls off the further past the threshold you go, and never rises again", () => {
    const safe = safeKeysPerSec(DEFAULT_BASELINE_WPM);
    let last = 1;
    for (let over = 0; over <= 40; over += 2) {
      const eff = spamEfficiency(safe + over, DEFAULT_BASELINE_WPM);
      expect(eff).toBeLessThanOrEqual(last);
      last = eff;
    }
    expect(spamEfficiency(safe + 2, DEFAULT_BASELINE_WPM)).toBeLessThan(1);
    expect(spamEfficiency(safe * 2, DEFAULT_BASELINE_WPM)).toBeLessThan(0.5);
  });
  it("never pays nothing, however hard the mashing", () => {
    expect(spamEfficiency(500, DEFAULT_BASELINE_WPM)).toBeGreaterThan(0);
    expect(spamEfficiency(1e6, DEFAULT_BASELINE_WPM)).toBeGreaterThan(0);
    expect(MIN_SPAM_THROUGHPUT).toBeGreaterThan(0);
  });
  it("judges the same rate against the player's own pace", () => {
    // 10 keys/sec is a hammering for a 40 wpm typist and a good run for a
    // 110 wpm one.
    expect(spamEfficiency(10, 40)).toBeLessThan(1);
    expect(spamEfficiency(10, 110)).toBe(1);
  });
  it("earns strictly less per second the harder you mash, and never more", () => {
    const safe = safeKeysPerSec(DEFAULT_BASELINE_WPM);
    const honest = safe * spamEfficiency(safe, DEFAULT_BASELINE_WPM);
    // Regression: a flat per-key floor let a hard enough mash climb back
    // above a moderate one, so hammering flat out beat merely hammering.
    let last = Infinity;
    for (let rate = safe; rate <= 200; rate += 0.5) {
      const earned = rate * spamEfficiency(rate, DEFAULT_BASELINE_WPM);
      expect(earned).toBeLessThanOrEqual(last + 1e-9);
      expect(earned).toBeLessThanOrEqual(honest + 1e-9);
      last = earned;
    }
    expect(30 * spamEfficiency(30, DEFAULT_BASELINE_WPM)).toBeLessThan(honest * 0.5);
  });
  it("never lets mashing be worth less than a fair share of honest typing", () => {
    const safe = safeKeysPerSec(DEFAULT_BASELINE_WPM);
    const honest = safe * spamEfficiency(safe, DEFAULT_BASELINE_WPM);
    expect(1000 * spamEfficiency(1000, DEFAULT_BASELINE_WPM)).toBeCloseTo(honest * MIN_SPAM_THROUGHPUT, 6);
  });
});

describe("the piano breaking", () => {
  it("breaks after five continuous seconds, and repairs for a flat price", () => {
    expect(BREAK_AFTER_SECONDS).toBe(5);
    expect(REPAIR_COST).toBe(200);
  });
});

describe("the cupboard", () => {
  it("grows with each level and never shrinks", () => {
    let last = 0;
    for (let lvl = 1; lvl <= 8; lvl++) {
      const cap = cupboardCapacity(lvl);
      expect(cap).toBeGreaterThan(last);
      last = cap;
    }
  });
  it("clamps to the ends of the table", () => {
    expect(cupboardCapacity(0)).toBe(cupboardCapacity(1));
    expect(cupboardCapacity(99)).toBe(cupboardCapacity(8));
  });
});
