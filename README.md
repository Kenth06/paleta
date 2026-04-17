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

```ts
import { getPalette } from "@paleta/core";
import { autoDecoders } from "@paleta/jsquash";

const result = await getPalette("https://example.com/cat.jpg", {
  decoders: autoDecoders(),
  colorCount: 8,
});

console.log(result.palette);   // [[r,g,b], ...] sorted by perceptual dominance
console.log(result.dominant);  // most-present color
console.log(result.meta.path); // "exif-thumb" | "full-decode" | "cache-hit"
```

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
- [ ] v0.3 — EXIF thumbnail fast path + JPEG DC-only decoder
- [ ] v0.4 — Durable Object cross-colo palette cache
- [ ] v0.5 — Containers tier for HEIC/TIFF
- [ ] v1.0 — stable

## License

MIT © Kenneth Rios
