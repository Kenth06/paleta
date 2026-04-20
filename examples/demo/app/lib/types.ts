/**
 * Response shape returned by the demo Worker's /api/palette endpoint.
 * Mirrors src/worker.ts `enrich()`.
 */

export type RGB = readonly [number, number, number];

export type PipelinePath =
  | "cache-hit"
  | "exif-thumb"
  | "dc-only"
  | "full-decode";

export type ImageFormat = "jpeg" | "png" | "webp" | "avif";

export interface Swatch {
  rgb: RGB;
  hex: string;
  oklch: string;
}

export type WcagTier = "AAA" | "AA" | "AA-large" | "fail";

export interface AccentPick {
  rgb: RGB;
  hex: string;
  contrast: number;
  wcag: WcagTier;
}

export interface PaletteMeta {
  format: ImageFormat;
  path: PipelinePath;
  width: number;
  height: number;
  decodeMs?: number;
  quantizeMs?: number;
  totalMs?: number;
  bytes?: number;
  [k: string]: unknown;
}

export interface PaletteResponse {
  palette: Swatch[];
  dominant: Swatch;
  accents: {
    onBlack: AccentPick;
    onWhite: AccentPick;
    onCustom?: AccentPick & { background: string };
  };
  meta: PaletteMeta;
}

export interface ApiError {
  error: string;
  message?: string;
}
