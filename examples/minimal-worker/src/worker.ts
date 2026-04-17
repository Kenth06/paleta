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
} from "@paleta/core";
import { autoDecoders } from "@paleta/jsquash";

// The wrangler CompiledWasm rule turns this into a WebAssembly.Module at
// build time, giving us a cold-start-friendly zero-parse instantiation.
// @ts-expect-error — resolved by wrangler, not TS.
import paletaWasm from "@paleta/core/wasm";

interface Env {
  ALLOWED_HOSTS?: string;
}

// Initialize WASM once per isolate. The first request pays the init cost
// (~5ms for 27KB of WASM); subsequent requests reuse the instantiated module.
let wasmReady: Promise<void> | undefined;
function ensureWasm(): Promise<void> {
  if (isWasmReady()) return Promise.resolve();
  wasmReady ??= initWasm(paletaWasm as WebAssembly.Module).catch((err) => {
    // Clear the promise so we can retry on the next request, but never block
    // the request — fall back to pure-JS quantizer.
    wasmReady = undefined;
    console.warn("paleta WASM init failed, falling back to JS:", err);
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

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "paleta", version: "0.1.0-alpha.0" });
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
      const result = await getPalette(targetUrl.toString(), {
        decoders: autoDecoders(),
        cache: caches.default,
        colorCount: Number.isFinite(colorCount) ? colorCount : 10,
        signal: request.signal,
      });

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
