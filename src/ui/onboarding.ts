/** First run: a name, three sentences, a short typing test, and the permission question. */
import { COMPOSER_NAMES } from "../game/titles";
import { typingTest, TEST_PHRASE } from "./typing-test";
import type { AppContext } from "../app";
import { append, h } from "./dom";

type Step = "welcome" | "name" | "how" | "pace" | "permission";

export function runOnboarding(app: AppContext, parent: HTMLElement, onDone: (name: string, wpm: number) => void): void {
  const root = h("div", { class: "onboarding", role: "dialog", "aria-label": "Welcome" });
  parent.appendChild(root);
  let name: string = COMPOSER_NAMES[Math.floor(Math.random() * COMPOSER_NAMES.length)] ?? "Pip";
  const needsPermission = app.permission === "denied";
  let wpm = 0;
  const steps: Step[] = needsPermission ? ["welcome", "name", "how", "pace", "permission"] : ["welcome", "name", "how", "pace"];
  let index = 0;

  const dots = () => h("div", { class: "dots", "aria-hidden": "true" }, ...steps.map((_, i) => h("i", { class: i === index ? "on" : "" })));

  const render = () => {
    const step = steps[index]!;
    root.replaceChildren();
    if (step === "welcome") {
      root.append(
        h(
          "div",
          { class: "onboarding-body" },
          h("h1", null, "Sonatina"),
          h("p", { class: "lede" }, "A little composer for your menu bar."),
          composerArt(),
          h("p", null, "They have ambition and very little discipline. Every key you press — and every click — is a note on their manuscript."),
        ),
        h("div", { class: "onboarding-actions" }, h("button", { class: "btn is-primary", onClick: next }, "Meet them")),
        dots(),
      );
    } else if (step === "name") {
      const input = h("input", { class: "text-input", type: "text", value: name, maxlength: "24", "aria-label": "Name", spellcheck: "false", style: { maxWidth: "220px", margin: "0 auto", textAlign: "center" } }) as HTMLInputElement;
      input.addEventListener("input", () => {
        name = input.value;
        chips.querySelectorAll<HTMLElement>(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.textContent === name.trim())));
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") next();
      });
      const chips = h(
        "div",
        { class: "chips" },
        ...COMPOSER_NAMES.map((n) =>
          h(
            "button",
            {
              class: "chip",
              "aria-pressed": String(n === name),
              onClick: () => {
                name = n;
                input.value = n;
                chips.querySelectorAll<HTMLElement>(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.textContent === n)));
              },
            },
            n,
          ),
        ),
      );
      root.append(
        h("div", { class: "onboarding-body" }, h("h2", null, "What shall we call them?"), chips, input),
        h("div", { class: "onboarding-actions" }, h("button", { class: "btn is-primary", onClick: next }, "Continue")),
        dots(),
      );
      requestAnimationFrame(() => input.focus());
    } else if (step === "how") {
      root.append(
        h(
          "div",
          { class: "onboarding-body" },
          h("h2", null, `How ${name.trim() || "they"} work${name.trim() ? "s" : ""}`),
          h(
            "div",
            { class: "steps" },
            h(
              "ol",
              null,
              h("li", null, "Every key you press and every click you make, anywhere, is a note."),
              h("li", null, "When a piece is finished it premieres and earns a little money."),
              h("li", null, "Spend it on tempo, artistry and ambition, and take on bigger forms."),
            ),
          ),
          h("p", { class: "small muted" }, "You get on with your work. They get on with theirs."),
        ),
        h("div", { class: "onboarding-actions" }, h("button", { class: "btn is-primary", onClick: next }, needsPermission ? "Continue" : "Begin")),
        dots(),
      );
    } else if (step === "pace") {
      root.append(
        ...typingTest({
          phrase: TEST_PHRASE,
          onDone: (measured) => {
            wpm = measured;
            next();
          },
          onSkip: next,
        }),
        dots(),
      );
    } else {
      let status: "idle" | "waiting" | "denied" = "idle";
      const body = h("div", { class: "onboarding-body" });
      const actions = h("div", { class: "onboarding-actions" });
      const paint = () => {
        body.replaceChildren(
          h("h2", null, "One question from macOS"),
          h("p", null, `To hear you work in other apps, macOS will ask to let Sonatina “receive keystrokes”. It only counts them — which keys you press, and where you click, is never recorded, stored or sent anywhere.`),
          status === "denied"
            ? h(
                "p",
                { class: "small" },
                "Not allowed yet. Open System Settings → Privacy & Security → Input Monitoring, switch Sonatina on — then, if it still says no, quit and reopen Sonatina. macOS sometimes only notices a new permission after a full restart, not just a re-check.",
              )
            : status === "waiting"
              ? h("p", { class: "small muted" }, "Waiting for the switch…")
              : h("p", { class: "small muted" }, "You can skip this; only typing inside this panel will count."),
        );
        actions.replaceChildren();
        append(actions, [
          status === "denied"
            ? h("button", { class: "btn", onClick: () => void app.bridge.openInputMonitoringSettings() }, "Open System Settings")
            : null,
          status === "denied" && app.bridge.isTauri
            ? h("button", { class: "btn is-quiet", onClick: () => void app.bridge.relaunch() }, "Relaunch Sonatina")
            : null,
          h(
            "button",
            {
              class: "btn is-primary",
              onClick: () => {
                status = "waiting";
                paint();
                app.requestListening((ok) => {
                  if (ok) finish();
                  else {
                    status = "denied";
                    paint();
                  }
                });
              },
            },
            status === "denied" ? "Try again" : "Allow",
          ),
          h("button", { class: "btn is-quiet", onClick: finish }, status === "denied" ? "Skip for now" : "Not now"),
        ]);
      };
      paint();
      root.append(body, actions, dots());
    }
  };

  const next = () => {
    if (steps[index] === "name" && !name.trim()) name = "Pip";
    if (index < steps.length - 1) {
      index++;
      render();
    } else finish();
  };

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    root.remove();
    onDone(name.trim() || "Pip", wpm);
  };

  render();
}

/** A larger, static portrait of the composer for the welcome page. */
function composerArt(): HTMLCanvasElement {
  const rows = [
    ".....#..#..#....",
    "....#.##.##.#...",
    "...##########...",
    "..############..",
    ".#############..",
    ".#............#.",
    "#..............#",
    "#..............#",
    "#...##...##....#",
    "#...##...##....#",
    "#..............#",
    "#..............#",
    ".#............#.",
    ".#............#.",
    "..############..",
    ".....######.....",
    "....#..##..#....",
    "...#..####..#...",
    "...#...##...#...",
    "..#..........#..",
    "..#..........#..",
    "..############..",
  ];
  const scale = 4;
  const c = document.createElement("canvas");
  c.className = "onboarding-art";
  c.width = 16 * scale;
  c.height = rows.length * scale;
  c.style.width = `${c.width}px`;
  c.style.height = `${c.height}px`;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#2e2a27";
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (r[x] === "#") ctx.fillRect(x * scale, y * scale, scale, scale);
  });
  return c;
}
