import type { DecodeFn } from "@paleta/core";
import { toArrayBuffer, toDecoded } from "./shared.js";

let decoderPromise: Promise<DecodeFn> | undefined;

async function load(): Promise<DecodeFn> {
  const mod = await import("@jsquash/png");
  return async (bytes) => {
    const img = await mod.decode(toArrayBuffer(bytes));
    if (!img) throw new Error("jSquash PNG decoder returned null");
    return toDecoded(img);
  };
}

export const decodePNG: DecodeFn = async (bytes, options) => {
  decoderPromise ??= load();
  const decoder = await decoderPromise;
  return decoder(bytes, options);
};
