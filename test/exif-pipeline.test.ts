/**
 * EXIF thumbnail fast-path integration test.
 *
 * We synthesize a small "JPEG" with an APP1/Exif segment that embeds a
 * distinct inner JPEG. Since our core pipeline only sniffs bytes and the
 * decoder is BYO, we use a fake decoder that reads a single marker byte to
 * distinguish "outer image" from "inner thumbnail". That way we can assert
 * the pipeline picked up the thumbnail fast path.
 */

import { describe, expect, it } from "vitest";
import { getPalette, type DecodeFn, type DecodedImage } from "@paleta/core";
import { extractExifThumbnail } from "@paleta/exif";

/** Build a JPEG-shaped byte array with APP1/Exif + an embedded inner JPEG. */
function buildJpegWithExifThumb(outerMark: number, innerMark: number): Uint8Array {
  // Inner JPEG body — arbitrary bytes after SOI, 1KB. We mark the 3rd byte
  // so the fake decoder can tell outer and inner apart.
  const innerJpeg = new Uint8Array(1024);
  innerJpeg[0] = 0xff; innerJpeg[1] = 0xd8; // SOI
  innerJpeg[2] = innerMark;
  innerJpeg[innerJpeg.length - 2] = 0xff;
  innerJpeg[innerJpeg.length - 1] = 0xd9; // EOI

  // TIFF header (little-endian): II + 0x002A + IFD0 offset(=8).
  const tiff: number[] = [
    0x49, 0x49, 0x2a, 0x00,
    0x08, 0x00, 0x00, 0x00,
  ];
  // IFD0 with zero entries + offset to IFD1.
  // entries: 0 (u16)
  tiff.push(0x00, 0x00);
  // IFD1 offset: after IFD0 (count:2 + 0 entries + next_ptr:4 = 6 bytes).
  const ifd1Offset = tiff.length + 4;
  tiff.push(ifd1Offset & 0xff, (ifd1Offset >> 8) & 0xff, 0, 0);

  // IFD1: 2 entries (0x0201, 0x0202), next ptr 0.
  const ifd1Start = tiff.length;
  tiff.push(0x02, 0x00); // 2 entries (u16)
  // Entry 1: tag 0x0201 (JpegIFOffset), type 4 (LONG), count 1, value = offset
  tiff.push(0x01, 0x02, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00);
  // Placeholder value — patch later
  const offsetEntryValuePos = tiff.length;
  tiff.push(0, 0, 0, 0);
  // Entry 2: tag 0x0202 (JpegIFByteCount), type 4, count 1, value = length
  tiff.push(0x02, 0x02, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00);
  tiff.push(
    innerJpeg.length & 0xff,
    (innerJpeg.length >> 8) & 0xff,
    (innerJpeg.length >> 16) & 0xff,
    (innerJpeg.length >> 24) & 0xff,
  );
  // Next IFD ptr = 0
  tiff.push(0, 0, 0, 0);

  // Thumbnail bytes come right after IFD1's next-ptr.
  const thumbOffsetFromTiff = tiff.length;
  // Append the inner JPEG to the TIFF buffer.
  const tiffWithThumb = new Uint8Array(tiff.length + innerJpeg.length);
  tiffWithThumb.set(tiff);
  tiffWithThumb.set(innerJpeg, tiff.length);
  // Patch the JpegIFOffset value.
  tiffWithThumb[offsetEntryValuePos] = thumbOffsetFromTiff & 0xff;
  tiffWithThumb[offsetEntryValuePos + 1] = (thumbOffsetFromTiff >> 8) & 0xff;
  tiffWithThumb[offsetEntryValuePos + 2] = (thumbOffsetFromTiff >> 16) & 0xff;
  tiffWithThumb[offsetEntryValuePos + 3] = (thumbOffsetFromTiff >> 24) & 0xff;

  // APP1 segment body: "Exif\0\0" + tiff+thumb.
  const exifBody = new Uint8Array(6 + tiffWithThumb.length);
  exifBody.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  exifBody.set(tiffWithThumb, 6);
  const segLen = exifBody.length + 2; // +2 for the length field itself

  // Outer JPEG: SOI + APP1 marker + len(be) + exifBody + a garbage SOS-ish
  // section + EOI. We stash the `outerMark` byte at a fixed post-APP1 offset
  // so the fake decoder can find it.
  const parts: number[] = [];
  parts.push(0xff, 0xd8);                             // SOI
  parts.push(0xff, 0xe1);                             // APP1
  parts.push((segLen >> 8) & 0xff, segLen & 0xff);    // length (big-endian)
  for (const b of exifBody) parts.push(b);
  // Outer body region — first byte is outerMark so the decoder can find it.
  parts.push(outerMark, 0xff);
  // Pad up
  for (let i = 0; i < 32; i++) parts.push(0x00);
  parts.push(0xff, 0xd9);                             // EOI
  return new Uint8Array(parts);
}

/**
 * Decoder that returns a solid RGBA image whose R channel equals the byte at
 * offset 2 (i.e. the SOI-follower). For the outer JPEG we write `outerMark`
 * immediately after APP1 instead (offset 2 is 0xFF), so we read a known
 * sentinel from offset 2 of the inner JPEG instead.
 */
function markDecoder(): DecodeFn {
  return async (bytes: Uint8Array): Promise<DecodedImage> => {
    // Inner JPEGs have their mark at offset 2 (right after SOI).
    // Outer JPEGs have their mark later — we pick offset (2 + 2 + segLen + 0)
    // but that's brittle; instead we scan for the first marker-like byte.
    // Simplest: inner images are small (1024B), outer are ~1100+.
    const mark = bytes.length <= 1200 ? bytes[2]! : 0x00;
    const side = 16;
    const data = new Uint8Array(side * side * 4);
    for (let i = 0; i < side * side; i++) {
      data[i * 4] = mark;
      data[i * 4 + 1] = 20;
      data[i * 4 + 2] = 40;
      data[i * 4 + 3] = 255;
    }
    return { data, width: side, height: side };
  };
}

describe("pipeline: EXIF thumbnail fast path", () => {
  it("takes the fast path when extractor returns a thumbnail", async () => {
    const jpeg = buildJpegWithExifThumb(0xaa, 0xbb);
    const result = await getPalette(jpeg, {
      decoder: markDecoder(),
      thumbnailExtractor: extractExifThumbnail,
      colorCount: 4,
      minThumbnailDimension: 1,
    });
    expect(result.meta.path).toBe("exif-thumb");
    // Decoder stamped inner mark (0xBB) into the R channel.
    expect(result.dominant[0]).toBe(0xbb);
  });

  it("falls back to full decode when no extractor provided", async () => {
    const jpeg = buildJpegWithExifThumb(0xaa, 0xbb);
    const result = await getPalette(jpeg, {
      decoder: markDecoder(),
      colorCount: 4,
    });
    expect(result.meta.path).toBe("full-decode");
  });

  it("falls back to full decode when extractor returns undefined", async () => {
    const jpeg = buildJpegWithExifThumb(0xaa, 0xbb);
    const result = await getPalette(jpeg, {
      decoder: markDecoder(),
      thumbnailExtractor: () => undefined,
      colorCount: 4,
    });
    expect(result.meta.path).toBe("full-decode");
  });
});
