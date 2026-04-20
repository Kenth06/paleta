/**
 * Graceful-failure tests for the experimental DC-only JPEG decoder.
 *
 * Real-JPEG validation requires committed fixture files or jSquash's JPEG
 * encoder; deferred to a follow-up session. These tests lock in the contract
 * that matters most: the decoder **never throws on garbage input**, it just
 * returns `undefined` so the pipeline can fall back.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeJpegDcOnly, initWasm } from "@ken0106/core";

const WASM_PATH = fileURLToPath(
  new URL("../packages/core/wasm/paleta_core_bg.wasm", import.meta.url),
);

describe("decodeJpegDcOnly — graceful failure", () => {
  beforeAll(async () => {
    const bytes = await readFile(WASM_PATH);
    await initWasm(bytes);
  });

  it("returns undefined for empty input", async () => {
    expect(await decodeJpegDcOnly(new Uint8Array(0))).toBeUndefined();
  });

  it("returns undefined for non-JPEG bytes", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await decodeJpegDcOnly(png)).toBeUndefined();
  });

  it("returns undefined for truncated JPEG (only SOI)", async () => {
    expect(await decodeJpegDcOnly(new Uint8Array([0xff, 0xd8]))).toBeUndefined();
  });

  it("returns undefined for JPEG with no SOF", async () => {
    // SOI + EOI (empty container)
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(await decodeJpegDcOnly(bytes)).toBeUndefined();
  });

  it("returns undefined for obviously malformed SOF2 bytes", async () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc2, 0x00, 0x02,
      0xff, 0xd9,
    ]);
    expect(await decodeJpegDcOnly(bytes)).toBeUndefined();
  });

  it("returns undefined for SOF3 lossless JPEG", async () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc3, 0x00, 0x02, // SOF3 = lossless sequential
      0xff, 0xd9,
    ]);
    expect(await decodeJpegDcOnly(bytes)).toBeUndefined();
  });

  it("returns undefined for SOF5-SOF15 (hierarchical, etc.)", async () => {
    for (const sofMarker of [0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) {
      const bytes = new Uint8Array([
        0xff, 0xd8,
        0xff, sofMarker, 0x00, 0x02,
        0xff, 0xd9,
      ]);
      expect(
        await decodeJpegDcOnly(bytes),
        `SOF marker 0x${sofMarker.toString(16)} should be rejected`,
      ).toBeUndefined();
    }
  });

  it("returns undefined for arithmetic-coded JPEGs (DAC marker)", async () => {
    // Synthetic header: SOI + DAC + EOI. DAC replaces DHT for arithmetic
    // coding, which we explicitly do not support (patent history, never
    // widely used, would require a completely different decoder).
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xcc, 0x00, 0x04, 0x00, 0x00, // DAC with minimal payload
      0xff, 0xd9,
    ]);
    expect(await decodeJpegDcOnly(bytes)).toBeUndefined();
  });
});

describe("decodeJpegDcOnly — real JPEG", () => {
  beforeAll(async () => {
    const bytes = await readFile(WASM_PATH);
    await initWasm(bytes);
  });

  it("decodes a 64×64 baseline 4:4:4 JPEG to an 8×8 DC-only RGBA image", async () => {
    const fixturePath = fileURLToPath(
      new URL("./fixtures/red-blue-444.jpg", import.meta.url),
    );
    const bytes = new Uint8Array(await readFile(fixturePath));
    const decoded = await decodeJpegDcOnly(bytes);

    // If the decoder returns undefined we treat it as "needs validation work"
    // — fail loudly so the task doesn't stay hidden, rather than silently
    // skipping.
    expect(
      decoded,
      "DC-only decoder returned undefined on a baseline 4:4:4 JPEG — needs investigation.",
    ).toBeDefined();
    if (!decoded) return;

    // 64/8 = 8 pixels per side expected.
    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(8);

    // Left half of the original is (220,30,30). The DC-thumbnail's left
    // four columns should be reddish. Right four columns should be bluish.
    // Tolerate JPEG color shifting by comparing dominant channel.
    let redCount = 0, blueCount = 0;
    for (let y = 0; y < decoded.height; y++) {
      for (let x = 0; x < decoded.width; x++) {
        const i = (y * decoded.width + x) * 4;
        const r = decoded.data[i]!;
        const b = decoded.data[i + 2]!;
        if (x < 4 && r > b + 40) redCount++;
        if (x >= 4 && b > r + 40) blueCount++;
      }
    }
    // Each side has 4*8 = 32 pixels. Allow up to 8 off-expectation pixels
    // at the boundary (JPEG DC blurs across the 8-pixel split).
    expect(redCount).toBeGreaterThan(24);
    expect(blueCount).toBeGreaterThan(24);
  });

  it("decodes a 128×96 grayscale JPEG (1 component) to 16×12 with R=G=B", async () => {
    const fixturePath = fileURLToPath(
      new URL("./fixtures/paleta-gray.jpg", import.meta.url),
    );
    const bytes = new Uint8Array(await readFile(fixturePath));
    const decoded = await decodeJpegDcOnly(bytes);
    expect(decoded).toBeDefined();
    if (!decoded) return;

    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(12);

    // Grayscale must produce R=G=B at every pixel (no color introduced).
    for (let i = 0; i < decoded.width * decoded.height; i++) {
      const r = decoded.data[i * 4]!;
      const g = decoded.data[i * 4 + 1]!;
      const b = decoded.data[i * 4 + 2]!;
      expect(r).toBe(g);
      expect(g).toBe(b);
    }

    // Gradient check: left column should be darker than right column on average.
    const leftAvg = decoded.data[4 * 0]! + decoded.data[4 * (decoded.width * 5)]!;
    const rightAvg = decoded.data[4 * (decoded.width - 1)]!
      + decoded.data[4 * (decoded.width * 5 + decoded.width - 1)]!;
    expect(rightAvg).toBeGreaterThan(leftAvg);
  });

  it("decodes a 128×96 baseline 4:2:2 JPEG to 16×12", async () => {
    const fixturePath = fileURLToPath(
      new URL("./fixtures/paleta-422.jpg", import.meta.url),
    );
    const bytes = new Uint8Array(await readFile(fixturePath));
    const decoded = await decodeJpegDcOnly(bytes);
    expect(decoded).toBeDefined();
    if (!decoded) return;

    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(12);

    // The fixture has R increasing along X, G increasing along Y.
    // Top-left should be dark, bottom-right should have high R+G.
    const tl = [decoded.data[0]!, decoded.data[1]!, decoded.data[2]!];
    const brIdx = ((decoded.height - 1) * decoded.width + decoded.width - 1) * 4;
    const br = [decoded.data[brIdx]!, decoded.data[brIdx + 1]!, decoded.data[brIdx + 2]!];

    expect(br[0]! + br[1]!).toBeGreaterThan(tl[0]! + tl[1]!);
  });

  it("decodes a 128×128 CMYK JPEG (4 components) to 16×16", async () => {
    const fixturePath = fileURLToPath(
      new URL("./fixtures/paleta-cmyk.jpg", import.meta.url),
    );
    const bytes = new Uint8Array(await readFile(fixturePath));
    const decoded = await decodeJpegDcOnly(bytes);
    expect(
      decoded,
      "DC-only decoder returned undefined on a CMYK JPEG.",
    ).toBeDefined();
    if (!decoded) return;

    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(16);

    // CMYK interpretation depends on APP14 marker + PIL's behavior. We only
    // assert that output is non-degenerate (not all black, not all white)
    // and that the four quadrants differ from each other. Exact RGB depends
    // on the YCCK vs raw-CMYK color model choice.
    const sample = (qx: number, qy: number) => {
      const cx = qx * 8 + 4;
      const cy = qy * 8 + 4;
      const i = (cy * 16 + cx) * 4;
      return [decoded.data[i]!, decoded.data[i + 1]!, decoded.data[i + 2]!];
    };
    const tl = sample(0, 0);
    const tr = sample(1, 0);
    const bl = sample(0, 1);
    const br = sample(1, 1);

    // No pixel should be exactly [0,0,0] or [255,255,255] across all four.
    const allBlack = [tl, tr, bl, br].every(([r, g, b]) => r === 0 && g === 0 && b === 0);
    const allWhite = [tl, tr, bl, br].every(([r, g, b]) => r === 255 && g === 255 && b === 255);
    expect(allBlack, `all black: ${JSON.stringify([tl, tr, bl, br])}`).toBe(false);
    expect(allWhite, `all white: ${JSON.stringify([tl, tr, bl, br])}`).toBe(false);

    // Quadrants should not all be identical.
    const colors = new Set([tl, tr, bl, br].map((c) => c.join(",")));
    expect(colors.size).toBeGreaterThan(1);
  });

  it("decodes a non-interleaved progressive JPEG (separate Y/Cb/Cr DC scans)", async () => {
    const fixturePath = fileURLToPath(
      new URL("./fixtures/paleta-progressive-noninterleaved.jpg", import.meta.url),
    );
    const bytes = new Uint8Array(await readFile(fixturePath));
    const decoded = await decodeJpegDcOnly(bytes);
    expect(
      decoded,
      "DC-only decoder returned undefined on a non-interleaved progressive JPEG.",
    ).toBeDefined();
    if (!decoded) return;

    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(16);

    const sample = (qx: number, qy: number) => {
      const cx = qx * 8 + 4;
      const cy = qy * 8 + 4;
      const i = (cy * 16 + cx) * 4;
      return [decoded.data[i]!, decoded.data[i + 1]!, decoded.data[i + 2]!];
    };

    const [tlR, , tlB] = sample(0, 0);
    const [trR, trG, trB] = sample(1, 0);
    const [blR, , blB] = sample(0, 1);
    const [brR, brG, brB] = sample(1, 1);

    expect(tlR).toBeGreaterThan(tlB);
    expect(trG).toBeGreaterThan(trR);
    expect(trG).toBeGreaterThan(trB);
    expect(blB).toBeGreaterThan(blR);
    expect(brR).toBeGreaterThan(brB);
    expect(brG).toBeGreaterThan(brB);
  });

  it("decodes a 128×128 progressive JPEG (four quadrants) to 16×16", async () => {
    const fixturePath = fileURLToPath(
      new URL("./fixtures/paleta-progressive.jpg", import.meta.url),
    );
    const bytes = new Uint8Array(await readFile(fixturePath));
    const decoded = await decodeJpegDcOnly(bytes);
    expect(
      decoded,
      "DC-only decoder returned undefined on a progressive JPEG.",
    ).toBeDefined();
    if (!decoded) return;

    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(16);

    const sample = (qx: number, qy: number) => {
      const cx = qx * 8 + 4;
      const cy = qy * 8 + 4;
      const i = (cy * 16 + cx) * 4;
      return [decoded.data[i]!, decoded.data[i + 1]!, decoded.data[i + 2]!];
    };

    const [tlR, tlG, tlB] = sample(0, 0);
    const [trR, trG, trB] = sample(1, 0);
    const [blR, blG, blB] = sample(0, 1);
    const [brR, brG, brB] = sample(1, 1);

    // Dominant-channel per quadrant. Progressive DC scans lose some
    // precision (they only carry DC, level-shifted), so tolerances are
    // wider than for baseline.
    expect(tlR).toBeGreaterThan(tlB);       // red TL
    expect(trG).toBeGreaterThan(trR);       // green TR
    expect(blB).toBeGreaterThan(blR);       // blue BL
    expect(brR).toBeGreaterThan(brB);       // amber BR
    expect(brG).toBeGreaterThan(brB);
  });

  it("decodes a 128×128 baseline 4:2:0 JPEG (four quadrants) to 16×16", async () => {
    const fixturePath = fileURLToPath(
      new URL("./fixtures/four-quadrants-420.jpg", import.meta.url),
    );
    const bytes = new Uint8Array(await readFile(fixturePath));
    const decoded = await decodeJpegDcOnly(bytes);
    expect(
      decoded,
      "DC-only decoder returned undefined on a baseline 4:2:0 JPEG — needs investigation.",
    ).toBeDefined();
    if (!decoded) return;

    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(16);

    // Sample center of each quadrant (8×8 sub-region).
    const sample = (qx: number, qy: number): [number, number, number] => {
      const cx = qx * 8 + 4;
      const cy = qy * 8 + 4;
      const i = (cy * 16 + cx) * 4;
      return [decoded.data[i]!, decoded.data[i + 1]!, decoded.data[i + 2]!];
    };

    const [tlR, tlG, tlB] = sample(0, 0);
    const [trR, trG, trB] = sample(1, 0);
    const [blR, blG, blB] = sample(0, 1);
    const [brR, brG, brB] = sample(1, 1);

    // Top-left dominant channel should be red
    expect(tlR).toBeGreaterThan(tlG);
    expect(tlR).toBeGreaterThan(tlB);
    // Top-right should be green
    expect(trG).toBeGreaterThan(trR);
    expect(trG).toBeGreaterThan(trB);
    // Bottom-left should be blue
    expect(blB).toBeGreaterThan(blR);
    expect(blB).toBeGreaterThan(blG);
    // Bottom-right should be yellow/amber (red + green dominant over blue)
    expect(brR).toBeGreaterThan(brB);
    expect(brG).toBeGreaterThan(brB);
  });
});
