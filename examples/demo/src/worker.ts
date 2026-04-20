/**
 * paleta demo Worker.
 *
 * Serves the Vite-built SPA via the [assets] binding and exposes a single
 * /api/palette endpoint that drives the UI. The endpoint mirrors
 * examples/minimal-worker but enriches the response with per-swatch OKLCH
 * strings and pre-computed accents for #000 / #fff so the UI doesn't have
 * to round-trip for common background choices.
 */

import {
  getPalette,
  initWasm,
  isWasmReady,
  pickAccent,
  PaletteError,
  rgbToOKLCH,
  type PaletteResult,
  type RGB,
} from "@ken0106/core";
import { autoDecoders } from "@ken0106/jsquash";
// Re-export of the Durable Object class. Uncomment the two lines below and
// the matching blocks in wrangler.jsonc to enable cross-colo caching.
// export { PaletaCacheDO } from "@ken0106/cache-do";
import { init as initJpegCodec } from "@jsquash/jpeg/decode";
import { init as initPngCodec } from "@jsquash/png/decode";
import { init as initWebpCodec } from "@jsquash/webp/decode";
import { init as initAvifCodec } from "@jsquash/avif/decode";

// @ts-expect-error — resolved by wrangler's CompiledWasm rule
import paletaWasm from "../../../packages/core/wasm/paleta_core_bg.wasm";
// @ts-expect-error — resolved by wrangler
import mozjpegDecWasm from "../node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
// @ts-expect-error — resolved by wrangler
import squooshPngWasm from "../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
// @ts-expect-error — resolved by wrangler
import webpDecWasm from "../node_modules/@jsquash/webp/codec/dec/webp_dec.wasm";
// @ts-expect-error — resolved by wrangler
import avifDecWasm from "../node_modules/@jsquash/avif/codec/dec/avif_dec.wasm";

interface Env {
  ASSETS: Fetcher;
  ALLOWED_HOSTS?: string;
  PALETA_CACHE?: DurableObjectNamespace;
}

let wasmReady: Promise<void> | undefined;
function ensureWasm(): Promise<void> {
  wasmReady ??= (async () => {
    const steps: Array<Promise<unknown>> = [];
    if (!isWasmReady()) steps.push(initWasm(paletaWasm as WebAssembly.Module));
    steps.push(
      initJpegCodec(mozjpegDecWasm as WebAssembly.Module),
      initPngCodec(squooshPngWasm as WebAssembly.Module),
      initWebpCodec(webpDecWasm as WebAssembly.Module),
      initAvifCodec(avifDecWasm as WebAssembly.Module),
    );
    await Promise.all(steps);
  })().catch((err) => {
    wasmReady = undefined;
    console.warn("WASM init failed:", err);
  });
  return wasmReady;
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      ...(init?.headers ?? {}),
    },
  });
}

function parseHex(hex: string): RGB | undefined {
  const m = hex.trim().replace(/^#/, "");
  if (m.length !== 3 && m.length !== 6) return undefined;
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return undefined;
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function hostAllowed(host: string, env: Env): boolean {
  if (!env.ALLOWED_HOSTS) return true;
  const list = env.ALLOWED_HOSTS.split(",").map((h) => h.trim()).filter(Boolean);
  if (list.length === 0) return true;
  return list.some((pattern) => {
    if (pattern.startsWith("*."))
      return host === pattern.slice(2) || host.endsWith(pattern.slice(1));
    return host === pattern;
  });
}

function toHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

function toOklchString([r, g, b]: RGB): string {
  const [L, C, H] = rgbToOKLCH(r, g, b);
  return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)})`;
}

type Swatch = {
  rgb: RGB;
  hex: string;
  oklch: string;
};

type AccentPick = {
  rgb: RGB;
  hex: string;
  contrast: number;
  wcag: "AAA" | "AA" | "AA-large" | "fail";
};

function wcagTier(contrast: number): AccentPick["wcag"] {
  if (contrast >= 7) return "AAA";
  if (contrast >= 4.5) return "AA";
  if (contrast >= 3) return "AA-large";
  return "fail";
}

function enrichedAccent(palette: readonly RGB[], bg: RGB): AccentPick {
  const result = pickAccent(palette, bg);
  return {
    rgb: result.color,
    hex: toHex(result.color),
    contrast: +result.contrast.toFixed(2),
    wcag: wcagTier(result.contrast),
  };
}

function enrich(result: PaletteResult, requestedBg?: RGB) {
  const palette: Swatch[] = result.palette.map((rgb) => ({
    rgb,
    hex: toHex(rgb),
    oklch: toOklchString(rgb),
  }));
  const dominant: Swatch = {
    rgb: result.dominant,
    hex: toHex(result.dominant),
    oklch: toOklchString(result.dominant),
  };
  const accents = {
    onBlack: enrichedAccent(result.palette, [0, 0, 0]),
    onWhite: enrichedAccent(result.palette, [255, 255, 255]),
    ...(requestedBg
      ? { onCustom: { background: toHex(requestedBg), ...enrichedAccent(result.palette, requestedBg) } }
      : {}),
  };
  return {
    palette,
    dominant,
    accents,
    meta: result.meta,
  };
}

async function handlePalette(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
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
  if (!hostAllowed(targetUrl.hostname, env)) {
    return json({ error: "host_not_allowed", host: targetUrl.hostname }, { status: 403 });
  }

  const colorCount = Number.parseInt(url.searchParams.get("count") ?? "", 10);
  const bgRaw = url.searchParams.get("bg");
  const bg = bgRaw ? parseHex(bgRaw) : undefined;

  try {
    await ensureWasm();
    const result = await getPalette(targetUrl.toString(), {
      decoders: autoDecoders(),
      cache: caches.default,
      colorCount: Number.isFinite(colorCount) ? Math.min(12, Math.max(3, colorCount)) : 8,
      signal: request.signal,
      // DC-only is the paleta killer feature: 4–12× faster than mozjpeg on JPEGs.
      useDcOnlyJpeg: true,
    });
    return json(enrich(result, bg));
  } catch (err) {
    if (err instanceof PaletteError) {
      const status =
        err.code === "FETCH_FAILED" ? 502 : err.code === "ABORTED" ? 499 : 400;
      return json({ error: err.code, message: err.message }, { status });
    }
    return json(
      { error: "internal_error", message: (err as Error).message },
      { status: 500 },
    );
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "paleta-demo" });
    }
    if (url.pathname === "/api/palette") {
      return handlePalette(request, env);
    }
    // Worker only runs for /api/* (see wrangler.jsonc run_worker_first).
    // Anything else that reaches here is a stray — fall through to assets.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
