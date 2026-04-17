/**
 * EXIF APP1 thumbnail extractor.
 *
 * JPEG files commonly ship an embedded JPEG thumbnail inside the EXIF APP1
 * segment. Parsing it lets us palette-sample a 100×100-ish image in ~5ms
 * regardless of the main image size.
 *
 * Parser walks:
 *   1. JPEG SOI (0xFFD8), then segment markers until APP1 (0xFFE1).
 *   2. Inside APP1, match "Exif\0\0" identifier.
 *   3. Read TIFF header: byte-order ("II" | "MM") + magic 0x002A + IFD0 offset.
 *   4. Walk IFD0 entries, read offset-to-IFD1 from the last 4 bytes.
 *   5. Walk IFD1, pick out JPEGInterchangeFormat (0x0201) + ...Length (0x0202).
 *   6. Slice the embedded JPEG bytes and return them.
 *
 * Spec references:
 *   - Exif 2.3 §4.5 (APP1 structure)
 *   - TIFF 6.0 §2 (byte order, IFD format)
 *   - ISO/IEC 10918-1 (JPEG segments)
 */

const SOI = 0xffd8;
const EOI = 0xffd9;
const APP1 = 0xffe1;
const SOS = 0xffda;

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

const TAG_JPEG_IF_OFFSET = 0x0201;
const TAG_JPEG_IF_LENGTH = 0x0202;

export interface ExifThumbnail {
  /** The raw embedded JPEG bytes (no EXIF header, no TIFF). */
  bytes: Uint8Array;
  /** Byte offset into the parent JPEG where the thumbnail starts. */
  offset: number;
}

class Reader {
  readonly view: DataView;
  readonly littleEndian: boolean;
  constructor(view: DataView, littleEndian: boolean) {
    this.view = view;
    this.littleEndian = littleEndian;
  }
  u16(offset: number): number {
    return this.view.getUint16(offset, this.littleEndian);
  }
  u32(offset: number): number {
    return this.view.getUint32(offset, this.littleEndian);
  }
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]!);
  return out;
}

function bytesEqualAt(bytes: Uint8Array, offset: number, pattern: readonly number[]): boolean {
  if (bytes.length < offset + pattern.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (bytes[offset + i] !== pattern[i]) return false;
  }
  return true;
}

/**
 * Extract an embedded JPEG thumbnail from the EXIF APP1 segment of a JPEG.
 * Returns `undefined` when no thumbnail is present or the file isn't JPEG.
 */
export function extractExifThumbnail(bytes: Uint8Array): ExifThumbnail | undefined {
  if (bytes.length < 4) return undefined;
  // Big-endian SOI
  if ((bytes[0]! << 8 | bytes[1]!) !== SOI) return undefined;

  let p = 2;
  while (p < bytes.length - 1) {
    if (bytes[p] !== 0xff) return undefined;
    const marker = (bytes[p]! << 8) | bytes[p + 1]!;
    if (marker === EOI || marker === SOS) return undefined;

    // Standalone markers (no length): 0xFFD0..0xFFD7, 0xFF01
    if ((marker >= 0xffd0 && marker <= 0xffd7) || marker === 0xff01) {
      p += 2;
      continue;
    }

    if (p + 4 > bytes.length) return undefined;
    const segLen = (bytes[p + 2]! << 8) | bytes[p + 3]!;
    const segStart = p + 2;
    const segEnd = segStart + segLen;
    if (segEnd > bytes.length) return undefined;

    if (marker === APP1 && bytesEqualAt(bytes, segStart + 2, EXIF_HEADER)) {
      const tiffStart = segStart + 2 + EXIF_HEADER.length;
      return parseTiff(bytes, tiffStart, segEnd);
    }

    p = segEnd;
  }
  return undefined;
}

function parseTiff(bytes: Uint8Array, tiffStart: number, segEnd: number): ExifThumbnail | undefined {
  const byteOrder = readAscii(bytes, tiffStart, 2);
  let littleEndian: boolean;
  if (byteOrder === "II") littleEndian = true;
  else if (byteOrder === "MM") littleEndian = false;
  else return undefined;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r = new Reader(view, littleEndian);

  const magic = r.u16(tiffStart + 2);
  if (magic !== 0x002a) return undefined;

  const ifd0Offset = r.u32(tiffStart + 4);
  const ifd0 = tiffStart + ifd0Offset;
  if (ifd0 + 2 > segEnd) return undefined;

  const ifd0Count = r.u16(ifd0);
  // IFD1 offset is stored immediately after the last IFD0 entry (12 bytes each).
  const ifd1OffsetPos = ifd0 + 2 + ifd0Count * 12;
  if (ifd1OffsetPos + 4 > segEnd) return undefined;
  const ifd1Offset = r.u32(ifd1OffsetPos);
  if (ifd1Offset === 0) return undefined;

  const ifd1 = tiffStart + ifd1Offset;
  if (ifd1 + 2 > segEnd) return undefined;

  const ifd1Count = r.u16(ifd1);
  let thumbOffset = -1;
  let thumbLength = -1;

  for (let i = 0; i < ifd1Count; i++) {
    const entry = ifd1 + 2 + i * 12;
    if (entry + 12 > segEnd) return undefined;
    const tag = r.u16(entry);
    // Each IFD entry: tag(2) + type(2) + count(4) + value/offset(4)
    if (tag === TAG_JPEG_IF_OFFSET) thumbOffset = r.u32(entry + 8);
    else if (tag === TAG_JPEG_IF_LENGTH) thumbLength = r.u32(entry + 8);
  }

  if (thumbOffset < 0 || thumbLength <= 0) return undefined;
  const absStart = tiffStart + thumbOffset;
  const absEnd = absStart + thumbLength;
  if (absEnd > bytes.length) return undefined;

  // Thumbnail should itself begin with SOI 0xFFD8.
  if (bytes[absStart] !== 0xff || bytes[absStart + 1] !== 0xd8) return undefined;

  return { bytes: bytes.slice(absStart, absEnd), offset: absStart };
}
