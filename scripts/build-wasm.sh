#!/usr/bin/env bash
# Build the paleta-core Rust crate to WASM with SIMD + size optimization.
#
# Prereqs:
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli
#   cargo install wasm-opt   # from binaryen
set -euo pipefail

CRATE_DIR="$(cd "$(dirname "$0")/../crates/paleta-core" && pwd)"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/packages/core/wasm"
mkdir -p "$OUT_DIR"

cd "$CRATE_DIR"

RUSTFLAGS='-C target-feature=+simd128' \
  cargo build --release --target wasm32-unknown-unknown

WASM_PATH="$CRATE_DIR/target/wasm32-unknown-unknown/release/paleta_core.wasm"

wasm-bindgen "$WASM_PATH" --target web --out-dir "$OUT_DIR" --no-typescript

# Size optimization. -Oz preserves SIMD ops on recent wasm-opt.
if command -v wasm-opt >/dev/null; then
  wasm-opt -Oz --enable-simd -o "$OUT_DIR/paleta_core_bg.wasm" "$OUT_DIR/paleta_core_bg.wasm"
fi

ls -la "$OUT_DIR"
