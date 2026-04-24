# CLAUDE.md — paleta

> This file is your working memory for this project. Read it every session. **Update it every session.** You are the designer and maintainer of paleta — nobody else is watching. The user has delegated full autonomy; behave like a senior engineer who is accountable for the outcome, not a code monkey executing instructions.

---

## Mission

Build **the best open-source color-palette extraction library for the edge**. "Best" means:

1. **Fastest on free Cloudflare Workers** (no paid bindings required).
2. **Correct** — matches reference colorthief output within ΔE2000 < 5, fixes known sniffer bugs.
3. **Smallest default bundle** — <250KB for JPEG-only users, <800KB for full multi-format.
4. **Perceptual** — palettes ordered by OKLab dominance, with WCAG-aware accent selection.
5. **Hackable** — users can BYO decoder, BYO cache, BYO storage. No required bindings.

If a change doesn't move one of those five needles, reject it.

## Non-goals

- Cloudflare Images binding (paid, not open-source-friendly).
- General-purpose image manipulation (resize, filters, etc.). That's `photon-rs`/`jSquash`'s job.
- Browser SVG/Canvas extraction. We read bytes, we return palettes.
- Perfect palettes. "Pretty good, very fast" beats "perfect, slow" for this domain.

---

## Architecture (locked, change requires writing a new ADR below)

```
@ken0106/core      pure-TS kernel + Rust/WASM hot path (sniff, pipeline, Wu JS + WASM, DC-only JPEG)
@ken0106/jsquash   JPEG/PNG/WebP/AVIF adapters — jSquash, lazy WASM, optional peers
@ken0106/exif      EXIF APP1 thumbnail extractor (JPEG fast path)
@ken0106/cache-do  Durable Object cache backend (optional; free-tier SQLite storage)
@ken0106/worker    deployable /palette?url=... Worker
crates/paleta-core Rust source for the shipped WASM (Wu quantizer + DC-only JPEG)
```

Everything is pnpm workspace, TS strict mode, ESM only. Core ships without WASM. Core doesn't know about Cloudflare. The Worker package glues to caches.default and optional bindings.

## Pipeline contract

```
input → sniff → cache-lookup(caches.default, optional DO) →
  ├─ EXIF thumb (JPEG only, if present) →
  ├─ DC-only decode (JPEG only, via Rust WASM) →
  └─ full decode via provided decoder
→ resize ≤128×128 → histogram → Wu quantize →
  OKLab re-rank → accent pick → write cache → return
```

`meta.path` on the result tells callers which branch fired. Never remove this field.

## Invariants

- **The core has zero runtime dependencies.** If you're about to `pnpm add` something to `@ken0106/core`, stop and ask why.
- **All decoders are optional peers.** A JPEG-only consumer must not ship PNG/WebP/AVIF WASM.
- **Static WASM imports are forbidden outside the per-format adapter modules.** Use dynamic `import()` so Wrangler/bundlers can code-split.
- **The public API never throws on input-bytes being the wrong format.** Return a typed error result or throw a `PaletteError` with a known `code`. Never leak a decoder's internal error.
- **Palettes are always returned sorted.** Sort key: OKLab population weight, ties broken by chroma then lightness.
- **Nothing imports from `node:*` in `@ken0106/core`.** If you need Node APIs, you're in the wrong package.
- **No `eval`, no `new Function`.** Workers block both, and MCP-strict environments do too.
- **No `TextEncoder`/`TextDecoder` in decoder hot paths.** Workers supports them, but avoiding them keeps us portable to simpler V8 runtimes.

## Perf targets

Live commitment, not an aspiration — regressions against these are release-blockers. Numbers are **Node 24 / M2 Pro warm means** on the 1280×720 fixtures in `test/fixtures/`. Workers-isolate numbers are within ~15–30 % (see `bench/results/2026-04-20-workers-isolate.md`). Cold means include WASM parse + module evaluation.

| Path                | Measured warm | Ceiling (release-block) | Cache hit |
| ------------------- | ------------- | ----------------------- | --------- |
| EXIF-thumb JPEG     | 0.39 ms       | ≤ 1 ms                  | 1–3 ms    |
| DC-only JPEG 1080p  | 1.06 ms       | ≤ 3 ms                  | 1–3 ms    |
| Full decode 1080p   | 6.61 ms       | ≤ 15 ms                 | 1–3 ms    |

Cold numbers aren't pinned yet — WASM parse cost needs its own bench. Don't invent a target; measure first.

Re-bench every significant change. Commit the full results to `bench/results/YYYY-MM-DD.md` so drift is visible in git. If a measured mean crosses the ceiling column, that's a release-block — file an issue or fix before merging.

---

## Research loop (run at the start of every session, not just when stuck)

1. Read `CLAUDE.md` (this file) and `LEARNINGS.md`.
2. **Reality-check this file against the code before trusting it.** ADRs, the architecture block, the pipeline contract, and "Open questions" drift faster than they get updated. Before relying on a claim like "v0.3" or "scaffold only" or "not yet implemented", verify with `ls packages/*/src/`, a quick `grep` of the public exports in `packages/*/src/index.ts`, or `git log -- <path>`. If the code disagrees with this file, **the code is right** — fix this file in the same commit as your other work (or as its own `docs(claude): sync …` commit if the drift is large). Same applies to `LEARNINGS.md` entries that name specific APIs or versions. Stale docs are a bug; treat them like one.
3. Check the Cloudflare Workers changelog for anything published since `LEARNINGS.md`'s last `last-checked` date. Focus on: WASM, SIMD, Durable Objects, RPC, Containers, Smart Placement, caches.
4. Check jSquash, `quantette`, `libimagequant`, `photon-rs` release notes.
5. If something new could change an architectural decision — write an ADR below before coding.
6. Update `LEARNINGS.md` with `last-checked` and a one-line summary of anything notable.

Be aggressive about adopting new Cloudflare primitives when they genuinely help. Be skeptical of them when they're beta/paid/lock-in.

## Optimization loop (run after every feature)

1. Bench the feature (`pnpm bench`).
2. Compare against the target in the table above. If off-target, profile.
3. Common suspects, in priority order:
   - Allocations in the histogram loop (use `Uint32Array`, not `number[]`)
   - WASM boundary crossings (batch, don't loop)
   - Re-parsing WASM modules (memoize init per isolate)
   - Unnecessary full decode (try EXIF → DC → full in that order)
   - Full-resolution quantize (resize first, always)
4. Record results in `bench/results/YYYY-MM-DD.md`.
5. Update `LEARNINGS.md` with anything surprising.

---

## Self-correction protocol

When you make a mistake (failed test, wrong API, regression, wrong assumption), **record it in `LEARNINGS.md` under "Mistakes"** with:

- Date
- What you did wrong
- Why you did it (the incorrect mental model)
- How you'd avoid it next time (concrete rule)

Do this **immediately** after the fix, not "later". Future-you reads this file and learns from past-you — that's the entire point.

Don't pad the list with trivial typos. Record mistakes that reveal a flawed belief or a gap in the codebase that tempted the mistake.

**When you ship a feature, update this file in the same PR/commit stream.** If you add a public export, land a new pipeline branch, resolve an open question, or change the architecture — amend the ADR, the architecture block, the pipeline contract, or "Open questions" right then. Don't leave "will update later" TODOs. The `docs(claude): …` or `docs(learnings): …` commit lives next to the feature commit, not three sessions later.

---

## Commit etiquette — atomic commits, always

- **Conventional commits**: `feat(core): …`, `fix(jsquash): …`, `perf(worker): …`, `docs: …`, `bench: …`, `chore: …`, `refactor(core): …`, `test: …`.
- **One logical change per commit.** If the diff touches two unrelated concerns, split it. "One concern" = one reviewer could reject or accept it without caring about the rest.
- Each commit must pass `pnpm typecheck` and `pnpm test` on its own. No "WIP" commits on `main`.
- Commit title ≤72 chars, imperative mood. Body explains *why*, not *what*.
- If a commit changes perf, include bench numbers in the body.
- Never commit `dist/`, `node_modules/`, `.wrangler/`, `target/`, `pkg/`, or `.DS_Store`.
- Keep secrets out — no tokens, no internal URLs.
- Commit packages independently when possible: scaffold → types → impl → tests → docs as separate commits.

## Working-with-the-user notes

- The user (Kenneth Rios) is an AI Engineer from Panama. He understands the stack; skip the 101.
- He asked for autonomy: "you have to plan before actually start building." Plan before multi-step work. For single-file edits, just do it.
- He values speed of shipping over theoretical perfection. Ship a v0.1 that works, iterate.
- He prefers Spanish and English interchangeably — respond in whichever he used last.

## Published state (as of 2026-04-20)

All four packages are live on npm under the `@ken0106` scope. dist-tags
`latest` and `alpha` both point to `0.1.0-alpha.0`.

```
@ken0106/core       0.1.0-alpha.0   (85 KB)
@ken0106/jsquash    0.1.0-alpha.0   (4.7 KB)
@ken0106/exif       0.1.0-alpha.0   (5.3 KB)
@ken0106/cache-do   0.1.0-alpha.0   (5.6 KB)
```

The scope is `@ken0106` not `@paleta` because npm returned 404 when
publishing to `@paleta` — the original scope is squatted/unavailable.
If the user later registers the `@paleta` npm org, the rename is a
mechanical find-replace (see commit `7e9a395` which did it one way).

### Publishing workflow

Use `scripts/publish.sh`. Bump version in each `packages/*/package.json`
first. npm 2FA is on, so expect 4 OTP prompts per run.

### Known npm/CDN quirk

Fresh publishes can return 404 on `npm view` and `npm install` for up
to ~15 minutes despite the tarball being live. The workaround:
`npm cache clean --force && npm install --prefer-online <pkg>@alpha`.
This is Cloudflare edge caching in front of npm's registry, not a
real outage. Noted here so future-you doesn't panic.

---

## ADRs (Architecture Decision Records)

Append below. Each one dated. Each one has: Context, Decision, Consequences, Alternatives-rejected.

### ADR-001 — Monorepo with separate decoder packages (2026-04-17)

**Context**: cf-colorthief statically imports all four jSquash codecs (~1.3MB WASM) even when the caller only processes JPEGs.

**Decision**: Split into `@ken0106/core` (kernel, no WASM) + `@ken0106/jsquash` (with optional peer deps). Callers opt into formats they need.

**Consequences**: JPEG-only Worker ships ~200KB instead of 1.3MB. Users must wire decoders explicitly. README needs a quickstart that makes this non-annoying.

**Rejected**: Single package with feature flags (too much bundler configuration burden on users).

### ADR-002 — Wu is the only shipped quantizer (2026-04-17, updated 2026-04-24)

**Context**: MMCQ is O(pixels). Wu is O(histogram buckets = 32³ = 32,768) regardless of image size.

**Decision**: Ship only Wu. The `QuantizeAlgorithm` type is narrowed to `"wu"` — not `"wu" | "mmcq"` — because the MMCQ branch was never implemented and the wider type silently ran Wu on callers who passed `'mmcq'`. A type that lies is worse than no knob. If someone later needs bit-for-bit colorthief parity, widen the type *and* wire up a real MMCQ implementation in the same change; don't split them.

**Consequences**: 10× faster on large images vs pixel-space quantizers. Slightly different palette output vs colorthief; parity tests allow ΔE2000 < 5. Callers previously passing `algorithm: 'mmcq'` were silently getting Wu results — their TS now breaks, forcing them to acknowledge the reality.

**Rejected**: Keep the wider type "as a placeholder" (lying types produce the very kind of session-start drift we're trying to prevent). Median cut (reference original, slower), k-means only (stochastic, not deterministic across runs).

### ADR-003 — TS + Rust/WASM dual implementation (2026-04-17, updated 2026-04-24)

**Context**: Rust+WASM+SIMD gives 10–15× over JS. Rust toolchain adds setup friction; the TS Wu is already fast enough for most images.

**Decision**: Ship both. `@ken0106/core` exports `quantizeWu` (pure JS) and `quantizeWuWasm` (Rust/WASM via `initWasm(bytes)`). `decodeJpegDcOnly` also ships from the Rust crate. Callers opt into WASM by initializing; without it, the JS path is the default.

**Consequences**: Users get the fast path when they want it and a zero-dependency fallback when they don't. `paleta-core_bg.wasm` is committed in `packages/core/wasm/` (see `scripts/build-wasm.sh`). Rust builds use `panic=abort` for size today; a `panic=unwind` build (workers-rs 0.8+, nightly + `-Zbuild-std`) is an opt-in reliability mode — would let callers catch `PanicError` and fall back to the JS path instead of poisoning the isolate. Bench the size/latency delta before flipping the default.

**Rejected**: Rust-only (shipping a JS fallback keeps `@ken0106/core` usable in strictly-no-WASM environments and gives a safety net if the WASM panics).

---

## Open questions / TODO

- Decide: should `getPalette` accept `ReadableStream` directly, or always buffer? Streaming decode has no jSquash support today.
- Write the fixture generation script (50 test images with known expected palettes). Today `test/fixtures/` has 11 JPEGs (one of which carries an EXIF APP1 thumbnail for bench purposes; see `scripts/gen-exif-fixture.mjs`).
- Measure in-the-wild EXIF-thumb hit rate on a representative URL sample (Unsplash, Pexels, direct CDN, camera dumps) before promoting the fast path to the pipeline default over DC-only.
- Bench the cache-hit path inside workerd — `caches.default` isn't accessible from Node, so this lives in `examples/minimal-worker`.

## Resolved (keep for history; do not reopen without ADR)

- npm scope → `@ken0106` (the original `@paleta` is squatted; see "Published state" above).
- `PaletteError` → shipped as an exported class from `@ken0106/core` (`packages/core/src/types.ts`).
- `QuantizeAlgorithm` → narrowed to `"wu"` in 2026-04-24; see ADR-002. Widen only alongside a real implementation.
