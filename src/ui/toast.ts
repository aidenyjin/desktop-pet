/** The premiere card that floats over the scene, like a note left on the piano. */
import { formatMoney } from "../game/economy";
import type { Notice } from "../game/state";
import { append, clear, h, icon } from "./dom";

export interface ToastActions {
  onDismiss: (notice: Notice) => void;
  onListen?: (notice: Notice) => void;
  isPlaying?: () => boolean;
}

export class Toast {
  private readonly el: HTMLElement;
  private notice: Notice | null = null;

  constructor(parent: HTMLElement, private readonly actions: ToastActions) {
    this.el = h("div", { class: "toast", role: "status", hidden: true });
    parent.appendChild(this.el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  get current(): Notice | null {
    return this.notice;
  }

  show(notice: Notice, opts: { canListen: boolean }): void {
    this.notice = notice;
    clear(this.el);
    append(this.el, [
      h("div", null, h("em", null, notice.title), ` earned ${formatMoney(notice.earned)}!`),
      notice.line ? h("div", { class: "toast-line" }, notice.line) : null,
      opts.canListen && this.actions.onListen
        ? h(
            "div",
            { class: "toast-actions" },
            h("button", { class: "btn is-small", onClick: () => this.actions.onListen?.(notice) }, icon("play"), " Listen"),
          )
        : null,
      h("button", { class: "modal-close", "aria-label": "Dismiss", onClick: () => this.dismiss() }, icon("close")),
    ]);
    this.el.hidden = false;
  }

  /** A plain message (no notice behind it). */
  say(text: string, sub?: string): void {
    this.notice = null;
    clear(this.el);
    append(this.el, [
      h("div", null, text),
      sub ? h("div", { class: "toast-line" }, sub) : null,
      h("button", { class: "modal-close", "aria-label": "Dismiss", onClick: () => this.hide() }, icon("close")),
    ]);
    this.el.hidden = false;
  }

  dismiss(): void {
    const n = this.notice;
    this.hide();
    if (n) this.actions.onDismiss(n);
  }

  hide(): void {
    this.el.hidden = true;
    this.notice = null;
  }
}
