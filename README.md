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
pnpm add @paleta/core @paleta/jsquash
# optional peers:
pnpm add @jsquash/jpeg @jsquash/png @jsquash/webp @jsquash/avif
```

## Quick start

### On a Cloudflare Worker

```ts
import { getPalette, initWasm } from "@paleta/core";
import { autoDecoders } from "@paleta/jsquash";
// wrangler.jsonc: [[rules]] type = "CompiledWasm", globs = ["**/*.wasm"]
import paletaWasm from "@paleta/core/wasm";

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
import { getPalette, initWasm } from "@paleta/core";
import { autoDecoders } from "@paleta/jsquash";
import { readFile } from "node:fs/promises";

await initWasm(await readFile(
  new URL("@paleta/core/wasm", import.meta.url),
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
| `@paleta/core` | Pure-TS kernel: types, sniffer, Wu quantizer, OKLab, cache pipeline |
| `@paleta/jsquash` | jSquash adapters (JPEG/PNG/WebP/AVIF) with lazy WASM init |
| `@paleta/exif` | EXIF APP1 thumbnail extractor (fast path for JPEG) |
| `@paleta/worker` | Deployable `/palette?url=...` Worker |
| `paleta-core` (Rust) | v0.2 SIMD-accelerated WASM quantizer — scaffold only |

## Roadmap

- [x] v0.1 — TS kernel, jSquash adapters, deployable Worker
- [x] v0.2 — Rust+SIMD WASM quantizer (3.38× faster on 128×128, 7.7× p99)
- [~] v0.3 — **EXIF thumbnail fast path ✅** + JPEG DC-only decoder (pending)
- [ ] v0.4 — Durable Object cross-colo palette cache
- [ ] v0.5 — Containers tier for HEIC/TIFF
- [ ] v1.0 — stable

## License

MIT © Kenneth Rios
