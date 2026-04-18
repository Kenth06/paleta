#!/usr/bin/env bash
# Build the paleta-core Rust crate to WASM with SIMD + size optimization.
#
# Prereqs:
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli
#   brew install binaryen   # for wasm-opt (macOS)
#   OR: npm install -g binaryen

set -euo pipefail

CRATE_DIR="$(cd "$(dirname "$0")/../crates/paleta-core" && pwd)"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/packages/core/wasm"
mkdir -p "$OUT_DIR"

echo "[1/3] cargo build --release --target wasm32-unknown-unknown"
(
  cd "$CRATE_DIR"
  RUSTFLAGS='-C target-feature=+simd128' \
    cargo build --release --target wasm32-unknown-unknown
)

WASM_PATH="$CRATE_DIR/target/wasm32-unknown-unknown/release/paleta_core.wasm"

echo "[2/3] wasm-bindgen --target web"
wasm-bindgen "$WASM_PATH" --target web --out-dir "$OUT_DIR" --no-typescript

if command -v wasm-opt >/dev/null; then
  echo "[3/3] wasm-opt -O3 --enable-simd --enable-bulk-memory ..."
  wasm-opt -O3 \
    --enable-simd \
    --enable-bulk-memory \
    --enable-bulk-memory-opt \
    --enable-nontrapping-float-to-int \
    "$OUT_DIR/paleta_core_bg.wasm" \
    -o "$OUT_DIR/paleta_core_bg.wasm"
else
  echo "[3/3] wasm-opt not found; skipping size/perf polish"
fi

printf '\nFinal artifact sizes:\n'
ls -la "$OUT_DIR"
