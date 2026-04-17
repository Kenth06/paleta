import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildHistogram,
  initWasm,
  isWasmReady,
  quantizeWu,
  quantizeWuWasm,
  wasmVersion,
} from "@paleta/core";

const WASM_PATH = fileURLToPath(
  new URL("../packages/core/wasm/paleta_core_bg.wasm", import.meta.url),
);

function threeStripes(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const third = Math.floor(w / 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = 0, g = 0, b = 0;
      if (x < third) r = 255;
      else if (x < 2 * third) g = 255;
      else b = 255;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}

describe("WASM quantizer", () => {
  beforeAll(async () => {
    const bytes = await readFile(WASM_PATH);
    await initWasm(bytes);
  });

  it("initializes and reports its version", () => {
    expect(isWasmReady()).toBe(true);
    expect(wasmVersion()).toBe("0.1.0-alpha.0");
  });

  it("recovers the three dominant colors from RGB stripes", () => {
    const data = threeStripes(90, 30);
    const res = quantizeWuWasm(data, 90, 30, {
      colorCount: 3,
      step: 1,
      alphaThreshold: 125,
      includeWhite: true,
    });
    expect(res.palette.length).toBe(3);
    const sorted = res.palette
      .map(([r, g, b]) => (r > g && r > b ? "r" : g > r && g > b ? "g" : "b"))
      .sort();
    expect(sorted).toEqual(["b", "g", "r"]);
  });

  it("produces the same palette as the JS implementation (within rounding)", () => {
    const data = threeStripes(90, 30);
    const jsHist = buildHistogram(data, 90, 30, {
      alphaThreshold: 125,
      includeWhite: true,
      step: 1,
    });
    const js = quantizeWu(jsHist, 6);
    const wasm = quantizeWuWasm(data, 90, 30, {
      colorCount: 6,
      step: 1,
      alphaThreshold: 125,
      includeWhite: true,
    });

    expect(wasm.palette.length).toBe(js.palette.length);

    const key = (rgb: readonly [number, number, number]) =>
      rgb.map((c) => Math.round(c / 8) * 8).join(",");
    const jsKeys = new Set(js.palette.map(key));
    for (const entry of wasm.palette) {
      expect(jsKeys.has(key(entry))).toBe(true);
    }
  });
});
