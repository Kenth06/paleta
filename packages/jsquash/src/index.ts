/**
 * @paleta/jsquash — decoder adapters.
 *
 * Each format is exposed as a named adapter and lazy-loads its jSquash module
 * on first call. The `autoDecoders()` helper returns a DecoderMap suitable for
 * passing straight into `getPalette({ decoders: ... })`.
 */

import type { DecoderMap } from "@paleta/core";
import { decodeAVIF } from "./avif.js";
import { decodeJPEG } from "./jpeg.js";
import { decodePNG } from "./png.js";
import { decodeWebP } from "./webp.js";

export { decodeJPEG } from "./jpeg.js";
export { decodePNG } from "./png.js";
export { decodeWebP } from "./webp.js";
export { decodeAVIF } from "./avif.js";

/**
 * Map of all four jSquash decoders. Decoders are still lazy — the WASM for a
 * format is only fetched when that format actually arrives. So including all
 * four here doesn't bloat the bundle thanks to dynamic `import()` splitting.
 */
export function autoDecoders(): DecoderMap {
  return {
    jpeg: decodeJPEG,
    png: decodePNG,
    webp: decodeWebP,
    avif: decodeAVIF,
  };
}
