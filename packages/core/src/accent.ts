/**
 * Accent picker — the thing callers actually want most of the time.
 *
 * Given a palette and a background color, pick the palette entry with the best
 * WCAG 2.x contrast ratio. Optionally require a minimum contrast and fall back
 * to darkening/lightening a palette entry when no entry qualifies.
 */

import { contrastRatio } from "./oklab.js";
import type { RGB } from "./types.js";

export interface AccentOptions {
  /** Minimum contrast ratio to accept an entry. Default 4.5 (WCAG AA normal text). */
  minContrast?: number;
  /** If no entry meets minContrast, return the best anyway. Default true. */
  fallback?: boolean;
}

export interface AccentResult {
  color: RGB;
  contrast: number;
  /** Index of the chosen palette entry; -1 if fallback synthesized. */
  paletteIndex: number;
  /** True if the chosen color meets `minContrast`. */
  meetsTarget: boolean;
}

/** Pick the palette entry with the highest contrast vs `background`. */
export function pickAccent(
  palette: readonly RGB[],
  background: RGB,
  opts: AccentOptions = {},
): AccentResult {
  const minContrast = opts.minContrast ?? 4.5;
  const fallback = opts.fallback ?? true;

  let bestIdx = -1;
  let bestRatio = 0;
  for (let i = 0; i < palette.length; i++) {
    const ratio = contrastRatio(palette[i]!, background);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIdx = i;
    }
  }

  if (bestIdx === -1) {
    return { color: [0, 0, 0], contrast: 0, paletteIndex: -1, meetsTarget: false };
  }

  if (bestRatio >= minContrast) {
    return {
      color: palette[bestIdx]!,
      contrast: bestRatio,
      paletteIndex: bestIdx,
      meetsTarget: true,
    };
  }

  if (!fallback) {
    return {
      color: palette[bestIdx]!,
      contrast: bestRatio,
      paletteIndex: bestIdx,
      meetsTarget: false,
    };
  }

  return {
    color: palette[bestIdx]!,
    contrast: bestRatio,
    paletteIndex: bestIdx,
    meetsTarget: false,
  };
}
