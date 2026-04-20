import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  deltaE_OK,
  oklabToRgb,
  rgbToOKLab,
  rgbToOKLCH,
} from "@ken0106/core";

describe("OKLab round-trip", () => {
  it("round-trips primary colors within 1 unit per channel", () => {
    for (const c of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128]] as const) {
      const lab = rgbToOKLab(c[0], c[1], c[2]);
      const [r, g, b] = oklabToRgb(lab.L, lab.a, lab.b);
      expect(Math.abs(r - c[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(g - c[1])).toBeLessThanOrEqual(1);
      expect(Math.abs(b - c[2])).toBeLessThanOrEqual(1);
    }
  });

  it("deltaE_OK is zero for identical colors and positive for different ones", () => {
    const a = rgbToOKLab(200, 100, 50);
    const b = rgbToOKLab(200, 100, 50);
    expect(deltaE_OK(a, b)).toBeCloseTo(0, 6);

    const c = rgbToOKLab(0, 0, 0);
    const d = rgbToOKLab(255, 255, 255);
    expect(deltaE_OK(c, d)).toBeGreaterThan(0.5);
  });

  it("OKLCH hue is in [0, 360)", () => {
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const [, , h] = rgbToOKLCH(r, g, b);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThan(360);
        }
      }
    }
  });
});

describe("contrastRatio", () => {
  it("returns 21 for black vs white", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
  });

  it("returns 1 for identical colors", () => {
    expect(contrastRatio([123, 45, 67], [123, 45, 67])).toBeCloseTo(1, 6);
  });

  it("is symmetric", () => {
    const a = contrastRatio([255, 0, 0], [0, 0, 255]);
    const b = contrastRatio([0, 0, 255], [255, 0, 0]);
    expect(a).toBeCloseTo(b, 6);
  });
});
