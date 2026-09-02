/** The specific dialogs: pieces, upgrades, repertoire, settings, rename, confirm. */
import {
  FORMS,
  UPGRADES,
  artistryMultiplier,
  formById,
  formUnlocked,
  formatMoney,
  formatNumber,
  nextRank,
  rankFor,
  tempoName,
  upgradeCost,
  type UpgradeId,
} from "../game/economy";
import {
  abandonPiece,
  buyUpgrade,
  canBuy,
  canStart,
  dayKey,
  renamePiece,
  setSettings,
  startPiece,
  type GameState,
  type Settings,
  type Theme,
  type Work,
} from "../game/state";
import type { AppContext } from "../app";
import { formatDate, h, icon } from "./dom";
import type { ModalApi } from "./modal";

export function openPieces(app: AppContext): void {
  app.modals.open({
    title: "On the stand",
    body: (api) => piecesBody(app, api),
  });
}

function piecesBody(app: AppContext, api: ModalApi): Node {
  const s = app.store.get();
  const frag = document.createDocumentFragment();
  if (s.current) {
    const cur = s.current;
    const pct = Math.floor((cur.notes / cur.target) * 100);
    let confirming = false;
    const box = h("div", { class: "rows" });
    const render = () => {
      box.replaceChildren(
        h("div", { class: "row is-static" }, h("div", { class: "row-main" }, h("em", null, cur.title), h("span", { class: "sub" }, `${pct}%`))),
        confirming
          ? h(
              "div",
              { class: "row", style: { gap: "10px", flexWrap: "wrap" } },
              h("span", { class: "small" }, "Put it away? Half the sketches go in the drawer."),
              h(
                "span",
                { style: { marginLeft: "auto", display: "inline-flex", gap: "6px" } },
                h(
                  "button",
                  {
                    class: "btn is-small",
                    onClick: () => {
                      app.store.update(abandonPiece, { immediate: true });
                      api.refresh();
                    },
                  },
                  "Put it away",
                ),
                h(
                  "button",
                  {
                    class: "btn is-small is-quiet",
                    onClick: () => {
                      confirming = false;
                      render();
                    },
                  },
                  "Keep going",
                ),
              ),
            )
          : h(
              "div",
              { style: { display: "flex", justifyContent: "flex-end", padding: "4px 12px 10px" } },
              h(
                "button",
                {
                  class: "btn is-small is-quiet",
                  onClick: () => {
                    confirming = true;
                    render();
                  },
                },
                "Put it away…",
              ),
            ),
      );
    };
    render();
    frag.append(h("p", { class: "small muted", style: { textAlign: "center", margin: "0 0 6px" } }, "One piece at a time."), box);
    return frag;
  }
  const rows = h("div", { class: "rows" });
  for (const f of FORMS) {
    const unlocked = formUnlocked(f, s.upgrades);
    rows.appendChild(
      h(
        "button",
        {
          class: `row ${unlocked ? "" : "is-locked"}`,
          disabled: !unlocked,
          "aria-disabled": String(!unlocked),
          onClick: () => {
            if (!canStart(app.store.get(), f.id)) return;
            const t = startPiece(app.store.get(), f.id);
            app.store.update(() => t.state, { immediate: true });
            app.engine.wake();
            api.close();
          },
        },
        h(
          "div",
          { class: "row-main" },
          h("span", { class: "name" }, `${f.name} `, h("span", { class: "sub" }, `(${formatNumber(f.notes)} notes)`)),
          unlocked ? null : h("span", { class: "sub" }, `needs Ambition ${f.tier}`),
        ),
        h("span", { class: "blurb" }, f.blurb),
      ),
    );
  }
  frag.appendChild(rows);
  if (s.spareNotes >= 1) {
    frag.appendChild(
      h("p", { class: "small muted", style: { margin: "12px 4px 0", textAlign: "center" } }, `${formatNumber(s.spareNotes)} notes of sketches in the drawer will go into the next piece.`),
    );
  }
  return frag;
}

export function openUpgrades(app: AppContext): void {
  app.modals.open({ title: "Upgrades", body: (api) => upgradesBody(app, api) });
}

function upgradeLine(s: GameState, id: UpgradeId): string {
  const lvl = s.upgrades[id];
  const max = UPGRADES.find((u) => u.id === id)!.max;
  const arrow = " → ";
  switch (id) {
    case "tempo":
      return lvl >= max ? `Tempo: ${tempoName(lvl)}` : `Tempo: ${tempoName(lvl)}${arrow}${tempoName(lvl + 1)}`;
    case "artistry":
      return lvl >= max ? `Artistry: ${lvl}` : `Artistry: ${lvl}${arrow}${lvl + 1}`;
    case "ambition": {
      const next = FORMS[lvl];
      return next ? `Ambition: ${lvl}${arrow}${lvl + 1}` : `Ambition: ${lvl}`;
    }
  }
}

function upgradeDetail(s: GameState, id: UpgradeId): string {
  const lvl = s.upgrades[id];
  switch (id) {
    case "tempo":
      return "More notes for every key you press.";
    case "artistry":
      return `Pays ${Math.round(artistryMultiplier(lvl) * 100)}% now; warmer receptions.`;
    case "ambition": {
      const next = FORMS[lvl];
      return next ? `Unlocks the ${next.name.toLowerCase()} (${formatNumber(next.notes)} notes).` : "Every form is within reach.";
    }
  }
}

function upgradesBody(app: AppContext, api: ModalApi): Node {
  const s = app.store.get();
  const frag = document.createDocumentFragment();
  frag.appendChild(h("p", { class: "small muted", style: { textAlign: "center", margin: "0 0 4px" } }, `${formatMoney(s.money)} to spend`));
  for (const u of UPGRADES) {
    const cost = upgradeCost(u.id, s.upgrades[u.id]);
    const affordable = canBuy(s, u.id);
    frag.appendChild(
      h(
        "div",
        { class: "upgrade" },
        h("div", null, h("div", { class: "upgrade-name" }, upgradeLine(s, u.id)), h("div", { class: "upgrade-blurb" }, upgradeDetail(s, u.id))),
        h(
          "button",
          {
            class: `btn ${affordable ? "is-affordable" : ""}`,
            disabled: cost === null || !affordable,
            "aria-label": cost === null ? `${u.name} is at its best` : `Buy ${u.name} for ${formatMoney(cost)}`,
            onClick: () => {
              app.store.update((st) => buyUpgrade(st, u.id), { immediate: true });
              api.refresh();
            },
          },
          cost === null ? "Best" : formatMoney(cost),
        ),
      ),
    );
  }
  return frag;
}

export function openRepertoire(app: AppContext): void {
  app.modals.open({ title: "Repertoire", body: (api) => repertoireBody(app, api), onClose: () => app.audio.stop() });
}

function repertoireBody(app: AppContext, api: ModalApi): Node {
  const s = app.store.get();
  const frag = document.createDocumentFragment();
  const rank = rankFor(s.renown);
  const next = nextRank(s.renown);
  const pct = next ? Math.min(1, (s.renown - rank.min) / (next.min - rank.min)) : 1;
  frag.appendChild(
    h(
      "div",
      { class: "rank" },
      h("div", { class: "rank-name" }, s.composerName || "Your composer"),
      h("div", { class: "rank-title" }, rank.title),
      h("div", { class: "rank-bar", title: next ? `${s.renown} / ${next.min} renown` : "" }, h("i", { style: { width: `${pct * 100}%` } })),
      next ? h("div", { class: "small muted", style: { marginTop: "4px" } }, `${next.min - s.renown} renown to ${next.title.toLowerCase()}`) : null,
    ),
  );
  if (!s.repertoire.length) {
    frag.appendChild(h("p", { class: "muted", style: { textAlign: "center" } }, "Nothing yet. Every composer starts with a bagatelle."));
  } else {
    const list = h("div");
    const works = [...s.repertoire].reverse();
    for (const w of works) list.appendChild(workRow(app, w, api));
    frag.appendChild(list);
  }
  frag.appendChild(
    h(
      "div",
      { class: "stats" },
      h("div", null, "Today ", h("b", null, formatNumber(s.stats.today === dayKey(Date.now()) ? s.stats.todayNotes : 0)), " notes"),
      h("div", null, "All time ", h("b", null, formatNumber(s.lifetimeNotes)), " notes"),
      h("div", null, "Premieres ", h("b", null, formatNumber(s.stats.premieres))),
      h("div", null, "Best night ", h("b", null, formatMoney(s.stats.bestEarning))),
    ),
  );
  return frag;
}

function workRow(app: AppContext, w: Work, api: ModalApi): Node {
  const playing = app.playingWorkId === w.id;
  const canListen = app.store.get().settings.sound;
  return h(
    "div",
    { class: "work" },
    h("div", { class: "work-title" }, w.title),
    h("div", { class: "work-meta" }, `${formById(w.formId).name} · ${formatMoney(w.earned)} · ${formatDate(w.completedAt)}${w.receptionLine ? ` · ${w.receptionLine}` : ""}`),
    canListen
      ? h(
          "button",
          {
            class: "btn is-small is-icon",
            "aria-label": playing ? "Stop" : `Listen to ${w.title}`,
            onClick: () => {
              if (playing) app.audio.stop();
              else app.listen(w, () => api.refresh());
              api.refresh();
            },
          },
          icon(playing ? "stop" : "play"),
        )
      : null,
  );
}

export function openRename(app: AppContext): void {
  const cur = app.store.get().current;
  if (!cur) return;
  app.modals.open({
    title: "Rename",
    body: (api) => {
      const input = h("input", { class: "text-input", type: "text", value: cur.title, maxlength: "80", "aria-label": "Title", spellcheck: "false" }) as HTMLInputElement;
      const save = () => {
        app.store.update((s) => renamePiece(s, input.value), { immediate: true });
        api.close();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") save();
      });
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
      return h(
        "div",
        null,
        input,
        h(
          "div",
          { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" } },
          h("button", { class: "btn is-quiet", onClick: () => api.close() }, "Cancel"),
          h("button", { class: "btn is-primary", onClick: save }, "Save"),
        ),
      );
    },
  });
}

export function openConfirm(app: AppContext, opts: { title: string; text: string; action: string; onConfirm: () => void }): void {
  app.modals.open({
    title: opts.title,
    body: (api) =>
      h(
        "div",
        null,
        h("p", null, opts.text),
        h(
          "div",
          { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" } },
          h("button", { class: "btn is-quiet", onClick: () => api.close() }, "Cancel"),
          h(
            "button",
            {
              class: "btn is-primary",
              onClick: () => {
                api.close();
                opts.onConfirm();
              },
            },
            opts.action,
          ),
        ),
      ),
  });
}

export function openSettings(app: AppContext): void {
  let autostart: boolean | null = null;
  let version = "";
  let saveDir = "";
  app.modals.open({
    title: "Settings",
    body: (api) => {
      if (autostart === null) {
        void Promise.all([app.bridge.getAutostart(), app.bridge.appVersion(), app.bridge.saveDir()]).then(([a, v, d]) => {
          autostart = a;
          version = v;
          saveDir = d;
          api.refresh();
        });
      }
      return settingsBody(app, api, { autostart, version, saveDir });
    },
  });
}

function toggle(label: string, sub: string | null, value: boolean, onChange: (v: boolean) => void, disabled = false): Node {
  return h(
    "div",
    { class: "setting" },
    h("div", { class: "setting-label" }, label, sub ? h("small", null, sub) : null),
    h("button", {
      class: "toggle",
      role: "switch",
      "aria-checked": String(value),
      "aria-label": label,
      disabled,
      onClick: () => onChange(!value),
    }),
  );
}

function settingsBody(app: AppContext, api: ModalApi, extra: { autostart: boolean | null; version: string; saveDir: string }): Node {
  const s = app.store.get();
  const set = (patch: Partial<Settings>) => {
    app.store.update((st) => setSettings(st, patch), { immediate: true });
    api.refresh();
  };
  const frag = document.createDocumentFragment();

  // Listening status.
  const listening = app.listening;
  if (app.permission !== "unsupported") {
    frag.appendChild(
      h(
        "div",
        { class: "setting" },
        h(
          "div",
          { class: "setting-label" },
          h("span", { class: listening ? "status-ok" : "status-warn" }, listening ? "Counting keystrokes everywhere" : "Only counting keys typed here"),
          h("small", null, listening ? "Only the count is kept — never which keys." : "Allow Input Monitoring so the composer hears you work."),
        ),
        listening ? null : h("button", { class: "btn is-small", onClick: () => app.requestListening(() => api.refresh()) }, "Allow"),
      ),
    );
  }

  frag.appendChild(
    h(
      "div",
      { class: "setting" },
      h("div", { class: "setting-label" }, "Composer's name"),
      (() => {
        const input = h("input", { class: "text-input is-short", type: "text", value: s.composerName, maxlength: "24", "aria-label": "Composer's name", spellcheck: "false" }) as HTMLInputElement;
        const commit = () => {
          const name = input.value.trim().slice(0, 24);
          if (name && name !== app.store.get().composerName) app.store.update((st) => ({ ...st, composerName: name }), { immediate: true });
        };
        input.addEventListener("change", commit);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            commit();
            input.blur();
          }
        });
        return input;
      })(),
    ),
  );

  frag.appendChild(
    h(
      "div",
      { class: "setting" },
      h("div", { class: "setting-label" }, "Appearance"),
      h(
        "div",
        { class: "segmented", role: "group", "aria-label": "Appearance" },
        ...(["paper", "night", "auto"] as Theme[]).map((t) =>
          h("button", { "aria-pressed": String(s.settings.theme === t), onClick: () => set({ theme: t }) }, t === "paper" ? "Paper" : t === "night" ? "Night" : "Auto"),
        ),
      ),
    ),
  );

  frag.appendChild(toggle("Keep the panel open", "Otherwise it hides when you click away.", s.settings.pinned, (v) => set({ pinned: v })));
  frag.appendChild(
    toggle("Launch at login", null, extra.autostart ?? false, (v) => {
      void app.bridge.setAutostart(v).then(
        () => void app.bridge.getAutostart().then((a) => {
          extra.autostart = a;
          api.refresh();
        }),
        () => api.refresh(),
      );
      extra.autostart = v;
    }, extra.autostart === null),
  );
  frag.appendChild(toggle("Premiere notifications", "When a piece finishes while the panel is hidden.", s.settings.notifications, (v) => set({ notifications: v })));
  frag.appendChild(toggle("Sound", "A chime at premieres; listen to finished pieces.", s.settings.sound, (v) => set({ sound: v })));
  frag.appendChild(
    toggle("Play along", "Soft notes while you type.", s.settings.playAlong, (v) => set({ playAlong: v, ...(v ? { sound: true } : {}) }), !s.settings.sound && !s.settings.playAlong),
  );

  frag.appendChild(
    h(
      "div",
      { class: "setting", style: { justifyContent: "space-between" } },
      h("div", { class: "setting-label" }, "Start over", h("small", null, "Keeps the name and these settings.")),
      h(
        "button",
        {
          class: "btn is-small",
          onClick: () =>
            openConfirm(app, {
              title: "Start over",
              text: "Everything the composer has written and earned will be gone. This cannot be undone.",
              action: "Start over",
              onConfirm: () => app.reset(),
            }),
        },
        "Reset…",
      ),
    ),
  );

  frag.appendChild(
    h(
      "p",
      { class: "small muted", style: { margin: "14px 0 0", textAlign: "center", lineHeight: 1.5 } },
      `Sonatina ${extra.version || ""}`.trim(),
      " · ",
      h("button", { class: "link", onClick: () => void app.bridge.openUrl("https://github.com/aidenyjin/desktop-pet") }, "GitHub"),
      h("br"),
      "Counts keystrokes, never records them. No network.",
      extra.saveDir ? h("span", null, h("br"), h("span", { title: extra.saveDir }, "Saved in Application Support.")) : null,
    ),
  );
  return frag;
}
