/** One modal at a time, centred in the card, with a focus trap and ⎋ to close. */
import { clear, h, icon } from "./dom";

export interface ModalSpec {
  title: string;
  /** Builds the body. Called again on `refresh()`. */
  body: (api: ModalApi) => Node;
  onClose?: () => void;
  /** Extra class on the modal element. */
  className?: string;
}

export interface ModalApi {
  close: () => void;
  refresh: () => void;
}

export class ModalHost {
  private readonly layer: HTMLElement;
  private current: { spec: ModalSpec; el: HTMLElement; body: HTMLElement } | null = null;
  private lastFocus: Element | null = null;

  constructor(parent: HTMLElement) {
    this.layer = h("div", { class: "modal-layer", hidden: true });
    parent.appendChild(this.layer);
    this.layer.addEventListener("mousedown", (e) => {
      if (e.target === this.layer) this.close();
    });
    this.layer.addEventListener("keydown", (e) => {
      if (e.key !== "Tab" || !this.current) return;
      const focusables = this.focusables();
      if (!focusables.length) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  open(spec: ModalSpec): ModalApi {
    if (this.current) this.close();
    this.lastFocus = document.activeElement;
    const api: ModalApi = { close: () => this.close(), refresh: () => this.refresh() };
    const body = h("div", { class: "modal-body" });
    const el = h(
      "div",
      { class: `modal ${spec.className ?? ""}`, role: "dialog", "aria-modal": "true", "aria-label": spec.title },
      h(
        "div",
        { class: "modal-head" },
        h("h2", { class: "modal-title" }, spec.title),
        h("button", { class: "modal-close", "aria-label": "Close", onClick: () => this.close() }, icon("close")),
      ),
      body,
    );
    this.current = { spec, el, body };
    clear(this.layer);
    this.layer.appendChild(el);
    this.layer.hidden = false;
    body.appendChild(spec.body(api));
    // Focus the dialog itself so ⎋ and Tab work without highlighting a control.
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
    return api;
  }

  /** Rebuilds the body from the spec unless the user is typing in it. */
  refresh(): void {
    if (!this.current) return;
    const active = document.activeElement;
    if (active && this.current.body.contains(active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
    const focusedIndex = this.focusables().indexOf(active as HTMLElement);
    const scroll = this.current.body.scrollTop;
    clear(this.current.body);
    this.current.body.appendChild(this.current.spec.body({ close: () => this.close(), refresh: () => this.refresh() }));
    this.current.body.scrollTop = scroll;
    if (focusedIndex >= 0) this.focusables()[focusedIndex]?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.current) return;
    const { spec } = this.current;
    this.current = null;
    clear(this.layer);
    this.layer.hidden = true;
    spec.onClose?.();
    if (this.lastFocus instanceof HTMLElement) this.lastFocus.focus({ preventScroll: true });
  }

  private focusables(): HTMLElement[] {
    if (!this.current) return [];
    return Array.from(
      this.current.el.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.offsetParent !== null);
  }
}
