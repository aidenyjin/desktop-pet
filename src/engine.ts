/**
 * The heartbeat: pulls the keystroke total from the host, feeds it to the
 * game, and decides what the composer is doing right now.
 */
import type { Bridge } from "./bridge";
import type { GameStore } from "./store";
import { applyKeys, observeTyping, type GameEvent } from "./game/state";
import { tempoBpm } from "./game/economy";
import type { Scene, Mood } from "./scene/scene";

const IDLE_AFTER_S = 1.8;
const DOZE_AFTER_S = 120;
const PREMIERE_S = 3.2;

export interface EngineHooks {
  onEvents(events: GameEvent[]): void;
  onKeys(n: number): void;
}

const POLL_VISIBLE_MS = 150;
const POLL_HIDDEN_MS = 1000;

export class Engine {
  private timer: number | undefined;
  private visible = true;
  private lastKeyAt = -Infinity;
  private premiereAt = -Infinity;
  private rate = 0;
  private lastTick = performance.now();
  private stopped = false;
  private consecutiveErrors = 0;

  constructor(
    private readonly bridge: Bridge,
    private readonly store: GameStore,
    private readonly scene: Scene,
    private readonly hooks: EngineHooks,
  ) {}

  start(): void {
    this.stopped = false;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (v) this.schedule(0);
  }

  /** Current typing rate in keys per second (smoothed). */
  typingRate(): number {
    return this.rate;
  }

  /** Aligns the consumed counter with the host total without applying a delta. */
  async resync(): Promise<void> {
    const total = await this.bridge.keyTotal();
    this.store.update((s) => (s.keysConsumed === total ? s : { ...s, keysConsumed: total }), { immediate: true });
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    const now = performance.now();
    const dt = Math.max(0.001, (now - this.lastTick) / 1000);
    this.lastTick = now;
    try {
      const total = await this.bridge.keyTotal();
      const state = this.store.get();
      let delta = total - state.keysConsumed;
      if (delta < 0) {
        // The host counter went backwards (ledger removed?). Resync quietly.
        this.store.update((s) => ({ ...s, keysConsumed: total }));
        delta = 0;
      }
      // Exponential moving average of the typing rate — updated before
      // applyKeys so note value reacts to a *sustained* pace, not this
      // single tick's instantaneous (and often bursty) sample. Capped so
      // one huge one-off batch (a catch-up after the panel was hidden, a
      // test harness fast-forwarding) can't spike it on its own — only a
      // pace held across several ticks actually raises the average.
      const instant = Math.min(60, delta / dt);
      const alpha = 1 - Math.exp(-dt / 1.2);
      this.rate += (instant - this.rate) * alpha;
      if (this.rate < 0.05) this.rate = 0;

      // Learn the player's pace from how they actually type, and run the
      // clock on playing too hard. Every tick, not just the ones with
      // keystrokes, so backing off clears the warning while idle too.
      if (state.onboarded) this.store.update((s) => observeTyping(s, this.rate, dt));

      if (delta > 0 && state.onboarded) {
        // Re-read: observeTyping above has already moved the state on, and
        // applyKeys replaces it wholesale.
        const t = applyKeys(this.store.get(), delta, Date.now(), Math.random, this.rate);
        this.store.update(() => t.state, { immediate: t.events.some((e) => e.type === "premiere") });
        const broken = t.state.pianoBroken;
        // A broken piano still means you're at the keys, not away.
        this.lastKeyAt = now / 1000;
        this.hooks.onKeys(delta);
        if (t.events.length) this.hooks.onEvents(t.events);
        if (t.events.some((e) => e.type === "premiere")) this.premiereAt = now / 1000;
        if (this.visible) {
          // A broken piano gets both: a jolt of debris off the keys, and the
          // notes themselves coming out sour and falling instead of rising.
          if (broken) this.scene.jolt();
          this.scene.emitNotes(delta, broken);
        }
      }
      this.consecutiveErrors = 0;
    } catch (e) {
      this.consecutiveErrors++;
      if (this.consecutiveErrors < 3) console.warn("tick failed", e);
    }
    this.updateMood(now / 1000);
    this.schedule(this.visible ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
  }

  /** Called when a premiere is triggered outside the tick (tests, dev). */
  celebrate(): void {
    this.premiereAt = performance.now() / 1000;
    this.updateMood(performance.now() / 1000);
  }

  private updateMood(nowS: number): void {
    const state = this.store.get();
    let mood: Mood;
    if (nowS - this.premiereAt < PREMIERE_S) mood = "premiere";
    else if (nowS - this.lastKeyAt < IDLE_AFTER_S) mood = "playing";
    else if (nowS - this.lastKeyAt > DOZE_AFTER_S || this.lastKeyAt === -Infinity) mood = "dozing";
    else mood = "idle";
    if (!state.current && mood === "playing") mood = "idle";
    this.scene.setView({ mood, typingRate: this.rate, tempoBpm: tempoBpm(state.upgrades.tempo), broken: state.pianoBroken });
  }

  /** A fresh session starts the composer awake, not dozing. */
  wake(): void {
    this.lastKeyAt = performance.now() / 1000 - IDLE_AFTER_S - 1;
    this.updateMood(performance.now() / 1000);
  }
}
