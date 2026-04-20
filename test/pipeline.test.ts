import { describe, expect, it } from "vitest";
import { getPalette, type DecodeFn, type DecodedImage } from "@ken0106/core";

/** Synthetic JPEG-looking bytes (just enough magic for the sniffer). */
function jpegLikeBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00]);
}

/** Fake decoder that returns a solid 8×8 red image regardless of input. */
function solidRedDecoder(): DecodeFn {
  return async (): Promise<DecodedImage> => {
    const data = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) {
      data[i * 4] = 240;
      data[i * 4 + 1] = 30;
      data[i * 4 + 2] = 30;
      data[i * 4 + 3] = 255;
    }
    return { data, width: 8, height: 8 };
  };
}

describe("getPalette end-to-end", () => {
  it("runs the full pipeline with a BYO decoder", async () => {
    const result = await getPalette(jpegLikeBytes(), {
      decoder: solidRedDecoder(),
      colorCount: 4,
    });
    expect(result.palette.length).toBeGreaterThan(0);
    const [r, g, b] = result.dominant;
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
    expect(result.meta.format).toBe("jpeg");
    expect(result.meta.path).toBe("full-decode");
    expect(result.oklch.length).toBe(result.palette.length);
  });

  it("throws NO_DECODER when none is provided", async () => {
    await expect(getPalette(jpegLikeBytes())).rejects.toMatchObject({
      code: "NO_DECODER",
    });
  });

  it("throws UNSUPPORTED_FORMAT for unknown bytes", async () => {
    const random = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    await expect(
      getPalette(random, { decoder: solidRedDecoder() }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
  });
});
