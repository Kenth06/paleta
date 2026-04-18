import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bench, describe } from "vitest";
import {
  buildHistogram,
  initWasm,
  quantizeWu,
  quantizeWuWasm,
} from "@paleta/core";

// Dynamically import the bindgen module to call build_histogram_total,
// which isn't re-exported from @paleta/core but is useful for measuring
// the pure histogram cost.
const bindgen = (await import("../packages/core/wasm/paleta_core.js")) as unknown as {
  build_histogram_total: (
    rgba: Uint8Array, w: number, h: number, step: number, alpha: number, white: boolean,
  ) => number;
};

const WASM_PATH = fileURLToPath(
  new URL("../packages/core/wasm/paleta_core_bg.wasm", import.meta.url),
);

// vitest bench does not reliably await beforeAll before running iterations,
// so we init at module top level (ESM supports top-level await).
const wasmBytes = await readFile(WASM_PATH);
await initWasm(wasmBytes);
// Independently init the bindgen module instance used by this file's direct
// `bindgen.build_histogram_total` calls. ESM module caching means this is
// the same singleton as the one @paleta/core uses, but we call `default`
// again to be safe — a second init is a no-op in wasm-bindgen.
await (bindgen as unknown as {
  default: (input: unknown) => Promise<unknown>;
}).default({ module_or_path: wasmBytes });

function noisy(w: number, h: number, seed = 42): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  let s = seed;
  for (let i = 0; i < w * h; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i * 4] = s & 0xff;
    out[i * 4 + 1] = (s >> 8) & 0xff;
    out[i * 4 + 2] = (s >> 16) & 0xff;
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe("128x128 noise — JS vs WASM", () => {
  const data = noisy(128, 128);

  bench("JS: histogram only", () => {
    buildHistogram(data, 128, 128, {
      alphaThreshold: 125,
      includeWhite: false,
      step: 1,
    });
  });

  bench("WASM: histogram only", () => {
    bindgen.build_histogram_total(data, 128, 128, 1, 125, false);
  });

  bench("JS: histogram + quantizeWu(10)", () => {
    const hist = buildHistogram(data, 128, 128, {
      alphaThreshold: 125,
      includeWhite: false,
      step: 1,
    });
    quantizeWu(hist, 10);
  });

  bench("WASM: quantizeWuWasm(10)", () => {
    quantizeWuWasm(data, 128, 128, {
      colorCount: 10,
      step: 1,
      alphaThreshold: 125,
      includeWhite: false,
    });
  });
});

describe("1024x1024 noise, step=50 — JS vs WASM", () => {
  const data = noisy(1024, 1024);

  bench("JS: histogram(step=50) + quantizeWu(10)", () => {
    const hist = buildHistogram(data, 1024, 1024, {
      alphaThreshold: 125,
      includeWhite: false,
      step: 50,
    });
    quantizeWu(hist, 10);
  });

  bench("WASM: quantizeWuWasm(step=50, count=10)", () => {
    quantizeWuWasm(data, 1024, 1024, {
      colorCount: 10,
      step: 50,
      alphaThreshold: 125,
      includeWhite: false,
    });
  });
});
