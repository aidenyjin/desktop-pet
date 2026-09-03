import { describe, expect, it } from "vitest";
import { newGame, observeTyping, setTypingTest, migrate, serialize, clampWpm, MIN_BASELINE_WPM, MAX_BASELINE_WPM } from "../src/game/state";
import { DEFAULT_BASELINE_WPM, LEARN_MAX_KEYS_PER_SEC, safeKeysPerSec, wearFromTyping, wpmToKeysPerSec } from "../src/game/economy";

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
    // Regression: learning was once gated at the wear threshold, so a pace
    // above it could never be learned — a fast typist whose test came out
    // low would be called a spammer forever, with no way to prove otherwise.
    const understated = setTypingTest(newGame(NOW), 40);
    const reallyTypesAt = wpmToKeysPerSec(85);
    expect(reallyTypesAt).toBeGreaterThan(safeKeysPerSec(40));
    const after = type(understated, reallyTypesAt, 300);
    expect(after.typing.baselineWpm).toBeGreaterThan(70);
    expect(wearFromTyping(reallyTypesAt, 1, after.typing.baselineWpm)).toBe(0);
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

describe("piano recovery", () => {
  it("heals while the pace is back under the threshold", () => {
    const worn = { ...setTypingTest(newGame(NOW), 50), pianoWear: 400 };
    expect(type(worn, 2, 60).pianoWear).toBeLessThan(400);
  });
  it("does not heal while still mashing", () => {
    const worn = { ...setTypingTest(newGame(NOW), 50), pianoWear: 400 };
    expect(type(worn, 30, 30).pianoWear).toBe(400);
  });
  it("never heals below pristine", () => {
    const s = { ...setTypingTest(newGame(NOW), 50), pianoWear: 5 };
    expect(type(s, 0, 600).pianoWear).toBe(0);
  });
  it("is slow enough that a real jam still needs repairing", () => {
    const worn = { ...setTypingTest(newGame(NOW), 50), pianoWear: 1000 };
    // Half a minute of calm should not undo a jam.
    expect(type(worn, 1.5, 30).pianoWear).toBeGreaterThan(900);
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
