# @paleta/core

> The pure-TS kernel for [paleta](https://github.com/Kenth06/paleta) —
> correct image-format sniffing, Wu color quantization, OKLab color math,
> and an edge-ready palette-extraction pipeline. Bring your own decoder.

```sh
npm install @paleta/core
```

## Status

**pre-alpha** — APIs may break before `v1.0.0`. Pin the version you test against.

## Quick start

```ts
import { getPalette, initWasm } from "@paleta/core";
import { readFile } from "node:fs/promises";

// Rust WASM quantizer (optional — pure-JS fallback runs without it).
await initWasm(await readFile(
  new URL("@paleta/core/wasm", import.meta.url),
));

const result = await getPalette(bytes, {
  decoder: myDecoder,   // ArrayBuffer → { data: RGBA, width, height }
  colorCount: 8,
});

result.palette;    // [[r, g, b], …]  sorted by perceptual dominance
result.dominant;   // [r, g, b]
result.oklch;      // [[L, C, H], …]  OKLCH for each palette entry
result.meta.path;  // "full-decode" | "exif-thumb" | "dc-only" | "cache-hit"
```

On a Cloudflare Worker, use the `CompiledWasm` rule and pass the module
directly to `initWasm`:

```ts
// wrangler.jsonc: [[rules]] type = "CompiledWasm", globs = ["**/*.wasm"]
import paletaWasm from "<relative path to>/paleta_core_bg.wasm";
await initWasm(paletaWasm as WebAssembly.Module);
```

## What's in the box

| Export | Purpose |
|---|---|
| `getPalette(source, opts)` | Pipeline: sniff → cache → decode → resize → quantize → sort |
| `getColor(source, opts)` | Convenience — returns the dominant color only |
| `pickAccent(palette, bg, opts)` | WCAG-aware accent picker (`"#hex"` or `[r,g,b]`) |
| `decodeJpegDcOnly(bytes)` | Experimental: 4–12× faster JPEG decode via DC coefficients |
| `sniffFormat(bytes)` | Correct magic-byte detection for PNG / JPEG / WebP / AVIF |
| `quantizeWu(hist, n)` | Wu quantizer over a 5-bit RGB histogram |
| `initWasm(source)` | Load the SIMD-accelerated Rust quantizer (optional) |
| `rgbToOKLab`, `contrastRatio`, … | OKLab / OKLCH / WCAG color math |

Full API: the TypeScript `.d.ts` files under `dist/`.

## Decoders

`@paleta/core` is decoder-agnostic. You pass a `DecodeFn` for each format
you support. The companion package
[`@paleta/jsquash`](https://www.npmjs.com/package/@paleta/jsquash) provides
jSquash-backed decoders for JPEG/PNG/WebP/AVIF:

```ts
import { autoDecoders } from "@paleta/jsquash";
await getPalette(url, { decoders: autoDecoders(), … });
```

## Why

Full writeup, benchmarks, and examples at
[github.com/Kenth06/paleta](https://github.com/Kenth06/paleta).

## License

MIT
