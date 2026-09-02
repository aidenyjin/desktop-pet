# Sonatina — design notes

*A little composer who lives in your menu bar and writes music while you work.*

Sonatina takes its cue from idle desktop companions such as *Little Writer*:
a one‑bit character on sage paper, serif type, and a single loop — **your
keystrokes move their work forward**. The creative liberty taken here is the
profession. Your companion is a composer. Every key you press is a note on
their manuscript; finish a piece and it premieres, earning a little money and
a little renown. Spend the money on their craft and they take on bigger
forms — from a bagatelle to an opera.

The whole thing is meant to feel like a well‑made object: quiet, quick,
and never in the way.

## Product rules

1. **Lives in the menu bar.** No Dock icon, no main window. A template icon
   (adapts to light/dark menu bars). Left‑click toggles the panel; right‑click
   opens a small menu (Open, Launch at Login, Quit).
2. **The panel only appears when clicked.** It floats under the icon and
   hides when you click elsewhere or press ⎋. A pin keeps it open if you
   prefer to watch.
3. **Counts, never records.** Sonatina needs macOS *Input Monitoring* to hear
   key‑down events system‑wide. It increments a counter and discards the
   event. No key codes, characters, or window titles are stored or sent
   anywhere. There is no network code in the app.
4. **Works even without permission.** If you decline, only typing inside the
   panel counts. The composer naps in the meantime.
5. **Never loses progress.** The Rust side keeps a lifetime keystroke total on
   disk; the game state records how many of those it has consumed. Crashes,
   force‑quits, or a suspended webview cannot lose notes.
6. **Small and quiet.** Native WKWebView via Tauri (≈10 MB app, ≈40 MB RSS),
   render loop sleeps when hidden, no timers when idle.

## Loop

```
keystroke ──▶ notes (× tempo) ──▶ piece progress ──▶ premiere ──▶ money + renown
                                                          │
                                                          ▼
                                    upgrades: tempo · artistry · ambition
```

### Forms

| # | Form      | Notes   | Base payout | Needs ambition |
|---|-----------|---------|-------------|----------------|
| 1 | Bagatelle | 500     | $500        | 1 |
| 2 | Étude     | 2,000   | $2,400      | 2 |
| 3 | Nocturne  | 6,000   | $8,400      | 3 |
| 4 | Sonata    | 15,000  | $24,000     | 4 |
| 5 | Concerto  | 40,000  | $72,000     | 5 |
| 6 | Symphony  | 100,000 | $200,000    | 6 |
| 7 | Opera     | 250,000 | $625,000    | 7 |

Payout = base × artistry multiplier × reception (0.88–1.18, biased upward by
artistry). The reception also picks a line of flavour text for the premiere.

### Upgrades

| Upgrade   | Effect                                  | Cost curve                 |
|-----------|-----------------------------------------|----------------------------|
| Tempo     | notes per keystroke = level             | 50 · 2.2^(L‑1)             |
| Artistry  | payout × (1 + 0.5·(L‑1))                | 100 · 2.4^(L‑1)            |
| Ambition  | unlocks form L                          | 30 % of that form's payout |

A day of ordinary computer use is roughly 10–20k keystrokes. Targets:
first premiere within the first hour, a sonata inside the first week, a
symphony in a month of regular work. `scripts/simulate.ts` checks this.

### Renown

Each premiere adds *tier²* renown. Ranks: Unknown → Neighbourhood favourite
(3) → Rising talent (12) → Celebrated (40) → Renowned (120) → Legendary (300).

### Titles

Generated from the form, a key (C…B, major/minor) and a small vocabulary,
numbered as opus. Tap the title to rename it.

### Sound (optional, off by default)

Every piece carries a seed. A tiny generator turns it into a motif in the
piece's key; you can listen to a finished work in the repertoire, and
*Play along* sounds the motif softly while you type.

## Scene

A 1‑bit room drawn at 180×100 logical pixels and scaled by an integer factor
so pixels stay crisp on Retina. Left to right: an upright piano with a candle,
the composer on a stool, an arched window whose sky follows the real clock
(sun, dusk, moon and stars), a shelf with a metronome and a bust, and a cat
asleep on an armchair whose tail flicks now and then.

States: **playing** (hands alternate, head bobs, notes drift up — speed tracks
your typing rate), **idle** (after ~2 s: hands in lap, occasional stretch or
glance at the window), **dozing** (after ~2 min: head down, Zzz),
**premiere** (arms up, confetti).

Two palettes: *Paper* (sage paper, ink) and *Night* (ink paper, sage ink),
with *Auto* following the system appearance.

## Architecture

```
src/                     TypeScript, no framework
  main.ts                boot, wiring
  bridge.ts              Tauri commands with browser fallbacks (for dev/tests)
  game/state.ts          model, reducer‑style actions, migrations
  game/economy.ts        forms, upgrades, payouts, renown
  game/titles.ts         seeded title generator
  game/melody.ts         seeded motif generator
  scene/                 canvas renderer, sprites, particles, sky
  ui/                    HUD, menu, modals, onboarding, toasts
  audio.ts               WebAudio synth
src-tauri/               Rust
  src/lib.rs             setup, commands, tray
  src/keytap.rs          CGEventTap keystroke counter (macOS)
  src/panel.rs           window positioning / show / hide
  src/store.rs           atomic JSON persistence
```

Rust owns: tray, panel placement, keystroke counting, permission checks,
persistence, launch‑at‑login, notifications. The frontend owns: all game
logic, rendering, and UI. The frontend pulls the keystroke total (rather than
being pushed events) so a suspended webview can never miss counts.

## Install

* **Download**: the GitHub release `.dmg` (universal). Unsigned builds need
  a right‑click → Open on first launch.
* **Build**: `./scripts/install.sh` (needs Xcode CLT, Rust, Node) builds and
  copies `Sonatina.app` to `/Applications`. Locally built apps carry no
  quarantine flag, so they open without ceremony.
