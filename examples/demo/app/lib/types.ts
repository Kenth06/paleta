export type RGB = readonly [number, number, number];

export interface Swatch {
  rgb: RGB;
  hex: string;
  oklch: string;
}

export interface PaletteResponse {
  palette: Swatch[];
  dominant: Swatch;
}

export interface ApiError {
  error: string;
  message?: string;
}
