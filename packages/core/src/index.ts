/**
 * @ken0106/core — pure-TS kernel.
 *
 * Pipelines image bytes into a perceptually-sorted color palette.
 * Bring your own decoder (e.g. from @ken0106/jsquash).
 */

export { getPalette, getColor } from "./pipeline.js";
export { decodeJpegDcOnly } from "./decode/jpeg_dc.js";
export { pickAccent, type AccentOptions, type AccentResult } from "./accent.js";
export { sniffFormat, sniffFormatFromResponse } from "./sniff.js";
export {
  rgbToOKLab,
  oklabToRgb,
  rgbToOKLCH,
  oklabToOKLCH,
  contrastRatio,
  deltaE_OK,
  relativeLuminance,
  type OKLabTriple,
} from "./oklab.js";
export {
  quantizeWu,
  buildHistogram,
  initWasm,
  initWasmSync,
  isWasmReady,
  quantizeWuWasm,
  wasmVersion,
  WasmNotInitializedError,
  type HistogramResult,
  type WuResult,
  type WasmQuantizeOptions,
} from "./quantize/index.js";
export { resizeNearestRGBA } from "./resize.js";
export { hashKey } from "./cache.js";
export {
  PaletteError,
  type DecodedImage,
  type DecodeFn,
  type DecoderMap,
  type ImageFormat,
  type ImageInput,
  type OKLCH,
  type PaletteCacheBackend,
  type PaletteMeta,
  type PaletteOptions,
  type PaletteResult,
  type PipelinePath,
  type QuantizeAlgorithm,
  type RGB,
} from "./types.js";
