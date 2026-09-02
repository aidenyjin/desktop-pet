#!/usr/bin/env bash
# Type-checks the Rust side for macOS from a Linux machine (no SDK needed).
# Useful for CI-less iteration; the real build happens on macOS.
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"
export CC_aarch64_apple_darwin=clang CC_x86_64_apple_darwin=clang
export AR_aarch64_apple_darwin=llvm-ar AR_x86_64_apple_darwin=llvm-ar
rustup target add aarch64-apple-darwin >/dev/null 2>&1 || true
cargo check --target aarch64-apple-darwin --no-default-features "$@"
