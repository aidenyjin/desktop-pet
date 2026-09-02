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

export interface MiniDragOptions {
  isTauri: boolean;
  startWindowDrag: () => Promise<void>;
  onExpand: () => void;
  onDragEnd: (x: number, y: number) => void;
}

/**
 * Wires pointer handling onto `card`: a plain click expands it back to the
 * full panel; a real drag either hands off to the OS (Tauri) or, in a
 * browser, moves the element directly by tracking the pointer.
 */
export function attachMiniDrag(card: HTMLElement, opts: MiniDragOptions): void {
  let down = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  const isMini = () => card.classList.contains("is-mini");

  card.addEventListener("pointerdown", (e) => {
    if (!isMini() || e.button !== 0) return;
    down = true;
    dragging = false;
    startX = e.clientX;
    startY = e.clientY;
  });

  card.addEventListener("pointermove", (e) => {
    if (!down || dragging || !isMini()) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
    dragging = true;
    if (opts.isTauri) {
      void opts.startWindowDrag();
    } else {
      beginBrowserDrag(card, e, opts.onDragEnd);
    }
  });

  const finish = () => {
    if (down && !dragging && isMini()) opts.onExpand();
    down = false;
    dragging = false;
  };
  card.addEventListener("pointerup", finish);
  card.addEventListener("pointercancel", () => {
    down = false;
    dragging = false;
  });
}

function beginBrowserDrag(card: HTMLElement, start: PointerEvent, onEnd: (x: number, y: number) => void): void {
  const rect = card.getBoundingClientRect();
  const offX = start.clientX - rect.left;
  const offY = start.clientY - rect.top;
  card.style.right = "auto";
  card.style.bottom = "auto";
  let last = { x: rect.left, y: rect.top };
  const move = (e: PointerEvent) => {
    const x = Math.max(0, Math.min(window.innerWidth - rect.width, e.clientX - offX));
    const y = Math.max(0, Math.min(window.innerHeight - rect.height, e.clientY - offY));
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
    last = { x, y };
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onEnd(last.x, last.y);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}
