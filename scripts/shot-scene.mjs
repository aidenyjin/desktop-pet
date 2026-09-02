// Screenshots the scene harness at several states for visual review.
//   node scripts/shot-scene.mjs [outDir]
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "dev/shots";
mkdirSync(out, { recursive: true });
const vite = spawn("npx", ["vite", "--port", "1421", "--strictPort"], { stdio: "ignore" });
const waitFor = async (url) => {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("vite did not start");
};
try {
  await waitFor("http://localhost:1421/dev/scene.html");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 720, height: 400 }, deviceScaleFactor: 1 });
  const states = [
    ["idle-day", "mood=idle&hour=14"],
    ["playing-day", "mood=playing&hour=10&rate=4&bpm=120&notes=6&frames=12"],
    ["dozing-night", "mood=dozing&hour=23&frames=40"],
    ["premiere-dusk", "mood=premiere&hour=19&frames=25"],
    ["idle-night-inverted", "mood=idle&hour=2&ink=%23b6c1b5&paper=%232a2725"],
    ["playing-rain-day", "mood=playing&hour=11&rate=2&bpm=92&notes=4&frames=30&rainday=1"],
    ["thinking", "mood=thinking&hour=15&frames=20"],
    ["wear-30", "mood=idle&hour=14&wear=30"],
    ["wear-60-stutter", "mood=playing&hour=14&rate=3&bpm=92&wear=60&frames=150"],
    ["wear-85", "mood=idle&hour=14&wear=85"],
    ["wear-broken", "mood=playing&hour=14&rate=3&bpm=92&wear=100&frames=10"],
    ["jolt", "mood=playing&hour=14&wear=100&jolt=1&frames=3"],
    ["sparkle-repair", "mood=idle&hour=14&wear=0&sparkle=1&frames=8"],
  ];
  for (const [name, qs] of states) {
    await page.goto(`http://localhost:1421/dev/scene.html?${qs}`);
    await page.waitForFunction(() => window.__ready === true);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log("wrote", `${out}/${name}.png`);
  }
  await browser.close();
} finally {
  vite.kill();
}
