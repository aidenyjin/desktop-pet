/**
 * Game state and the handful of pure transitions that change it.
 * No DOM, no Tauri — this file is fully covered by unit tests.
 */
import {
  FORMS,
  drawReception,
  formById,
  formUnlocked,
  notesPerKey,
  payoutFor,
  renownFor,
  upgradeCost,
  upgradeDef,
  type FormId,
  type UpgradeId,
  type Upgrades,
} from "./economy";
import { mulberry32, randomSeed } from "./rng";
import { generateTitle, type KeyName, type Mode } from "./titles";

export const SAVE_VERSION = 1;

export type Theme = "paper" | "night" | "auto";

export interface Settings {
  theme: Theme;
  /** Premiere chime and repertoire playback. */
  sound: boolean;
  /** Soft notes while you type. */
  playAlong: boolean;
  /** macOS notification when a piece premieres while the panel is hidden. */
  notifications: boolean;
  /** Keep the panel open when it loses focus. */
  pinned: boolean;
}

export interface Piece {
  id: string;
  formId: FormId;
  title: string;
  key: KeyName;
  mode: Mode;
  seed: number;
  notes: number;
  target: number;
  startedAt: number;
  opus: number;
}

export interface Work {
  id: string;
  formId: FormId;
  title: string;
  key: KeyName;
  mode: Mode;
  seed: number;
  notes: number;
  earned: number;
  reception: number;
  receptionLine: string;
  startedAt: number;
  completedAt: number;
  opus: number;
}

export interface Notice {
  id: string;
  kind: "premiere";
  workId: string;
  title: string;
  earned: number;
  line: string;
  at: number;
  seen: boolean;
}

export interface Stats {
  premieres: number;
  bestEarning: number;
  totalEarned: number;
  spent: number;
}

export interface GameState {
  version: number;
  createdAt: number;
  composerName: string;
  onboarded: boolean;
  money: number;
  renown: number;
  /** Lifetime keystrokes already turned into notes. */
  keysConsumed: number;
  lifetimeNotes: number;
  /** Notes written past the end of a piece; applied to the next one. */
  spareNotes: number;
  upgrades: Upgrades;
  current: Piece | null;
  repertoire: Work[];
  inbox: Notice[];
  settings: Settings;
  stats: Stats;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "auto",
  sound: true,
  playAlong: false,
  notifications: true,
  pinned: false,
};

export function newGame(now = Date.now()): GameState {
  return {
    version: SAVE_VERSION,
    createdAt: now,
    composerName: "",
    onboarded: false,
    money: 0,
    renown: 0,
    keysConsumed: 0,
    lifetimeNotes: 0,
    spareNotes: 0,
    upgrades: { tempo: 1, artistry: 1, ambition: 1 },
    current: null,
    repertoire: [],
    inbox: [],
    settings: { ...DEFAULT_SETTINGS },
    stats: { premieres: 0, bestEarning: 0, totalEarned: 0, spent: 0 },
  };
}

let idCounter = 0;
export function makeId(prefix: string, now = Date.now()): string {
  idCounter = (idCounter + 1) % 10_000;
  return `${prefix}_${now.toString(36)}_${idCounter.toString(36)}_${randomSeed().toString(36).slice(0, 4)}`;
}

// ───────────────────────── transitions ─────────────────────────

export type GameEvent =
  | { type: "notes"; added: number }
  | { type: "premiere"; work: Work; notice: Notice }
  | { type: "started"; piece: Piece };

export interface Transition {
  state: GameState;
  events: GameEvent[];
}

/** Applies `keys` new keystrokes. Pure; `rng` only decides receptions. */
export function applyKeys(
  state: GameState,
  keys: number,
  now = Date.now(),
  rng: () => number = Math.random,
): Transition {
  const events: GameEvent[] = [];
  if (keys <= 0) return { state, events };
  let s: GameState = { ...state, keysConsumed: state.keysConsumed + keys };
  if (!s.current) {
    // Nothing on the stand: the composer sketches; keep a bounded pile of
    // spare notes so a lump of typing is not entirely wasted.
    const added = keys * notesPerKey(s.upgrades);
    s.spareNotes = Math.min(s.spareNotes + added, spareCap(s));
    return { state: s, events };
  }
  const added = keys * notesPerKey(s.upgrades);
  s.lifetimeNotes += added;
  events.push({ type: "notes", added });
  const piece: Piece = { ...s.current, notes: s.current.notes + added };
  if (piece.notes >= piece.target) {
    const overflow = piece.notes - piece.target;
    piece.notes = piece.target;
    const t = premiere({ ...s, current: piece }, now, rng);
    s = t.state;
    events.push(...t.events);
    s.spareNotes = Math.min(s.spareNotes + overflow, spareCap(s));
  } else {
    s.current = piece;
  }
  return { state: s, events };
}

/** Spare notes never exceed one piece of the largest unlocked form. */
export function spareCap(state: GameState): number {
  const unlocked = FORMS.filter((f) => formUnlocked(f, state.upgrades));
  const largest = unlocked[unlocked.length - 1] ?? FORMS[0]!;
  return largest.notes;
}

function premiere(state: GameState, now: number, rng: () => number): Transition {
  const piece = state.current!;
  const form = formById(piece.formId);
  const reception = drawReception(rng(), rng(), state.upgrades.artistry);
  const earned = payoutFor(form, state.upgrades, reception.factor);
  const work: Work = {
    id: piece.id,
    formId: piece.formId,
    title: piece.title,
    key: piece.key,
    mode: piece.mode,
    seed: piece.seed,
    notes: piece.target,
    earned,
    reception: reception.factor,
    receptionLine: reception.line,
    startedAt: piece.startedAt,
    completedAt: now,
    opus: piece.opus,
  };
  const notice: Notice = {
    id: makeId("n", now),
    kind: "premiere",
    workId: work.id,
    title: work.title,
    earned,
    line: reception.line,
    at: now,
    seen: false,
  };
  const s: GameState = {
    ...state,
    money: state.money + earned,
    renown: state.renown + renownFor(form),
    current: null,
    repertoire: [...state.repertoire, work],
    inbox: [...state.inbox, notice].slice(-20),
    stats: {
      ...state.stats,
      premieres: state.stats.premieres + 1,
      bestEarning: Math.max(state.stats.bestEarning, earned),
      totalEarned: state.stats.totalEarned + earned,
    },
  };
  return { state: s, events: [{ type: "premiere", work, notice }] };
}

export function canStart(state: GameState, formId: FormId): boolean {
  return !state.current && formUnlocked(formById(formId), state.upgrades);
}

/** Puts a new piece on the stand. Spare notes from the drawer are applied. */
export function startPiece(state: GameState, formId: FormId, now = Date.now(), seed = randomSeed()): Transition {
  if (!canStart(state, formId)) return { state, events: [] };
  const form = formById(formId);
  const opus = state.repertoire.length + 1;
  const t = generateTitle(formId, seed, opus);
  const piece: Piece = {
    id: makeId("p", now),
    formId,
    title: t.title,
    key: t.key,
    mode: t.mode,
    seed,
    notes: 0,
    target: form.notes,
    startedAt: now,
    opus,
  };
  let s: GameState = { ...state, current: piece };
  const events: GameEvent[] = [{ type: "started", piece }];
  if (s.spareNotes > 0) {
    const use = Math.min(s.spareNotes, form.notes - 1); // never auto-complete
    s = { ...s, spareNotes: s.spareNotes - use, current: { ...piece, notes: use }, lifetimeNotes: s.lifetimeNotes + use };
  }
  return { state: s, events };
}

export function renamePiece(state: GameState, title: string): GameState {
  if (!state.current) return state;
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!clean) return state;
  return { ...state, current: { ...state.current, title: clean } };
}

export function abandonPiece(state: GameState): GameState {
  if (!state.current) return state;
  // Sketches go in the drawer, bounded like everything else.
  const spare = Math.min(state.spareNotes + Math.floor(state.current.notes / 2), spareCap(state));
  return { ...state, current: null, spareNotes: spare };
}

export function canBuy(state: GameState, id: UpgradeId): boolean {
  const cost = upgradeCost(id, state.upgrades[id]);
  return cost !== null && state.money >= cost;
}

export function buyUpgrade(state: GameState, id: UpgradeId): GameState {
  const cost = upgradeCost(id, state.upgrades[id]);
  if (cost === null || state.money < cost) return state;
  return {
    ...state,
    money: state.money - cost,
    upgrades: { ...state.upgrades, [id]: state.upgrades[id] + 1 },
    stats: { ...state.stats, spent: state.stats.spent + cost },
  };
}

export function markInboxSeen(state: GameState): GameState {
  if (!state.inbox.some((n) => !n.seen)) return state;
  return { ...state, inbox: state.inbox.map((n) => (n.seen ? n : { ...n, seen: true })) };
}

export function dismissNotice(state: GameState, id: string): GameState {
  return { ...state, inbox: state.inbox.filter((n) => n.id !== id) };
}

export function unseenCount(state: GameState): number {
  return state.inbox.filter((n) => !n.seen).length;
}

export function setSettings(state: GameState, patch: Partial<Settings>): GameState {
  return { ...state, settings: { ...state.settings, ...patch } };
}

export function progress(state: GameState): number {
  if (!state.current) return 0;
  return Math.min(1, state.current.notes / state.current.target);
}

// ───────────────────────── persistence ─────────────────────────

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function num(v: unknown, d: number, min = -Infinity): number {
  return isNum(v) ? Math.max(min, v) : d;
}

/**
 * Turns whatever was on disk into a valid state. Unknown or damaged fields
 * fall back to defaults; a hopeless document yields `null` so the caller can
 * decide (and tell the user) rather than silently starting over.
 */
export function migrate(raw: unknown): GameState | null {
  if (!isObj(raw)) return null;
  const version = num(raw.version, 0);
  if (version > SAVE_VERSION) {
    // Newer app wrote this; be conservative but try.
  }
  const base = newGame(num(raw.createdAt, Date.now()));
  const up = isObj(raw.upgrades) ? raw.upgrades : {};
  const upgrades: Upgrades = {
    tempo: Math.min(upgradeDef("tempo").max, Math.floor(num(up.tempo, 1, 1))),
    artistry: Math.min(upgradeDef("artistry").max, Math.floor(num(up.artistry, 1, 1))),
    ambition: Math.min(upgradeDef("ambition").max, Math.floor(num(up.ambition, 1, 1))),
  };
  const st = isObj(raw.settings) ? raw.settings : {};
  const settings: Settings = {
    theme: st.theme === "paper" || st.theme === "night" || st.theme === "auto" ? st.theme : "auto",
    sound: typeof st.sound === "boolean" ? st.sound : DEFAULT_SETTINGS.sound,
    playAlong: typeof st.playAlong === "boolean" ? st.playAlong : DEFAULT_SETTINGS.playAlong,
    notifications: typeof st.notifications === "boolean" ? st.notifications : DEFAULT_SETTINGS.notifications,
    pinned: typeof st.pinned === "boolean" ? st.pinned : DEFAULT_SETTINGS.pinned,
  };
  const s0 = isObj(raw.stats) ? raw.stats : {};
  const state: GameState = {
    ...base,
    version: SAVE_VERSION,
    composerName: isStr(raw.composerName) ? raw.composerName.slice(0, 24) : "",
    onboarded: raw.onboarded === true,
    money: num(raw.money, 0, 0),
    renown: num(raw.renown, 0, 0),
    keysConsumed: num(raw.keysConsumed, 0, 0),
    lifetimeNotes: num(raw.lifetimeNotes, 0, 0),
    spareNotes: num(raw.spareNotes, 0, 0),
    upgrades,
    current: migratePiece(raw.current),
    repertoire: Array.isArray(raw.repertoire) ? raw.repertoire.map(migrateWork).filter((w): w is Work => !!w) : [],
    inbox: Array.isArray(raw.inbox) ? raw.inbox.map(migrateNotice).filter((n): n is Notice => !!n).slice(-20) : [],
    settings,
    stats: {
      premieres: num(s0.premieres, 0, 0),
      bestEarning: num(s0.bestEarning, 0, 0),
      totalEarned: num(s0.totalEarned, 0, 0),
      spent: num(s0.spent, 0, 0),
    },
  };
  if (state.current && state.current.notes > state.current.target) state.current.notes = state.current.target;
  state.spareNotes = Math.min(state.spareNotes, spareCap(state));
  return state;
}

function validFormId(v: unknown): FormId | null {
  return FORMS.some((f) => f.id === v) ? (v as FormId) : null;
}

function migratePiece(v: unknown): Piece | null {
  if (!isObj(v)) return null;
  const formId = validFormId(v.formId);
  if (!formId) return null;
  const form = formById(formId);
  const seed = num(v.seed, randomSeed());
  const opus = Math.max(1, Math.floor(num(v.opus, 1)));
  const t = generateTitle(formId, seed, opus);
  return {
    id: isStr(v.id) ? v.id : makeId("p"),
    formId,
    title: isStr(v.title) && v.title.trim() ? v.title : t.title,
    key: isStr(v.key) ? (v.key as KeyName) : t.key,
    mode: v.mode === "minor" ? "minor" : "major",
    seed,
    notes: num(v.notes, 0, 0),
    target: form.notes,
    startedAt: num(v.startedAt, Date.now()),
    opus,
  };
}

function migrateWork(v: unknown): Work | null {
  if (!isObj(v)) return null;
  const formId = validFormId(v.formId);
  if (!formId) return null;
  const seed = num(v.seed, 1);
  const opus = Math.max(1, Math.floor(num(v.opus, 1)));
  const t = generateTitle(formId, seed, opus);
  return {
    id: isStr(v.id) ? v.id : makeId("w"),
    formId,
    title: isStr(v.title) && v.title.trim() ? v.title : t.title,
    key: isStr(v.key) ? (v.key as KeyName) : t.key,
    mode: v.mode === "minor" ? "minor" : "major",
    seed,
    notes: Math.floor(num(v.notes, formById(formId).notes, 0)),
    earned: Math.floor(num(v.earned, 0, 0)),
    reception: num(v.reception, 1),
    receptionLine: isStr(v.receptionLine) ? v.receptionLine : "",
    startedAt: num(v.startedAt, 0),
    completedAt: num(v.completedAt, 0),
    opus,
  };
}

function migrateNotice(v: unknown): Notice | null {
  if (!isObj(v) || v.kind !== "premiere") return null;
  return {
    id: isStr(v.id) ? v.id : makeId("n"),
    kind: "premiere",
    workId: isStr(v.workId) ? v.workId : "",
    title: isStr(v.title) ? v.title : "",
    earned: Math.floor(num(v.earned, 0, 0)),
    line: isStr(v.line) ? v.line : "",
    at: num(v.at, 0),
    seen: v.seen === true,
  };
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/** Deterministic RNG for tests and simulations. */
export const seededRandom = mulberry32;
