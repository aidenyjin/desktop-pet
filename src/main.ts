import { createApp } from "./app";
import { createBridge, isTauri } from "./bridge";

async function boot(): Promise<void> {
  if (!isTauri()) document.body.classList.add("in-browser");
  const root = document.getElementById("app");
  if (!root) throw new Error("missing #app");
  const bridge = await createBridge();
  await createApp(root, bridge);
}

void boot().catch((e) => {
  console.error(e);
  const root = document.getElementById("app");
  if (root) root.textContent = `Sonatina could not start: ${e instanceof Error ? e.message : String(e)}`;
});
