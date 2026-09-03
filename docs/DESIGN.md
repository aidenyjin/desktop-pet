# Sonatina — design notes

*A little composer who lives in your menu bar and writes music while you work.*

Sonatina takes its cue from idle desktop companions such as *Little Writer*:
a one‑bit character on sage paper, serif type, and a single loop — **your
keystrokes move their work forward**. The creative liberty taken here is the
profession. Your companion is a composer. Every key you press, and every click, is a note on
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
| 2 | Étude     | 2,500   | $2,500      | 2 |
| 3 | Nocturne  | 8,000   | $9,000      | 3 |
| 4 | Sonata    | 25,000  | $30,000     | 4 |
| 5 | Concerto  | 70,000  | $90,000     | 5 |
| 6 | Symphony  | 180,000 | $250,000    | 6 |
| 7 | Opera     | 450,000 | $700,000    | 7 |

Payout = base × artistry multiplier × reception (0.88–1.18, skewed upward by
artistry). The reception also picks a line of flavour text for the premiere.
Notes written past the end of a piece go into "the drawer" and are applied to
the next piece (never enough to finish it outright).

### Upgrades

| Upgrade   | Effect                                      | Cost                                 |
|-----------|---------------------------------------------|--------------------------------------|
| Tempo     | notes per keystroke = bpm / 60; Adagio (60) → Prestissimo (200) in 8 marks | 100, 250, 600, 1.5k, 4k, 10k, 25k |
| Artistry  | payout × (1 + 0.15·(L‑1)), warmer receptions | 200 · 2.5^(L‑1), rounded          |
| Ambition  | unlocks form L+1                            | 1.5 × payout of the current largest  |

Clicks count as notes alongside keystrokes: the composer is keeping you
company through a day's work, and a day's work is not all typing — reading,
browsing and clicking through an interface should move the manuscript along
too. Only the *down* edge of a click counts, so a click is one note and a
drag is not a flurry of them. The same wear threshold applies, so an
auto-clicker is spam for exactly the same reason a held-down key is.

A day of ordinary computer use is roughly 10–20k keystrokes. With 15k a day
the simulation (`npm run simulate`) reaches a sonata on day 2, a concerto on
day 4, a symphony around day 10 and an opera in about three weeks; at 6k a
day those land on days 5, 11, 26 and 54.

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

## Beyond typing

Three small systems round out the loop:

**Mini mode.** The panel can shrink to a small round, draggable widget — a
loose crop on the composer, with a thin progress ring around the edge — that
sits on the desktop instead of tucking away under the menu bar icon. It
doesn't hide on blur (that would defeat the point of a widget you leave
out), remembers where you left it, and a click expands it back. The *full*
panel is draggable too — grab its header bar — and, once moved, stays put at
that spot on future opens instead of re-docking under the tray icon. On
macOS both hand off to the OS window manager (`startDragging`), reading the
window's settled position back afterward rather than tracking it live
(a real OS-driven drag can't be observed from JS mid-motion); the browser
fallback used for development moves the element directly.

**Thinking mode.** A toggle — a small note icon by the piano, or the ≡ menu —
for when you're away from the keyboard but still want the composer
"working." While on, they sit back — a raised hand, a slow-pulsing
thought-note — and a timer quietly banks *inspiration*, capped at ten
minutes' worth. Typing (of any kind, anywhere) always interrupts it
immediately. Banked inspiration adds up to +15% to the reception of the
*next* piece that premieres, then resets to zero — an ambient bonus for
stepping away, not a substitute for typing.

**Your pace.** What counts as spamming is *personal*. A threshold fixed for
everyone is either free money for a fast typist or a punishment for a slow
one — and the original fixed threshold (15 keys/sec, which is 180 wpm) was
so far above any human that mashing cost nothing at all. So the game
measures you instead. A short typing test on first run gives a starting
figure in words per minute (one "word" being five keystrokes, the usual
convention); from then on the estimate follows how you actually type. It
rises quickly (a 90-second time constant) and falls slowly (an hour), so it
settles near your comfortable *peak* rather than your average — an average
over a real session is dragged down by thinking and reading, and would end
up accusing ordinary flurries of being spam. The estimate is held between 15
and 140 wpm, and you can see it, and retake the test, in Settings.

Two windows matter here, and they are deliberately different sizes. The
*wear* threshold is about 1.7× your own pace. The *learning* window is
wider — anything up to 12 keys/sec is still credible as typing and counts as
evidence. Gating learning at the wear threshold instead would be a trap: an
underestimating test could never be corrected, because the very typing that
proved you were faster would be dismissed as spam. Mashing runs far above
even the wider window, so it still teaches the game nothing.

**Piano wear.** Wear is driven by a *smoothed* rate (the engine's running
average, not a single burst), so a quick flurry of ordinary typing, or a big
backlog arriving all at once after the panel was hidden, never registers as
spamming. Only holding a pace well above *your own* does. The wear scale
runs 0 to 1000 rather than 0 to 100 so the cracks creep in gradually: about
ten seconds of real mashing is already visible, and a full jam takes a
minute or two — enough warning to just stop. The piano also heals slowly
(0.5 per second) whenever your pace is back under the threshold, so one bad
afternoon does not follow you forever; it is far too slow to rescue active
spamming. Past 30%/60%/85% wear the piano visibly cracks (60% also adds an
occasional stuck-key stutter to the playing animation); past 100% it jams —
keystrokes still count toward the lifetime total, but only a small fraction
(12%) still turn into notes, with a spark and a flinch for the rest. That
trickle is deliberate: no state in this game produces zero income forever,
so there is always a way to earn a repair, however slow. Repairing costs
money that scales steeply with how far gone it is (capped at roughly one
nocturne's takings), and resets wear to zero. A "Start over" is also always
one confirm away in the ≡ menu, for a clean slate.

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
  src/keytap.rs          CGEventTap key + click counter (macOS)
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
