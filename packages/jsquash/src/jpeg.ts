/**
 * Lazy JPEG decoder. Dynamic import of `@jsquash/jpeg` so bundlers code-split
 * the WASM into its own chunk and JPEG-only Workers don't pay for the others.
 */

import type { DecodeFn } from "@paleta/core";
import { toArrayBuffer, toDecoded } from "./shared.js";

let decoderPromise: Promise<DecodeFn> | undefined;

async function load(): Promise<DecodeFn> {
  const mod = await import("@jsquash/jpeg");
  return async (bytes) => {
    const img = await mod.decode(toArrayBuffer(bytes));
    if (!img) throw new Error("jSquash JPEG decoder returned null");
    return toDecoded(img);
  };
}

export const decodeJPEG: DecodeFn = async (bytes, options) => {
  decoderPromise ??= load();
  const decoder = await decoderPromise;
  return decoder(bytes, options);
};
