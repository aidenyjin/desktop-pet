/**
 * Pacing simulation: a player who types `keysPerDay` keystrokes on weekdays
 * and follows a simple strategy (always work on the largest unlocked form,
 * buy the cheapest useful upgrade when affordable). Prints milestones.
 *
 *   npm run simulate            # default 15k keys/day
 *   npm run simulate -- 8000    # a lighter day
 */
import { FORMS, upgradeCost, formUnlocked } from "../src/game/economy";
import { applyKeys, buyUpgrade, newGame, startPiece, seededRandom, type GameState } from "../src/game/state";

const keysPerDay = Number(process.argv[2] ?? 15000);
const rng = seededRandom(1);
let s: GameState = { ...newGame(0), onboarded: true };
const milestones: string[] = [];
const seen = new Set<string>();

function strategy(state: GameState): GameState {
  let st = state;
  // Buy the cheapest upgrade among those worth having; ambition if we can afford the next form.
  for (let guard = 0; guard < 10; guard++) {
    const options = (["ambition", "tempo", "artistry"] as const)
      .map((id) => ({ id, cost: upgradeCost(id, st.upgrades[id]) }))
      .filter((o): o is { id: typeof o.id; cost: number } => o.cost !== null && st.money >= o.cost)
      .sort((a, b) => a.cost - b.cost);
    if (!options.length) break;
    st = buyUpgrade(st, options[0]!.id);
  }
  if (!st.current) {
    const unlocked = FORMS.filter((f) => formUnlocked(f, st.upgrades));
    st = startPiece(st, unlocked[unlocked.length - 1]!.id, 0, Math.floor(rng() * 1e9)).state;
  }
  return st;
}

const chunk = 250; // keystrokes per burst
for (let day = 1; day <= 60; day++) {
  const weekday = (day - 1) % 7 < 5;
  const keysToday = weekday ? keysPerDay : Math.round(keysPerDay * 0.3);
  for (let done = 0; done < keysToday; done += chunk) {
    s = strategy(s);
    const t = applyKeys(s, Math.min(chunk, keysToday - done), day * 86400000, rng);
    s = t.state;
    for (const e of t.events) {
      if (e.type === "premiere" && !seen.has(e.work.formId)) {
        seen.add(e.work.formId);
        milestones.push(`day ${String(day).padStart(2)}: first ${e.work.formId.padEnd(9)} premiered — ${e.work.title} ($${e.work.earned.toLocaleString()})`);
      }
    }
  }
  if (day === 1 || day === 7 || day === 14 || day === 30 || day === 60) {
    milestones.push(
      `day ${String(day).padStart(2)}: $${Math.floor(s.money).toLocaleString()} · tempo ${s.upgrades.tempo} · artistry ${s.upgrades.artistry} · ambition ${s.upgrades.ambition} · ${s.repertoire.length} works · renown ${s.renown}`,
    );
  }
}
console.log(`Simulating ${keysPerDay.toLocaleString()} keys per weekday\n`);
console.log(milestones.join("\n"));
