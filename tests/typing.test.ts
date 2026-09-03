import { describe, expect, it } from "vitest";
import { newGame, observeTyping, setTypingTest, retakeTypingTest, canRetakeTypingTest, migrate, serialize, clampWpm, MIN_BASELINE_WPM, MAX_BASELINE_WPM } from "../src/game/state";
import { DEFAULT_BASELINE_WPM, LEARN_MAX_KEYS_PER_SEC, safeKeysPerSec, spamEfficiency, typingTestCost, wpmToKeysPerSec } from "../src/game/economy";

const NOW = 1_700_000_000_000;

/** Runs `seconds` of steady typing at `kps` through the observer. */
function type(state = newGame(NOW), kps: number, seconds: number, step = 0.15) {
  let s = state;
  for (let t = 0; t < seconds; t += step) s = observeTyping(s, kps, step);
  return s;
}

describe("the typing test result", () => {
  it("sets both the recorded result and the working baseline", () => {
    const s = setTypingTest(newGame(NOW), 72);
    expect(s.typing.testWpm).toBe(72);
    expect(s.typing.baselineWpm).toBe(72);
  });
  it("clamps an implausible result rather than trusting it", () => {
    expect(setTypingTest(newGame(NOW), 5).typing.baselineWpm).toBe(MIN_BASELINE_WPM);
    expect(setTypingTest(newGame(NOW), 5000).typing.baselineWpm).toBe(MAX_BASELINE_WPM);
    expect(clampWpm(NaN)).toBe(DEFAULT_BASELINE_WPM);
  });
  it("resets the observed history, so a retake takes effect promptly", () => {
    const typed = type(newGame(NOW), 4, 60);
    expect(typed.typing.observedSeconds).toBeGreaterThan(0);
    expect(setTypingTest(typed, 80).typing.observedSeconds).toBe(0);
  });
});

describe("paying to redo the test", () => {
  const rich = (money: number) => ({ ...setTypingTest(newGame(NOW), 50), money });

  it("is free the first time, during setup", () => {
    const s = setTypingTest(newGame(NOW), 70);
    expect(s.money).toBe(0);
    expect(s.typing.retakes).toBe(0);
  });
  it("charges for a retake and records the new pace", () => {
    const s = retakeTypingTest(rich(1000), 88);
    expect(s.money).toBe(1000 - typingTestCost(0));
    expect(s.typing.baselineWpm).toBe(88);
    expect(s.typing.retakes).toBe(1);
  });
  it("counts the spend in the player's stats", () => {
    const s = retakeTypingTest(rich(1000), 88);
    expect(s.stats.spent).toBe(typingTestCost(0));
  });
  it("costs more every time, so re-rolling for a lucky score is a bad deal", () => {
    let s = rich(100_000);
    const paid: number[] = [];
    for (let i = 0; i < 4; i++) {
      const before = s.money;
      s = retakeTypingTest(s, 80);
      paid.push(before - s.money);
    }
    expect(paid).toEqual([...paid].sort((a, b) => a - b));
    expect(paid[3]!).toBeGreaterThan(paid[0]!);
  });
  it("refuses when it cannot be paid for, changing nothing", () => {
    const poor = rich(10);
    expect(canRetakeTypingTest(poor)).toBe(false);
    expect(retakeTypingTest(poor, 120)).toBe(poor);
  });
  it("resets what was learned, so the new figure actually takes effect", () => {
    const experienced = type(rich(1000), wpmToKeysPerSec(60), 200);
    expect(experienced.typing.observedSeconds).toBeGreaterThan(0);
    expect(retakeTypingTest(experienced, 35).typing.observedSeconds).toBe(0);
  });
  it("keeps the retake count across a save and load", () => {
    const s = retakeTypingTest(rich(5000), 75);
    expect(migrate(JSON.parse(serialize(s)))?.typing.retakes).toBe(1);
  });
});

describe("learning the baseline from real typing", () => {
  it("rises toward a faster pace that is genuinely sustained", () => {
    const start = setTypingTest(newGame(NOW), 40);
    const after = type(start, wpmToKeysPerSec(60), 120);
    expect(after.typing.baselineWpm).toBeGreaterThan(40);
    expect(after.typing.baselineWpm).toBeLessThanOrEqual(60);
  });
  it("falls only slowly, so a slow patch does not undo a known pace", () => {
    const start = setTypingTest(newGame(NOW), 90);
    const after = type(start, wpmToKeysPerSec(30), 120);
    expect(after.typing.baselineWpm).toBeGreaterThan(80);
  });
  it("ignores pauses, which are not a pace", () => {
    const start = setTypingTest(newGame(NOW), 70);
    const after = type(start, 0, 300);
    expect(after.typing.baselineWpm).toBe(70);
    expect(after.typing.observedSeconds).toBe(0);
  });
  it("refuses to learn from mashing, so spam cannot raise its own ceiling", () => {
    const start = setTypingTest(newGame(NOW), 45);
    const after = type(start, 40, 300);
    expect(after.typing.baselineWpm).toBe(45);
    expect(after.typing.observedSeconds).toBe(0);
  });
  it("keeps the estimate inside human bounds however long it runs", () => {
    const fast = type(setTypingTest(newGame(NOW), 130), wpmToKeysPerSec(200), 600);
    expect(fast.typing.baselineWpm).toBeLessThanOrEqual(MAX_BASELINE_WPM);
    const slow = type(setTypingTest(newGame(NOW), 20), wpmToKeysPerSec(2), 600);
    expect(slow.typing.baselineWpm).toBeGreaterThanOrEqual(MIN_BASELINE_WPM);
  });
  it("corrects an underestimating test instead of trapping the player", () => {
    // Regression: learning was once gated at the spam threshold, so a pace
    // above it could never be learned — a fast typist whose test came out
    // low would be called a spammer forever, with no way to prove otherwise.
    const understated = setTypingTest(newGame(NOW), 40);
    const reallyTypesAt = wpmToKeysPerSec(85);
    expect(reallyTypesAt).toBeGreaterThan(safeKeysPerSec(40));
    const after = type(understated, reallyTypesAt, 300);
    expect(after.typing.baselineWpm).toBeGreaterThan(70);
    // ...and once learned, that pace is worth full value again.
    expect(spamEfficiency(reallyTypesAt, after.typing.baselineWpm)).toBe(1);
  });
  it("mashing cannot lift the baseline to the learning ceiling", () => {
    const start = setTypingTest(newGame(NOW), 45);
    const after = type(start, LEARN_MAX_KEYS_PER_SEC + 5, 600);
    expect(after.typing.baselineWpm).toBe(45);
  });
  it("raises the spam threshold as the baseline rises", () => {
    const start = setTypingTest(newGame(NOW), 40);
    const before = safeKeysPerSec(start.typing.baselineWpm);
    const after = safeKeysPerSec(type(start, wpmToKeysPerSec(75), 200).typing.baselineWpm);
    expect(after).toBeGreaterThan(before);
  });
});

describe("breaking the piano", () => {
  it("leaves the piano alone at an ordinary pace, however long you type", () => {
    const s = type(setTypingTest(newGame(NOW), 50), 2, 600);
    expect(s.pianoBroken).toBe(false);
    expect(s.overspeedSeconds).toBe(0);
  });
  it("breaks after a few seconds of sustained mashing", () => {
    const s = type(setTypingTest(newGame(NOW), 50), 30, 30);
    expect(s.pianoBroken).toBe(true);
  });
  it("survives repeated short bursts, however many, as long as you keep pausing", () => {
    // Four seconds on, a breath off, over and over: never five in a row, so
    // nothing ever breaks. Wear used to accumulate across bursts like this.
    let s = setTypingTest(newGame(NOW), 50);
    for (let i = 0; i < 40; i++) {
      s = type(s, 30, 4);
      s = type(s, 1, 0.5);
    }
    expect(s.pianoBroken).toBe(false);
  });
  it("does not un-break on its own — a broken piano stays broken", () => {
    const broken = { ...setTypingTest(newGame(NOW), 50), pianoBroken: true };
    expect(type(broken, 1.5, 600).pianoBroken).toBe(true);
  });
});

describe("saving the pace", () => {
  it("survives a save and load round trip", () => {
    const s = type(setTypingTest(newGame(NOW), 66), wpmToKeysPerSec(70), 30);
    const back = migrate(JSON.parse(serialize(s)));
    expect(back?.typing.testWpm).toBe(66);
    expect(back?.typing.baselineWpm).toBeCloseTo(s.typing.baselineWpm, 5);
  });
  it("gives an older save a sensible pace instead of failing", () => {
    const old = { ...JSON.parse(serialize(newGame(NOW))), version: 1 };
    delete old.typing;
    const back = migrate(old);
    expect(back?.typing.baselineWpm).toBe(DEFAULT_BASELINE_WPM);
    expect(back?.typing.testWpm).toBe(0);
  });
  it("repairs a corrupted pace rather than trusting it", () => {
    const bad = { ...JSON.parse(serialize(newGame(NOW))), typing: { testWpm: -5, baselineWpm: 9999, observedSeconds: "x" } };
    const back = migrate(bad);
    expect(back?.typing.baselineWpm).toBe(MAX_BASELINE_WPM);
    expect(back?.typing.testWpm).toBe(0);
    expect(back?.typing.observedSeconds).toBe(0);
  });
});
