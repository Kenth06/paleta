# Changelog

All notable changes documented per Conventional Commits + Keep-a-Changelog.

## [Unreleased]

### Added
- **JPEG DC-only decoder** (Rust, exposed as `decodeJpegDcOnly` +
  `PaletteOptions.useDcOnlyJpeg`). Parses only the DC coefficients and
  skips IDCT entirely, giving a 1/8×1/8 downsampled RGBA image for
  roughly 1/64 the cost of a full decode. Supports baseline sequential
  YCbCr JPEGs with 4:4:4 and 4:2:0 subsampling. Validated end-to-end
  against PIL-generated fixtures.
- `meta.path = 'dc-only'` reports when the fast path fires.
- Real-image fixture suite (native PNG codec + 5 procedural fixtures,
  PIL-generated JPEG fixtures for DC-only). ΔE_OK < 4 quality gates.
- `examples/rpc-service`: PaletaService Worker exposing palette extraction
  via Service Binding RPC + a consumer Worker.
- GitHub Actions CI: typecheck/test on Node 20 & 22, Rust WASM build
  on stable with SIMD, non-blocking bench summary job.
- `scripts/build-wasm.sh` now runs `wasm-opt -O3` with SIMD +
  bulk-memory feature flags.

### Changed
- **WASM Wu quantizer: packed-moment layout + wasm-opt.** 5 cumulative
  moment tables collapsed into one `Vec<f64>` with stride 5; `volume5`
  fuses 5 previous calls into 1 eight-corner pass. Cuts loads from 40 to
  8 inside `variance()`. Paired with `wasm-opt -O3 --enable-simd`.
  Net: 7% faster mean, 9% better p99 vs v0.2 initial.
- `@paleta/core`: `PaletteOptions.crossColoCache` accepts any
  `PaletteCacheBackend` (`{ get, put }`); promoted from `cache` API only.
- Pipeline now does two-tier cache lookup (colo-local → cross-colo) and
  back-fills colo-local on cross-colo hits.

## [0.4.0-alpha] — 2026-04-17

### Added
- **`@paleta/cache-do`**: Durable Object SQLite cache backend. Free-tier
  compatible. `paletaDurableCache(namespace, shardKey?)` returns a
  `PaletteCacheBackend`. Self-managing expiry via DO alarms.
- `PaletaCacheDO` class with `cacheGet`/`cachePut`/`cachePurge` RPC methods.
- `PaletteCacheBackend` type exported from `@paleta/core`.
- Example Worker wires the DO cache behind an optional `PALETA_CACHE` binding.

## [0.3.0-alpha] — 2026-04-17

### Added
- **EXIF thumbnail fast path**. When a `thumbnailExtractor` is provided and
  the input is JPEG, the pipeline decodes the EXIF thumbnail instead of the
  full image. `meta.path` reports `exif-thumb` or `full-decode`.
- `PaletteOptions.thumbnailExtractor`, `minThumbnailDimension`.
- `@paleta/core/wasm` subpath export — ship the prebuilt WASM with the package.
- Example Worker uses `CompiledWasm` rule + lazy `initWasm` with auto-fallback.

### Deferred
- JPEG DC-only decoder. Scoped to its own multi-session effort.

## [0.2.0-alpha] — 2026-04-17

### Added
- **Rust WASM quantizer** (`paleta-core` crate). Built with
  `-C target-feature=+simd128`, artifact size 27.4 KB.
- `initWasm(source)`, `quantizeWuWasm(rgba, w, h, opts)`, `isWasmReady()`,
  `WasmNotInitializedError`.
- `PaletteOptions.useWasm` (auto-detected via `isWasmReady()`).
- Parity test: WASM palette matches JS within 8-per-channel rounding.

### Performance
- Histogram + Wu on 128×128: **0.83ms → 0.25ms** (3.38× faster).
- p99: **3.07ms → 0.40ms** (7.7× tighter tail latency).
- 1024×1024 step=50: 0.76ms → 0.33ms (2.27× faster).

## [0.1.0-alpha] — 2026-04-17

### Added — pure-TS kernel
- **`@paleta/core`**: correct magic-byte sniffer (fixes upstream AVIF +
  WebP bugs), Wu quantizer over a 5-bit RGB histogram, OKLab ↔ OKLCH
  conversions, WCAG 2.x contrast helpers, NN resize, perceptual palette
  sort, accent picker, `PaletteError`, edge-cache integration.
- **`@paleta/jsquash`**: lazy per-format adapters (JPEG/PNG/WebP/AVIF).
  jSquash declared as optional peer dependencies so JPEG-only consumers
  ship ~200KB instead of 1.3MB.
- **`@paleta/exif`**: standalone EXIF APP1 JPEG thumbnail extractor.
- **`examples/minimal-worker`**: deployable `/palette?url=…` Worker with
  `caches.default`, Smart Placement, optional `ALLOWED_HOSTS` SSRF guard.
- **`paleta-core` (Rust crate)**: scaffold for v0.2 with release profile,
  SIMD build script, and size budget.

### Added — tests/bench
- 20 unit tests: sniffer correctness (incl. explicit regressions for the
  upstream `RIWE` and offset-0 AVIF bugs), OKLab round-trip, WCAG
  contrast, quantizer on solid / tri-stripe / alpha-masked inputs,
  pipeline error codes.
- First benchmark baseline: post-decode hot path ~0.7ms on 128×128.
- 25× speedup from stride-sampling confirmed on 1MP input.

### Self-improving infra
- `CLAUDE.md`: mission, invariants, ADR log (3 committed), perf targets,
  research + optimization loops, atomic-commit etiquette.
- `LEARNINGS.md`: cross-session mistakes + wins notebook.
- `bench/results/`: per-date bench snapshots, committed.
