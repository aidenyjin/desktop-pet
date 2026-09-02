/**
 * Everything the frontend needs from the host. In Tauri this calls Rust
 * commands; in a plain browser (development, screenshots, tests) it uses
 * localStorage and counts keys typed on the page.
 */

export type Permission = "granted" | "denied" | "unsupported";

export interface Bridge {
  readonly isTauri: boolean;
  keyTotal(): Promise<number>;
  addLocalKeys(n: number): Promise<number>;
  inputPermission(): Promise<Permission>;
  requestInputPermission(): Promise<boolean>;
  startKeyListener(): Promise<boolean>;
  keyListenerRunning(): Promise<boolean>;
  openInputMonitoringSettings(): Promise<void>;
  loadSave(): Promise<string | null>;
  writeSave(json: string): Promise<void>;
  saveDir(): Promise<string>;
  setPinned(pinned: boolean): Promise<void>;
  hidePanel(): Promise<void>;
  panelVisible(): Promise<boolean>;
  /** Shrinks to (or restores from) the small draggable widget. `x`/`y` are physical screen pixels. */
  setMini(enabled: boolean, at: { x: number; y: number } | null): Promise<void>;
  /** Hands off an in-progress drag to the OS window manager (Tauri only). */
  startWindowDrag(): Promise<void>;
  /** Reads the window's current physical position — call after a real drag settles. */
  getWindowPosition(): Promise<{ x: number; y: number } | null>;
  /** Remembers a custom spot for the *full* panel; `null` goes back to tray-docking. */
  setPanelPosition(at: { x: number; y: number } | null): Promise<void>;
  setBadge(on: boolean): Promise<void>;
  setTooltip(text: string): Promise<void>;
  getAutostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<void>;
  notify(title: string, body: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  appVersion(): Promise<string>;
  quit(): Promise<void>;
  relaunch(): Promise<void>;
  /** Fires when the panel is shown / hidden by the host. Returns an unsubscribe. */
  onPanelVisibility(cb: (visible: boolean) => void): () => void;
  /** The host is about to quit; call `done` once state is saved. */
  onQuit(cb: (done: () => void) => void): void;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __sonatina?: DevHooks;
  }
}

/** Hooks for screenshots and end-to-end tests in the browser. */
export interface DevHooks {
  addKeys(n: number): void;
  setPermission(p: Permission): void;
  setPanelVisible(v: boolean): void;
  reset(): void;
  [extra: string]: unknown;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function tauriBridge(): Promise<Bridge> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const call = <T>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args);
  return {
    isTauri: true,
    keyTotal: () => call<number>("key_total"),
    addLocalKeys: (n) => call<number>("add_local_keys", { n }),
    inputPermission: () => call<Permission>("input_permission"),
    requestInputPermission: () => call<boolean>("request_input_permission"),
    startKeyListener: () => call<boolean>("start_key_listener"),
    keyListenerRunning: () => call<boolean>("key_listener_running"),
    openInputMonitoringSettings: () => call<void>("open_input_monitoring_settings"),
    loadSave: () => call<string | null>("load_save"),
    writeSave: (json) => call<void>("write_save", { json }),
    saveDir: () => call<string>("save_dir"),
    setPinned: (pinned) => call<void>("set_pinned", { pinned }),
    hidePanel: () => call<void>("hide_panel"),
    panelVisible: () => call<boolean>("panel_visible"),
    setMini: (enabled, at) => call<void>("set_mini", { enabled, x: at?.x, y: at?.y }),
    startWindowDrag: async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    },
    getWindowPosition: async () => {
      const pos = await call<[number, number] | null>("window_position");
      return pos ? { x: pos[0], y: pos[1] } : null;
    },
    setPanelPosition: (at) => call<void>("set_panel_position", { x: at?.x, y: at?.y }),
    setBadge: (on) => call<void>("set_badge", { on }),
    setTooltip: (text) => call<void>("set_tooltip", { text }),
    getAutostart: () => call<boolean>("get_autostart"),
    setAutostart: (enabled) => call<void>("set_autostart", { enabled }),
    notify: (title, body) => call<void>("notify", { title, body }),
    openUrl: (url) => call<void>("open_url", { url }),
    appVersion: () => call<string>("app_version"),
    quit: () => call<void>("quit"),
    relaunch: () => call<void>("relaunch"),
    onQuit: (cb) => {
      void listen("app:quit", () => cb(() => void call<void>("quit_ready").catch(() => {})));
    },
    onPanelVisibility: (cb) => {
      const subs: Array<Promise<() => void>> = [
        listen("panel:shown", () => cb(true)),
        listen("panel:hidden", () => cb(false)),
      ];
      return () => {
        for (const s of subs) s.then((un) => un()).catch(() => {});
      };
    },
  };
}

const LS_SAVE = "sonatina.save";
const LS_KEYS = "sonatina.keys";

function browserBridge(): Bridge {
  const params = new URLSearchParams(location.search);
  let permission: Permission = (params.get("perm") as Permission) || "unsupported";
  let listening = permission === "granted";
  let total = Number(localStorage.getItem(LS_KEYS) ?? "0") || 0;
  const visibilityListeners = new Set<(v: boolean) => void>();
  const persistKeys = () => {
    try {
      localStorage.setItem(LS_KEYS, String(total));
    } catch {
      /* private mode */
    }
  };
  const isModifier = (e: KeyboardEvent) =>
    e.key === "Shift" || e.key === "Meta" || e.key === "Alt" || e.key === "Control" || e.key === "CapsLock" || e.key === "Fn";
  window.addEventListener("keydown", (e) => {
    if (e.repeat || isModifier(e)) return;
    total += 1;
    persistKeys();
  });
  const hooks: DevHooks = {
    addKeys(n) {
      total += n;
      persistKeys();
    },
    setPermission(p) {
      permission = p;
      listening = p === "granted";
    },
    setPanelVisible(v) {
      for (const l of visibilityListeners) l(v);
    },
    reset() {
      localStorage.removeItem(LS_SAVE);
      localStorage.removeItem(LS_KEYS);
      total = 0;
    },
  };
  window.__sonatina = hooks;
  return {
    isTauri: false,
    keyTotal: async () => total,
    addLocalKeys: async (n) => {
      // The page's own keydown listener already counted these.
      void n;
      return total;
    },
    inputPermission: async () => permission,
    requestInputPermission: async () => {
      if (permission === "denied" && params.get("grant") === "1") {
        permission = "granted";
        listening = true;
      }
      return permission === "granted";
    },
    startKeyListener: async () => listening,
    keyListenerRunning: async () => listening,
    openInputMonitoringSettings: async () => {},
    loadSave: async () => localStorage.getItem(LS_SAVE),
    writeSave: async (json) => {
      localStorage.setItem(LS_SAVE, json);
    },
    saveDir: async () => "localStorage",
    setPinned: async () => {},
    hidePanel: async () => {
      for (const l of visibilityListeners) l(false);
    },
    panelVisible: async () => true,
    setMini: async () => {},
    startWindowDrag: async () => {},
    getWindowPosition: async () => null,
    setPanelPosition: async () => {},
    setBadge: async (on) => {
      document.title = on ? "• Sonatina" : "Sonatina";
    },
    setTooltip: async () => {},
    getAutostart: async () => localStorage.getItem("sonatina.autostart") === "1",
    setAutostart: async (enabled) => {
      localStorage.setItem("sonatina.autostart", enabled ? "1" : "0");
    },
    notify: async (title, body) => {
      console.info(`[notify] ${title} — ${body}`);
    },
    openUrl: async (url) => {
      window.open(url, "_blank", "noopener");
    },
    appVersion: async () => "dev",
    quit: async () => {
      console.info("[quit]");
    },
    relaunch: async () => {
      location.reload();
    },
    onPanelVisibility: (cb) => {
      visibilityListeners.add(cb);
      return () => visibilityListeners.delete(cb);
    },
    onQuit: () => {},
  };
}

export async function createBridge(): Promise<Bridge> {
  return isTauri() ? tauriBridge() : browserBridge();
}
