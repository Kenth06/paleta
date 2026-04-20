# Contributing to paleta

Thanks for your interest in paleta. This doc is the short version of
everything you need to know to land a change.

## Quick start

```sh
git clone https://github.com/Kenth06/paleta.git
cd paleta
pnpm install
pnpm -r build
pnpm test                     # 69 tests, ~500ms
pnpm exec vitest bench --run  # benchmarks (optional)
```

You need:

- **Node 20+** (CI tests both 20 and 22).
- **pnpm 9+** (repo uses `workspace:*` protocol).
- **Rust stable + wasm32-unknown-unknown** only if you're editing the Rust crate.
- **Python 3 + Pillow** only if you're adding a JPEG fixture.

## Project layout

```
packages/
  core/        @ken0106/core       ← the library kernel
  jsquash/     @ken0106/jsquash    ← jSquash decoder adapters
  exif/        @ken0106/exif       ← EXIF thumbnail extractor
  cache-do/    @ken0106/cache-do   ← Durable Object cache backend
crates/
  paleta-core/ Rust SIMD WASM quantizer + JPEG DC-only decoder
examples/
  minimal-worker/  deployable /palette?url=... Worker
  rpc-service/     Worker-to-Worker via Service Bindings
test/            vitest suites
bench/           vitest bench + published results/
scripts/         build-wasm.sh, publish.sh, find-panic.mjs
```

## Building the WASM artifact

If your change touches `crates/paleta-core/`:

```sh
bash scripts/build-wasm.sh
```

That runs:
1. `cargo build --release --target wasm32-unknown-unknown` with `+simd128`
2. `wasm-bindgen --target web`
3. `wasm-opt -O3` with SIMD + bulk-memory feature flags

Output lands in `packages/core/wasm/`. Commit the rebuilt
`paleta_core_bg.wasm` alongside your Rust change.

## Adding a JPEG fixture

```sh
python3 -c "
from PIL import Image
img = Image.new('RGB', (128, 128), (220, 30, 30))
img.save('test/fixtures/my-new.jpg', 'JPEG', quality=85, subsampling=0)
"
```

Then write a test in `test/jpeg-dc.test.ts` (or a new file) that asserts
your expected palette / pipeline path.

## Before you push

```sh
pnpm -r build        # makes sure dist/ is fresh so tests see current src
pnpm test            # 69/69 must pass
pnpm -r typecheck    # strict mode, exactOptionalPropertyTypes
bash scripts/find-panic.mjs   # optional: re-run the 300k fuzz sweep
```

For Rust changes, also:
```sh
cargo test --manifest-path crates/paleta-core/Cargo.toml
```

## Commit style

Conventional commits, one logical change per commit:

- `feat(core): …` — new public API
- `fix(jpeg_dc): …` — bug fix
- `perf(wasm): …` — performance change (include numbers in body)
- `test: …` — new tests
- `docs: …` — README/CHANGELOG
- `chore: …` — tooling, deps, release prep

Commit body should explain *why*, not *what*. For perf commits, include
the before/after numbers from `bench/`.

## Invariants (don't break these)

These are enforced by review + tests. See [CLAUDE.md](./CLAUDE.md) for the
full rationale.

1. **`@ken0106/core` has zero runtime dependencies.** If you're about to
   add one, open an issue first.
2. **Decoders are optional peers.** JPEG-only consumers must not ship
   PNG/WebP/AVIF WASM.
3. **Static WASM imports are forbidden outside per-format adapter
   modules.** Use dynamic `import()` so bundlers code-split.
4. **Public API never throws on wrong format.** Return a typed error or
   throw a `PaletteError` with a known `code`.
5. **Nothing in `@ken0106/core` imports from `node:*`.**
6. **DC-only decoder must never panic on any input.** Run the byte-flip
   fuzzer before merging Rust changes that touch `jpeg_dc.rs`.

## Reporting bugs

Please include:

- A minimal repro (link to a JPEG/PNG, or attach a small sample).
- The output of `result.meta` — specifically `format`, `path`, and timings.
- The `@ken0106/*` versions (`npm ls @ken0106/core`).

## Releasing (maintainers only)

```sh
# Bump versions across all publishable packages
for p in packages/{core,exif,jsquash,cache-do}; do
  (cd "$p" && npm version 0.1.0-alpha.1 --no-git-tag-version)
done

# Dry-run, then publish
scripts/publish.sh           # inspect output
scripts/publish.sh --go      # real publish (prompts for npm OTP × 4)
```

## License

By contributing you agree that your changes ship under
[MIT](./LICENSE).
