/** Money, the menu button, and what is on the stand. */
import { WEAR_BROKEN_AT, formatMoney, formatNumber, inspirationBonus, repairCost } from "../game/economy";
import { currentInspirationSeconds, progress, type GameState } from "../game/state";
import { append, clear, h, icon } from "./dom";

export interface HudActions {
  onMenu: () => void;
  onChoose: () => void;
  onRename: () => void;
  onFixListening: () => void;
  onRepair: () => void;
  onStopThinking: () => void;
}

export class Hud {
  readonly el: HTMLElement;
  readonly menuButton: HTMLButtonElement;
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
    this.el = h("header", { class: "hud" }, this.money, this.menuButton);
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

    // The status line (listening hint, piano wear, thinking) can change
    // independently of the piece itself, so it's kept in its own container
    // and refreshed every call rather than being tied to the piece-identity
    // cache key below — otherwise a wear/thinking change with no piece
    // progress to show for it would silently never reach the screen.
    this.updateStatus(state);

    const cur = state.current;
    const key = cur ? `${cur.id}|${cur.title}|${Math.floor(cur.notes)}|${cur.target}` : `none|${Math.floor(state.spareNotes)}`;
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
            ? h("p", { class: "piece-hint" }, `${formatNumber(state.spareNotes)} notes of sketches are waiting in the drawer.`)
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
    const key = [this.listening, this.supportsSystemWide, state.pianoWear, state.thinkingSince, state.thinkingSince && currentInspirationSeconds(state)].join(
      "|",
    );
    if (key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    clear(this.status);
    append(this.status, [this.hint(), this.wearBanner(state), this.thinkingBanner(state)]);
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

  private wearBanner(state: GameState): Node | null {
    if (state.pianoWear <= 0) return null;
    const broken = state.pianoWear >= WEAR_BROKEN_AT;
    return h(
      "div",
      { class: `piece-hint ${broken ? "status-warn" : ""}` },
      broken ? "The piano is jammed — only a few keys still work. " : "The piano could use some care. ",
      h("button", { class: "link", onClick: () => this.actions.onRepair() }, `Repair — ${formatMoney(repairCost(state.pianoWear))}`),
    );
  }

  private thinkingBanner(state: GameState): Node | null {
    if (state.thinkingSince === null) return null;
    const pct = Math.round(inspirationBonus(currentInspirationSeconds(state)) * 100);
    return h(
      "div",
      { class: "piece-hint" },
      pct > 0 ? `Thinking it through — +${pct}% for the next piece. ` : "Thinking it through… ",
      h("button", { class: "link", onClick: () => this.actions.onStopThinking() }, "Stop"),
    );
  }
}
