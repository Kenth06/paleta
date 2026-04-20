import { bench, describe } from "vitest";
import { buildHistogram, quantizeWu } from "@ken0106/core";

function noisyRGBA(w: number, h: number, seed = 42): Uint8Array {
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

describe("histogram + Wu on 128x128 noise", () => {
  const data = noisyRGBA(128, 128);
  bench("buildHistogram", () => {
    buildHistogram(data, 128, 128, { alphaThreshold: 125, includeWhite: false, step: 1 });
  });

  const hist = buildHistogram(data, 128, 128, {
    alphaThreshold: 125,
    includeWhite: false,
    step: 1,
  });
  bench("quantizeWu(10)", () => {
    quantizeWu(hist, 10);
  });
  bench("quantizeWu(16)", () => {
    quantizeWu(hist, 16);
  });
});

describe("histogram + Wu on 1024x1024 noise", () => {
  const data = noisyRGBA(1024, 1024);
  bench("buildHistogram(step=1)", () => {
    buildHistogram(data, 1024, 1024, { alphaThreshold: 125, includeWhite: false, step: 1 });
  });
  bench("buildHistogram(step=50)", () => {
    buildHistogram(data, 1024, 1024, { alphaThreshold: 125, includeWhite: false, step: 50 });
  });
});
