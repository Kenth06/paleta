# Changelog

All notable changes documented per Conventional Commits + Keep-a-Changelog.

## [Unreleased]

_nothing yet — next tag will sit here._

## [0.1.0-alpha.0] — 2026-04-20

First tagged release. Four packages published to the `alpha` dist-tag:
`@ken0106/core`, `@ken0106/jsquash`, `@ken0106/exif`, `@ken0106/cache-do`.

### Added
- **JPEG DC-only decoder** (Rust, exposed as `decodeJpegDcOnly` +
  `PaletteOptions.useDcOnlyJpeg`). Parses only the DC coefficients and
  skips IDCT entirely, giving a 1/8×1/8 downsampled RGBA image for
  roughly 1/64 the cost of a full decode. Supports:
  - Baseline sequential (SOF0) and progressive (SOF2) JPEGs.
  - 1-component (grayscale), 3-component (YCbCr), 4-component (YCCK/CMYK).
  - Subsamplings 4:4:4 / 4:2:2 / 4:4:0 / 4:2:0.
  - Interleaved AND non-interleaved progressive DC-first scans.
  - DRI restart markers, byte-stuffed entropy streams.
  - Adobe APP14 detection for YCCK vs raw CMYK.
- `meta.path = 'dc-only'` reports when the fast path fires.
- Real-image fixture suite (native PNG codec + 5 procedural fixtures,
  PIL-generated JPEG fixtures for DC-only). ΔE_OK < 4 quality gates.
- Byte-flip fuzzer (`scripts/find-panic.mjs`) — 300,072 mutations across
  all fixtures, zero panics.
- `examples/rpc-service`: PaletaService Worker exposing palette extraction
  via Service Binding RPC + a consumer Worker.
- `examples/minimal-worker` now decodes PNG/WebP/AVIF end-to-end on
  Cloudflare Workers via explicit `CompiledWasm` jSquash WASM init.
  `/bench?iters=N&path=dc|full` endpoint for real-runtime timing.
- GitHub Actions CI: typecheck/test on Node 20 & 22, Rust WASM build
  on stable with SIMD, non-blocking bench summary job.
- `scripts/build-wasm.sh` runs `wasm-opt -O3` with SIMD +
  bulk-memory feature flags.
- `scripts/publish.sh`: dry-run-by-default publish orchestration with
  dependency-ordered `pnpm publish` + git tag.

### Changed
- **WASM Wu quantizer: packed-moment layout + wasm-opt.** 5 cumulative
  moment tables collapsed into one `Vec<f64>` with stride 5; `volume5`
  fuses 5 previous calls into 1 eight-corner pass. Cuts loads from 40 to
  8 inside `variance()`. Paired with `wasm-opt -O3 --enable-simd`.
  Net: 7% faster mean, 9% better p99 vs v0.2 initial.
- **JPEG DC-only decoder optimizations**: 256-entry Huffman fast lookup
  and buffered u32 BitReader combine for an 11× speedup on the decoder
  hot path (3.68 ms → 0.33 ms on 640×480 4:2:0 JPEG). Final result is
  3–9× faster than `@jsquash/jpeg` (mozjpeg) across every tested size.
- `@ken0106/core`: `PaletteOptions.crossColoCache` accepts any
  `PaletteCacheBackend` (`{ get, put }`); promoted from `cache` API only.
- Pipeline now does two-tier cache lookup (colo-local → cross-colo) and
  back-fills colo-local on cross-colo hits.

### Fixed
- Defensive guards against corrupted JPEG input: segment length < 2,
  frame dimensions > 8192, out-of-range `qt_id` / `dc_huff_id` / `ac_huff_id`,
  `receive_extend` shift overflow on `s >= 31`, DC accumulator switched
  to `wrapping_add`. 300k fuzzing mutations now panic-free.

### Performance summary vs. alternatives

| Path                          | paleta          | mozjpeg full | Δ        |
| ----------------------------- | --------------- | ------------ | -------- |
| 64×64 baseline 4:4:4          | 0.006 ms        | 0.035 ms     | **5.9×** |
| 128×128 baseline 4:2:0        | 0.009 ms        | 0.115 ms     | **12.3×**|
| 640×480 baseline 4:4:4        | 0.55 ms         | 2.33 ms      | **4.2×** |
| 640×480 baseline 4:2:0        | 0.33 ms         | 2.19 ms      | **6.7×** |
| 1280×720 baseline 4:2:0       | 0.78 ms         | 6.27 ms      | **8.1×** |

End-to-end `getPalette()` inside a real Cloudflare `workerd` isolate
(640×480 4:2:0 JPEG, 300 iters):
  - DC-only path: mean 0.73 ms, p99 2 ms, ~1,370 rps
  - full-decode path: mean 2.54 ms, p99 6 ms, ~394 rps

## [0.4.0-alpha] — 2026-04-17

### Added
- **`@ken0106/cache-do`**: Durable Object SQLite cache backend. Free-tier
  compatible. `paletaDurableCache(namespace, shardKey?)` returns a
  `PaletteCacheBackend`. Self-managing expiry via DO alarms.
- `PaletaCacheDO` class with `cacheGet`/`cachePut`/`cachePurge` RPC methods.
- `PaletteCacheBackend` type exported from `@ken0106/core`.
- Example Worker wires the DO cache behind an optional `PALETA_CACHE` binding.

## [0.3.0-alpha] — 2026-04-17

### Added
- **EXIF thumbnail fast path**. When a `thumbnailExtractor` is provided and
  the input is JPEG, the pipeline decodes the EXIF thumbnail instead of the
  full image. `meta.path` reports `exif-thumb` or `full-decode`.
- `PaletteOptions.thumbnailExtractor`, `minThumbnailDimension`.
- `@ken0106/core/wasm` subpath export — ship the prebuilt WASM with the package.
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
- **`@ken0106/core`**: correct magic-byte sniffer (fixes upstream AVIF +
  WebP bugs), Wu quantizer over a 5-bit RGB histogram, OKLab ↔ OKLCH
  conversions, WCAG 2.x contrast helpers, NN resize, perceptual palette
  sort, accent picker, `PaletteError`, edge-cache integration.
- **`@ken0106/jsquash`**: lazy per-format adapters (JPEG/PNG/WebP/AVIF).
  jSquash declared as optional peer dependencies so JPEG-only consumers
  ship ~200KB instead of 1.3MB.
- **`@ken0106/exif`**: standalone EXIF APP1 JPEG thumbnail extractor.
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
