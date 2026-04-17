/**
 * The `getPalette` pipeline.
 *
 * Order of operations:
 *   1. Normalize input → bytes (+ optional Response).
 *   2. Sniff format.
 *   3. Check Cache API (optional).
 *   4. Resolve a decoder.
 *   5. Decode → RGBA.
 *   6. Resize to ≤ maxDimension.
 *   7. Build histogram (with adaptive stride to hit maxSamples).
 *   8. Wu quantize.
 *   9. Perceptual sort + convert to OKLCH.
 *   10. Write cache.
 *   11. Return PaletteResult.
 */

import { hashKey, readCachedPalette, writeCachedPalette } from "./cache.js";
import { normalizeInput, type NormalizedInput } from "./input.js";
import { buildHistogram, quantizeWu } from "./quantize/index.js";
import { resizeNearestRGBA } from "./resize.js";
import { sniffFormat, sniffFormatFromResponse } from "./sniff.js";
import { sortPaletteByDominance } from "./sort.js";
import {
  PaletteError,
  type DecodeFn,
  type ImageFormat,
  type ImageInput,
  type PaletteOptions,
  type PaletteResult,
  type PipelinePath,
} from "./types.js";

const DEFAULTS = {
  colorCount: 10,
  maxSamples: 20_000,
  maxDimension: 128,
  alphaThreshold: 125,
  includeWhite: false,
  algorithm: "wu" as const,
  cacheTTL: 86_400,
};

function resolveDecoder(
  format: ImageFormat,
  opts: PaletteOptions,
): DecodeFn | undefined {
  if (opts.decoder) return opts.decoder;
  return opts.decoders?.[format];
}

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

async function decodeBytes(
  format: ImageFormat,
  bytes: Uint8Array,
  decoder: DecodeFn,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  try {
    return await decoder(bytes);
  } catch (err) {
    throw new PaletteError(
      "DECODE_FAILED",
      `Decoder for ${format} failed: ${(err as Error).message ?? err}`,
      { cause: err },
    );
  }
}

/**
 * Choose a histogram stride so we sample at most `maxSamples` pixels.
 * Always ≥ 1.
 */
function chooseStride(totalPixels: number, maxSamples: number): number {
  if (maxSamples <= 0) return 1;
  return Math.max(1, Math.ceil(totalPixels / maxSamples));
}

function buildCacheKeyFromOptions(
  norm: NormalizedInput,
  opts: PaletteOptions,
): string | undefined {
  if (opts.cacheKey) return opts.cacheKey;
  if (!norm.sourceUrl) return undefined;
  const etag = norm.response?.headers.get("etag") ?? "";
  const lastMod = norm.response?.headers.get("last-modified") ?? "";
  const parts = [
    norm.sourceUrl,
    etag,
    lastMod,
    String(opts.colorCount ?? DEFAULTS.colorCount),
    String(opts.maxDimension ?? DEFAULTS.maxDimension),
    String(opts.alphaThreshold ?? DEFAULTS.alphaThreshold),
    String(opts.includeWhite ?? DEFAULTS.includeWhite),
    String(opts.algorithm ?? DEFAULTS.algorithm),
  ];
  return hashKey(parts);
}

export async function getPalette(
  source: ImageInput,
  opts: PaletteOptions = {},
): Promise<PaletteResult> {
  const tStart = now();
  const norm = await normalizeInput(source, { ...(opts.signal ? { signal: opts.signal } : {}) });

  const format = norm.response
    ? sniffFormatFromResponse(norm.response, norm.bytes)
    : sniffFormat(norm.bytes);

  if (!format) {
    throw new PaletteError(
      "UNSUPPORTED_FORMAT",
      "Could not detect a supported image format (PNG/JPEG/WebP/AVIF).",
    );
  }

  const cacheKey = opts.cache ? buildCacheKeyFromOptions(norm, opts) : undefined;
  if (opts.cache && cacheKey) {
    const cached = await readCachedPalette(opts.cache, cacheKey);
    if (cached) {
      return {
        ...cached,
        meta: { ...cached.meta, path: "cache-hit" as PipelinePath, totalMs: now() - tStart },
      };
    }
  }

  const decoder = resolveDecoder(format, opts);
  if (!decoder) {
    throw new PaletteError(
      "NO_DECODER",
      `No decoder provided for ${format}. Pass one via opts.decoders or opts.decoder.`,
    );
  }

  const tDecode = now();
  const decoded = await decodeBytes(format, norm.bytes, decoder);
  const decodeMs = now() - tDecode;

  const maxDim = opts.maxDimension ?? DEFAULTS.maxDimension;
  const resized = resizeNearestRGBA(decoded, maxDim);

  const totalPixels = resized.width * resized.height;
  const step = chooseStride(totalPixels, opts.maxSamples ?? DEFAULTS.maxSamples);

  const tQuant = now();
  const hist = buildHistogram(resized.data, resized.width, resized.height, {
    alphaThreshold: opts.alphaThreshold ?? DEFAULTS.alphaThreshold,
    includeWhite: opts.includeWhite ?? DEFAULTS.includeWhite,
    step,
  });
  const { palette: rawPalette, populations } = quantizeWu(
    hist,
    opts.colorCount ?? DEFAULTS.colorCount,
  );
  const sorted = sortPaletteByDominance(rawPalette, populations);
  const quantizeMs = now() - tQuant;

  const result: PaletteResult = {
    palette: sorted.palette,
    dominant: sorted.palette[0] ?? [0, 0, 0],
    oklch: sorted.oklch,
    meta: {
      format,
      path: "full-decode",
      width: decoded.width,
      height: decoded.height,
      sampledPixels: hist.total,
      decodeMs,
      quantizeMs,
      totalMs: now() - tStart,
    },
  };

  if (opts.cache && cacheKey) {
    await writeCachedPalette(
      opts.cache,
      cacheKey,
      result,
      opts.cacheTTL ?? DEFAULTS.cacheTTL,
    );
  }

  return result;
}

export async function getColor(
  source: ImageInput,
  opts: PaletteOptions = {},
): Promise<[number, number, number]> {
  const res = await getPalette(source, { ...opts, colorCount: Math.max(5, opts.colorCount ?? 5) });
  const [r, g, b] = res.dominant;
  return [r, g, b];
}
