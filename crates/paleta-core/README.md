# paleta-core (Rust)

v0.2 replacement for the TS hot path in `@ken0106/core`. Compiles to WASM with
SIMD for use in Cloudflare Workers and browsers.

## Status

**Scaffold only.** v0.1 ships with the pure-TS kernel. This crate is wired up
so v0.2 is a drop-in perf upgrade without reshuffling the package layout.

## Build

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli wasm-opt
../../scripts/build-wasm.sh
```

Output lands in `packages/core/wasm/` so `@ken0106/core` can dynamic-import it
at runtime once v0.2 ships.

## Design notes

- `crate-type = ["cdylib", "rlib"]` so Cargo can produce both a WASM artifact
  and an rlib for unit testing on native.
- `opt-level = "z"` + LTO + single codegen unit + `strip` keeps the artifact
  under 60KB gzipped.
- SIMD is enabled via `RUSTFLAGS='-C target-feature=+simd128'` in
  `scripts/build-wasm.sh`. Cloudflare Workers support `simd128`.
- No threads: `rayon` is not an option. Every hot path stays single-threaded.
