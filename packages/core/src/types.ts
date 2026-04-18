/**
 * Public types for @paleta/core.
 *
 * Keep this file dependency-free. Runtime code lives elsewhere.
 */

export type RGB = readonly [number, number, number];
export type OKLCH = readonly [L: number, C: number, H: number];

export type ImageFormat = "jpeg" | "png" | "webp" | "avif";

/** Any byte source we can accept as input. */
export type ImageInput =
  | ArrayBuffer
  | Uint8Array
  | ReadableStream<Uint8Array>
  | Response
  | URL
  | string;

export interface DecodedImage {
  data: Uint8Array; // RGBA
  width: number;
  height: number;
}

export type DecodeFn = (
  bytes: Uint8Array,
  options?: Record<string, unknown>,
) => Promise<DecodedImage>;

/** Map from sniffed format → decoder. Provide only the formats you want to support. */
export type DecoderMap = Partial<Record<ImageFormat, DecodeFn>>;

export type QuantizeAlgorithm = "wu" | "mmcq";

export type PipelinePath =
  | "cache-hit"
  | "exif-thumb"
  | "dc-only"
  | "full-decode"
  | "buffered";

export interface PaletteOptions {
  /** Number of colors to return. Clamped [2, 32]. Default 10. */
  colorCount?: number;
  /** Cap on samples fed into the quantizer after resize. Default 20_000. */
  maxSamples?: number;
  /** Max edge length after resize, in pixels. Default 128. */
  maxDimension?: number;
  /** Quantization algorithm. Default "wu". */
  algorithm?: QuantizeAlgorithm;
  /** Include near-white pixels in sampling. Default false. */
  includeWhite?: boolean;
  /** Alpha threshold below which pixels are discarded. Default 125. */
  alphaThreshold?: number;
  /** Map from format → decoder. If omitted, you must pass `decoder` or pre-decoded bytes. */
  decoders?: DecoderMap;
  /** Override: a single decoder used regardless of sniffed format. */
  decoder?: DecodeFn;
  /** Optional Cache API instance (e.g. caches.default) for result caching. */
  cache?: Cache;
  /**
   * Cross-colo / persistent cache. Accepts any backend with a simple
   * get/put contract: a Durable Object, a KV namespace wrapper, an R2
   * wrapper, or your own. Queried after `cache` misses. On a hit, the
   * value is promoted into `cache` for subsequent colo-local reuse.
   */
  crossColoCache?: PaletteCacheBackend;
  /** Seconds to cache the palette. Default 86400 (24h). */
  cacheTTL?: number;
  /** Abort signal for fetch + decode. */
  signal?: AbortSignal;
  /** Cache key override — defaults to `source+opts` hash. */
  cacheKey?: string;
  /**
   * Use the WASM quantizer when it's been initialized. Default: auto-detect
   * via isWasmReady(). Set false to force the pure-JS path.
   */
  useWasm?: boolean;
  /**
   * Optional JPEG thumbnail extractor. When provided and the input is JPEG,
   * the pipeline tries the extractor first; if it yields a thumbnail, that
   * thumbnail is decoded instead of the full image (much faster). Typically
   * `extractExifThumbnail` from `@paleta/exif`.
   */
  thumbnailExtractor?: (bytes: Uint8Array) => { bytes: Uint8Array } | Uint8Array | undefined;
  /**
   * Minimum thumbnail side length (pixels) below which we skip the fast path
   * and decode the full image. Only relevant when `thumbnailExtractor` is set.
   * Default 64. Set to 0 to always use the thumbnail when present.
   */
  minThumbnailDimension?: number;
}

export interface PaletteMeta {
  format: ImageFormat;
  path: PipelinePath;
  width: number;
  height: number;
  sampledPixels: number;
  decodeMs: number;
  quantizeMs: number;
  totalMs: number;
}

export interface PaletteResult {
  /** Palette sorted by perceptual dominance (OKLab population-weighted). */
  palette: RGB[];
  /** First entry of `palette` — most-present color. */
  dominant: RGB;
  /** Palette entries in OKLCH. Same order as `palette`. */
  oklch: OKLCH[];
  meta: PaletteMeta;
}

/**
 * Minimal async cache contract. Implemented by @paleta/cache-do for a
 * Durable Object SQLite backend, and easy to wrap KV/R2/Redis yourself.
 *
 * - `get(key)` resolves with a stored `PaletteResult` or `undefined` on miss.
 * - `put(key, value, ttlSeconds)` stores with a TTL. Backends that don't
 *   support TTL natively are expected to persist an expiry timestamp.
 */
export interface PaletteCacheBackend {
  get(key: string): Promise<PaletteResult | undefined>;
  put(key: string, value: PaletteResult, ttlSeconds: number): Promise<void>;
}

export class PaletteError extends Error {
  readonly code:
    | "UNSUPPORTED_FORMAT"
    | "NO_DECODER"
    | "DECODE_FAILED"
    | "FETCH_FAILED"
    | "INVALID_INPUT"
    | "ABORTED";
  constructor(code: PaletteError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = "PaletteError";
  }
}
