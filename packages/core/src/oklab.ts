/**
 * sRGB ↔ OKLab ↔ OKLCH conversions.
 *
 * OKLab is a perceptually-uniform color space by Björn Ottosson (2020).
 * We use it for:
 *   - dominance weighting (so the same numeric step = same perceived step)
 *   - perceptual palette sorting (group similar colors)
 *   - accent picking (OKLCH hue rotation)
 *
 * References:
 *   - https://bottosson.github.io/posts/oklab/
 *   - https://www.w3.org/TR/css-color-4/#ok-lab
 */

import type { OKLCH, RGB } from "./types.js";

// sRGB [0..255] → linear-light sRGB [0..1]
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

// linear-light sRGB [0..1] → sRGB [0..255]
function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

export interface OKLabTriple {
  L: number;
  a: number;
  b: number;
}

export function rgbToOKLab(r: number, g: number, b: number): OKLabTriple {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

export function oklabToRgb(L: number, a: number, b: number): RGB {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

export function oklabToOKLCH(L: number, a: number, b: number): OKLCH {
  const C = Math.hypot(a, b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, H];
}

export function rgbToOKLCH(r: number, g: number, b: number): OKLCH {
  const lab = rgbToOKLab(r, g, b);
  return oklabToOKLCH(lab.L, lab.a, lab.b);
}

/** Perceptual distance ΔE_OK — Euclidean distance in OKLab. */
export function deltaE_OK(a: OKLabTriple, b: OKLabTriple): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * Relative luminance per WCAG 2.x. Input is sRGB [0..255].
 * Used for contrast ratios.
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.x contrast ratio between two sRGB colors. Always returns ≥ 1. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a[0], a[1], a[2]);
  const lb = relativeLuminance(b[0], b[1], b[2]);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
