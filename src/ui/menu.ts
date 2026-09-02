/** The ≡ dropdown. */
import { h } from "./dom";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  hint?: string;
  checked?: boolean;
  badge?: number;
}

export type MenuEntry = MenuItem | "separator";

export class Menu {
  private el: HTMLElement | null = null;
  private onOutside = (e: MouseEvent) => {
    if (this.el && !this.el.contains(e.target as Node) && !this.anchor.contains(e.target as Node)) this.close();
  };

  constructor(
    private readonly parent: HTMLElement,
    private readonly anchor: HTMLElement,
    private readonly entries: () => MenuEntry[],
  ) {}

  get isOpen(): boolean {
    return this.el !== null;
  }

  toggle(): void {
    if (this.el) this.close();
    else this.open();
  }

  open(): void {
    if (this.el) return;
    const el = h("div", { class: "menu", role: "menu" });
    for (const entry of this.entries()) {
      if (entry === "separator") {
        el.appendChild(h("div", { class: "menu-sep", role: "separator" }));
        continue;
      }
      const item = h(
        "button",
        {
          class: "menu-item",
          role: entry.checked === undefined ? "menuitem" : "menuitemcheckbox",
          "aria-checked": entry.checked === undefined ? undefined : String(entry.checked),
          onClick: () => {
            this.close();
            entry.onSelect();
          },
        },
        h("span", null, entry.checked === undefined ? null : h("span", { class: "check" }, entry.checked ? "✓" : ""), entry.label),
        entry.badge ? h("span", { class: "dot" }, String(entry.badge)) : entry.hint ? h("span", { class: "kbd" }, entry.hint) : null,
      );
      el.appendChild(item);
    }
    el.addEventListener("keydown", (e) => {
      const items = Array.from(el.querySelectorAll<HTMLElement>(".menu-item"));
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(i + 1) % items.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[(i - 1 + items.length) % items.length]?.focus();
      }
    });
    this.parent.appendChild(el);
    this.el = el;
    this.anchor.setAttribute("aria-expanded", "true");
    window.setTimeout(() => document.addEventListener("mousedown", this.onOutside), 0);
    el.querySelector<HTMLElement>(".menu-item")?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", this.onOutside);
  }
}
