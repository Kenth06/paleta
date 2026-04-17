/**
 * Perceptual palette sorting.
 *
 * Wu gives us K boxes with populations; we want to hand back a list ordered
 * by "visual dominance". Population is a good starting point, but two
 * perceptually-identical colors (e.g. two near-identical dark greens) can both
 * survive quantization and shove truly distinct colors down the list.
 *
 * Strategy:
 *   1. Convert palette to OKLab.
 *   2. Primary sort by population (descending).
 *   3. Ties broken by chroma (more vivid first) then by |L - 0.5| (mid-tones
 *      tend to be more "representative" of an image than extreme L values).
 */

import { oklabToOKLCH, rgbToOKLab } from "./oklab.js";
import type { OKLCH, RGB } from "./types.js";

export interface SortedPalette {
  palette: RGB[];
  oklch: OKLCH[];
}

export function sortPaletteByDominance(
  palette: RGB[],
  populations: number[],
): SortedPalette {
  const entries = palette.map((rgb, i) => {
    const lab = rgbToOKLab(rgb[0], rgb[1], rgb[2]);
    const lch = oklabToOKLCH(lab.L, lab.a, lab.b);
    return { rgb, lch, pop: populations[i] ?? 0 };
  });

  entries.sort((a, b) => {
    if (b.pop !== a.pop) return b.pop - a.pop;
    if (b.lch[1] !== a.lch[1]) return b.lch[1] - a.lch[1];
    return Math.abs(a.lch[0] - 0.5) - Math.abs(b.lch[0] - 0.5);
  });

  return {
    palette: entries.map((e) => e.rgb),
    oklch: entries.map((e) => e.lch),
  };
}
