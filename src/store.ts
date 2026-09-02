/**
 * Holds the game state, persists it, and lets the UI subscribe to changes.
 * Every mutation goes through `update`, which is where saving is scheduled.
 */
import type { Bridge } from "./bridge";
import { migrate, newGame, serialize, unseenCount, type GameState } from "./game/state";

export type Listener = (state: GameState, prev: GameState) => void;

export class GameStore {
  private state: GameState;
  private listeners = new Set<Listener>();
  private saveTimer: number | undefined;
  private lastSavedJson = "";
  private saving = false;
  private pendingSave = false;
  /** Set when the save on disk could not be read, so the UI can say so once. */
  recoveredFromBackup = false;
  loadFailed = false;

  constructor(private readonly bridge: Bridge) {
    this.state = newGame();
  }

  get(): GameState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await this.bridge.loadSave();
    } catch (e) {
      console.warn("load failed", e);
      this.loadFailed = true;
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        const migrated = migrate(parsed);
        if (migrated) {
          this.state = migrated;
          this.lastSavedJson = raw;
        } else {
          this.loadFailed = true;
        }
      } catch {
        this.loadFailed = true;
      }
    }
  }

  /** Applies a pure transition and notifies listeners. */
  update(fn: (s: GameState) => GameState, opts: { immediate?: boolean } = {}): GameState {
    const prev = this.state;
    const next = fn(prev);
    if (next === prev) return prev;
    this.state = next;
    for (const l of this.listeners) l(next, prev);
    this.scheduleSave(opts.immediate ? 0 : 900);
    return next;
  }

  /** Replaces the state wholesale (reset / onboarding). */
  replace(next: GameState): void {
    this.update(() => next, { immediate: true });
  }

  private scheduleSave(delay: number): void {
    if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), delay);
  }

  /** Writes now if anything changed. Safe to call often. */
  async flush(): Promise<void> {
    if (this.saveTimer !== undefined) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    const json = serialize(this.state);
    if (json === this.lastSavedJson) return;
    if (this.saving) {
      this.pendingSave = true;
      return;
    }
    this.saving = true;
    try {
      await this.bridge.writeSave(json);
      this.lastSavedJson = json;
    } catch (e) {
      console.warn("save failed", e);
    } finally {
      this.saving = false;
      if (this.pendingSave) {
        this.pendingSave = false;
        void this.flush();
      }
    }
  }

  unseen(): number {
    return unseenCount(this.state);
  }
}
