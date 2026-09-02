/** Wires the pieces together: state, host, scene, audio and the UI. */
import { Audio } from "./audio";
import type { Bridge, Permission } from "./bridge";
import { Engine } from "./engine";
import { formatMoney } from "./game/economy";
import { generateMelody, pentatonic, rootMidi } from "./game/melody";
import { dismissNotice, newGame, setSettings, startPiece, type GameEvent, type GameState, type Theme, type Work } from "./game/state";
import { Scene } from "./scene/scene";
import { GameStore } from "./store";
import { h } from "./ui/dom";
import { Hud } from "./ui/hud";
import { Menu, type MenuEntry } from "./ui/menu";
import { ModalHost } from "./ui/modal";
import { openPieces, openRename, openRepertoire, openSettings, openUpgrades } from "./ui/modals";
import { runOnboarding } from "./ui/onboarding";
import { Toast } from "./ui/toast";

export interface AppContext {
  readonly store: GameStore;
  readonly bridge: Bridge;
  readonly audio: Audio;
  readonly engine: Engine;
  readonly scene: Scene;
  readonly modals: ModalHost;
  permission: Permission;
  listening: boolean;
  playingWorkId: string | null;
  requestListening(cb: (ok: boolean) => void): void;
  listen(work: Work, onChange: () => void): void;
  reset(): void;
}

export async function createApp(root: HTMLElement, bridge: Bridge): Promise<AppContext> {
  const store = new GameStore(bridge);
  await store.load();

  // ── DOM ──
  const card = h("div", { class: "card" });
  root.appendChild(card);
  const canvas = h("canvas", { "aria-hidden": "true" });
  const sceneBox = h("div", { class: "scene" }, canvas);
  const scene = new Scene(canvas);
  const audio = new Audio();
  const modals = new ModalHost(card);
  let visible = !bridge.isTauri;

  const app: AppContext = {
    store,
    bridge,
    audio,
    engine: null as unknown as Engine,
    scene,
    modals,
    permission: "unsupported",
    listening: false,
    playingWorkId: null,
    requestListening,
    listen,
    reset,
  };

  const hud = new Hud(card, {
    onMenu: () => menu.toggle(),
    onChoose: () => openPieces(app),
    onRename: () => openRename(app),
    onFixListening: () => openSettings(app),
  });
  card.appendChild(sceneBox);
  const toast = new Toast(card, {
    onDismiss: (n) => store.update((s) => dismissNotice(s, n.id), { immediate: true }),
    onListen: (n) => {
      const work = store.get().repertoire.find((w) => w.id === n.workId);
      if (work) listen(work, () => {});
    },
  });

  const menuEntries = (): MenuEntry[] => {
    const s = store.get();
    const entries: MenuEntry[] = [
      { label: s.current ? "On the stand" : "Choose a piece", onSelect: () => openPieces(app) },
      { label: "Upgrades", onSelect: () => openUpgrades(app) },
      { label: "Repertoire", onSelect: () => openRepertoire(app), badge: store.unseen() || undefined },
      { label: "Settings", onSelect: () => openSettings(app), hint: "⌘," },
      "separator",
      { label: "Keep open", checked: s.settings.pinned, onSelect: () => store.update((st) => setSettings(st, { pinned: !st.settings.pinned }), { immediate: true }) },
    ];
    if (bridge.isTauri) {
      entries.push("separator", {
        label: "Quit Sonatina",
        hint: "⌘Q",
        onSelect: () => void store.flush().then(() => bridge.quit()),
      });
    }
    return entries;
  };
  const menu = new Menu(card, hud.menuButton, menuEntries);

  // ── engine ──
  const engine = new Engine(bridge, store, scene, {
    onKeys: (n) => {
      const s = store.get();
      if (s.settings.playAlong && s.current) audio.playAlong(pentatonic(s.current.key, s.current.mode), n);
    },
    onEvents: (events) => handleEvents(events),
  });
  (app as { engine: Engine }).engine = engine;

  // ── theme ──
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  function applyTheme(theme: Theme): void {
    const resolved = theme === "auto" ? (media.matches ? "night" : "paper") : theme;
    document.documentElement.dataset.theme = resolved;
    const css = getComputedStyle(document.documentElement);
    scene.setView({ ink: css.getPropertyValue("--ink").trim(), paper: css.getPropertyValue("--paper").trim(), reduceMotion: reduceMotion.matches });
  }
  media.addEventListener("change", () => applyTheme(store.get().settings.theme));
  reduceMotion.addEventListener("change", () => applyTheme(store.get().settings.theme));

  // ── store → UI ──
  let lastBadge: boolean | null = null;
  let lastModalKey = "";
  let lastSettingsJson = "";
  const render = (s: GameState, prev?: GameState) => {
    hud.update(s, store.unseen());
    const badge = store.unseen() > 0;
    if (badge !== lastBadge) {
      lastBadge = badge;
      void bridge.setBadge(badge).catch(() => {});
    }
    const settingsJson = JSON.stringify(s.settings);
    if (settingsJson !== lastSettingsJson) {
      lastSettingsJson = settingsJson;
      applyTheme(s.settings.theme);
      audio.setEnabled(s.settings.sound || s.settings.playAlong);
      void bridge.setPinned(s.settings.pinned).catch(() => {});
    }
    const modalKey = [
      Math.floor(s.money),
      JSON.stringify(s.upgrades),
      s.current?.id,
      Math.floor(s.current?.notes ?? 0),
      s.current?.title,
      s.repertoire.length,
      settingsJson,
      s.composerName,
      Math.floor(s.spareNotes),
      app.listening,
      app.playingWorkId,
    ].join("|");
    if (modalKey !== lastModalKey) {
      lastModalKey = modalKey;
      modals.refresh();
    }
    if (prev && prev.onboarded && s.onboarded && !toast.visible && visible) showNextNotice();
  };
  store.subscribe(render);

  function showNextNotice(): void {
    const s = store.get();
    const notice = s.inbox.find((n) => !n.seen) ?? s.inbox[0];
    if (!notice || toast.visible) return;
    toast.show(notice, { canListen: s.settings.sound });
  }

  function handleEvents(events: GameEvent[]): void {
    for (const e of events) {
      if (e.type !== "premiere") continue;
      const s = store.get();
      if (s.settings.sound) audio.chime(rootMidi(e.work.key));
      if (!visible && s.settings.notifications) {
        void bridge.notify(e.work.title, `Earned ${formatMoney(e.work.earned)}. ${e.work.receptionLine}`).catch(() => {});
      }
      if (visible) {
        toast.hide();
        showNextNotice();
      }
    }
  }

  // ── listening / permission ──
  async function refreshListening(): Promise<void> {
    try {
      app.permission = await bridge.inputPermission();
      if (app.permission === "granted") {
        app.listening = (await bridge.keyListenerRunning()) || (await bridge.startKeyListener());
      } else {
        app.listening = false;
      }
    } catch {
      app.permission = "unsupported";
      app.listening = false;
    }
    hud.setListening(app.listening || app.permission === "unsupported", app.permission !== "unsupported");
    hud.update(store.get(), store.unseen());
    lastModalKey = "";
    modals.refresh();
  }

  function requestListening(cb: (ok: boolean) => void): void {
    void (async () => {
      let ok = false;
      try {
        ok = await bridge.requestInputPermission();
        // The system prompt is asynchronous; give the user a while to answer
        // (or to flip the switch in System Settings) before giving up.
        for (let i = 0; !ok && i < 40; i++) {
          await new Promise((r) => setTimeout(r, 500));
          ok = (await bridge.inputPermission()) === "granted";
        }
      } catch {
        ok = false;
      }
      if (ok) {
        try {
          app.listening = await bridge.startKeyListener();
        } catch {
          app.listening = false;
        }
      }
      await refreshListening();
      cb(ok && app.listening);
    })();
  }

  function listen(work: Work, onChange: () => void): void {
    const melody = generateMelody(work.seed, work.key, work.mode, work.formId);
    const started = audio.play(melody, () => {
      app.playingWorkId = null;
      lastModalKey = "";
      onChange();
      modals.refresh();
    });
    app.playingWorkId = started ? work.id : null;
    lastModalKey = "";
    onChange();
    modals.refresh();
  }

  function reset(): void {
    const s = store.get();
    const fresh = { ...newGame(), composerName: s.composerName, settings: s.settings, onboarded: true };
    store.replace(fresh);
    toast.hide();
    void engine.resync();
    toast.say("A fresh manuscript.", "Everything before is forgotten; the name stays.");
  }

  // ── keys typed inside the panel ──
  const isModifier = (e: KeyboardEvent) =>
    e.key === "Shift" || e.key === "Meta" || e.key === "Alt" || e.key === "Control" || e.key === "CapsLock" || e.key === "Fn" || e.key === "Dead";
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (modals.isOpen) modals.close();
      else if (menu.isOpen) menu.close();
      else if (toast.visible && toast.current === null) toast.hide();
      else if (!store.get().settings.pinned) void bridge.hidePanel();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      openSettings(app);
      return;
    }
    if (bridge.isTauri && !app.listening && !e.repeat && !isModifier(e) && !e.metaKey) {
      void bridge.addLocalKeys(1).catch(() => {});
    }
  });
  document.addEventListener("contextmenu", (e) => {
    if (bridge.isTauri && !(e.target instanceof HTMLInputElement)) e.preventDefault();
  });

  // ── visibility ──
  const setVisible = (v: boolean) => {
    visible = v;
    // The card starts visible so a click that lands before this code runs
    // never shows an empty window; hiding only fades it for the next show.
    card.classList.toggle("is-visible", v);
    engine.setVisible(v);
    if (v) {
      scene.resize();
      scene.start();
      showNextNotice();
    } else {
      menu.close();
      scene.stop();
      audio.stop();
      void store.flush();
    }
  };
  bridge.onPanelVisibility(setVisible);
  window.addEventListener("pagehide", () => void store.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void store.flush();
  });
  window.addEventListener("resize", () => scene.resize());

  // ── boot ──
  applyTheme(store.get().settings.theme);
  render(store.get());
  card.classList.add("is-visible");
  await refreshListening();
  engine.start();
  if (bridge.isTauri) {
    // The panel may already be on screen if the tray was clicked during load.
    const shown = await bridge.panelVisible().catch(() => false);
    setVisible(shown);
    if (!shown) card.classList.add("is-visible");
  } else {
    setVisible(true);
  }

  if (store.loadFailed) toast.say("The last save could not be read.", "Starting from a fresh manuscript.");

  if (!store.get().onboarded) {
    runOnboarding(app, card, (name) => {
      void (async () => {
        await engine.resync();
        const t = startPiece({ ...store.get(), composerName: name, onboarded: true }, "bagatelle");
        store.replace(t.state);
        engine.wake();
        toast.say(`${name} has started a bagatelle.`, "Go and type something.");
      })();
    });
  } else {
    engine.wake();
  }
  return app;
}
