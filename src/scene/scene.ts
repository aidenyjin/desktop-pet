/**
 * The room. Renders a 180×100 one-bit picture into an offscreen buffer and
 * blits it to the visible canvas at an integer scale so pixels stay crisp.
 */
import * as S from "./sprites";
import { skyAt, type SkyState } from "./sky";
import { mulberry32 } from "../game/rng";
import { WEAR_BROKEN_AT, WEAR_STUTTER_AT } from "../game/economy";

export const SCENE_W = 180;
export const SCENE_H = 100;
const FLOOR_Y = 86;

export type Mood = "idle" | "playing" | "dozing" | "premiere" | "thinking";

export interface SceneView {
  mood: Mood;
  /** Keystrokes per second, smoothed. Drives how lively the playing looks. */
  typingRate: number;
  tempoBpm: number;
  ink: string;
  paper: string;
  reduceMotion: boolean;
  /** 0 (pristine) – 100 (jammed). Shows as cracks; see economy.ts thresholds. */
  wear: number;
}

interface Particle {
  kind: "note" | "z" | "confetti" | "spark" | "sparkle" | "steam";
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  variant: number;
  seed: number;
  landed?: boolean;
}

/** 4×4 ordered-dither thresholds. */
const BAYER: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * Thinking mode sends the composer out for coffee: a single "journey" value
 * (0 = at the piano, 1 = at the kitchen window) drives position, room and
 * door state together, so the walk out and the walk back are the same
 * piecewise function run in opposite directions — no separate code paths.
 *
 *   0 ───────── .15 ── .22 [hidden, home→kitchen at .30] .35 ── .42 ───────── 1
 *   piano     door opens   through the doorway            door   walking   window
 *                                                          shuts
 */
const JOURNEY_SPEED = 1 / 1.8; // a one-way trip takes ~1.8s of walking time
const DOOR_OPEN_AT = 0.15;
const HIDDEN_FROM = 0.22;
const ROOM_SWITCH_AT = 0.3;
const HIDDEN_TO = 0.35;
const DOOR_SHUT_AT = 0.42;
/** Leg boundaries the journey eases between, in each direction. */
const JOURNEY_STOPS = [0, HIDDEN_FROM, HIDDEN_TO, 1];
const JOURNEY_STOPS_REV = [...JOURNEY_STOPS].reverse();

const LAYOUT = {
  piano: { x: 6, y: 42 },
  candle: { x: 10, y: 30 },
  flame: { x: 11, y: 26 },
  metronome: { x: 24, y: 30 },
  composer: { x: 46, y: 46 },
  homeDoor: { x: 160, y: 42 },
  rug: { x: 28, y: 83 },
  window: { x: 84, y: 24 },
  shelf: { x: 124, y: 30 },
  armchair: { x: 134, y: 60 },
  cat: { x: 146, y: 64 },
  clock: { x: 62, y: 24 },
  kitchenDoor: { x: 6, y: 42 },
  kitchenWindow: { x: 96, y: 24 },
  counter: { x: 136, y: 74 },
  composerAtKitchenDoor: 12,
  composerAtWindow: 102,
  notesFrom: { x: 39, y: 54 },
  zFrom: { x: 62, y: 44 },
};

export class Scene {
  private readonly canvas: HTMLCanvasElement;
  private readonly buf: HTMLCanvasElement;
  private readonly bctx: CanvasRenderingContext2D;
  private view: SceneView = { mood: "idle", typingRate: 0, tempoBpm: 60, ink: "#2e2a27", paper: "#b6c1b5", reduceMotion: false, wear: 0 };
  private spriteCache = new Map<string, HTMLCanvasElement>();
  private particles: Particle[] = [];
  private raf = 0;
  private running = false;
  private last = 0;
  private time = 0;
  private beatClock = 0;
  private beatIndex = 0;
  private blinkAt = 3;
  private blinkUntil = 0;
  private stretchAt = 10;
  private stretchUntil = 0;
  private tailAt = 6;
  private tailUntil = 0;
  private flameFrame = 0;
  private flameAt = 0;
  private premiereUntil = 0;
  private wakeUntil = 0;
  private joltUntil = 0;
  private prevMood: Mood = "idle";
  /** 0 = at the piano, 1 = at the kitchen window; see the journey diagram above. */
  private journey = 0;
  private windowX = LAYOUT.window.x;
  private windowY = LAYOUT.window.y;
  private zAt = 0;
  private steamAt = 0;
  private rng = mulberry32(7);
  private scale = 1;
  private windowInterior: Array<[number, number, number]> = []; // row, x0, x1 (inclusive) in window-local coords
  private interiorByRow: Array<[number, number] | undefined> = [];
  private cloudX = 0;
  private stars: Array<[number, number, number]> = [];
  private needsDraw = true;
  private sky: SkyState = skyAt(new Date());
  private clock: () => Date = () => new Date();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.buf = document.createElement("canvas");
    this.buf.width = SCENE_W;
    this.buf.height = SCENE_H;
    const ctx = this.buf.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.bctx = ctx;
    this.computeWindowInterior();
    const srng = mulberry32(11);
    for (let i = 0; i < 14; i++) {
      this.stars.push([2 + Math.floor(srng() * 25), 2 + Math.floor(srng() * 22), Math.floor(srng() * 1000)]);
    }
    this.resize();
  }

  /** Lets tests and screenshots pin the time of day. */
  setClock(fn: () => Date): void {
    this.clock = fn;
    this.sky = skyAt(fn());
    this.needsDraw = true;
  }

  setView(patch: Partial<SceneView>): void {
    const before = this.view;
    this.view = { ...this.view, ...patch };
    if (patch.ink && patch.ink !== before.ink) this.spriteCache.clear();
    if (patch.paper && patch.paper !== before.paper) this.spriteCache.clear();
    if (patch.mood && patch.mood !== before.mood) this.onMoodChange(before.mood, patch.mood);
    this.needsDraw = true;
  }

  private onMoodChange(from: Mood, to: Mood): void {
    if (to === "premiere") {
      this.premiereUntil = this.time + 3.2;
      this.spawnConfetti();
    }
    if (from === "dozing" && to === "playing") this.wakeUntil = this.time + 0.45;
    this.prevMood = from;
  }

  /** A few notes drift up from the keys. Called with the number of new keystrokes. */
  emitNotes(n: number): void {
    const count = Math.min(3, Math.max(1, Math.round(n / 2)));
    for (let i = 0; i < count; i++) {
      const j = this.rng();
      this.particles.push({
        kind: "note",
        x: LAYOUT.notesFrom.x + (j - 0.5) * 6,
        y: LAYOUT.notesFrom.y - i * 2,
        vx: (this.rng() - 0.5) * 3,
        vy: -11 - this.rng() * 5,
        age: -i * 0.12,
        life: 2.2 + this.rng() * 0.6,
        variant: this.rng() < 0.5 ? 0 : 1,
        seed: this.rng() * 6.28,
      });
    }
    if (this.particles.length > 60) this.particles.splice(0, this.particles.length - 60);
    this.needsDraw = true;
  }

  private spawnConfetti(): void {
    const n = this.view.reduceMotion ? 18 : 64;
    for (let i = 0; i < n; i++) {
      this.particles.push({
        kind: "confetti",
        x: this.rng() * SCENE_W,
        y: -4 - this.rng() * 30,
        vx: (this.rng() - 0.5) * 10,
        vy: 26 + this.rng() * 30,
        age: -this.rng() * 0.8,
        life: 5.5 + this.rng(),
        variant: this.rng() < 0.6 ? 2 : 3,
        seed: this.rng() * 6.28,
      });
    }
  }

  /** A jolt of spark debris from the keyboard when a jammed piano is struck. Self-throttled. */
  jolt(): void {
    if (this.time < this.joltUntil) return;
    this.joltUntil = this.time + 0.4;
    const originX = LAYOUT.piano.x + 27;
    const originY = LAYOUT.piano.y + 20;
    const n = this.view.reduceMotion ? 3 : 7;
    for (let i = 0; i < n; i++) {
      this.particles.push({
        kind: "spark",
        x: originX + (this.rng() - 0.5) * 6,
        y: originY + (this.rng() - 0.5) * 4,
        vx: (this.rng() - 0.5) * 26,
        vy: -8 - this.rng() * 14,
        age: 0,
        life: 0.35 + this.rng() * 0.25,
        variant: this.rng() < 0.5 ? 0 : 1,
        seed: this.rng() * 6.28,
      });
    }
    this.needsDraw = true;
  }

  /** A light, rising sparkle around the piano when it is repaired. */
  sparkle(): void {
    const originX = LAYOUT.piano.x + 13;
    const originY = LAYOUT.piano.y + 18;
    const n = this.view.reduceMotion ? 5 : 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28 + this.rng() * 0.4;
      this.particles.push({
        kind: "sparkle",
        x: originX + Math.cos(a) * 4,
        y: originY + Math.sin(a) * 10,
        vx: Math.cos(a) * 4,
        vy: -6 - this.rng() * 6,
        age: -this.rng() * 0.15,
        life: 1.0 + this.rng() * 0.5,
        variant: this.rng() < 0.5 ? 0 : 1,
        seed: this.rng() * 6.28,
      });
    }
    this.needsDraw = true;
  }

  resize(): void {
    const dpr = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 1)));
    const cssW = this.canvas.clientWidth || SCENE_W * 2;
    const cssScale = Math.max(1, Math.floor(cssW / SCENE_W));
    this.scale = cssScale * dpr;
    this.canvas.width = SCENE_W * this.scale;
    this.canvas.height = SCENE_H * this.scale;
    this.canvas.style.width = `${SCENE_W * cssScale}px`;
    this.canvas.style.height = `${SCENE_H * cssScale}px`;
    this.needsDraw = true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.step(dt);
      if (this.needsDraw) this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Advances the simulation by `dt` seconds and draws once (used by screenshots). */
  renderOnce(dt = 0): void {
    this.step(dt);
    this.draw();
  }

  // ───────────────────────── simulation ─────────────────────────

  private step(dt: number): void {
    const v = this.view;
    this.time += dt;
    this.sky = skyAt(this.clock());
    const lively = v.mood === "playing" || v.mood === "premiere" || this.particles.length > 0 || this.time < this.wakeUntil;
    // Frame pacing: lively scenes animate at full rate; quiet ones only need a few frames a second.
    const frameEvery = lively ? 1 / 30 : 1 / 8;
    this.beatClock += dt;
    if (this.beatClock < frameEvery && !this.needsDraw) return;
    const elapsed = this.beatClock;
    this.beatClock = 0;
    this.needsDraw = true;

    // Beats for the playing animation and the metronome.
    if (v.mood === "playing") {
      const bps = Math.max(0.8, Math.min(6, (v.tempoBpm / 60) * Math.max(0.8, Math.min(2.2, 0.6 + v.typingRate * 0.4))));
      this.beatIndex += elapsed * bps;
    }

    // Blinks.
    if (this.time > this.blinkAt) {
      this.blinkUntil = this.time + 0.12;
      this.blinkAt = this.time + 2.5 + this.rng() * 3.5;
    }
    // A stretch now and then while idle.
    if (v.mood === "idle" && this.time > this.stretchAt) {
      this.stretchUntil = this.time + 0.9;
      this.stretchAt = this.time + 9 + this.rng() * 9;
    }
    // The cat's tail.
    if (this.time > this.tailAt) {
      this.tailUntil = this.time + 0.5;
      this.tailAt = this.time + 6 + this.rng() * 8;
    }
    // Candle flicker.
    if (this.time > this.flameAt) {
      this.flameFrame = Math.floor(this.rng() * S.FLAME.length);
      this.flameAt = this.time + 0.12 + this.rng() * 0.2;
    }
    // Zzz.
    if (v.mood === "dozing" && this.time > this.zAt) {
      this.zAt = this.time + 1.6;
      this.particles.push({
        kind: "z",
        x: LAYOUT.zFrom.x,
        y: LAYOUT.zFrom.y,
        vx: 3,
        vy: -5,
        age: 0,
        life: 3,
        variant: this.rng() < 0.5 ? 0 : 1,
        seed: this.rng() * 6.28,
      });
    }
    // Clouds.
    this.cloudX = (this.cloudX + elapsed * 0.6) % 60;

    // Out for coffee while thinking, and back again once it stops — see the
    // journey diagram by LAYOUT for what each stretch of 0..1 means. Eased
    // within each leg (piano→door, hidden crossing, door→window) so every
    // start and stop is a gentle ease rather than a constant robotic pace.
    const journeyTarget = v.mood === "thinking" ? 1 : 0;
    const jd = journeyTarget - this.journey;
    if (Math.abs(jd) > 0.0008) {
      const dir = Math.sign(jd);
      const bounds = dir > 0 ? JOURNEY_STOPS : JOURNEY_STOPS_REV;
      const segEnd = bounds.find((b) => (dir > 0 ? b > this.journey + 1e-6 : b < this.journey - 1e-6)) ?? journeyTarget;
      const segStart = bounds
        .slice()
        .reverse()
        .find((b) => (dir > 0 ? b <= this.journey + 1e-6 : b >= this.journey - 1e-6)) ?? (dir > 0 ? 0 : 1);
      const span = Math.abs(segEnd - segStart) || 1;
      const within = Math.max(0, Math.min(1, Math.abs(this.journey - segStart) / span));
      const ease = 0.25 + 0.9 * Math.sin(within * Math.PI); // slow-fast-slow across each leg
      const step = dir * Math.min(Math.abs(jd), JOURNEY_SPEED * ease * elapsed);
      this.journey = Math.max(0, Math.min(1, this.journey + step));
    }
    // A little steam off the mug while settled at the window.
    if (this.journey >= 1 && this.time > this.steamAt) {
      this.steamAt = this.time + 0.9 + this.rng() * 0.5;
      this.particles.push({
        kind: "steam",
        x: LAYOUT.composerAtWindow - 5,
        y: LAYOUT.composer.y + 7,
        vx: (this.rng() - 0.5) * 3,
        vy: -6 - this.rng() * 3,
        age: 0,
        life: 1.6 + this.rng() * 0.5,
        variant: 0,
        seed: this.rng() * 6.28,
      });
    }

    // Particles.
    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.age += elapsed;
      if (p.age < 0) {
        keep.push(p);
        continue;
      }
      if (p.kind === "confetti") {
        if (!p.landed) {
          p.vy = Math.min(p.vy + 20 * elapsed, 70);
          p.x += (p.vx + Math.sin(p.age * 4 + p.seed) * 10) * elapsed;
          p.y += p.vy * elapsed;
          if (p.y >= FLOOR_Y - 1) {
            p.y = FLOOR_Y - 1;
            p.landed = true;
          }
        }
      } else if (p.kind === "spark") {
        // Short-lived debris: gravity, no bounce, gone before it lands.
        p.vy += 30 * elapsed;
        p.x += p.vx * elapsed;
        p.y += p.vy * elapsed;
      } else if (p.kind === "note" || p.kind === "sparkle") {
        p.x += (p.vx + Math.sin(p.age * 3 + p.seed) * 5) * elapsed;
        p.y += p.vy * elapsed;
      } else {
        p.x += p.vx * elapsed;
        p.y += p.vy * elapsed;
      }
      if (p.age < p.life && p.y > -10 && p.x > -8 && p.x < SCENE_W + 8) keep.push(p);
    }
    this.particles = keep;
  }

  // ───────────────────────── drawing ─────────────────────────

  /** Which room is on screen right now, per the journey value. */
  private get inKitchen(): boolean {
    return this.journey >= ROOM_SWITCH_AT;
  }

  private draw(): void {
    this.needsDraw = false;
    const ctx = this.bctx;
    ctx.clearRect(0, 0, SCENE_W, SCENE_H);

    if (this.inKitchen) {
      this.drawWindow(LAYOUT.kitchenWindow.x, LAYOUT.kitchenWindow.y);
      this.blit(S.COUNTER, LAYOUT.counter.x, LAYOUT.counter.y);
      this.drawDoor(LAYOUT.kitchenDoor.x, LAYOUT.kitchenDoor.y);
      this.drawComposer();
    } else {
      this.drawWindow(LAYOUT.window.x, LAYOUT.window.y);
      this.blit(S.SHELF, LAYOUT.shelf.x, LAYOUT.shelf.y);
      this.drawClock();
      this.blit(S.RUG, LAYOUT.rug.x, LAYOUT.rug.y);
      this.blit(S.PIANO, LAYOUT.piano.x, LAYOUT.piano.y);
      this.drawPianoWear();
      this.blit(S.CANDLE, LAYOUT.candle.x, LAYOUT.candle.y);
      this.blit(S.FLAME[this.flameFrame] ?? S.FLAME[0]!, LAYOUT.flame.x, LAYOUT.flame.y);
      this.drawMetronome();
      this.blit(S.ARMCHAIR, LAYOUT.armchair.x, LAYOUT.armchair.y);
      this.blit(this.time < this.tailUntil ? S.CAT[1]! : S.CAT[0]!, LAYOUT.cat.x, LAYOUT.cat.y);
      this.drawDoor(LAYOUT.homeDoor.x, LAYOUT.homeDoor.y);
      this.drawComposer();
    }
    this.drawParticles();

    // Floor line.
    ctx.fillStyle = this.view.ink;
    ctx.fillRect(0, FLOOR_Y, SCENE_W, 1);

    // Blit to the screen.
    const out = this.canvas.getContext("2d");
    if (!out) return;
    out.imageSmoothingEnabled = false;
    out.clearRect(0, 0, this.canvas.width, this.canvas.height);
    out.drawImage(this.buf, 0, 0, SCENE_W * this.scale, SCENE_H * this.scale);
  }

  /** The doorway to the other room; open while the composer is passing through it. */
  private drawDoor(x: number, y: number): void {
    const j = this.journey;
    const open = this.inKitchen ? j < DOOR_SHUT_AT : j > DOOR_OPEN_AT;
    this.blit(open ? S.DOOR_OPEN : S.DOOR_CLOSED, x, y);
  }

  private drawComposer(): void {
    const v = this.view;
    const j = this.journey;
    const y = LAYOUT.composer.y;

    // Hidden mid-doorway while the room swaps out from under them.
    if (j > HIDDEN_FROM && j < HIDDEN_TO) return;

    let x: number;
    let atRest: "home" | "window" | null = null;
    if (!this.inKitchen) {
      // 0 (piano) .. DOOR_OPEN_AT's room's doorway at HIDDEN_FROM
      const t = Math.min(1, j / HIDDEN_FROM);
      x = Math.round(LAYOUT.composer.x + (LAYOUT.homeDoor.x - LAYOUT.composer.x) * t);
      if (j <= 0.001) atRest = "home";
    } else {
      // HIDDEN_TO's kitchen doorway .. 1 (window)
      const t = Math.max(0, Math.min(1, (j - HIDDEN_TO) / (1 - HIDDEN_TO)));
      x = Math.round(LAYOUT.composerAtKitchenDoor + (LAYOUT.composerAtWindow - LAYOUT.composerAtKitchenDoor) * t);
      if (j >= 0.999) atRest = "window";
    }

    if (atRest === "window") {
      // Arrived: stands at the window with a mug, a slow breathing sway —
      // no rush now that the room's been reached.
      const sway = v.reduceMotion ? 0 : Math.round(Math.sin(this.time * 0.7) * 1);
      this.blit(S.LEGS_STAND, x, y + 26);
      this.blit(S.TORSO, x, y + 14 + sway);
      this.blit(S.ARM_CHIN, x - 10, y + 12 + sway);
      this.blit(S.HEAD_OPEN, x, y - 1 + sway);
      this.blit(S.MUG, x - 7, y + 9 + sway);
      return;
    }
    if (atRest !== "home") {
      // Crossing a room: a plain stride with a light step-to-step bob.
      const strideFrame = Math.floor(this.time / 0.16) % 2;
      const bob = v.reduceMotion ? 0 : strideFrame === 0 ? 0 : -1;
      this.blit(strideFrame ? S.LEGS_WALK_A : S.LEGS_WALK_B, x, y + 26);
      this.blit(S.TORSO, x, y + 14 + bob);
      this.blit(S.ARM_REST, x - 10, y + 12 + bob);
      this.blit(S.HEAD_OPEN, x, y + bob);
      return;
    }

    const beat = Math.floor(this.beatIndex) % 2;
    let headDx = 0;
    let headDy = 0;
    let torsoDy = 0;
    let head = S.HEAD_OPEN;
    let arm: S.Sprite | null = S.ARM_REST;
    let armsUp = false;

    const waking = this.time < this.wakeUntil;
    const premiere = v.mood === "premiere" || this.time < this.premiereUntil;
    const broken = v.wear >= WEAR_BROKEN_AT;
    const jolted = this.time < this.joltUntil;

    if (premiere) {
      head = S.HEAD_HAPPY;
      armsUp = true;
      const bounce = Math.floor(this.time * 5) % 2;
      if (!v.reduceMotion) {
        headDy = -bounce * 2;
        torsoDy = -bounce;
      }
    } else if (waking) {
      head = S.HEAD_OPEN;
      armsUp = true;
      headDy = -1;
    } else if (v.mood === "thinking") {
      head = S.HEAD_THINKING;
      arm = S.ARM_CHIN;
      const settle = Math.floor(this.time / 2.4) % 2;
      torsoDy = v.reduceMotion ? 0 : settle;
    } else if (v.mood === "playing") {
      if (broken) {
        // Nothing is landing; a resigned, stuck-in-place attempt.
        arm = S.ARM_KEYS_A;
        headDy = 1;
      } else if (v.wear >= WEAR_STUTTER_AT && !v.reduceMotion && Math.floor(this.beatIndex) % 5 === 0) {
        arm = S.ARM_KEYS_A; // a sticking key breaks the usual alternation
        headDy = 1;
      } else {
        arm = beat ? S.ARM_KEYS_A : S.ARM_KEYS_B;
        if (!v.reduceMotion) headDy = beat ? 0 : -1;
      }
    } else if (v.mood === "dozing") {
      head = S.HEAD_CLOSED;
      headDx = -1;
      headDy = 2;
      const breath = Math.floor(this.time / 1.6) % 2;
      torsoDy = v.reduceMotion ? 0 : breath;
      arm = S.ARM_REST;
    } else {
      // idle
      if (this.time < this.stretchUntil) {
        armsUp = true;
        headDy = -1;
      }
    }
    if (jolted && !v.reduceMotion) {
      head = S.HEAD_CLOSED;
      headDx -= 2;
      headDy += 1;
    }
    if (this.time < this.blinkUntil && !premiere && !jolted && v.mood !== "dozing" && v.mood !== "thinking") head = S.HEAD_CLOSED;

    this.blit(S.STOOL, x, y + 26);
    this.blit(S.TORSO, x, y + 14 + torsoDy);
    if (armsUp) this.blit(S.ARMS_UP, x - 3, y + 8 + torsoDy);
    else if (arm) this.blit(arm, x - 10, y + 12 + torsoDy);
    this.blit(head, x + headDx, y + headDy + torsoDy);
  }

  /** Cracks that appear across the piano's panels as wear climbs, worst at full wear. */
  private drawPianoWear(): void {
    const wear = this.view.wear;
    if (wear < WEAR_BROKEN_AT * 0.3) return;
    const ctx = this.bctx;
    ctx.fillStyle = this.view.ink;
    const { x, y } = LAYOUT.piano;
    const px = (dx: number, dy: number) => ctx.fillRect(x + dx, y + dy, 1, 1);
    // Each crack is a short jagged line in panel-local coordinates.
    const CRACKS: ReadonlyArray<{ at: number; points: ReadonlyArray<[number, number]> }> = [
      { at: WEAR_BROKEN_AT * 0.3, points: [[10, 28], [11, 29], [11, 30], [12, 31], [12, 32]] },
      { at: WEAR_BROKEN_AT * 0.6, points: [[17, 33], [18, 32], [18, 31], [19, 30], [19, 29], [20, 28]] },
      { at: WEAR_BROKEN_AT * 0.85, points: [[6, 5], [7, 6], [7, 7], [8, 8]] },
      { at: WEAR_BROKEN_AT, points: [[14, 36], [15, 36], [14, 37], [16, 37], [15, 38]] },
    ];
    for (const crack of CRACKS) {
      if (wear < crack.at) continue;
      for (const [dx, dy] of crack.points) px(dx, dy);
    }
  }

  private drawMetronome(): void {
    const { x, y } = LAYOUT.metronome;
    this.blit(S.METRONOME, x, y);
    const ctx = this.bctx;
    ctx.fillStyle = this.view.ink;
    // Pendulum: from the base centre up 9px, swinging when playing.
    const swinging = this.view.mood === "playing" && !this.view.reduceMotion;
    const angle = swinging ? Math.sin(this.beatIndex * Math.PI) * 0.55 : 0;
    const cx = x + 4;
    const cy = y + 9;
    for (let i = 1; i <= 8; i++) {
      const px = Math.round(cx + Math.sin(angle) * i);
      const py = Math.round(cy - Math.cos(angle) * i);
      ctx.fillRect(px, py, 1, 1);
    }
    const wx = Math.round(cx + Math.sin(angle) * 5);
    const wy = Math.round(cy - Math.cos(angle) * 5);
    ctx.fillRect(wx - 1, wy, 3, 1);
  }

  private drawClock(): void {
    const { x, y } = LAYOUT.clock;
    this.blit(S.CLOCK, x, y);
    const d = this.clock();
    const ctx = this.bctx;
    ctx.fillStyle = this.view.ink;
    const cx = x + 5;
    const cy = y + 5;
    const hourAngle = ((d.getHours() % 12) + d.getMinutes() / 60) * (Math.PI / 6);
    const minAngle = d.getMinutes() * (Math.PI / 30);
    for (let i = 1; i <= 2; i++) ctx.fillRect(Math.round(cx + Math.sin(hourAngle) * i), Math.round(cy - Math.cos(hourAngle) * i), 1, 1);
    for (let i = 1; i <= 3; i++) ctx.fillRect(Math.round(cx + Math.sin(minAngle) * i), Math.round(cy - Math.cos(minAngle) * i), 1, 1);
    ctx.fillRect(cx, cy, 1, 1);
  }

  private computeWindowInterior(): void {
    const rows = S.WINDOW.rows;
    for (let r = 0; r < rows.length - 2; r++) {
      const row = rows[r]!;
      const first = row.indexOf("#");
      const last = row.lastIndexOf("#");
      if (first < 0 || last - first < 2) continue;
      this.windowInterior.push([r, first + 1, last - 1]);
      this.interiorByRow[r] = [first + 1, last - 1];
    }
  }

  private inWindow(lx: number, ly: number): boolean {
    const row = ly >= 0 ? this.interiorByRow[ly] : undefined;
    return !!row && lx >= row[0] && lx <= row[1];
  }

  private drawWindow(x: number, y: number): void {
    const ctx = this.bctx;
    this.windowX = x;
    this.windowY = y;
    const sky = this.sky;
    ctx.fillStyle = this.view.ink;

    // Sky dots: an ordered dither that is dense at the top of the night sky
    // and thins out towards the horizon; lighter at dusk and dawn, gone by day.
    const density = sky.phase === "night" ? 0.62 : sky.phase === "dusk" ? 0.18 + sky.t * 0.3 : sky.phase === "dawn" ? 0.4 - sky.t * 0.35 : 0;
    if (density > 0) {
      for (const [r, x0, x1] of this.windowInterior) {
        if (r > 27) continue;
        const rowFade = Math.max(0, 1 - r / 26);
        const level = density * rowFade;
        for (let lx = x0; lx <= x1; lx++) {
          if (BAYER[r & 3]![lx & 3]! / 16 < level) ctx.fillRect(x + lx, y + r, 1, 1);
        }
      }
    }
    // Stars at night (twinkle), moon; sun by day with clouds.
    if (sky.rain) {
      // Overcast: no sun, moon or stars; a couple of low clouds instead.
      const cx = Math.round(this.cloudX) - 12;
      this.blitMasked(S.CLOUD, x + cx, y + 8, true);
      this.blitMasked(S.CLOUD, x + ((cx + 30) % 60) - 8, y + 16, true);
    } else if (sky.phase === "night") {
      for (const [sx, sy, ph] of this.stars) {
        const twinkle = Math.floor(this.time * 1.5 + ph) % 3 !== 0;
        if (twinkle && this.inWindow(sx, sy)) this.punch(x + sx, y + sy);
      }
      const mx = 4 + Math.round(sky.t * 16);
      this.blitMasked(S.MOON, x + mx, y + 5, true);
    } else {
      const arc = sky.phase === "day" ? sky.t : sky.phase === "dawn" ? 0 : 1;
      const sx = 4 + Math.round(arc * 16);
      const sy = sky.phase === "day" ? 6 + Math.round(Math.abs(arc - 0.5) * 2 * 10) : 22;
      this.blitMasked(S.SUN, x + sx, y + sy, false);
      if (!sky.rain) {
        const cx = Math.round(this.cloudX) - 12;
        this.blitMasked(S.CLOUD, x + cx, y + 12, false);
        this.blitMasked(S.CLOUD, x + ((cx + 28) % 60) - 6, y + 20, false);
      }
    }
    if (sky.rain) {
      // Sparse slanted dashes marching downwards.
      const off = Math.floor(this.time * 14) % 9;
      for (const [r, x0, x1] of this.windowInterior) {
        for (let lx = x0; lx <= x1; lx++) {
          const phase = (lx * 3 + r + off) % 9;
          const column = (lx * 5 + Math.floor(r / 9) * 3) % 4 === 0;
          if (column && phase < 2) ctx.fillRect(x + lx, y + r, 1, 1);
        }
      }
    }
    // Hills and pines, then the frame on top.
    this.blitMasked(S.HILLS, x + 1, y + 26, false);
    this.blit(S.WINDOW, x, y);
  }

  /** Draws a paper-coloured pixel (a star in a dotted sky). */
  private punch(px: number, py: number): void {
    const ctx = this.bctx;
    ctx.fillStyle = this.view.ink;
    ctx.fillRect(px, py, 1, 1);
    ctx.fillStyle = this.view.paper;
    ctx.fillRect(px - 1, py, 1, 1);
    ctx.fillRect(px + 1, py, 1, 1);
    ctx.fillRect(px, py - 1, 1, 1);
    ctx.fillRect(px, py + 1, 1, 1);
  }

  /** Blits a sprite but only inside the window opening. `halo` erases dots behind it first. */
  private blitMasked(sp: S.Sprite, px: number, py: number, halo: boolean): void {
    const ctx = this.bctx;
    const wx = this.windowX;
    const wy = this.windowY;
    if (halo) {
      ctx.fillStyle = this.view.paper;
      for (let r = -1; r <= sp.h; r++) {
        for (let c = -1; c <= sp.w; c++) {
          const gx = px + c;
          const gy = py + r;
          if (this.inWindow(gx - wx, gy - wy)) ctx.fillRect(gx, gy, 1, 1);
        }
      }
    }
    ctx.fillStyle = this.view.ink;
    for (let r = 0; r < sp.h; r++) {
      const row = sp.rows[r]!;
      for (let c = 0; c < sp.w; c++) {
        if (row[c] !== "#") continue;
        const gx = px + c;
        const gy = py + r;
        if (this.inWindow(gx - wx, gy - wy)) ctx.fillRect(gx, gy, 1, 1);
      }
    }
  }

  private drawParticles(): void {
    const ctx = this.bctx;
    for (const p of this.particles) {
      if (p.age < 0) continue;
      const px = Math.round(p.x);
      const py = Math.round(p.y);
      if (p.kind === "note") {
        const fading = p.age > p.life * 0.72;
        if (fading && Math.floor(p.age * 12) % 2 === 0) continue;
        this.blitHalo(p.variant === 0 ? S.NOTE_A : S.NOTE_B, px, py);
      } else if (p.kind === "z") {
        const fading = p.age > p.life * 0.7;
        if (fading && Math.floor(p.age * 10) % 2 === 0) continue;
        this.blitHalo(p.variant === 0 ? S.Z_SMALL : S.Z_BIG, px, py);
      } else if (p.kind === "spark") {
        ctx.fillStyle = this.view.ink;
        ctx.fillRect(px, py, p.variant === 0 ? 2 : 1, p.variant === 0 ? 1 : 2);
      } else if (p.kind === "sparkle") {
        const fading = p.age > p.life * 0.6;
        if (fading && Math.floor(p.age * 14) % 2 === 0) continue;
        ctx.fillStyle = this.view.ink;
        if (p.variant === 0) {
          ctx.fillRect(px, py - 1, 1, 3);
          ctx.fillRect(px - 1, py, 3, 1);
        } else {
          ctx.fillRect(px, py, 1, 1);
        }
      } else if (p.kind === "steam") {
        // A soft wisp, faint from the start and fading further as it rises.
        const alpha = (1 - p.age / p.life) * 0.5;
        if (alpha <= 0.05) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.view.ink;
        ctx.fillRect(px, py, 1, 1);
        ctx.globalAlpha = 1;
      } else {
        const fadeOut = p.age > p.life - 1.2 && Math.floor(p.age * 10) % 2 === 0;
        if (fadeOut) continue;
        ctx.fillStyle = this.view.ink;
        const spin = Math.floor(p.age * 6 + p.seed) % 2 === 0;
        if (p.variant === 2) {
          if (spin) ctx.fillRect(px, py, 2, 2);
          else ctx.fillRect(px, py, 2, 1);
        } else if (spin) {
          ctx.fillRect(px, py, 3, 3);
        } else {
          ctx.fillRect(px + 1, py, 1, 3);
          ctx.fillRect(px, py + 1, 3, 1);
        }
      }
    }
  }

  /** Sprite with a one-pixel paper outline so it stays readable over furniture. */
  private blitHalo(sp: S.Sprite, px: number, py: number): void {
    const halo = this.cached(sp, this.view.paper);
    const ctx = this.bctx;
    ctx.drawImage(halo, px - 1, py);
    ctx.drawImage(halo, px + 1, py);
    ctx.drawImage(halo, px, py - 1);
    ctx.drawImage(halo, px, py + 1);
    this.blit(sp, px, py);
  }

  private blit(sp: S.Sprite, px: number, py: number): void {
    this.bctx.drawImage(this.cached(sp, this.view.ink), px, py);
  }

  private cached(sp: S.Sprite, color: string): HTMLCanvasElement {
    const key = `${color}:${sp.rows.join("|")}`;
    let c = this.spriteCache.get(key);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = sp.w;
    c.height = sp.h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = color;
    for (let r = 0; r < sp.h; r++) {
      const row = sp.rows[r]!;
      let start = -1;
      for (let x = 0; x <= sp.w; x++) {
        const on = x < sp.w && row[x] === "#";
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          ctx.fillRect(start, r, x - start, 1);
          start = -1;
        }
      }
    }
    this.spriteCache.set(key, c);
    return c;
  }
}
