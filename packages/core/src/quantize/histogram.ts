/**
 * 5-bit per-channel RGB histogram.
 *
 * We bin every sampled pixel into one of 32×32×32 = 32,768 buckets. The
 * quantizer then operates on the histogram, so cost is bounded by bucket count
 * rather than image size.
 *
 * Each bucket stores: count + sum(r) + sum(g) + sum(b) + sum(r²+g²+b²).
 * We use a single `Float64Array` of length 32768 * 5 so all moments live
 * together and cache well.
 */

export const HIST_BITS = 5;
export const HIST_SIDE = 1 << HIST_BITS; // 32
export const HIST_SIZE = HIST_SIDE * HIST_SIDE * HIST_SIDE; // 32768
export const HIST_STRIDE = 5; // count, sumR, sumG, sumB, sumRGBSq

/** Pack a 5-bit RGB triple into a 15-bit index. */
export function packRGB(r: number, g: number, b: number): number {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

export interface HistogramResult {
  /** Flat moments table: [count, sumR, sumG, sumB, sumSq] per bucket. */
  moments: Float64Array;
  /** Total pixels included in the histogram (after filtering). */
  total: number;
}

export interface BuildHistogramOptions {
  alphaThreshold: number;
  includeWhite: boolean;
  /** Stride between samples when walking the pixel array. Pass 1 for every pixel. */
  step: number;
}

/**
 * Build a 5-bit histogram from an RGBA byte array, applying alpha and
 * optional near-white filters.
 */
export function buildHistogram(
  pixels: Uint8Array,
  width: number,
  height: number,
  opts: BuildHistogramOptions,
): HistogramResult {
  const moments = new Float64Array(HIST_SIZE * HIST_STRIDE);
  const { alphaThreshold, includeWhite, step } = opts;
  const pixelCount = width * height;
  let total = 0;

  for (let i = 0; i < pixelCount; i += step) {
    const off = i * 4;
    const r = pixels[off]!;
    const g = pixels[off + 1]!;
    const b = pixels[off + 2]!;
    const a = pixels[off + 3]!;

    if (a < alphaThreshold) continue;
    if (!includeWhite && r > 250 && g > 250 && b > 250) continue;

    const idx = packRGB(r, g, b) * HIST_STRIDE;
    moments[idx]! += 1;
    moments[idx + 1]! += r;
    moments[idx + 2]! += g;
    moments[idx + 3]! += b;
    moments[idx + 4]! += r * r + g * g + b * b;
    total++;
  }

  return { moments, total };
}
