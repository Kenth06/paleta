# Bench results — 2026-04-20 (real Workers isolate)

Numbers from inside a real `workerd` process (wrangler 4.83.0 dev) —
the actual runtime that Cloudflare serves traffic with. Measured by a
`/bench?iters=300&path=dc|full` endpoint in `examples/minimal-worker`
that runs N end-to-end `getPalette()` calls on an inlined 640×480 4:2:0
JPEG (no network, no miniflare overhead between iterations).

## Fixture

- 640 × 480 pixels, 4:2:0 chroma, quality 80.
- 14,077 bytes raw, inlined as base64 into the Worker.

## End-to-end `getPalette()` — inside workerd

| Path            | iters | mean (ms) | p95 (ms) | p99 (ms) | throughput |
| --------------- | ----- | --------- | -------- | -------- | ---------- |
| DC-only         | 300   | **0.73**  | 1        | 2        | **1,370 rps** |
| full-decode     | 300   | 2.54      | 3        | 6        | 394 rps    |

**DC-only is 3.5× faster end-to-end in a real Workers isolate.**

## How it compares to Node

Native Node 22 aarch64 numbers from the earlier `bench/jpeg-decode.bench.ts`
run, same fixture and same code:

| Path        | Node mean | workerd mean | Δ        |
| ----------- | --------- | ------------ | -------- |
| DC-only     | 0.54 ms   | 0.73 ms      | +0.2ms   |
| full-decode | 2.44 ms   | 2.54 ms      | +0.1ms   |

V8-on-Workers is within ~15–30% of native Node on this workload — well
within the expected envelope. Translation from one to the other is
credible without asterisks.

## Caveat on resolution

workerd's `performance.now()` **rounds to 1ms** by default (anti-side-channel
timing guard), which is why `p95` / `p99` show as integer milliseconds. The
`mean` is computed over 300 samples so it's still a reliable signal, but
single-iteration p99 numbers should be treated as upper bounds.

For sub-millisecond precision, future runs should either:
- Use `compatibility_flags: ["high_precision_performance_now"]` (Workers Paid).
- Batch the timing around N iterations inside the worker so individual call
  differences average out.

## Repro

```sh
cd examples/minimal-worker
node scripts/gen-bench-fixture.mjs   # refresh the inlined fixture
pnpm exec wrangler dev --port 8787

# In another terminal:
curl 'http://127.0.0.1:8787/bench?iters=500&path=dc'
curl 'http://127.0.0.1:8787/bench?iters=500&path=full'
```

## Interpretation

- The Rust DC-only decoder's 4–12× advantage over mozjpeg (measured against
  raw `decode()` calls) compresses to ~3.5× when you include the full
  pipeline (resize, histogram, Wu, OKLCH). That's because the non-decode
  portion is a fixed cost regardless of decoder.
- For a typical web Worker serving palette extraction requests, the
  **DC-only path lets one isolate serve ~1,400 rps of actual work**
  versus ~400 rps on the full-decode path. That matters most at burst:
  one Worker can handle 3× the spike without cold-starting more.
