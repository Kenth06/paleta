/**
 * Minimal native PNG encoder + decoder for test fixtures.
 *
 * Uses Node's built-in `zlib` for the DEFLATE step so tests can round-trip
 * RGBA ↔ PNG bytes without depending on jSquash or a bundler. Only supports
 * 8-bit RGBA (color type 6), which is all our fixtures need.
 */

import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Uint8Array.of(
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
);

/* --- CRC32 (IEEE 802.3) table --- */
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC32_TABLE[i] = c >>> 0;
}
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeUInt32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function readUInt32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset]! << 24) |
      (buf[offset + 1]! << 16) |
      (buf[offset + 2]! << 8) |
      buf[offset + 3]!) >>>
    0
  );
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const length = data.length;
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(4 + 4 + length + 4);
  writeUInt32BE(out, 0, length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  writeUInt32BE(out, 8 + length, crc32(crcInput));
  return out;
}

/** Encode RGBA bytes into a PNG buffer. */
export function encodePNG(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  if (rgba.length !== width * height * 4) {
    throw new Error("encodePNG: rgba length does not match width*height*4");
  }

  const ihdr = new Uint8Array(13);
  writeUInt32BE(ihdr, 0, width);
  writeUInt32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Filter = 0 (None) per scanline, then row bytes.
  const stride = width * 4;
  const filtered = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + stride)] = 0;
    filtered.set(rgba.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  }
  const idat = new Uint8Array(deflateSync(filtered));

  const ihdrChunk = chunk("IHDR", ihdr);
  const idatChunk = chunk("IDAT", idat);
  const iendChunk = chunk("IEND", new Uint8Array(0));

  const out = new Uint8Array(
    PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let offset = 0;
  out.set(PNG_SIGNATURE, offset); offset += PNG_SIGNATURE.length;
  out.set(ihdrChunk, offset); offset += ihdrChunk.length;
  out.set(idatChunk, offset); offset += idatChunk.length;
  out.set(iendChunk, offset);
  return out;
}

/** Decode a PNG buffer. Only supports 8-bit RGBA / color type 6, filter method 0. */
export function decodePNG(bytes: Uint8Array): {
  data: Uint8Array;
  width: number;
  height: number;
} {
  if (bytes.length < 8) throw new Error("decodePNG: too short");
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("decodePNG: bad signature");
  }

  let width = 0;
  let height = 0;
  const idatChunks: Uint8Array[] = [];

  let p = 8;
  while (p < bytes.length) {
    const length = readUInt32BE(bytes, p);
    const type = String.fromCharCode(
      bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!,
    );
    const dataStart = p + 8;
    const dataEnd = dataStart + length;

    if (type === "IHDR") {
      width = readUInt32BE(bytes, dataStart);
      height = readUInt32BE(bytes, dataStart + 4);
      if (bytes[dataStart + 8] !== 8 || bytes[dataStart + 9] !== 6) {
        throw new Error("decodePNG: only 8-bit RGBA is supported");
      }
    } else if (type === "IDAT") {
      idatChunks.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }

    p = dataEnd + 4; // skip CRC
  }

  // Concatenate IDATs and inflate.
  const totalIdat = idatChunks.reduce((a, c) => a + c.length, 0);
  const idat = new Uint8Array(totalIdat);
  {
    let off = 0;
    for (const c of idatChunks) { idat.set(c, off); off += c.length; }
  }
  const filtered = new Uint8Array(inflateSync(idat));

  // Undo per-scanline filters. We support filter 0 (None) and filter 1 (Sub),
  // since Node's deflateSync may pick Sub for small rows.
  const stride = width * 4;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filterType = filtered[y * (1 + stride)]!;
    const srcOff = y * (1 + stride) + 1;
    const dstOff = y * stride;
    if (filterType === 0) {
      out.set(filtered.subarray(srcOff, srcOff + stride), dstOff);
    } else if (filterType === 1) {
      // Sub: pixel[x] = pixel[x-bpp] + raw. bpp = 4.
      for (let x = 0; x < stride; x++) {
        const left = x >= 4 ? out[dstOff + x - 4]! : 0;
        out[dstOff + x] = (filtered[srcOff + x]! + left) & 0xff;
      }
    } else if (filterType === 2) {
      // Up: pixel[x] = pixel above + raw.
      for (let x = 0; x < stride; x++) {
        const up = y > 0 ? out[(y - 1) * stride + x]! : 0;
        out[dstOff + x] = (filtered[srcOff + x]! + up) & 0xff;
      }
    } else {
      // Average / Paeth filters — not implemented (zlib rarely picks them for
      // our small synthetic fixtures). Throw so tests fail loudly rather than
      // silently yielding garbage pixels.
      throw new Error(`decodePNG: unsupported filter ${filterType}`);
    }
  }

  return { data: out, width, height };
}
