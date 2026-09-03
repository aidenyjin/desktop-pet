/** Tiny DOM helpers so the UI code stays readable without a framework. */

type Child = Node | string | number | null | undefined | false | Child[];

export type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "html") el.innerHTML = String(v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === "dataset" && typeof v === "object") Object.assign(el.dataset, v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function icon(name: "menu" | "close" | "pencil" | "play" | "stop" | "pin"): SVGElement {
  const paths: Record<string, string> = {
    menu: '<path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    close: '<path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    pencil: '<path d="M2 10.5V13h2.5l7-7L9 3.5l-7 7zM8 4.5l2.5 2.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>',
    play: '<path d="M4 2.5v10l8-5z" fill="currentColor"/>',
    stop: '<rect x="3" y="3" width="9" height="9" rx="1" fill="currentColor"/>',
    pin: '<path d="M6 2h4l-.6 4 2.6 2v1H9v4l-1 1-1-1v-4H4V8l2.6-2z" fill="currentColor"/>',
  };
  const viewBox = name === "close" ? "0 0 11 11" : "0 0 16 16";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = paths[name] ?? "";
  return svg;
}

export function formatDate(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
