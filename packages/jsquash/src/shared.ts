/**
 * Shared helpers for jSquash adapters.
 *
 * jSquash returns `ImageData` (with `data: Uint8ClampedArray`). We narrow to
 * `Uint8Array` because the core pipeline wants plain bytes. `Uint8ClampedArray`
 * is compatible at the byte level — no copy is needed.
 */

import type { DecodedImage } from "@paleta/core";

export interface JSquashImageData {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export function toDecoded(img: JSquashImageData): DecodedImage {
  const u8 = img.data instanceof Uint8Array
    ? img.data
    : new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return { data: u8, width: img.width, height: img.height };
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // jSquash decoders accept ArrayBuffer. Slice on the underlying buffer so
  // we pass the exact byte window regardless of the Uint8Array's offset.
  const out = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
  return out as ArrayBuffer;
}
