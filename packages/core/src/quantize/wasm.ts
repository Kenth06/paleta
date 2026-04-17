/**
 * WASM-backed quantizer — thin wrapper over the Rust `paleta-core` crate.
 *
 * Usage:
 *   // Cloudflare Workers (preferred: zero-cost instantiation)
 *   import wasmModule from "../wasm/paleta_core_bg.wasm"; // CompiledWasm rule
 *   initWasmSync(wasmModule);
 *
 *   // Node / Bun / browser (async)
 *   await initWasm(await fetch("/paleta_core_bg.wasm").then(r => r.arrayBuffer()));
 *
 *   const result = quantizeWuWasm(rgba, width, height, { colorCount: 10 });
 *
 * On init failure or before init, throws `WasmNotInitializedError`. The
 * pipeline catches this and falls back to the pure-JS Wu quantizer.
 */

import type { RGB } from "../types.js";
import type { WuResult } from "./wu.js";

type WasmModule = typeof import("../../wasm/paleta_core.js");

let mod: WasmModule | undefined;
let initPromise: Promise<void> | undefined;

export class WasmNotInitializedError extends Error {
  constructor() {
    super(
      "paleta WASM is not initialized. Call initWasm() or initWasmSync() before using WASM-backed quantizer.",
    );
    this.name = "WasmNotInitializedError";
  }
}

/** Initialize the WASM from a compiled module (Workers/CompiledWasm rule). */
export function initWasmSync(compiledModule: WebAssembly.Module): void {
  if (mod) return;
  // Load the wasm-bindgen JS wrapper lazily to keep it out of the main bundle.
  // In Workers we are in an async-safe context, but this path uses top-level
  // await or a prior dynamic import to have `mod` already loaded.
  throw new Error(
    "initWasmSync requires the JS wrapper to be pre-imported. " +
      "Use `await initWasm(bytes)` instead, or import `./paleta_core.js` yourself and call `initSync(module)`.",
  );
  // Retained for doc clarity; the recommended Workers path is `await initWasm`.
  void compiledModule;
}

/** Initialize the WASM from raw bytes (Node/Bun/browser). */
export async function initWasm(
  source: ArrayBuffer | Uint8Array | WebAssembly.Module | URL | string,
): Promise<void> {
  if (mod) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const loaded = (await import("../../wasm/paleta_core.js")) as unknown as WasmModule & {
      default: (input: unknown) => Promise<unknown>;
    };
    await loaded.default(source);
    mod = loaded;
  })();
  return initPromise;
}

export function isWasmReady(): boolean {
  return mod !== undefined;
}

export interface WasmQuantizeOptions {
  colorCount?: number;
  step?: number;
  alphaThreshold?: number;
  includeWhite?: boolean;
}

export function quantizeWuWasm(
  rgba: Uint8Array,
  width: number,
  height: number,
  opts: WasmQuantizeOptions = {},
): WuResult {
  if (!mod) throw new WasmNotInitializedError();

  const out = mod.quantize_wu(
    rgba,
    width,
    height,
    opts.colorCount ?? 10,
    opts.step ?? 1,
    opts.alphaThreshold ?? 125,
    opts.includeWhite ?? false,
  );

  const entries = Math.floor(out.length / 7);
  const palette: RGB[] = [];
  const populations: number[] = [];
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < entries; i++) {
    const base = i * 7;
    palette.push([out[base]!, out[base + 1]!, out[base + 2]!]);
    populations.push(view.getUint32(base + 3, true));
  }
  return { palette, populations };
}

export function wasmVersion(): string {
  if (!mod) throw new WasmNotInitializedError();
  return mod.version();
}
