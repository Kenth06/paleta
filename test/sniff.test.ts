import { describe, expect, it } from "vitest";
import { sniffFormat } from "@paleta/core";

function bytes(arr: number[]): Uint8Array {
  return new Uint8Array(arr);
}

describe("sniffFormat", () => {
  it("detects JPEG", () => {
    expect(sniffFormat(bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe("jpeg");
  });

  it("detects PNG", () => {
    expect(sniffFormat(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
  });

  it("detects WebP only when RIFF + WEBP both match", () => {
    // size field (4 bytes) + WEBP
    const webp = bytes([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // size
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(sniffFormat(webp)).toBe("webp");

    // RIFF but no WEBP → not a WebP
    const bogus = bytes([
      0x52, 0x49, 0x46, 0x46,
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45, // "WAVE" (audio, not image)
    ]);
    expect(sniffFormat(bogus)).toBeUndefined();
  });

  it("detects AVIF at the correct ftyp offset", () => {
    // ISO-BMFF: box size (4) + ftyp (4) + major brand "avif" (4) + minor (4)
    const avif = bytes([
      0x00, 0x00, 0x00, 0x20,       // box size = 32
      0x66, 0x74, 0x79, 0x70,       // "ftyp"
      0x61, 0x76, 0x69, 0x66,       // "avif"
      0x00, 0x00, 0x00, 0x00,       // minor version
      0x61, 0x76, 0x69, 0x66,       // compatible brand "avif"
      0x6d, 0x69, 0x66, 0x31,       // "mif1"
      0x6d, 0x69, 0x61, 0x66,       // "miaf"
      0x00, 0x00, 0x00, 0x00,
    ]);
    expect(sniffFormat(avif)).toBe("avif");
  });

  it("detects AVIF via compatible-brands list when major is not 'avif'", () => {
    const heic = bytes([
      0x00, 0x00, 0x00, 0x20,
      0x66, 0x74, 0x79, 0x70,       // ftyp
      0x6d, 0x73, 0x66, 0x31,       // "msf1" (major)
      0x00, 0x00, 0x00, 0x00,
      0x6d, 0x73, 0x66, 0x31,
      0x61, 0x76, 0x69, 0x66,       // "avif" in compatible brands
      0x6d, 0x69, 0x61, 0x66,
      0x00, 0x00, 0x00, 0x00,
    ]);
    expect(sniffFormat(heic)).toBe("avif");
  });

  it("returns undefined for unrecognized bytes", () => {
    expect(sniffFormat(bytes([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))).toBeUndefined();
  });

  it("does not match the broken upstream 'RIWE' pattern", () => {
    // Exactly the pattern cf-colorthief accepted as WebP.
    expect(sniffFormat(bytes([0x52, 0x49, 0x57, 0x45, 0x00, 0x00]))).toBeUndefined();
  });

  it("does not match the broken upstream AVIF pattern at offset 0", () => {
    // Bytes [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66] at offset 0
    // — cf-colorthief matched this, but 'ftyp' must be at offset 4.
    expect(
      sniffFormat(bytes([0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66])),
    ).toBeUndefined();
  });
});
