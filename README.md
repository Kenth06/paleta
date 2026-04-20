# paleta

> Steal palettes from images at the edge.

Fast, open-source color palette extraction for Cloudflare Workers (and any modern JS runtime). Zero-dependency core, WASM decoders on demand, edge-cached results, perceptually-sorted palettes in OKLab.

**Status: pre-alpha (v0.1 kernel in active development).**

## Why paleta

- **Works on free Cloudflare Workers** — no paid Images, no paid bindings required.
- **Tiny default bundle** — decoders are optional peers; JPEG-only users ship ~200KB.
- **Correct** — fixes the broken AVIF/WebP sniffers found in older alternatives.
- **Perceptual** — palettes sorted by OKLab dominance, not naive RGB population.
- **Edge-native** — built-in `caches.default` integration, optional Durable Object cache.
- **Accessibility-aware** — `getAccent(image, background)` picks the best WCAG-contrast color for you.

## Install (once published)

```sh
pnpm add @ken0106/core @ken0106/jsquash
# optional peers:
pnpm add @jsquash/jpeg @jsquash/png @jsquash/webp @jsquash/avif
```

## Quick start

### On a Cloudflare Worker

```ts
import { getPalette, initWasm } from "@ken0106/core";
import { autoDecoders } from "@ken0106/jsquash";
// wrangler.jsonc: [[rules]] type = "CompiledWasm", globs = ["**/*.wasm"]
import paletaWasm from "@ken0106/core/wasm";

let ready: Promise<void> | undefined;
const ensureWasm = () => (ready ??= initWasm(paletaWasm as WebAssembly.Module));

export default {
  async fetch(req: Request) {
    await ensureWasm();
    const url = new URL(req.url).searchParams.get("url")!;
    const result = await getPalette(url, {
      decoders: autoDecoders(),
      cache: caches.default,
      colorCount: 8,
    });
    return Response.json(result);
  },
};
```

### On Node / Bun / browsers

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
console.log(result.meta.path); // "cache-hit" | "exif-thumb" | "full-decode"
```

### Without WASM (pure TypeScript)

Skip `initWasm()` entirely. The pipeline falls back to a pure-JS Wu quantizer.
Slower but portable to any runtime; also avoids the 27KB WASM payload.

## Packages

| Package | Purpose |
|---|---|
| `@ken0106/core` | Pure-TS kernel: types, sniffer, Wu quantizer, OKLab, cache pipeline |
| `@ken0106/jsquash` | jSquash adapters (JPEG/PNG/WebP/AVIF) with lazy WASM init |
| `@ken0106/exif` | EXIF APP1 thumbnail extractor (fast path for JPEG) |
| `@ken0106/cache-do` | Durable Object SQLite cross-colo cache backend |
| `paleta-core` (Rust) | SIMD-accelerated WASM Wu quantizer (`@ken0106/core/wasm`) |

## Examples

| Example | Shows |
|---|---|
| `examples/minimal-worker` | `/palette?url=…` endpoint, WASM, caches.default, optional DO |
| `examples/rpc-service` | Worker-to-Worker via Service Bindings (zero-overhead RPC) |

## Roadmap

- [x] v0.1 — TS kernel, jSquash adapters, deployable Worker
- [x] v0.2 — Rust+SIMD WASM quantizer (2.9× mean, ~10× p99 on 128×128)
- [x] v0.3 — EXIF thumbnail fast path + JPEG DC-only decoder (4–12× faster than mozjpeg on real JPEGs; full baseline/progressive/grayscale/CMYK/4:2:2/4:2:0 coverage)
- [x] v0.4 — Durable Object cross-colo palette cache (`@ken0106/cache-do`)
- [ ] v0.5 — Containers tier for HEIC/TIFF
- [ ] v1.0 — stable

## License

MIT © Kenneth Rios
