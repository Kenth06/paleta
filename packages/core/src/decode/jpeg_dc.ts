/**
 * Experimental JPEG DC-only decoder — wraps the Rust implementation.
 *
 * **Status: experimental.** Not yet wired into the main pipeline. Exposed so
 * callers can opt in, measure, and report bugs against real-world JPEGs
 * before we take the training wheels off.
 *
 * Contract: returns a `DecodedImage` at 1/8 the JPEG's dimensions on success,
 * or `undefined` when the Rust decoder couldn't handle the input (progressive
 * JPEG, unusual chroma subsampling, malformed bytes). Callers — typically
 * the pipeline — must fall back to their usual decoder on `undefined`.
 *
 * Requires `initWasm` to have been called.
 */

import type { DecodedImage } from "../types.js";
import { isWasmReady, WasmNotInitializedError } from "../quantize/wasm.js";

type WasmModule = typeof import("../../wasm/paleta_core.js");

let mod: WasmModule | undefined;

async function loadedModule(): Promise<WasmModule> {
  if (mod) return mod;
  mod = (await import("../../wasm/paleta_core.js")) as unknown as WasmModule;
  return mod;
}

/**
 * Try to decode only the DC coefficients of a JPEG, yielding a 1/8×1/8
 * RGBA image. Returns `undefined` if the decoder bails (caller should
 * fall back to full decode).
 */
export async function decodeJpegDcOnly(
  bytes: Uint8Array,
): Promise<DecodedImage | undefined> {
  if (!isWasmReady()) throw new WasmNotInitializedError();
  const m = await loadedModule();

  const out = m.dc_only_decode_jpeg(bytes);
  if (out.length < 8) return undefined;

  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  if (width === 0 || height === 0) return undefined;
  if (out.length < 8 + width * height * 4) return undefined;

  return {
    data: out.slice(8),
    width,
    height,
  };
}
