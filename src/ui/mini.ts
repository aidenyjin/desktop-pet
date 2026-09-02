/**
 * The mini widget: a small, draggable stand-in for the full panel. It reuses
 * the same animated scene (cropped and zoomed via CSS onto the composer) so
 * whatever the composer is up to — playing, thinking, dozing, celebrating —
 * still reads at a glance.
 */
import { h } from "./dom";

const RING_R = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;
const DRAG_THRESHOLD = 4;

export interface MiniOverlay {
  el: SVGSVGElement;
  badge: HTMLElement;
  setProgress(p: number): void;
  setUnseen(on: boolean): void;
}

/** Builds the progress ring + notice badge and appends them to `card`. */
export function createMiniOverlay(card: HTMLElement): MiniOverlay {
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg") as unknown as SVGSVGElement;
  svg.setAttribute("class", "mini-ring");
  svg.setAttribute("viewBox", "0 0 128 128");
  svg.setAttribute("aria-hidden", "true");
  const track = document.createElementNS(svgNs, "circle");
  track.setAttribute("class", "track");
  track.setAttribute("cx", "64");
  track.setAttribute("cy", "64");
  track.setAttribute("r", String(RING_R));
  const fill = document.createElementNS(svgNs, "circle");
  fill.setAttribute("class", "fill");
  fill.setAttribute("cx", "64");
  fill.setAttribute("cy", "64");
  fill.setAttribute("r", String(RING_R));
  fill.setAttribute("transform", "rotate(-90 64 64)");
  fill.setAttribute("stroke-dasharray", String(RING_CIRCUMFERENCE));
  fill.setAttribute("stroke-dashoffset", String(RING_CIRCUMFERENCE));
  svg.append(track, fill);
  const badge = h("div", { class: "mini-badge", "aria-hidden": "true" });
  card.append(svg, badge);
  return {
    el: svg,
    badge,
    setProgress(p: number) {
      const clamped = Math.max(0, Math.min(1, p));
      fill.setAttribute("stroke-dashoffset", String(RING_CIRCUMFERENCE * (1 - clamped)));
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
