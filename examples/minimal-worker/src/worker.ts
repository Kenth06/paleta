/**
 * Minimal paleta Worker.
 *
 * GET /palette?url=<image-url>
 *   -> JSON { palette, dominant, oklch, meta }
 *
 * Uses caches.default so repeat requests for the same URL cost ~1ms.
 * Smart Placement is enabled in wrangler.jsonc to pull the Worker near the
 * origin image server when that helps (e.g. images served from a single
 * region).
 */

import {
  getPalette,
  initWasm,
  isWasmReady,
  pickAccent,
  PaletteError,
  type RGB,
} from "@ken0106/core";
import { autoDecoders } from "@ken0106/jsquash";
import { paletaDurableCache } from "@ken0106/cache-do";
import { benchFixtureBytes } from "./bench-fixture.js";
import { init as initJpegCodec } from "@jsquash/jpeg/decode";
import { init as initPngCodec } from "@jsquash/png/decode";
import { init as initWebpCodec } from "@jsquash/webp/decode";
import { init as initAvifCodec } from "@jsquash/avif/decode";

// All wrangler CompiledWasm imports. Relative paths because wrangler's
// esbuild only applies the CompiledWasm rule when the literal extension is
// visible in the import string.
// @ts-expect-error — resolved by wrangler
import paletaWasm from "../../../packages/core/wasm/paleta_core_bg.wasm";
// @ts-expect-error — resolved by wrangler
import mozjpegDecWasm from "../node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
// @ts-expect-error — resolved by wrangler
import squooshPngWasm from "../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
// @ts-expect-error — resolved by wrangler
import webpDecWasm from "../node_modules/@jsquash/webp/codec/dec/webp_dec.wasm";
// @ts-expect-error — resolved by wrangler
import avifDecWasm from "../node_modules/@jsquash/avif/codec/dec/avif_dec.wasm";

// Re-export the DO class so wrangler can instantiate it. The class must be
// at the Worker module level or Cloudflare can't wire it up.
export { PaletaCacheDO } from "@ken0106/cache-do";

interface Env {
  ALLOWED_HOSTS?: string;
  /** Durable Object namespace bound in wrangler.jsonc. Optional. */
  PALETA_CACHE?: DurableObjectNamespace;
}

// Cold-start instrumentation for WASM instantiate cost.
//
// Caveats that drove this design:
// - workerd clamps performance.now() resolution to 1ms without the paid
//   `high_precision_performance_now` flag, and doesn't advance it
//   within synchronous code (only across I/O / microtask boundaries).
//   A per-codec breakdown using sync timers comes back as all-zeros,
//   so we only measure the aggregate Promise.all() time.
// - performance.now() at module top-level returns a different origin
//   than inside a fetch handler (top-level gets an absolute-ish
//   timestamp; handler calls get request-relative values). So a
//   "module load to first call" delta would be bogus. We don't try.
// - The measurement here is the *instantiate* cost only — CompiledWasm
//   imports are already parsed by the time our code sees them.
let firstEnsureWasmMs: number | undefined;

// Initialize all WASM modules once per isolate.
let wasmReady: Promise<void> | undefined;
function ensureWasm(): Promise<void> {
  wasmReady ??= (async () => {
    const t0 = performance.now();
    const steps: Array<Promise<unknown>> = [];
    if (!isWasmReady()) steps.push(initWasm(paletaWasm as WebAssembly.Module));
    steps.push(
      initJpegCodec(mozjpegDecWasm as WebAssembly.Module),
      initPngCodec(squooshPngWasm as WebAssembly.Module),
      initWebpCodec(webpDecWasm as WebAssembly.Module),
      initAvifCodec(avifDecWasm as WebAssembly.Module),
    );
    await Promise.all(steps);
    firstEnsureWasmMs ??= +(performance.now() - t0).toFixed(3);
  })().catch((err) => {
    // Reset so the next request retries. We never block on WASM init
    // failure — the pipeline falls back where it can.
    wasmReady = undefined;
    console.warn("WASM init failed:", err);
  });
  return wasmReady;
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      ...(init?.headers ?? {}),
    },
  });
}

function parseHexColor(hex: string): RGB | undefined {
  const m = hex.trim().replace(/^#/, "");
  if (m.length !== 3 && m.length !== 6) return undefined;
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return undefined;
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function allowedHost(host: string, env: Env): boolean {
  if (!env.ALLOWED_HOSTS) return true;
  const list = env.ALLOWED_HOSTS.split(",").map((h) => h.trim()).filter(Boolean);
  if (list.length === 0) return true;
  return list.some((pattern) => {
    if (pattern.startsWith("*.")) return host === pattern.slice(2) || host.endsWith(pattern.slice(1));
    return host === pattern;
  });
}

const BENCH_CACHE_KEY = "paleta-bench-cache-v1";

/**
 * GET /bench?iters=200&path=dc|full|cache
 *
 * Times N end-to-end palette extractions against an inlined 640×480 4:2:0
 * JPEG fixture. Returns mean/p50/p95/p99 so we can compare paths from
 * inside a real workerd isolate (no miniflare-wrangler-dev cold-start
 * noise between iterations).
 *
 *   path=dc     — DC-only JPEG decode (Rust WASM).
 *   path=full   — jSquash mozjpeg full decode + resize.
 *   path=cache  — prime caches.default once, then measure hit cost.
 *                 Uses an explicit cacheKey because the fixture is raw
 *                 bytes with no source URL.
 *
 * workerd rounds performance.now() to 1ms without the paid
 * `high_precision_performance_now` compat flag, so single-iteration p99
 * numbers are integer-ms upper bounds. The mean averages away the
 * rounding over hundreds of samples — for cache-hit measurement push
 * iters higher (e.g. 1000+) to get a reliable sub-ms mean.
 */
async function runBench(params: URLSearchParams): Promise<Response> {
  await ensureWasm();

  const iters = Math.max(1, Math.min(5000, Number.parseInt(params.get("iters") ?? "200", 10)));
  const rawMode = params.get("path") ?? "dc";
  const mode: "dc" | "full" | "cache" =
    rawMode === "full" ? "full" : rawMode === "cache" ? "cache" : "dc";

  const fixture = benchFixtureBytes();
  const runs: number[] = [];

  const baseOpts = {
    decoders: autoDecoders(),
    colorCount: 8,
    useDcOnlyJpeg: mode !== "full",
  } as const;

  if (mode === "cache") {
    // Prime — first call misses and writes to caches.default.
    await getPalette(fixture, {
      ...baseOpts,
      cache: caches.default,
      cacheKey: BENCH_CACHE_KEY,
    });
    // Verify the next call is actually a hit. If it isn't, surface that
    // up front rather than publishing a fake "cache hit" number that was
    // really a full pipeline run.
    const verify = await getPalette(fixture, {
      ...baseOpts,
      cache: caches.default,
      cacheKey: BENCH_CACHE_KEY,
    });
    if (verify.meta.path !== "cache-hit") {
      return json(
        { error: "cache_not_priming", observed_path: verify.meta.path },
        { status: 500 },
      );
    }

    for (let i = 0; i < iters; i++) {
      const t0 = performance.now();
      await getPalette(fixture, {
        ...baseOpts,
        cache: caches.default,
        cacheKey: BENCH_CACHE_KEY,
      });
      runs.push(performance.now() - t0);
    }
  } else {
    // Warm-up — first invocation primes the WASM instance caches.
    await getPalette(fixture, baseOpts);

    for (let i = 0; i < iters; i++) {
      const t0 = performance.now();
      await getPalette(fixture, baseOpts);
      runs.push(performance.now() - t0);
    }
  }

  runs.sort((a, b) => a - b);
  const pct = (p: number) => runs[Math.min(runs.length - 1, Math.floor(runs.length * p))]!;
  const mean = runs.reduce((a, b) => a + b, 0) / runs.length;

  return json({
    fixture: { bytes: fixture.length, dims: "640x480", subsampling: "4:2:0" },
    mode,
    iters,
    timings_ms: {
      mean: +mean.toFixed(3),
      min: +runs[0]!.toFixed(3),
      p50: +pct(0.5).toFixed(3),
      p95: +pct(0.95).toFixed(3),
      p99: +pct(0.99).toFixed(3),
      max: +runs[runs.length - 1]!.toFixed(3),
    },
    hz: +(1000 / mean).toFixed(1),
  });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "paleta", version: "0.1.0-alpha.0" });
    }

    if (url.pathname === "/bench") {
      return runBench(url.searchParams);
    }

    if (url.pathname === "/cold-stats") {
      // Trigger WASM init and return the first-call measurement. Safe to
      // call from a warm isolate too — subsequent calls just observe the
      // cached number without overwriting it.
      await ensureWasm();
      if (firstEnsureWasmMs === undefined) {
        return json({ error: "stats_unavailable" }, { status: 500 });
      }
      return json({
        wasm_instantiate_ms: firstEnsureWasmMs,
        note: "Time for Promise.all() over 5 initX(module) calls on first ensureWasm(). Parse cost isn't measured — CompiledWasm imports are pre-parsed.",
      });
    }

    if (url.pathname !== "/palette") {
      return json({ error: "not_found" }, { status: 404 });
    }

    const target = url.searchParams.get("url");
    if (!target) return json({ error: "missing_param", param: "url" }, { status: 400 });

    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      return json({ error: "invalid_url" }, { status: 400 });
    }
    if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
      return json({ error: "unsupported_protocol" }, { status: 400 });
    }
    if (!allowedHost(targetUrl.hostname, env)) {
      return json({ error: "host_not_allowed", host: targetUrl.hostname }, { status: 403 });
    }

    const colorCount = Number.parseInt(url.searchParams.get("count") ?? "", 10);
    const bg = url.searchParams.get("bg");
    const bgRgb = bg ? parseHexColor(bg) : undefined;

    try {
      await ensureWasm();
      const paletteOpts: Parameters<typeof getPalette>[1] = {
        decoders: autoDecoders(),
        cache: caches.default,
        colorCount: Number.isFinite(colorCount) ? colorCount : 10,
        signal: request.signal,
        // DC-only handles every common JPEG variant (baseline, progressive,
        // grayscale, CMYK, all subsamplings) and is 4–12× faster than
        // mozjpeg full decode, so we always try it first for JPEG input.
        useDcOnlyJpeg: true,
      };
      if (env.PALETA_CACHE) {
        paletteOpts.crossColoCache = paletaDurableCache(env.PALETA_CACHE as never);
      }
      const result = await getPalette(targetUrl.toString(), paletteOpts);

      const body: Record<string, unknown> = { ...result };
      if (bgRgb) {
        body.accent = pickAccent(result.palette, bgRgb);
      }
      return json(body);
    } catch (err) {
      if (err instanceof PaletteError) {
        const status = err.code === "FETCH_FAILED" ? 502 : err.code === "ABORTED" ? 499 : 400;
        return json({ error: err.code, message: err.message }, { status });
      }
      return json({ error: "internal_error", message: (err as Error).message }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
