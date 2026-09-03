/**
 * The numbers behind Sonatina. Everything here is pure and unit-tested.
 * See docs/DESIGN.md for the reasoning; scripts/simulate.ts checks pacing.
 */

export type FormId =
  | "bagatelle"
  | "etude"
  | "nocturne"
  | "sonata"
  | "concerto"
  | "symphony"
  | "opera";

export interface Form {
  id: FormId;
  name: string;
  /** Notes required to finish. */
  notes: number;
  /** Payout at artistry 1 and a neutral reception. */
  payout: number;
  /** 1-based; also the ambition level required. */
  tier: number;
  /** A line shown in the piece picker. */
  blurb: string;
}

export const FORMS: readonly Form[] = [
  { id: "bagatelle", name: "Bagatelle", notes: 500, payout: 500, tier: 1, blurb: "A trifle. Over before the tea cools." },
  { id: "etude", name: "Étude", notes: 2_500, payout: 2_500, tier: 2, blurb: "A study. Good for the fingers." },
  { id: "nocturne", name: "Nocturne", notes: 8_000, payout: 9_000, tier: 3, blurb: "Something for the small hours." },
  { id: "sonata", name: "Sonata", notes: 25_000, payout: 30_000, tier: 4, blurb: "Three movements and a point of view." },
  { id: "concerto", name: "Concerto", notes: 70_000, payout: 90_000, tier: 5, blurb: "Piano and orchestra, arguing politely." },
  { id: "symphony", name: "Symphony", notes: 180_000, payout: 250_000, tier: 6, blurb: "The whole orchestra. The whole month." },
  { id: "opera", name: "Opera", notes: 450_000, payout: 700_000, tier: 7, blurb: "Singers, sets, and a great deal of ink." },
];

export function formById(id: FormId): Form {
  const f = FORMS.find((x) => x.id === id);
  if (!f) throw new Error(`unknown form ${id}`);
  return f;
}

export type UpgradeId = "tempo" | "artistry" | "ambition";

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  blurb: string;
  max: number;
}

/** Tempo levels are metronome markings; notes per keystroke = bpm / 60. */
export const TEMPI: ReadonlyArray<{ name: string; bpm: number; cost: number | null }> = [
  { name: "Adagio", bpm: 60, cost: 100 },
  { name: "Andante", bpm: 76, cost: 250 },
  { name: "Moderato", bpm: 92, cost: 600 },
  { name: "Allegretto", bpm: 108, cost: 1_500 },
  { name: "Allegro", bpm: 120, cost: 4_000 },
  { name: "Vivace", bpm: 138, cost: 10_000 },
  { name: "Presto", bpm: 168, cost: 25_000 },
  { name: "Prestissimo", bpm: 200, cost: null },
];

export const UPGRADES: readonly UpgradeDef[] = [
  { id: "tempo", name: "Tempo", blurb: "More notes for every key you press.", max: TEMPI.length },
  { id: "artistry", name: "Artistry", blurb: "Finer work, warmer receptions, better pay.", max: 10 },
  { id: "ambition", name: "Ambition", blurb: "The nerve to take on larger forms.", max: FORMS.length },
];

export function upgradeDef(id: UpgradeId): UpgradeDef {
  return UPGRADES.find((u) => u.id === id)!;
}

export function tempoName(level: number): string {
  return TEMPI[Math.min(TEMPI.length, Math.max(1, level)) - 1]!.name;
}

export function tempoBpm(level: number): number {
  return TEMPI[Math.min(TEMPI.length, Math.max(1, level)) - 1]!.bpm;
}

export type Upgrades = Record<UpgradeId, number>;

/** Rounds a price to something that reads well on a menu. */
export function niceRound(v: number): number {
  if (v < 100) return Math.round(v / 10) * 10;
  if (v < 1_000) return Math.round(v / 10) * 10;
  if (v < 10_000) return Math.round(v / 100) * 100;
  if (v < 100_000) return Math.round(v / 1_000) * 1_000;
  return Math.round(v / 10_000) * 10_000;
}

/** Cost to move `id` from `level` to `level + 1`, or null at max. */
export function upgradeCost(id: UpgradeId, level: number): number | null {
  const def = upgradeDef(id);
  if (level >= def.max || level < 1) return null;
  switch (id) {
    case "tempo":
      return TEMPI[level - 1]?.cost ?? null;
    case "artistry":
      return niceRound(200 * Math.pow(2.5, level - 1));
    case "ambition": {
      // Unlocking the next form costs about one and a half of the current largest.
      const current = FORMS[level - 1];
      return current ? niceRound(current.payout * 1.5) : null;
    }
  }
}

/** Fractional notes per keystroke; the piece keeps a float and displays whole notes. */
export function notesPerKey(upgrades: Upgrades): number {
  return tempoBpm(upgrades.tempo) / 60;
}

export function artistryMultiplier(level: number): number {
  return 1 + 0.15 * (level - 1);
}

export function formUnlocked(form: Form, upgrades: Upgrades): boolean {
  return upgrades.ambition >= form.tier;
}

export interface Reception {
  /** 0.88 … 1.18 */
  factor: number;
  line: string;
}

const RECEPTION_LINES: ReadonlyArray<[number, string[]]> = [
  [0.95, ["Polite applause.", "A quiet room, a few nods.", "The critics were … fair."]],
  [1.05, ["Warmly received.", "The hall hummed on the way out.", "A good night."]],
  [1.12, ["The critics were kind.", "Someone wept in the third row.", "An encore was demanded."]],
  [Infinity, ["A standing ovation!", "The house came down.", "Flowers on the stage. Actual flowers."]],
];

/** Draws a reception; higher artistry skews towards the warm end. */
export function drawReception(u: number, pickLine: number, artistry: number): Reception {
  const skew = Math.pow(Math.min(0.999999, Math.max(0, u)), 1 / (1 + 0.2 * (artistry - 1)));
  const factor = Math.round((0.88 + 0.3 * skew) * 1000) / 1000;
  const band = RECEPTION_LINES.find(([max]) => factor < max) ?? RECEPTION_LINES[RECEPTION_LINES.length - 1]!;
  const lines = band[1];
  const line = lines[Math.min(lines.length - 1, Math.floor(pickLine * lines.length))]!;
  return { factor, line };
}

export function payoutFor(form: Form, upgrades: Upgrades, reception: number): number {
  return Math.round(form.payout * artistryMultiplier(upgrades.artistry) * reception);
}

export function renownFor(form: Form): number {
  return form.tier * form.tier;
}

export interface Rank {
  min: number;
  title: string;
}

export const RANKS: readonly Rank[] = [
  { min: 0, title: "Unknown" },
  { min: 3, title: "Neighbourhood favourite" },
  { min: 12, title: "Rising talent" },
  { min: 40, title: "Celebrated" },
  { min: 120, title: "Renowned" },
  { min: 300, title: "Legendary" },
];

export function rankFor(renown: number): Rank {
  let r = RANKS[0]!;
  for (const rank of RANKS) if (renown >= rank.min) r = rank;
  return r;
}

export function nextRank(renown: number): Rank | null {
  return RANKS.find((r) => r.min > renown) ?? null;
}

// ───────────────────────── the piano ─────────────────────────

/**
 * Typing at a normal pace never wears the piano down — only sustained
 * spamming does. What counts as "sustained spamming" is *personal*: a
 * threshold fixed for everyone is either free money for a fast typist or a
 * punishment for a slow one. So the game learns your pace — from a short
 * test on first run, then from how you actually type — and measures
 * spamming against that.
 *
 * Wear is driven by a *smoothed* typing rate (the engine's running average,
 * not a single burst), so a quick flurry of ordinary typing never counts.
 */

/** The typing-test convention: one "word" is five keystrokes. */
export const KEYS_PER_WORD = 5;

export function wpmToKeysPerSec(wpm: number): number {
  return (wpm * KEYS_PER_WORD) / 60;
}

export function keysPerSecToWpm(keysPerSec: number): number {
  return (keysPerSec * 60) / KEYS_PER_WORD;
}

/**
 * Assumed pace when the first-run test is skipped — a middling typist. It
 * only sets the starting point; the baseline adapts from real typing within
 * a few minutes of use either way.
 */
export const DEFAULT_BASELINE_WPM = 45;

/**
 * How far above your own pace counts as spamming rather than a good run.
 * Real typing is bursty — a familiar phrase can briefly run well above your
 * average — so the threshold sits comfortably clear of it.
 */
export const SAFE_MARGIN = 1.7;

/**
 * Floor and ceiling on the personal threshold. The floor keeps a slow or
 * mistyped test from making ordinary typing wear the piano; the ceiling
 * stops an inflated test result (or a very fast typist) from buying
 * immunity to mashing. 3.5–12 keys/sec is 42–144 wpm of headroom.
 */
export const MIN_SAFE_KEYS_PER_SEC = 3.5;
export const MAX_SAFE_KEYS_PER_SEC = 12;

/**
 * Retaking the typing test costs money, and each retake costs three times
 * the last. The first measurement, during setup, is free.
 *
 * The escalation is the point rather than the price: a cheap unlimited
 * retake would be an exploit, since you could roll the test over and over
 * until a lucky run flattered you into a higher threshold — which is exactly
 * the anti-spam limit the test exists to set. Paying steeply for each
 * attempt makes an honest single run the sensible move. It is capped so it
 * never becomes impossible in a long game.
 */
export const TYPING_TEST_BASE_COST = 300;
export const TYPING_TEST_MAX_COST = 25_000;

export function typingTestCost(retakes: number): number {
  const n = Math.max(0, Math.floor(Number.isFinite(retakes) ? retakes : 0));
  const raw = TYPING_TEST_BASE_COST * Math.pow(3, Math.min(n, 12));
  return Math.min(TYPING_TEST_MAX_COST, niceRound(raw));
}

/**
 * The fastest pace still credible as real typing, and so the most the
 * baseline will ever learn from. This is deliberately *higher* than any
 * individual's spam threshold: gating learning at the threshold itself
 * would be a trap — an underestimating test could never be corrected,
 * because the very typing that proves you are faster would be dismissed as
 * spam. Mashing runs far above even this, so it still teaches nothing.
 */
export const LEARN_MAX_KEYS_PER_SEC = 12;

/** The spam threshold, in keys per second, for someone whose pace is `baselineWpm`. */
export function safeKeysPerSec(baselineWpm: number): number {
  const wpm = Number.isFinite(baselineWpm) && baselineWpm > 0 ? baselineWpm : DEFAULT_BASELINE_WPM;
  const kps = wpmToKeysPerSec(wpm) * SAFE_MARGIN;
  return Math.max(MIN_SAFE_KEYS_PER_SEC, Math.min(MAX_SAFE_KEYS_PER_SEC, kps));
}

/**
 * Wear per excess key per second. Tuned so that mashing at roughly twice a
 * typical threshold shows cracks within about half a minute and jams the
 * piano inside two — fast enough that spamming is visibly a bad idea,
 * slow enough that you are never surprised by it.
 */
export const WEAR_PER_EXCESS_KEY = 2;

/** The wear scale runs 0–1000 (not 0–100) so a moment of fast typing is
 * nowhere near jamming anything, and the cracks have room to creep in
 * gradually — giving plenty of warning (and plenty of time to just stop)
 * well before it becomes a problem. */
export const WEAR_STUTTER_AT = 600;
export const WEAR_BROKEN_AT = 1000;
/**
 * Even fully jammed, the piano is stubborn, not silent: a small fraction of
 * keystrokes still land. There is deliberately no state in this game that
 * produces zero income forever — that would be a dead end no amount of
 * money could climb out of.
 */
export const BROKEN_NOTE_EFFICIENCY = 0.12;

/**
 * Wear added for `dtSeconds` spent at a smoothed typing rate of
 * `keysPerSec`, for a player whose pace is `baselineWpm`.
 */
export function wearFromTyping(keysPerSec: number, dtSeconds: number, baselineWpm = DEFAULT_BASELINE_WPM): number {
  if (dtSeconds <= 0 || keysPerSec <= 0) return 0;
  const excess = Math.max(0, keysPerSec - safeKeysPerSec(baselineWpm));
  if (excess <= 0) return 0;
  return excess * WEAR_PER_EXCESS_KEY * dtSeconds;
}

/**
 * The piano recovers a little while you are not hammering it. Without this
 * the wear from a single bad afternoon would follow you forever, and the
 * personal threshold would feel like a trap rather than a nudge. Slow
 * enough that it never rescues active spamming.
 */
export const WEAR_RECOVERY_PER_SEC = 0.5;

/**
 * Cost to fully repair the piano from `wear` (0–1000). Cheap early, steep
 * near full wear, but never more than a single decent premiere or two —
 * scaled by *fraction* worn so it stays sensible regardless of the wear
 * scale above.
 */
export function repairCost(wear: number): number {
  const frac = Math.max(0, Math.min(1, wear / WEAR_BROKEN_AT));
  if (frac <= 0) return 0;
  return niceRound(300 * frac + 2700 * frac * frac);
}

export function formatMoney(n: number): string {
  return "$" + Math.floor(n).toLocaleString("en-US");
}

export function formatNumber(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
}
