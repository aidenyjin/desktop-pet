// End-to-end check of the panel in a browser: onboarding, typing to a
// premiere, buying an upgrade, persistence across reload, reset.
//   node scripts/e2e.mjs
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";

const vite = spawn("npx", ["vite", "--port", "1422", "--strictPort"], { stdio: "ignore" });
const waitFor = async (url) => {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("vite did not start");
};
const assert = (cond, msg) => { if (!cond) throw new Error(`assertion failed: ${msg}`); };
let failures = 0;
const step = async (name, fn) => {
  try { await fn(); console.log("ok  ", name); } catch (e) { failures++; console.error("FAIL", name, "\n    ", e.message); }
};

try {
  await waitFor("http://localhost:1422/");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 396, height: 512 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = "http://localhost:1422/?perm=granted";
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.goto(base);
  await page.waitForSelector(".card");

  await step("onboarding names the composer and starts a bagatelle", async () => {
    await page.click("text=Meet them");
    await page.click("text=Wren");
    await page.click("text=Continue");
    await page.click("text=Begin");
    await page.waitForSelector(".piece-title");
    const title = await page.textContent(".piece-title-inner");
    assert(/Bagatelle|Op\. 1/.test(title), `title was ${title}`);
    assert((await page.textContent(".toast")).includes("Wren has started"), "welcome toast");
  });

  await step("typing moves the piece forward", async () => {
    await page.keyboard.type("hello there, composer");
    await page.waitForTimeout(500);
    const big = await page.textContent(".piece-numbers .big");
    assert(big.startsWith("21 /"), `expected 21 notes, got ${big}`);
  });

  await step("finishing the piece premieres it and pays", async () => {
    await page.evaluate(() => window.__sonatina.addKeys(600));
    await page.waitForSelector(".toast em");
    const money = await page.textContent(".money");
    assert(/^\$[4-6]\d\d$/.test(money), `money was ${money}`);
    assert((await page.textContent(".badge")) === "1", "badge shows one notice");
    assert(await page.isVisible("text=Nothing on the stand."), "stand is empty");
    await page.click(".toast .modal-close");
    assert(await page.isHidden(".badge"), "badge clears after dismissing");
  });

  await step("spare notes carry into the next piece", async () => {
    await page.click("text=Choose a piece");
    await page.click(".row:not(.is-locked)");
    const big = await page.textContent(".piece-numbers .big");
    assert(/^1\d\d \/ 500$/.test(big), `expected ~121 carried notes, got ${big}`);
  });

  await step("upgrades cost money and change the tempo", async () => {
    await page.click(".icon-btn");
    await page.click("text=Upgrades");
    const before = await page.textContent(".money");
    await page.click(".upgrade .btn.is-affordable");
    await page.waitForTimeout(100);
    const after = await page.textContent(".money");
    assert(before !== after, "money changed");
    assert(await page.isVisible("text=Andante"), "tempo advanced to Andante");
    await page.keyboard.press("Escape");
  });

  await step("state survives a reload", async () => {
    await page.waitForTimeout(1200);
    const money = await page.textContent(".money");
    await page.reload();
    await page.waitForSelector(".piece-title");
    assert((await page.textContent(".money")) === money, "money persisted");
    assert(await page.isHidden(".onboarding"), "no onboarding after reload");
  });

  await step("rename and settings work", async () => {
    await page.click(".piece-rename");
    await page.fill(".modal input", "Sonata for my thesis");
    await page.keyboard.press("Enter");
    assert((await page.textContent(".piece-title-inner")).startsWith("Sonata for my thesis"), "renamed");
    await page.keyboard.press("Meta+,");
    await page.waitForSelector("text=Appearance");
    await page.click("text=Night");
    assert((await page.getAttribute("html", "data-theme")) === "night", "night theme applied");
    await page.keyboard.press("Escape");
  });

  await step("reset keeps the name and settings", async () => {
    await page.keyboard.press("Meta+,");
    await page.click("text=Reset…");
    await page.click(".modal .btn.is-primary");
    await page.waitForTimeout(300);
    assert((await page.textContent(".money")) === "$0", "money reset");
    assert((await page.getAttribute("html", "data-theme")) === "night", "theme kept");
    await page.evaluate(() => window.__sonatina.addKeys(50));
    await page.waitForTimeout(400);
    assert(await page.isVisible("text=Nothing on the stand."), "no piece after reset");
  });

  assert(errors.length === 0, `page errors: ${errors.join("; ")}`);
  await browser.close();
} finally {
  vite.kill();
}
if (failures) { console.error(`${failures} step(s) failed`); process.exit(1); }
console.log("e2e passed");
