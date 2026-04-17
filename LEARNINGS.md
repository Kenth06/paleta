# LEARNINGS.md — paleta

Persistent notebook across Claude sessions. Append-only. Read before starting work.

---

## last-checked

- Cloudflare Workers changelog: **2026-04-17**
- jSquash releases: **2026-04-17**
- quantette crate: **2026-04-17**
- photon-rs crate: **2026-04-17**

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
