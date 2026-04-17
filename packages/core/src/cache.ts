/**
 * Cache API integration. Palettes are deterministic functions of (input bytes,
 * options), so caching at the edge is trivially correct.
 *
 * We use a synthetic URL (`https://paleta.cache/<key>`) as the Cache key so
 * callers can reuse `caches.default` without colliding with their own routes.
 */

import type { PaletteResult } from "./types.js";

const CACHE_NAMESPACE = "https://paleta.cache/";

/** FNV-1a 64-bit hash as a lowercase hex string. Cheap, no collisions in practice. */
export function hashKey(parts: string[]): string {
  let h1 = 0xcbf29ce4;
  let h2 = 0x84222325;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      const c = part.charCodeAt(i);
      h1 ^= c;
      h2 ^= c >>> 8;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = Math.imul(h2, 0x01000193) >>> 0;
    }
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function buildCacheRequest(key: string): Request {
  return new Request(CACHE_NAMESPACE + key, { method: "GET" });
}

export async function readCachedPalette(
  cache: Cache,
  key: string,
): Promise<PaletteResult | undefined> {
  const res = await cache.match(buildCacheRequest(key));
  if (!res) return undefined;
  try {
    return (await res.json()) as PaletteResult;
  } catch {
    return undefined;
  }
}

export async function writeCachedPalette(
  cache: Cache,
  key: string,
  result: PaletteResult,
  ttlSeconds: number,
): Promise<void> {
  const res = new Response(JSON.stringify(result), {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${Math.max(0, ttlSeconds | 0)}`,
    },
  });
  await cache.put(buildCacheRequest(key), res);
}
