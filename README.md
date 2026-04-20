# paleta

> Steal palettes from images at the edge.

[![@ken0106/core on npm](https://img.shields.io/npm/v/@ken0106/core?label=%40ken0106%2Fcore&color=cb3837)](https://www.npmjs.com/package/@ken0106/core)
[![@ken0106/jsquash on npm](https://img.shields.io/npm/v/@ken0106/jsquash?label=%40ken0106%2Fjsquash&color=cb3837)](https://www.npmjs.com/package/@ken0106/jsquash)
[![@ken0106/exif on npm](https://img.shields.io/npm/v/@ken0106/exif?label=%40ken0106%2Fexif&color=cb3837)](https://www.npmjs.com/package/@ken0106/exif)
[![@ken0106/cache-do on npm](https://img.shields.io/npm/v/@ken0106/cache-do?label=%40ken0106%2Fcache-do&color=cb3837)](https://www.npmjs.com/package/@ken0106/cache-do)
[![CI](https://github.com/Kenth06/paleta/actions/workflows/ci.yml/badge.svg)](https://github.com/Kenth06/paleta/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Fast, open-source color-palette extraction for Cloudflare Workers (and any
modern JS runtime). Zero-dependency core, WASM decoders on demand,
edge-cached results, perceptually-sorted palettes in OKLab.

**Status: `0.1.0-alpha.0`** — pre-alpha, APIs may break before `v1.0.0`.

## Highlights

- **Works on free Cloudflare Workers.** No paid Images binding, no paid Durable Objects.
- **4–12× faster JPEG decoding** than `@jsquash/jpeg` (mozjpeg) via a custom DC-only Rust decoder.
- **Tiny default bundle.** JPEG-only users ship ~200 KB; decoders are optional peers.
- **Correct.** Fixes the broken AVIF/WebP sniffers present in older alternatives.
- **Perceptual.** Palettes sorted by OKLab dominance, not naive RGB population.
- **Edge-native.** Built-in `caches.default` integration, optional Durable Object cross-colo cache.
- **Accessibility-aware.** `pickAccent(palette, background)` returns the WCAG-best entry.

## Install

```sh
npm install @ken0106/core @ken0106/jsquash
# Pick only the codecs you need (optional peers):
npm install @jsquash/jpeg @jsquash/png @jsquash/webp @jsquash/avif
# Optional tiers:
npm install @ken0106/exif        # EXIF thumbnail fast path
npm install @ken0106/cache-do    # Durable Object cross-colo cache
```

## Quick start

### Cloudflare Worker (recommended)

```ts
import { getPalette, initWasm } from "@ken0106/core";
import { autoDecoders } from "@ken0106/jsquash";
// wrangler.jsonc: [[rules]] type = "CompiledWasm", globs = ["**/*.wasm"]
import paletaWasm from "<relative-path>/@ken0106/core/wasm/paleta_core_bg.wasm";

let ready: Promise<void> | undefined;
const ensureWasm = () => (ready ??= initWasm(paletaWasm as WebAssembly.Module));

export default {
  async fetch(req: Request) {
    await ensureWasm();
    const url = new URL(req.url).searchParams.get("url")!;
    const result = await getPalette(url, {
      decoders: autoDecoders(),
      cache: caches.default,
      useDcOnlyJpeg: true,   // 4–12× faster on JPEGs
      colorCount: 8,
    });
    return Response.json(result);
  },
};
```

### Node / Bun / browsers

```ts
import { getPalette, initWasm } from "@ken0106/core";
import { autoDecoders } from "@ken0106/jsquash";
import { readFile } from "node:fs/promises";

await initWasm(await readFile(
  new URL("@ken0106/core/wasm", import.meta.url),
));

const result = await getPalette("https://example.com/cat.jpg", {
  decoders: autoDecoders(),
  colorCount: 8,
});

console.log(result.palette);   // [[r,g,b], ...] sorted by perceptual dominance
console.log(result.dominant);  // most-present color
console.log(result.meta.path); // "cache-hit" | "exif-thumb" | "dc-only" | "full-decode"
```

### Without WASM (pure TypeScript)

Skip `initWasm()` entirely. The pipeline falls back to a pure-JS Wu quantizer.
Slower but portable to any runtime; also avoids the 60 KB WASM payload.

## Packages

| Package | Size | Purpose |
|---|---|---|
| [`@ken0106/core`](https://www.npmjs.com/package/@ken0106/core) | 85 KB | Pure-TS kernel: types, sniffer, Wu quantizer, OKLab, cache pipeline, WASM artifact |
| [`@ken0106/jsquash`](https://www.npmjs.com/package/@ken0106/jsquash) | 4.7 KB | jSquash adapters (JPEG/PNG/WebP/AVIF), lazy WASM init, optional peer deps |
| [`@ken0106/exif`](https://www.npmjs.com/package/@ken0106/exif) | 5.3 KB | EXIF APP1 thumbnail extractor (fast path for JPEG) |
| [`@ken0106/cache-do`](https://www.npmjs.com/package/@ken0106/cache-do) | 5.6 KB | Durable Object SQLite cross-colo cache backend |
| `paleta-core` (Rust crate) | 59 KB WASM | SIMD-accelerated Wu quantizer + JPEG DC-only decoder |

## Examples

| Example | Shows |
|---|---|
| [`examples/demo`](./examples/demo) | Starter template — Vite + React SPA + Worker. [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Kenth06/paleta/tree/main/examples/demo) |
| [`examples/minimal-worker`](./examples/minimal-worker) | `/palette?url=…` endpoint, WASM, caches.default, optional DO, `/bench` |
| [`examples/rpc-service`](./examples/rpc-service) | Worker-to-Worker via Service Bindings (zero-overhead RPC) |

## Performance

Numbers from a real Cloudflare `workerd` isolate (`wrangler 4.83.0`),
end-to-end `getPalette()` on a 640×480 4:2:0 JPEG, 300 iters:

| Path             | mean   | p99   | throughput |
| ---------------- | ------ | ----- | ---------- |
| DC-only          | 0.73ms | 2ms   | ~1,370 rps |
| full-decode      | 2.54ms | 6ms   | ~394 rps   |

Raw decoder head-to-head vs `@jsquash/jpeg` (mozjpeg):

| Fixture                       | paleta DC-only | jSquash full | Δ         |
| ----------------------------- | -------------- | ------------ | --------- |
| 64×64 baseline 4:4:4          | **0.006 ms**   | 0.036 ms     | **5.9×**  |
| 128×128 4:2:0                 | **0.009 ms**   | 0.119 ms     | **12.3×** |
| 640×480 scene 4:4:4           | **0.55 ms**    | 2.33 ms      | **4.2×**  |
| 640×480 scene 4:2:0           | **0.33 ms**    | 2.19 ms      | **6.7×**  |
| 1280×720 scene 4:2:0          | **0.78 ms**    | 6.27 ms      | **8.1×**  |

Full bench log: [`bench/results/`](./bench/results/).

## JPEG format coverage

| Variant                                   | Supported |
|-------------------------------------------|-----------|
| Baseline sequential, YCbCr 4:4:4/4:2:2/4:4:0/4:2:0 | ✅ |
| Grayscale (1-component)                   | ✅ |
| CMYK / YCCK (4-component, Adobe APP14)    | ✅ |
| Progressive — interleaved DC scan         | ✅ |
| Progressive — non-interleaved DC scans    | ✅ |
| DRI restart markers, byte-stuffing        | ✅ |
| SOF3 lossless                             | ❌ refused cleanly |
| SOF5–SOF15 hierarchical                   | ❌ refused cleanly |
| Arithmetic coding (DAC)                   | ❌ refused cleanly |

300,072 byte-flip mutations across every fixture, **zero panics**.

## Roadmap

- [x] v0.1 — TS kernel, jSquash adapters, deployable Worker — **published**
- [x] v0.2 — Rust+SIMD WASM quantizer (2.9× mean, ~10× p99 on 128×128)
- [x] v0.3 — EXIF thumbnail fast path + JPEG DC-only decoder
- [x] v0.4 — Durable Object cross-colo palette cache (`@ken0106/cache-do`)
- [ ] v0.5 — Containers tier for HEIC / TIFF / RAW
- [ ] v1.0 — stable

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Short version: `pnpm install`,
`pnpm test`, send a PR against `main`.

## License

MIT © [Kenneth Rios](https://github.com/Kenth06)
