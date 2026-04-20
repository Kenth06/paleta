/**
 * Procedural fixture generators.
 *
 * Each function returns `{ rgba, width, height, expectedColors }` where
 * `expectedColors` lists the dominant colors the pipeline should recover
 * (in rough order of population). Used by the fixtures test suite.
 */

import type { RGB } from "@ken0106/core";

export interface Fixture {
  name: string;
  rgba: Uint8Array;
  width: number;
  height: number;
  /** Colors we expect a palette extractor to surface among the top entries. */
  expectedColors: RGB[];
}

function fill(rgba: Uint8Array, offset: number, r: number, g: number, b: number): void {
  rgba[offset] = r;
  rgba[offset + 1] = g;
  rgba[offset + 2] = b;
  rgba[offset + 3] = 255;
}

export function solidRed(): Fixture {
  const w = 32, h = 32;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) fill(rgba, i * 4, 220, 30, 30);
  return { name: "solid-red", rgba, width: w, height: h, expectedColors: [[220, 30, 30]] };
}

export function triStripes(): Fixture {
  const w = 90, h = 30;
  const rgba = new Uint8Array(w * h * 4);
  const third = Math.floor(w / 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x < third) fill(rgba, i, 220, 20, 20);
      else if (x < 2 * third) fill(rgba, i, 20, 200, 40);
      else fill(rgba, i, 30, 60, 220);
    }
  }
  return {
    name: "tri-stripes",
    rgba,
    width: w,
    height: h,
    expectedColors: [[220, 20, 20], [20, 200, 40], [30, 60, 220]],
  };
}

export function fourQuadrants(): Fixture {
  const w = 64, h = 64;
  const rgba = new Uint8Array(w * h * 4);
  const half = 32;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x < half && y < half) fill(rgba, i, 200, 150, 40);      // amber
      else if (x >= half && y < half) fill(rgba, i, 40, 160, 170); // teal
      else if (x < half && y >= half) fill(rgba, i, 190, 70, 130); // magenta
      else fill(rgba, i, 30, 50, 200);                              // blue
    }
  }
  return {
    name: "four-quadrants",
    rgba,
    width: w,
    height: h,
    expectedColors: [[200, 150, 40], [40, 160, 170], [190, 70, 130], [30, 50, 200]],
  };
}

export function horizontalGradient(): Fixture {
  // Linear blue → orange gradient. Palette should include both endpoints.
  const w = 64, h = 32;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = x / (w - 1);
      const r = Math.round(30 + t * (240 - 30));
      const g = Math.round(80 + t * (170 - 80));
      const b = Math.round(200 + t * (20 - 200));
      fill(rgba, (y * w + x) * 4, r, g, b);
    }
  }
  return {
    name: "horizontal-gradient",
    rgba,
    width: w,
    height: h,
    expectedColors: [[30, 80, 200], [240, 170, 20]],
  };
}

export function noisyWithDominant(): Fixture {
  // 90% solid teal with 10% random noise. Dominant palette entry should be teal.
  const w = 64, h = 64;
  const rgba = new Uint8Array(w * h * 4);
  let s = 1337;
  for (let i = 0; i < w * h; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    if ((s & 0xff) < 25) {
      // Random noise pixel.
      fill(rgba, i * 4, (s >> 8) & 0xff, (s >> 16) & 0xff, (s >> 24) & 0xff);
    } else {
      fill(rgba, i * 4, 20, 150, 140);
    }
  }
  return {
    name: "noisy-teal",
    rgba,
    width: w,
    height: h,
    expectedColors: [[20, 150, 140]],
  };
}

export const ALL_FIXTURES: ReadonlyArray<() => Fixture> = [
  solidRed,
  triStripes,
  fourQuadrants,
  horizontalGradient,
  noisyWithDominant,
];
