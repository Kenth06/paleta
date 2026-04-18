import { describe, expect, it, vi } from "vitest";
import {
  getPalette,
  type DecodeFn,
  type DecodedImage,
  type PaletteCacheBackend,
  type PaletteResult,
} from "@paleta/core";
import { paletaDurableCache } from "@paleta/cache-do";

function jpegLikeBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00]);
}

function solidDecoder(r: number, g: number, b: number): DecodeFn {
  return async (): Promise<DecodedImage> => {
    const data = new Uint8Array(16 * 16 * 4);
    for (let i = 0; i < 16 * 16; i++) {
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
    return { data, width: 16, height: 16 };
  };
}

/** In-memory cache backend — exercises the PaletteCacheBackend contract. */
function memoryBackend(): PaletteCacheBackend & { store: Map<string, PaletteResult> } {
  const store = new Map<string, PaletteResult>();
  return {
    store,
    async get(key) {
      return store.get(key);
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

describe("pipeline: crossColoCache integration", () => {
  it("writes to the cross-colo cache on miss", async () => {
    const backend = memoryBackend();
    const decoder = solidDecoder(10, 20, 30);
    // URL required so we produce a deterministic cache key.
    const mockFetch = vi.fn(async () => new Response(jpegLikeBytes()));
    vi.stubGlobal("fetch", mockFetch);

    const url = "https://example.test/first.jpg";
    const result = await getPalette(url, {
      decoder,
      crossColoCache: backend,
      colorCount: 4,
    });
    expect(result.meta.path).toBe("full-decode");
    // put() is fire-and-forget; flush the microtask queue.
    await Promise.resolve();
    expect(backend.store.size).toBe(1);
    vi.unstubAllGlobals();
  });

  it("returns cache-hit when cross-colo has the key", async () => {
    const backend = memoryBackend();
    const seeded: PaletteResult = {
      palette: [[1, 2, 3]],
      dominant: [1, 2, 3],
      oklch: [[0, 0, 0]],
      meta: {
        format: "jpeg",
        path: "full-decode",
        width: 1,
        height: 1,
        sampledPixels: 1,
        decodeMs: 0,
        quantizeMs: 0,
        totalMs: 0,
      },
    };
    // Pre-seed with the key the pipeline will generate. Easiest way is to
    // run once then read what was put.
    const url = "https://example.test/second.jpg";
    const mockFetch = vi.fn(async () => new Response(jpegLikeBytes()));
    vi.stubGlobal("fetch", mockFetch);
    await getPalette(url, {
      decoder: solidDecoder(50, 60, 70),
      crossColoCache: backend,
      colorCount: 4,
    });
    await Promise.resolve();
    const [seededKey] = [...backend.store.keys()];
    backend.store.set(seededKey!, seeded);

    const result = await getPalette(url, {
      decoder: solidDecoder(50, 60, 70),
      crossColoCache: backend,
      colorCount: 4,
    });
    expect(result.meta.path).toBe("cache-hit");
    expect(result.dominant).toEqual([1, 2, 3]);
    vi.unstubAllGlobals();
  });
});

describe("paletaDurableCache adapter", () => {
  it("routes get/put to the DO namespace", async () => {
    const cacheGet = vi.fn(async () => undefined);
    const cachePut = vi.fn(async () => undefined);
    const stub = { cacheGet, cachePut };
    const id = { toString: () => "id-1" } as DurableObjectId;
    const namespace = {
      idFromName: vi.fn(() => id),
      get: vi.fn(() => stub),
    };

    const backend = paletaDurableCache(namespace as never);
    const sample: PaletteResult = {
      palette: [[0, 0, 0]],
      dominant: [0, 0, 0],
      oklch: [[0, 0, 0]],
      meta: {
        format: "jpeg",
        path: "full-decode",
        width: 1, height: 1, sampledPixels: 1, decodeMs: 0, quantizeMs: 0, totalMs: 0,
      },
    };

    await backend.put("abc", sample, 120);
    expect(namespace.idFromName).toHaveBeenCalledWith("default");
    expect(cachePut).toHaveBeenCalledWith("abc", sample, 120);

    await backend.get("abc");
    expect(cacheGet).toHaveBeenCalledWith("abc");
  });

  it("honors a sharding function", async () => {
    const stub = {
      cacheGet: vi.fn(async () => undefined),
      cachePut: vi.fn(async () => undefined),
    };
    const idFromName = vi.fn(() => ({}) as DurableObjectId);
    const namespace = { idFromName, get: vi.fn(() => stub) };

    const backend = paletaDurableCache(namespace as never, (key) => `shard-${key[0]}`);
    await backend.get("abc");
    expect(idFromName).toHaveBeenCalledWith("shard-a");
  });
});
