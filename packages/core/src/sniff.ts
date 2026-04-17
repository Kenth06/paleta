/**
 * Correct magic-byte image-format sniffing.
 *
 * Fixes two bugs present in upstream `cf-colorthief`:
 *   - AVIF: was matched from offset 0, but ISO-BMFF `ftyp` box starts at offset 4.
 *   - WebP: required RIFF at 0..3 AND WEBP at 8..11 (not `RIWE`).
 *
 * Order matters: PNG/JPEG magic bytes are short and unambiguous, so we test them
 * first. RIFF and ISO-BMFF are longer prefixes.
 */

import type { ImageFormat } from "./types.js";

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

/** ISO-BMFF ftyp brands we treat as AVIF (incl. sequences + HEIF variants we can sometimes decode as AVIF). */
const AVIF_BRANDS = new Set([
  "avif", // primary image
  "avis", // image sequence
  "heic", // heic — many decoders treat av1-based heic as avif
  "heix",
  "mif1",
  "msf1",
]);

function matchAt(bytes: Uint8Array, offset: number, pattern: readonly number[]): boolean {
  if (bytes.length < offset + pattern.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (bytes[offset + i] !== pattern[i]) return false;
  }
  return true;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  const end = Math.min(offset + length, bytes.length);
  let out = "";
  for (let i = offset; i < end; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

/**
 * Detect an image format from raw bytes. Returns `undefined` if unrecognized.
 * Requires at least 12 bytes to confidently identify WebP and AVIF.
 */
export function sniffFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (matchAt(bytes, 0, JPEG)) return "jpeg";
  if (matchAt(bytes, 0, PNG)) return "png";

  // WebP: "RIFF" at 0..3, "WEBP" at 8..11. Bytes 4..7 are the chunk size.
  if (matchAt(bytes, 0, RIFF) && matchAt(bytes, 8, WEBP)) return "webp";

  // ISO-BMFF: first 4 bytes are box size (big-endian u32), bytes 4..7 == "ftyp",
  // bytes 8..11 are the major brand. Compatible brands follow starting at byte 16.
  if (readAscii(bytes, 4, 4) === "ftyp") {
    const major = readAscii(bytes, 8, 4);
    if (AVIF_BRANDS.has(major)) return "avif";

    // Walk compatible brands (each 4 bytes), bounded by box size.
    const boxSize =
      bytes.length >= 4
        ? ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0
        : 0;
    const end = Math.min(boxSize > 0 ? boxSize : bytes.length, bytes.length);
    for (let off = 16; off + 4 <= end; off += 4) {
      const brand = readAscii(bytes, off, 4);
      if (AVIF_BRANDS.has(brand)) return "avif";
      if (brand === "" || brand === "\x00\x00\x00\x00") break;
    }
  }

  return undefined;
}

/**
 * Prefer Content-Type when present and trustworthy, otherwise fall back to
 * magic-byte sniffing. Unknown content types fall back to the bytes.
 */
export function sniffFormatFromResponse(
  response: Response,
  headBytes: Uint8Array,
): ImageFormat | undefined {
  const ct = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (ct.includes("image/jpeg") || ct.includes("image/jpg")) return "jpeg";
  if (ct.includes("image/png")) return "png";
  if (ct.includes("image/webp")) return "webp";
  if (ct.includes("image/avif") || ct.includes("image/heic") || ct.includes("image/heif"))
    return "avif";
  return sniffFormat(headBytes);
}
