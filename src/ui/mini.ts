/**
 * The mini widget: a small, draggable stand-in for the full panel. It reuses
 * the same animated scene (cropped and zoomed via CSS onto the piano and
 * composer) so whatever they're up to — playing, thinking, dozing,
 * celebrating — still reads at a glance, behind a plain rectangular frame
 * with a slim progress bar along the bottom.
 */
import { h } from "./dom";

const DRAG_THRESHOLD = 4;

export interface MiniOverlay {
  el: HTMLElement;
  badge: HTMLElement;
  setProgress(p: number): void;
  setUnseen(on: boolean): void;
}

/** Builds the progress bar + notice badge and appends them to `card`. */
export function createMiniOverlay(card: HTMLElement): MiniOverlay {
  const fill = h("i");
  const bar = h("div", { class: "mini-bar", "aria-hidden": "true" }, fill);
  const badge = h("div", { class: "mini-badge", "aria-hidden": "true" });
  card.append(bar, badge);
  return {
    el: bar,
    badge,
    setProgress(p: number) {
      const clamped = Math.max(0, Math.min(1, p));
      fill.style.width = `${clamped * 100}%`;
    },
    setUnseen(on: boolean) {
      badge.classList.toggle("is-on", on);
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
