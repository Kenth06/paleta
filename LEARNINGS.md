# LEARNINGS.md — paleta

Persistent notebook across Claude sessions. Append-only. Read before starting work.

---

## last-checked

- Cloudflare Workers changelog: **2026-04-17**
- jSquash releases: **2026-04-17**
- quantette crate: **2026-04-17**
- photon-rs crate: **2026-04-17**
- wasm-bindgen: **0.2.118 (2026-04-17)**

## Notable platform state (as of last-checked)

- **WASM SIMD** is supported on Workers. Use `-C target-feature=+simd128` for Rust crates.
- **No threads.** `rayon` / `wasm-bindgen-rayon` won't work. Single-threaded only.
- **FinalizationRegistry** is supported — wire it for WASM memory leak prevention (`Exceeded Memory` errors).
- **Startup budget is 1 second** global-scope. Bundle + WASM parse must fit.
- **Durable Objects with SQLite storage are on the free tier.** 10GB each on paid.
- **Cloudflare Containers are GA** as of March 2026. Useful for HEIC/TIFF later.
- **Service Bindings + RPC** — zero-overhead in-process calls. No network hop.
- **Smart Placement** only affects `fetch` handlers, not RPC methods.
- **`env` can be imported from `cloudflare:workers`** at module scope (not just during requests).

## Algorithms

- **Wu quantizer** — 3D weighted-variance median cut on a 32³ histogram. Bounded cost regardless of image size. ~2–5ms in JS, <1ms in WASM.
- **Material Color Utilities** uses Wu as a coarse pass, then WSMeans for refinement — good reference pipeline.
- **OKLab / OKLCH** — use OKLab for population weighting and gradient interpolation; OKLCH for hue-family sorting and accent picks.
- **JPEG DC-only** — Huffman-decode only DC coefficients, skip IDCT. Gives 1/8×1/8 of original at ~1/64 the cost. Requires custom decoder (no off-the-shelf JS lib exposes this).
- **EXIF APP1 thumbnail** — present in most camera/CDN JPEGs. ≤64KB. Decode it instead of the full image when available.

## Bugs in the wild (copied from before — do not reintroduce)

- `cf-colorthief` AVIF sniffer: checks `ftypavif` from offset 0. Should check bytes 4–11 (ISO-BMFF `ftyp` box starts at offset 4). Our `sniff.ts` fixes this.
- `cf-colorthief` WebP sniffer: matches `RIWE` (not a real signature). Should require `RIFF` at 0–3 AND `WEBP` at 8–11. Our `sniff.ts` fixes this.

## Mistakes

*(Record here when you get something wrong. Include date, what, why, and how to avoid.)*

### 2026-04-17 — Worker packages must drop DOM lib for `caches.default` typing
**What**: Worker `tsconfig` inherited `lib: ["DOM", "DOM.Iterable"]` from the
base. That pulls in DOM's `CacheStorage` type, which has `match()` / `open()`
but not `.default`. Cloudflare's `@cloudflare/workers-types` augments
`CacheStorage` with `.default`, but DOM's plain `CacheStorage` shadows it.
**Why**: Assumed `@cloudflare/workers-types` is additive. It's only additive
when DOM isn't also pulled in.
**Avoid next time**: In Worker-specific packages, override `lib` to drop DOM.
Keep only `["ES2023"]` and add `types: ["@cloudflare/workers-types"]`.
Library packages (`@paleta/core`) keep DOM since they need `fetch`/`Response`
in non-Worker runtimes.

### 2026-04-17 — vitest bench does not await `beforeAll`
**What**: Put `await initWasm(bytes)` inside `beforeAll`. The bench ran with
0 samples because WasmNotInitializedError was thrown every iteration and
silently counted as "unable to measure".
**Why**: Assumed bench shares the `beforeAll` contract with `test`. It doesn't
— bench internals don't defer the bench loop on async setup.
**Avoid next time**: For bench files that need async setup, use **top-level
await** directly at module scope. ESM bench files support this.

### 2026-04-17 — wasm-bindgen 0.2.100+ wants object-form init params
**What**: Called `init(bytes)` where `bytes` is a Uint8Array. It worked but
logged `using deprecated parameters for the initialization function; pass a
single object instead` at every init.
**Why**: The init signature changed to accept `{ module_or_path: ... }` to
support additional knobs (custom imports, memory) without breaking callers.
**Avoid next time**: Always call as
`await init({ module_or_path: <bytes | URL | Module> })`. Cast as needed —
the .d.ts option type is a union that includes the object form.

### 2026-04-17 — tsup caches — add new exports to both index.ts AND rebuild
**What**: Added `initWasm`, `isWasmReady`, `quantizeWuWasm` to
`quantize/index.ts` but not to `src/index.ts`. Tests importing from
`@paleta/core` failed with `initWasm is not a function` because the
workspace resolves to `packages/core/dist/index.js`.
**Why**: Forgot that the package's public surface is `src/index.ts`, not
whatever happens to be re-exported from a submodule. Additionally, `dist/`
is cached; edits to `src/` don't reach consumers until `pnpm build` runs.
**Avoid next time**: When adding a new export, update `src/index.ts` first
then rebuild. Better: add a workspace-level `pnpm build` pre-test hook so
`pnpm test` always sees fresh dist outputs.

### 2026-04-17 — exactOptionalPropertyTypes vs `signal: undefined`
**What**: Passed `{ signal: opts?.signal, redirect: "follow" }` to `fetch()` with
`exactOptionalPropertyTypes: true`. TS rejected it because `RequestInit.signal`
is typed `AbortSignal | null` (not `| undefined`), and our value could be undefined.
**Why**: Assumed optional-property typing is symmetric with the browser's lib
definitions, but the DOM lib uses `null` for "absent", not `undefined`.
**Avoid next time**: With `exactOptionalPropertyTypes`, don't spread optional
values into option objects. Build the object conditionally:
```ts
const init: RequestInit = { redirect: "follow" };
if (opts.signal) init.signal = opts.signal;
```
This also applies to any DOM/Cloudflare typing that uses `X | null` rather
than `X | undefined`.

## Wins

*(Record unexpected performance wins so they don't get reverted.)*

### 2026-04-17 — Rust Wu quantizer p99 beats JS by 7.7× on 128×128
**What**: Pure-JS mean 0.83ms, p99 3.07ms. Rust WASM mean 0.25ms, **p99
0.40ms**. The mean speedup is 3.4× but the p99 is 7.7×.
**Why it matters**: In a Workers isolate with noisy neighbors and GC
pauses, the p99 (not the mean) is what user-facing latency looks like.
**Don't revert**: The Rust port's `split_at_mut` pattern (two mutable refs
into one Vec) is subtle. Future refactors that switch to `Vec<Rc<Box>>` or
`boxes.clone()` will eat the win. Keep the split_at_mut dance.
