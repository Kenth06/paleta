# Bench results — 2026-04-24 cold-start WASM instantiate (workerd)

Completes the last unmeasured row in the perf-targets table: the cost
our code pays on the first request into a fresh workerd isolate to
instantiate the 5 WASM modules (paleta_core, mozjpeg, png, webp, avif).

Run via `scripts/bench-cold-start.sh`, which restarts `wrangler dev
--local` once per sample, waits for "Ready on", fires a single
`/cold-stats` request, kills wrangler, and repeats. The harness
deliberately ignores wall-clock (wrangler+miniflare process restart
adds ~1–2 s of dev-only overhead that production cold-starts don't
pay) and only collects the in-worker `wasm_instantiate_ms` number,
which is a property of our code (module sizes, number of imports) and
should port to production within a modest factor.

## What's actually being measured

`firstEnsureWasmMs` on the first `ensureWasm()` call inside a fresh
isolate. That's:

```ts
const t0 = performance.now();
await Promise.all([
  initWasm(paletaWasm),
  initJpegCodec(mozjpegDecWasm),
  initPngCodec(squooshPngWasm),
  initWebpCodec(webpDecWasm),
  initAvifCodec(avifDecWasm),
]);
const elapsed = performance.now() - t0;
```

Only **instantiate** — not parse. Wrangler's `CompiledWasm` rule
parses each module at isolate startup, before our JS runs, so the
parse cost is amortized into the runtime's own cold-start and our
measurement can't see it.

Per-codec breakdown was tried and dropped: workerd's 1 ms-resolution
`performance.now()` doesn't advance within synchronous code, so
individual `init*Codec(module)` times came back as zeros. The
aggregate `Promise.all()` time is meaningful because the microtask
boundaries inside `Promise.all` let the clock tick between resolutions.

## Results (10 samples, M2 Pro, wrangler 4.83.0)

| Stat | ms     |
| ---- | ------ |
| min  | 4      |
| p50  | **4**  |
| mean | 7.1    |
| p95  | 32     |
| max  | 32     |

Distribution was tight around 4–5 ms with one 32 ms outlier that
dragged the mean. p50 is the honest representative figure here.

## Implications for end-user latency

A cold request on the DC-only path pays approximately:

```
~4 ms   (cold WASM instantiate, this measurement)
  +
~1 ms   (warm DC-only pipeline, see 2026-04-20-workers-isolate.md)
  =
~5 ms   total first-request latency
```

Every subsequent request in the same isolate is purely the warm
number (0.68 ms DC-only, 0.16 ms cache-hit). Cloudflare's isolate
lifetime is measured in tens of seconds up to minutes per box under
any real traffic, so the cold-hit rate in practice should be small.

## Caveat: timer resolution

Same 1 ms rounding as other workerd benches. The 4 ms floor is
probably "1–5 ms, actually" — we can't measure tighter without the
paid `high_precision_performance_now` compat flag. The ceiling for
regression detection should accept that floor as a lower bound.

## What would make this faster

Not a priority given 4 ms is already fast, but for reference:

1. **Lazy per-codec init.** Today `ensureWasm()` instantiates all 5
   modules on first request. If only JPEG is requested, 4 of those
   are wasted. Changing to format-gated init would drop the cold
   path to whatever the specific format's module costs (mozjpeg is
   the big one; paleta_core is tiny).
2. **Streaming instantiate.** `WebAssembly.instantiateStreaming` is
   no faster than `instantiate(module)` when we already have a
   `WebAssembly.Module` via CompiledWasm imports — skip.
3. **Smaller AVIF decoder.** avif-dec.wasm is the largest of the
   four. If we can accept a smaller AVIF subset or drop AVIF by
   default, the cold path shrinks materially.

None of these are release-blockers. 4 ms is already well under any
sensible cold-start ceiling for an edge Worker.

## Repro

```sh
# jq + curl required; install via brew if missing.
scripts/bench-cold-start.sh 10
# or tweak samples / port:
PORT=8799 scripts/bench-cold-start.sh 20
```

Each sample takes ~3 s (wrangler restart is the dominant cost).
10 samples ≈ 30 s total.
