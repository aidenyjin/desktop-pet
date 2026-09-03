/** Money, the menu button, and what is on the stand. */
import { REPAIR_COST, WARN_AFTER_SECONDS, formatMoney, formatNumber } from "../game/economy";
import { progress, spareCap, type GameState } from "../game/state";
import { append, clear, h, icon } from "./dom";

export interface HudActions {
  onMenu: () => void;
  onChoose: () => void;
  onRename: () => void;
  onFixListening: () => void;
  onRepair: () => void;
}

export class Hud {
  readonly el: HTMLElement;
  readonly menuButton: HTMLButtonElement;
  /** Groups the menu button with anything else (e.g. the pin toggle) pinned to the top-right corner. */
  readonly rightSlot: HTMLElement;
  private readonly money: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly piece: HTMLElement;
  private lastMoney = -1;
  private lastPieceKey = "";
  private listening = true;
  private supportsSystemWide = true;

  private readonly status: HTMLElement;
  private lastStatusKey = "";

  constructor(parent: HTMLElement, private readonly actions: HudActions) {
    this.money = h("div", { class: "money", "aria-label": "Money" }, "$0");
    this.badge = h("span", { class: "badge", hidden: true });
    this.menuButton = h(
      "button",
      { class: "icon-btn", "aria-label": "Menu", "aria-haspopup": "menu", "aria-expanded": "false", onClick: () => actions.onMenu() },
      icon("menu"),
      this.badge,
    );
    this.rightSlot = h("div", { class: "hud-right" }, this.menuButton);
    this.el = h("header", { class: "hud" }, this.money, this.rightSlot);
    this.piece = h("section", { class: "piece", "aria-label": "Current piece" });
    this.status = h("div", { class: "piece-status" });
    parent.append(this.el, this.piece);
  }

  setListening(listening: boolean, supportsSystemWide: boolean): void {
    this.listening = listening;
    this.supportsSystemWide = supportsSystemWide;
    this.lastPieceKey = "";
    this.lastStatusKey = "";
  }

  update(state: GameState, unseen: number): void {
    const money = Math.floor(state.money);
    if (money !== this.lastMoney) {
      this.money.textContent = formatMoney(money);
      if (this.lastMoney >= 0 && money > this.lastMoney) {
        this.money.classList.remove("bump");
        void this.money.offsetWidth;
        this.money.classList.add("bump");
      }
      this.lastMoney = money;
    }
    this.badge.hidden = unseen === 0;
    this.badge.textContent = String(unseen);

    // The status line (listening hint, piano warning) can change independently
    // of the piece itself, so it's kept in its own container and refreshed
    // every call rather than being tied to the piece-identity cache key
    // below — otherwise a warning with no piece progress to show for it
    // would silently never reach the screen.
    this.updateStatus(state);

    const cur = state.current;
    const key = cur ? `${cur.id}|${cur.title}|${Math.floor(cur.notes)}|${cur.target}` : `none|${Math.floor(state.spareNotes)}|${spareCap(state)}`;
    if (key === this.lastPieceKey) return;
    const titleChanged = !cur || !this.lastPieceKey.startsWith(`${cur.id}|${cur.title}|`);
    this.lastPieceKey = key;

    if (!cur) {
      clear(this.piece);
      append(this.piece, [
        h(
          "div",
          { class: "piece-empty" },
          h("p", null, "Nothing on the stand."),
          h("button", { class: "btn", onClick: () => this.actions.onChoose() }, "Choose a piece"),
          state.spareNotes >= 1
            ? h(
                "p",
                { class: "piece-hint" },
                `${formatNumber(state.spareNotes)} / ${formatNumber(spareCap(state))} notes of sketches in the cupboard.`,
              )
            : null,
        ),
        this.status,
      ]);
      return;
    }

    if (titleChanged) {
      clear(this.piece);
      const inner = h("span", { class: "piece-title-inner" }, cur.title);
      const clip = h("div", { class: "piece-title-clip" }, inner);
      const title = h(
        "div",
        { class: "piece-title" },
        clip,
        h("button", { class: "piece-rename", "aria-label": "Rename piece", title: "Rename", onClick: () => this.actions.onRename() }, icon("pencil")),
      );
      const numbers = h("div", { class: "piece-numbers" }, h("span", { class: "big" }), h("span", null, "notes"));
      const percent = h("div", { class: "piece-percent" });
      const bar = h("div", { class: "piece-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, h("i"));
      append(this.piece, [title, numbers, percent, bar, this.status]);
      // Scroll long titles like a ticker.
      requestAnimationFrame(() => {
        if (inner.scrollWidth > clip.clientWidth) {
          inner.textContent = `${cur.title}   ·   ${cur.title}   ·   `;
          clip.classList.add("scrolling");
          clip.style.setProperty("--ticker-duration", `${Math.max(8, inner.scrollWidth / 26)}s`);
        }
      });
    }
    const big = this.piece.querySelector<HTMLElement>(".piece-numbers .big");
    const percent = this.piece.querySelector<HTMLElement>(".piece-percent");
    const bar = this.piece.querySelector<HTMLElement>(".piece-bar");
    const p = progress(state);
    if (big) big.textContent = `${formatNumber(cur.notes)} / ${formatNumber(cur.target)}`;
    if (percent) percent.textContent = `${Math.floor(p * 100)}%`;
    if (bar) {
      bar.setAttribute("aria-valuenow", String(Math.floor(p * 100)));
      const fill = bar.firstElementChild as HTMLElement | null;
      if (fill) fill.style.width = `${Math.max(0, Math.min(100, p * 100))}%`;
    }
  }

  private updateStatus(state: GameState): void {
    const key = [this.listening, this.supportsSystemWide, state.pianoBroken, state.overspeedSeconds > WARN_AFTER_SECONDS].join("|");
    if (key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    clear(this.status);
    append(this.status, [this.hint(), this.pianoBanner(state)]);
  }

  private hint(): Node | null {
    if (this.listening || !this.supportsSystemWide) return null;
    return h(
      "div",
      { class: "piece-hint" },
      "Only counting keys typed in this window. ",
      h("button", { class: "link", onClick: () => this.actions.onFixListening() }, "Allow system-wide"),
    );
  }

  /** Two states, never a meter: a warning while you are overdoing it, then a broken piano. */
  private pianoBanner(state: GameState): Node | null {
    if (state.pianoBroken) {
      return h(
        "div",
        { class: "piece-hint status-warn" },
        "The piano is broken — the notes come out sour, and most of them miss. ",
        h("button", { class: "link", onClick: () => this.actions.onRepair() }, `Repair — ${formatMoney(REPAIR_COST)}`),
      );
    }
    if (state.overspeedSeconds > WARN_AFTER_SECONDS) {
      return h("div", { class: "piece-hint status-warn" }, "Steady on — the piano will not take being played this hard for long.");
    }
    return null;
  }
}
