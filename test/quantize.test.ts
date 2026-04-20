import { describe, expect, it } from "vitest";
import { buildHistogram, quantizeWu } from "@ken0106/core";

function solidRGBA(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function threeStripesRGBA(w: number, h: number): Uint8Array {
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

describe("quantizeWu", () => {
  it("returns a single color for a solid image", () => {
    const data = solidRGBA(32, 32, 120, 200, 80);
    const hist = buildHistogram(data, 32, 32, {
      alphaThreshold: 125,
      includeWhite: true,
      step: 1,
    });
    const result = quantizeWu(hist, 10);
    expect(result.palette.length).toBeGreaterThan(0);
    const [r, g, b] = result.palette[0]!;
    // 5-bit quantization means we lose the low 3 bits; expect within ±8.
    expect(Math.abs(r - 120)).toBeLessThanOrEqual(8);
    expect(Math.abs(g - 200)).toBeLessThanOrEqual(8);
    expect(Math.abs(b - 80)).toBeLessThanOrEqual(8);
  });

  it("recovers the three dominant colors from RGB stripes", () => {
    const data = threeStripesRGBA(90, 30);
    const hist = buildHistogram(data, 90, 30, {
      alphaThreshold: 125,
      includeWhite: true,
      step: 1,
    });
    const result = quantizeWu(hist, 3);
    expect(result.palette.length).toBe(3);

    const sorted = result.palette
      .map(([r, g, b]) => ({ r, g, b, dom: r > g && r > b ? "r" : g > r && g > b ? "g" : "b" }))
      .sort((a, b) => a.dom.localeCompare(b.dom));

    expect(sorted.map((s) => s.dom)).toEqual(["b", "g", "r"]);
  });

  it("respects the alphaThreshold by ignoring transparent pixels", () => {
    const data = solidRGBA(16, 16, 255, 0, 0);
    // Mark the first half as fully transparent.
    for (let i = 0; i < 128; i++) data[i * 4 + 3] = 0;

    const hist = buildHistogram(data, 16, 16, {
      alphaThreshold: 125,
      includeWhite: true,
      step: 1,
    });
    expect(hist.total).toBe(128);
    const result = quantizeWu(hist, 5);
    const [r] = result.palette[0]!;
    expect(r).toBeGreaterThan(240);
  });
});
