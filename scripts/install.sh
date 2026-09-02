#!/usr/bin/env bash
# Builds Sonatina from source and installs it into /Applications.
# Needs: macOS 12+, Xcode Command Line Tools, Rust (rustup), Node 20+.
set -euo pipefail
cd "$(dirname "$0")/.."

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing: $1. $2" >&2
    exit 1
  fi
}

[[ "$(uname -s)" == "Darwin" ]] || { echo "Sonatina is a macOS app; build this on a Mac." >&2; exit 1; }
xcode-select -p >/dev/null 2>&1 || { echo "Install the Xcode Command Line Tools first: xcode-select --install" >&2; exit 1; }
need node "Install from https://nodejs.org or: brew install node"
need cargo "Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"

ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then TARGET="aarch64-apple-darwin"; else TARGET="x86_64-apple-darwin"; fi

bold "Installing dependencies…"
npm ci --no-audit --no-fund

bold "Building Sonatina for $TARGET (this takes a few minutes the first time)…"
npx tauri build --target "$TARGET" --bundles app

APP="src-tauri/target/$TARGET/release/bundle/macos/Sonatina.app"
[[ -d "$APP" ]] || { echo "Build finished but $APP was not found." >&2; exit 1; }

bold "Installing to /Applications…"
if pgrep -x Sonatina >/dev/null 2>&1; then
  osascript -e 'tell application "Sonatina" to quit' >/dev/null 2>&1 || pkill -x Sonatina || true
  sleep 1
fi
rm -rf /Applications/Sonatina.app
ditto "$APP" /Applications/Sonatina.app

bold "Done."
echo "Open it with:  open -a Sonatina"
echo "It lives in the menu bar. When macOS asks, allow Input Monitoring so the composer can hear you type."
if [[ "${1:-}" == "--open" ]]; then open -a Sonatina; fi
