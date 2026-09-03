/**
 * The mini widget: a small, draggable stand-in for the full panel.
 *
 * It is a wide rectangle in two halves. The left half reuses the same
 * animated scene (cropped and zoomed via CSS onto the piano, the composer
 * and the window) so whatever they're up to — playing, dozing, celebrating —
 * still reads at a glance. The crop stops short of the shelf and the
 * armchair; that side of the room is given over instead to a small readout:
 * money, what is on the stand, how far along it is, and a button back to
 * the full panel.
 */
import { formatMoney } from "../game/economy";
import { progress, type GameState } from "../game/state";
import { h, icon } from "./dom";

const DRAG_THRESHOLD = 4;

export interface MiniOverlay {
  el: HTMLElement;
  badge: HTMLElement;
  update(state: GameState, unseen: number): void;
}

export interface MiniOptions {
  /** The expand button was pressed; go back to the full panel. */
  onExpand: () => void;
}

/** Builds the mini readout — money, piece, progress, expand — and appends it to `card`. */
export function createMiniOverlay(card: HTMLElement, opts: MiniOptions): MiniOverlay {
  const money = h("div", { class: "mini-money" }, "$0");
  const expand = h(
    "button",
    { class: "mini-expand", "aria-label": "Open the full panel", title: "Open panel", onClick: () => opts.onExpand() },
    icon("expand"),
  );
  const title = h("div", { class: "mini-title" }, "Empty stand");
  const fill = h("i");
  const bar = h("div", { class: "mini-bar", "aria-hidden": "true" }, fill);
  const percent = h("div", { class: "mini-percent" }, "0%");
  const badge = h("div", { class: "mini-badge", "aria-hidden": "true" });
  const panel = h(
    "div",
    { class: "mini-panel" },
    h("div", { class: "mini-row" }, money, expand),
    title,
    h("div", { class: "mini-row mini-progress" }, bar, percent),
  );
  card.append(panel, badge);

  let lastMoney = -1;
  let lastTitle = "";
  let lastPercent = -1;
  let lastUnseen: boolean | null = null;

  return {
    el: panel,
    badge,
    update(state: GameState, unseen: number) {
      const m = Math.floor(state.money);
      if (m !== lastMoney) {
        lastMoney = m;
        money.textContent = formatMoney(m);
      }
      const t = state.current ? state.current.title : "Empty stand";
      if (t !== lastTitle) {
        lastTitle = t;
        title.textContent = t;
        title.title = t;
        title.classList.toggle("is-empty", !state.current);
      }
      const p = Math.max(0, Math.min(1, progress(state)));
      const pct = Math.floor(p * 100);
      if (pct !== lastPercent) {
        lastPercent = pct;
        fill.style.width = `${p * 100}%`;
        percent.textContent = `${pct}%`;
      }
      const on = unseen > 0;
      if (on !== lastUnseen) {
        lastUnseen = on;
        badge.classList.toggle("is-on", on);
      }
    },
  };
}

export interface DragOptions {
  isTauri: boolean;
  /** Checked on pointerdown; return false to ignore this press entirely (wrong mode, landed on a real button, …). */
  enabled: (target: EventTarget | null) => boolean;
  startWindowDrag: () => Promise<void>;
  /** Tauri only: reads the window's real position once a drag has settled (a real OS-driven drag can't be tracked live). */
  getWindowPosition?: () => Promise<{ x: number; y: number } | null>;
  /** A drag actually happened and has a final position to remember. */
  onDragEnd?: (x: number, y: number) => void;
  /** A plain press-and-release with no real movement. */
  onClick?: () => void;
}

/**
 * Wires pointer handling onto `surface`: a plain click fires `onClick`; a
 * real drag either hands off to the OS window manager (Tauri, moving
 * `moveTarget`'s whole window) or, in a browser, moves `moveTarget` directly
 * by tracking the pointer — used for both the mini widget (surface and
 * moveTarget are the same card; a click expands it) and the full panel
 * (surface is a drag handle within the card; moveTarget is the card itself;
 * no click action).
 */
export function attachDrag(surface: HTMLElement, moveTarget: HTMLElement, opts: DragOptions): void {
  let down = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;

  surface.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !opts.enabled(e.target)) return;
    down = true;
    dragging = false;
    startX = e.clientX;
    startY = e.clientY;
  });

  surface.addEventListener("pointermove", (e) => {
    if (!down || dragging || !opts.enabled(e.target)) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
    dragging = true;
    if (opts.isTauri) {
      void opts.startWindowDrag();
    } else {
      beginBrowserDrag(moveTarget, e, opts.onDragEnd);
    }
  });

  const finish = () => {
    const wasDragging = dragging;
    down = false;
    dragging = false;
    if (wasDragging) {
      if (opts.isTauri && opts.getWindowPosition) {
        void opts.getWindowPosition().then((pos) => {
          if (pos) opts.onDragEnd?.(pos.x, pos.y);
        });
      }
    } else {
      opts.onClick?.();
    }
  };
  surface.addEventListener("pointerup", finish);
  surface.addEventListener("pointercancel", () => {
    down = false;
    dragging = false;
  });
}

function beginBrowserDrag(target: HTMLElement, start: PointerEvent, onEnd?: (x: number, y: number) => void): void {
  const rect = target.getBoundingClientRect();
  const offX = start.clientX - rect.left;
  const offY = start.clientY - rect.top;
  target.style.right = "auto";
  target.style.bottom = "auto";
  let last = { x: rect.left, y: rect.top };
  const move = (e: PointerEvent) => {
    const x = Math.max(0, Math.min(window.innerWidth - rect.width, e.clientX - offX));
    const y = Math.max(0, Math.min(window.innerHeight - rect.height, e.clientY - offY));
    target.style.left = `${x}px`;
    target.style.top = `${y}px`;
    last = { x, y };
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onEnd?.(last.x, last.y);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}
