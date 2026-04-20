/**
 * PaletaService — a Worker exposing paleta's pipeline as a Service Binding.
 *
 * Callers bind this Worker in their wrangler.jsonc and invoke methods via
 * `env.PALETA.getPalette(url)`. Service Bindings run in-process on the same
 * thread, so there's zero TCP/HTTP overhead and zero billed requests between
 * caller and service (caller's CPU time is billed; service RPC is free
 * within-account).
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import {
  getPalette,
  initWasm,
  isWasmReady,
  pickAccent,
  type PaletteOptions,
  type PaletteResult,
  type RGB,
} from "@ken0106/core";
import { autoDecoders } from "@ken0106/jsquash";
import { paletaDurableCache } from "@ken0106/cache-do";
// @ts-expect-error — resolved by wrangler's CompiledWasm rule
import paletaWasm from "@ken0106/core/wasm";

export { PaletaCacheDO } from "@ken0106/cache-do";

interface Env {
  PALETA_CACHE?: DurableObjectNamespace;
}

let wasmReady: Promise<void> | undefined;
function ensureWasm(): Promise<void> {
  if (isWasmReady()) return Promise.resolve();
  wasmReady ??= initWasm(paletaWasm as WebAssembly.Module).catch((err) => {
    wasmReady = undefined;
    console.warn("PaletaService WASM init failed, falling back to JS:", err);
  });
  return wasmReady;
}

/**
 * Callers see exactly these methods. Kept tight — RPC surfaces are a
 * contract; adding methods later is cheap, removing them is not.
 */
export default class PaletaService extends WorkerEntrypoint<Env> {
  async healthz(): Promise<{ ok: true; wasm: boolean }> {
    return { ok: true, wasm: isWasmReady() };
  }

  /** Extract a palette for a given image URL. */
  async palette(url: string, opts: Omit<PaletteOptions, "decoders" | "cache" | "crossColoCache"> = {}): Promise<PaletteResult> {
    await ensureWasm();
    const full: PaletteOptions = {
      ...opts,
      decoders: autoDecoders(),
      cache: caches.default,
    };
    if (this.env.PALETA_CACHE) {
      full.crossColoCache = paletaDurableCache(this.env.PALETA_CACHE as never);
    }
    return getPalette(url, full);
  }

  /** Convenience: just the dominant color. */
  async dominant(url: string): Promise<RGB> {
    const result = await this.palette(url, { colorCount: 5 });
    return result.dominant;
  }

  /**
   * Palette + accent color chosen for contrast against `background`.
   * `background` accepts `#rrggbb` or `[r, g, b]`.
   */
  async accent(
    url: string,
    background: string | RGB,
    minContrast = 4.5,
  ): Promise<{ palette: RGB[]; dominant: RGB; accent: RGB; contrast: number }> {
    const result = await this.palette(url);
    const bg = typeof background === "string" ? hex(background) : background;
    const pick = pickAccent(result.palette, bg, { minContrast });
    return {
      palette: result.palette,
      dominant: result.dominant,
      accent: pick.color,
      contrast: pick.contrast,
    };
  }
}

function hex(str: string): RGB {
  const m = str.trim().replace(/^#/, "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
