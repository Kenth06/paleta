/**
 * Pipeline-level tests for DC-only JPEG fast path.
 *
 * Verifies that when `useDcOnlyJpeg: true` is passed on a real baseline JPEG,
 * the pipeline takes the dc-only branch and still returns a reasonable
 * palette. We also verify that it falls back to the full decoder on
 * unsupported JPEGs.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getPalette,
  initWasm,
  type DecodeFn,
  type DecodedImage,
} from "@paleta/core";

const WASM_PATH = fileURLToPath(
  new URL("../packages/core/wasm/paleta_core_bg.wasm", import.meta.url),
);

/** Pretend-decoder that emits a bright solid magenta image; lets us detect
 *  whether the fallback was used instead of the DC fast path. */
const fallbackDecoder: DecodeFn = async (): Promise<DecodedImage> => {
  const data = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 16 * 16; i++) {
    data[i * 4] = 255; // R
    data[i * 4 + 1] = 0; // G
    data[i * 4 + 2] = 255; // B
    data[i * 4 + 3] = 255;
  }
  return { data, width: 16, height: 16 };
};

describe("pipeline: DC-only JPEG fast path", () => {
  beforeAll(async () => {
    const bytes = await readFile(WASM_PATH);
    await initWasm(bytes);
  });

  it("takes dc-only path on a real baseline JPEG when enabled", async () => {
    const jpg = new Uint8Array(
      await readFile(
        fileURLToPath(new URL("./fixtures/red-blue-444.jpg", import.meta.url)),
      ),
    );
    const result = await getPalette(jpg, {
      decoder: fallbackDecoder,
      useDcOnlyJpeg: true,
      colorCount: 4,
      includeWhite: true,
    });
    expect(result.meta.path).toBe("dc-only");
    expect(result.meta.width).toBe(8);
    expect(result.meta.height).toBe(8);

    // The fixture is red | blue. Palette should contain reddish and bluish
    // entries, not the fallback's bright magenta.
    const redish = result.palette.some(([r, g, b]) => r > 150 && g < 100 && b < 100);
    const blueish = result.palette.some(([r, g, b]) => b > 120 && r < 100);
    expect(redish, `palette=${JSON.stringify(result.palette)}`).toBe(true);
    expect(blueish, `palette=${JSON.stringify(result.palette)}`).toBe(true);
  });

  it("falls back to full decode when useDcOnlyJpeg is false", async () => {
    const jpg = new Uint8Array(
      await readFile(
        fileURLToPath(new URL("./fixtures/red-blue-444.jpg", import.meta.url)),
      ),
    );
    const result = await getPalette(jpg, {
      decoder: fallbackDecoder,
      useDcOnlyJpeg: false,
      colorCount: 4,
    });
    expect(result.meta.path).toBe("full-decode");
  });

  it("falls back to full decode on unsupported JPEG even when flag is set", async () => {
    // Truncated but magic-valid JPEG — sniffer accepts, DC-decoder bails.
    const bogus = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00]);
    const result = await getPalette(bogus, {
      decoder: fallbackDecoder,
      useDcOnlyJpeg: true,
      colorCount: 4,
    });
    expect(result.meta.path).toBe("full-decode");
  });
});
