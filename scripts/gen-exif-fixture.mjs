#!/usr/bin/env node
/**
 * Generates a JPEG fixture that embeds a real 160×120 JPEG thumbnail
 * in its EXIF APP1 segment. We need one for benchmarking the
 * EXIF-thumb fast path; none of the PIL-generated fixtures in
 * test/fixtures/ carry EXIF metadata.
 *
 * Requires ImageMagick (`magick` on PATH).
 *
 * Input:  test/fixtures/paleta-scene-large-420.jpg (1280×720)
 * Output: test/fixtures/paleta-scene-with-exif-thumb.jpg
 *
 * Structure of the output:
 *   SOI (0xFFD8)
 *   APP1 (0xFFE1) + length + "Exif\0\0" + TIFF header + IFD0 + IFD1
 *     IFD1 has JpegIFOffset (0x0201) and JpegIFByteCount (0x0202)
 *     pointing at the embedded thumbnail bytes.
 *   Thumbnail JPEG bytes (full SOI..EOI).
 *   Rest of the source JPEG (everything after its SOI).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "test/fixtures/paleta-scene-large-420.jpg");
const dst = join(root, "test/fixtures/paleta-scene-with-exif-thumb.jpg");
const tmpThumb = join(tmpdir(), `paleta-exif-thumb-${process.pid}.jpg`);

try {
  execFileSync("magick", [src, "-resize", "160x120", "-quality", "80", "-strip", tmpThumb]);
} catch (err) {
  console.error("ImageMagick (`magick`) is required. Install via `brew install imagemagick`.");
  throw err;
}

const thumb = readFileSync(tmpThumb);
unlinkSync(tmpThumb);

const srcBytes = readFileSync(src);
if (srcBytes[0] !== 0xff || srcBytes[1] !== 0xd8) {
  throw new Error("Source is not a JPEG (missing SOI).");
}

/**
 * Build the TIFF section of the EXIF APP1 body.
 * IFD0 is empty; the chained IFD1 offset points at IFD1 which carries the
 * JpegIFOffset and JpegIFByteCount tags, and the thumbnail bytes are
 * appended right after IFD1's next-ptr.
 */
function buildTiffWithThumb(thumbBytes) {
  const tiff = [];
  // Little-endian TIFF header: "II" + 0x002A + IFD0 offset(=8)
  tiff.push(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00);
  // IFD0: zero entries
  tiff.push(0x00, 0x00);
  // IFD1 offset = current length + 4 (the next-ptr itself)
  const ifd1Offset = tiff.length + 4;
  tiff.push(ifd1Offset & 0xff, (ifd1Offset >> 8) & 0xff, 0, 0);

  // IFD1: 2 entries
  tiff.push(0x02, 0x00);
  // Entry 1: JpegIFOffset (0x0201), type LONG (4), count 1, value = placeholder
  tiff.push(0x01, 0x02, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00);
  const offsetValuePos = tiff.length;
  tiff.push(0, 0, 0, 0);
  // Entry 2: JpegIFByteCount (0x0202), type LONG, count 1, value = length
  tiff.push(0x02, 0x02, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00);
  tiff.push(
    thumbBytes.length & 0xff,
    (thumbBytes.length >> 8) & 0xff,
    (thumbBytes.length >> 16) & 0xff,
    (thumbBytes.length >> 24) & 0xff,
  );
  // Next IFD ptr = 0
  tiff.push(0, 0, 0, 0);

  // Append thumbnail; record its offset relative to TIFF start
  const thumbOffsetFromTiff = tiff.length;
  const out = new Uint8Array(tiff.length + thumbBytes.length);
  out.set(tiff);
  out.set(thumbBytes, tiff.length);
  out[offsetValuePos] = thumbOffsetFromTiff & 0xff;
  out[offsetValuePos + 1] = (thumbOffsetFromTiff >> 8) & 0xff;
  out[offsetValuePos + 2] = (thumbOffsetFromTiff >> 16) & 0xff;
  out[offsetValuePos + 3] = (thumbOffsetFromTiff >> 24) & 0xff;
  return out;
}

const tiffWithThumb = buildTiffWithThumb(thumb);

// APP1 body = "Exif\0\0" + TIFF+thumb
const exifBody = new Uint8Array(6 + tiffWithThumb.length);
exifBody.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
exifBody.set(tiffWithThumb, 6);

// APP1 segment length field is big-endian and includes itself (2 bytes)
const segLen = exifBody.length + 2;
if (segLen > 0xffff) {
  throw new Error(`APP1 payload too large for a single segment (${segLen} B > 65535).`);
}

// Compose: SOI + APP1 + len + body + (source JPEG from offset 2 onwards)
const header = new Uint8Array(4 + exifBody.length);
header[0] = 0xff; header[1] = 0xe1;
header[2] = (segLen >> 8) & 0xff;
header[3] = segLen & 0xff;
header.set(exifBody, 4);

const tail = srcBytes.subarray(2); // everything after the original SOI

const out = new Uint8Array(2 + header.length + tail.length);
out[0] = 0xff; out[1] = 0xd8;
out.set(header, 2);
out.set(tail, 2 + header.length);

writeFileSync(dst, out);
console.log(`wrote ${dst}`);
console.log(`  outer size:     ${out.length} B`);
console.log(`  thumbnail size: ${thumb.length} B (160×120)`);
console.log(`  source size:    ${srcBytes.length} B`);
