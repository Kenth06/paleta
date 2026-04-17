/**
 * Quantization entry point. v0.1 ships Wu only.
 * v0.1+ will add MMCQ for colorthief parity, and optionally a k-means refiner.
 */

export {
  buildHistogram,
  HIST_BITS,
  HIST_SIDE,
  HIST_SIZE,
  packRGB,
  type BuildHistogramOptions,
  type HistogramResult,
} from "./histogram.js";

export { quantizeWu, type WuResult } from "./wu.js";

export {
  initWasm,
  initWasmSync,
  isWasmReady,
  quantizeWuWasm,
  wasmVersion,
  WasmNotInitializedError,
  type WasmQuantizeOptions,
} from "./wasm.js";
