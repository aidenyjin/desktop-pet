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

  await step("a big fast-forward burst does not wear the piano", async () => {
    // A single large addKeys() call spikes the *instant* rate sample for one
    // tick; it must not leak into the smoothed rate enough to register as
    // spamming (that regressed once already — see engine.ts's rate cap).
    await page.waitForTimeout(500);
    const wear = await page.evaluate(() => JSON.parse(localStorage.getItem("sonatina.save")).pianoWear);
    assert(wear === 0, `expected no piano wear from fast-forwarding, got ${wear}`);
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

  await step("mini mode shrinks, drags, and expands back", async () => {
    await page.click(".icon-btn");
    await page.click("text=Shrink");
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => document.querySelector(".card").classList.contains("is-mini")), "card is mini");
    const box = await page.locator(".card").boundingBox();
    assert(Math.abs(box.width - 128) < 2, `mini width was ${box.width}`);
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 160, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const moved = await page.locator(".card").boundingBox();
    assert(Math.abs(moved.x - box.x) > 20 || Math.abs(moved.y - box.y) > 20, "mini widget actually moved");
    await page.mouse.click(moved.x + 64, moved.y + 64);
    await page.waitForTimeout(400);
    assert(!(await page.evaluate(() => document.querySelector(".card").classList.contains("is-mini"))), "expanded back to full");
    assert(await page.isVisible(".hud"), "hud visible again");
  });

  await step("thinking mode banks inspiration and typing interrupts it", async () => {
    await page.click(".icon-btn");
    await page.click("text=Thinking");
    await page.waitForTimeout(200);
    assert(await page.isVisible("text=Thinking it through"), "thinking banner shown");
    // Let the store's debounced save settle before editing localStorage
    // directly, so this still-running instance's own unload-time flush (on
    // the reload below) has nothing stale to write back over the edit.
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      // Simulate having thought for a while without waiting for real time.
      const save = JSON.parse(localStorage.getItem("sonatina.save"));
      save.thinkingSince = Date.now() - 120_000;
      localStorage.setItem("sonatina.save", JSON.stringify(save));
    });
    await page.reload();
    await page.waitForSelector(".card");
    assert(await page.isVisible("text=Thinking it through"), "thinking resumed after reload");
    await page.keyboard.type("back to work");
    await page.waitForTimeout(1100);
    assert(!(await page.isVisible("text=Thinking it through")), "typing stopped thinking mode");
    const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("sonatina.save")).pendingInspirationSec);
    assert(pending > 100, `expected banked thinking time, got ${pending}`);
  });

  await step("a worn piano can be repaired", async () => {
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const save = JSON.parse(localStorage.getItem("sonatina.save"));
      save.pianoWear = 40;
      save.money = 100000;
      localStorage.setItem("sonatina.save", JSON.stringify(save));
    });
    await page.reload();
    await page.waitForSelector(".card");
    assert(await page.isVisible("text=The piano could use some care."), "wear banner shown");
    const moneyBefore = await page.textContent(".money");
    await page.click(".piece-hint .link");
    await page.waitForTimeout(300);
    assert(!(await page.isVisible("text=The piano could use some care.")), "wear banner cleared");
    const moneyAfter = await page.textContent(".money");
    assert(moneyBefore !== moneyAfter, "repair cost money");
    const wear = await page.evaluate(() => JSON.parse(localStorage.getItem("sonatina.save")).pianoWear);
    assert(wear === 0, `expected wear cleared, got ${wear}`);
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
