/**
 * The typing test. A short phrase to copy out; what comes back is a words-
 * per-minute figure that sets how hard you can play before the piano starts
 * to complain.
 *
 * The timer starts on the first keystroke, not when the step appears, so
 * reading the phrase costs nothing. Only correctly typed characters count,
 * so hammering the keyboard scores badly — which matters, because this is
 * the measurement the anti-spam threshold is built on.
 */
import { KEYS_PER_WORD, keysPerSecToWpm } from "../game/economy";
import { MAX_BASELINE_WPM, MIN_BASELINE_WPM } from "../game/state";
import { h } from "./dom";

export const TEST_PHRASE = "The composer writes a quiet melody while the evening rain taps at the window.";

/** The shortest run worth trusting; below this a lucky burst dominates. */
const MIN_CHARS = 24;
const MIN_SECONDS = 3;

export interface TypingTestOptions {
  phrase: string;
  onDone: (wpm: number) => void;
  onSkip: () => void;
  /** Heading text; the settings retake words it differently from first run. */
  title?: string;
  skipLabel?: string;
}

/**
 * Builds the test UI. Returns the elements to append, so the caller decides
 * where it lives (an onboarding step, a settings modal).
 */
export function typingTest(opts: TypingTestOptions): HTMLElement[] {
  const phrase = opts.phrase;
  let startedAt = 0;
  let finished = false;

  const target = h("div", { class: "typing-phrase", "aria-hidden": "true" });
  const paintTarget = (typed: string) => {
    target.replaceChildren();
    for (let i = 0; i < phrase.length; i++) {
      const ch = phrase[i]!;
      const state = i >= typed.length ? "" : typed[i] === ch ? "is-right" : "is-wrong";
      const cursor = i === typed.length ? " is-cursor" : "";
      target.appendChild(h("span", { class: `${state}${cursor}` }, ch === " " ? " " : ch));
    }
  };
  paintTarget("");

  const hint = h("p", { class: "small muted" }, "Type it as you normally would. Accuracy counts.");
  const input = h("input", {
    class: "text-input typing-input",
    type: "text",
    "aria-label": "Type the phrase",
    spellcheck: "false",
    autocapitalize: "off",
    autocomplete: "off",
    autocorrect: "off",
  }) as HTMLInputElement;

  /** Correct characters typed so far, counted in place (not longest prefix). */
  const correctCount = (typed: string): number => {
    let n = 0;
    for (let i = 0; i < typed.length && i < phrase.length; i++) if (typed[i] === phrase[i]) n++;
    return n;
  };

  const settle = () => {
    if (finished) return;
    const typed = input.value;
    const seconds = startedAt ? (performance.now() - startedAt) / 1000 : 0;
    const correct = correctCount(typed);
    if (seconds < MIN_SECONDS || correct < MIN_CHARS) {
      hint.textContent = "That was too short to measure — give it another go.";
      hint.classList.add("is-warn");
      input.value = "";
      startedAt = 0;
      paintTarget("");
      return;
    }
    finished = true;
    const wpm = Math.round(Math.max(MIN_BASELINE_WPM, Math.min(MAX_BASELINE_WPM, keysPerSecToWpm(correct / seconds))));
    opts.onDone(wpm);
  };

  input.addEventListener("input", () => {
    if (!startedAt && input.value.length > 0) startedAt = performance.now();
    hint.classList.remove("is-warn");
    if (input.value.length > phrase.length) input.value = input.value.slice(0, phrase.length);
    paintTarget(input.value);
    if (input.value.length >= phrase.length) settle();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") settle();
  });

  requestAnimationFrame(() => input.focus());

  return [
    h(
      "div",
      { class: "onboarding-body" },
      h("h2", null, opts.title ?? "How fast do you play?"),
      h(
        "p",
        null,
        `Copy out the line below. It sets how hard the piano can be played before it starts to wear — measured against your pace, not a number picked for everyone.`,
      ),
      target,
      input,
      hint,
    ),
    h(
      "div",
      { class: "onboarding-actions" },
      h("button", { class: "btn is-primary", onClick: settle }, "Done"),
      h("button", { class: "btn is-quiet", onClick: opts.onSkip }, opts.skipLabel ?? "Skip"),
    ),
  ];
}

/** Words-per-minute for `chars` correct characters in `seconds`. Exported for tests. */
export function wpmFor(chars: number, seconds: number): number {
  if (seconds <= 0) return 0;
  return keysPerSecToWpm(chars / seconds);
}

export { KEYS_PER_WORD };
