// Screenshots the real panel UI in a browser at 2x for visual review.
//   node scripts/shot-app.mjs [outDir]
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "dev/shots/app";
mkdirSync(out, { recursive: true });
const vite = spawn("npx", ["vite", "--port", "1421", "--strictPort"], { stdio: "ignore" });
const waitFor = async (url) => {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("vite did not start");
};

const NOW = Date.now();
const richSave = {
  version: 1, createdAt: NOW - 86400000 * 9, composerName: "Wren", onboarded: true, money: 2275, renown: 14,
  keysConsumed: 0, lifetimeNotes: 31210, spareNotes: 0,
  upgrades: { tempo: 3, artistry: 2, ambition: 3 },
  current: { id: "p1", formId: "nocturne", title: "Nocturne for the Hour Before Rain, Op. 6", key: "E♭", mode: "minor", seed: 4242, notes: 4120, target: 8000, startedAt: NOW - 3600000, opus: 6 },
  repertoire: [
    { id: "w1", formId: "bagatelle", title: "Bagatelle in G major, Op. 1", key: "G", mode: "major", seed: 1, notes: 500, earned: 512, reception: 1.02, receptionLine: "Warmly received.", startedAt: NOW - 86400000 * 9, completedAt: NOW - 86400000 * 9, opus: 1 },
    { id: "w2", formId: "bagatelle", title: "Bagatelle for a Sleeping Cat, Op. 2", key: "D", mode: "major", seed: 2, notes: 500, earned: 560, reception: 1.12, receptionLine: "The critics were kind.", startedAt: NOW - 86400000 * 8, completedAt: NOW - 86400000 * 8, opus: 2 },
    { id: "w3", formId: "etude", title: "Étude on a Quiet Tuesday, Op. 3", key: "A", mode: "minor", seed: 3, notes: 2500, earned: 2610, reception: 1.04, receptionLine: "A good night.", startedAt: NOW - 86400000 * 7, completedAt: NOW - 86400000 * 6, opus: 3 },
    { id: "w4", formId: "etude", title: "Study for a Paper Boat, Op. 4", key: "F", mode: "major", seed: 4, notes: 2500, earned: 2980, reception: 1.16, receptionLine: "A standing ovation!", startedAt: NOW - 86400000 * 5, completedAt: NOW - 86400000 * 4, opus: 4 },
    { id: "w5", formId: "nocturne", title: "Nocturne in C♯ minor, Op. 5", key: "C♯", mode: "minor", seed: 5, notes: 8000, earned: 9800, reception: 1.09, receptionLine: "Someone wept in the third row.", startedAt: NOW - 86400000 * 3, completedAt: NOW - 86400000, opus: 5 },
  ],
  inbox: [],
  settings: { theme: "paper", sound: true, playAlong: false, notifications: true, pinned: false },
  stats: { premieres: 5, bestEarning: 9800, totalEarned: 16462, spent: 14187 },
};

try {
  await waitFor("http://localhost:1421/");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 396, height: 512 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE:", m.text()); });
  const base = "http://localhost:1421/";

  const seed = async (save, extra = "") => {
    await page.goto(base + extra);
    await page.evaluate((s) => {
      localStorage.clear();
      if (s) localStorage.setItem("sonatina.save", JSON.stringify(s));
    }, save);
    await page.goto(base + extra);
    await page.waitForSelector(".card");
    await page.waitForTimeout(400);
  };
  const shot = async (name) => {
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log("wrote", name);
  };

  // Onboarding
  await seed(null, "?perm=denied");
  await shot("onboarding-1-welcome");
  await page.click("text=Meet them");
  await page.waitForTimeout(150);
  await shot("onboarding-2-name");
  await page.click("text=Continue");
  await page.waitForTimeout(150);
  await shot("onboarding-3-how");
  await page.click("text=Continue");
  await page.waitForTimeout(150);
  await shot("onboarding-4-permission");
  await page.click("text=Not now");
  await page.waitForTimeout(500);
  await shot("fresh-after-onboarding");

  // Main HUD with piece in progress
  await seed(richSave);
  await shot("main-piece");
  await page.evaluate(() => window.__sonatina.addKeys(12));
  await page.waitForTimeout(450);
  await shot("main-typing");

  // Menu
  await page.click(".icon-btn");
  await page.waitForTimeout(200);
  await shot("menu");
  await page.keyboard.press("Escape");

  // Modals
  await page.click(".icon-btn");
  await page.click("text=On the stand");
  await page.waitForTimeout(200);
  await shot("modal-on-the-stand");
  await page.keyboard.press("Escape");
  await page.click(".icon-btn");
  await page.click("text=Upgrades");
  await page.waitForTimeout(200);
  await shot("modal-upgrades");
  await page.keyboard.press("Escape");
  await page.click(".icon-btn");
  await page.click("text=Repertoire");
  await page.waitForTimeout(200);
  await shot("modal-repertoire");
  await page.keyboard.press("Escape");
  await page.click(".icon-btn");
  await page.click("text=Settings");
  await page.waitForTimeout(400);
  await shot("modal-settings");
  await page.keyboard.press("Escape");
  await page.click(".piece-rename");
  await page.waitForTimeout(200);
  await shot("modal-rename");
  await page.keyboard.press("Escape");

  // Premiere: finish the nocturne
  await page.evaluate(() => window.__sonatina.addKeys(4000));
  await page.waitForTimeout(700);
  await shot("premiere-toast");

  // Empty stand (no piece)
  await seed({ ...richSave, current: null, spareNotes: 1240 });
  await shot("main-empty");
  await page.click("text=Choose a piece");
  await page.waitForTimeout(200);
  await shot("modal-choose");

  // Night theme
  await seed({ ...richSave, settings: { ...richSave.settings, theme: "night" } });
  await shot("night-main");
  await page.click(".icon-btn");
  await page.click("text=Upgrades");
  await page.waitForTimeout(200);
  await shot("night-upgrades");

  await browser.close();
} finally {
  vite.kill();
}
