# @paleta/jsquash

> [jSquash](https://github.com/jamsinclair/jSquash) decoder adapters for
> [@paleta/core](https://www.npmjs.com/package/@paleta/core). Lazy WASM
> loading per format, optional peer dependencies, ~900 bytes of adapter
> code per codec on top of jSquash's native WASM.

```sh
npm install @paleta/core @paleta/jsquash
# + the codecs you actually need:
npm install @jsquash/jpeg @jsquash/png @jsquash/webp @jsquash/avif
```

## Why optional peers

JPEG-only consumers shouldn't ship 1.3 MB of PNG/WebP/AVIF WASM. The
jSquash codecs are declared as `peerDependenciesMeta: optional` so your
bundler only bundles the ones you install.

## Quick start

```ts
import { getPalette } from "@paleta/core";
import { autoDecoders, decodeJPEG } from "@paleta/jsquash";

// All four formats — WASM loads lazily on first use:
await getPalette(url, { decoders: autoDecoders() });

// Just JPEG — minimal bundle:
await getPalette(url, { decoders: { jpeg: decodeJPEG } });
```

## Named imports (tree-shakeable)

```ts
import { decodeJPEG } from "@paleta/jsquash/jpeg";
import { decodePNG }  from "@paleta/jsquash/png";
import { decodeWebP } from "@paleta/jsquash/webp";
import { decodeAVIF } from "@paleta/jsquash/avif";
```

Each entry triggers its own jSquash WASM fetch on first call and memoizes
the module for subsequent calls.

## On Cloudflare Workers

Workers needs WASM modules to be imported with the `CompiledWasm` rule
rather than fetched. See the example in the
[paleta repo](https://github.com/Kenth06/paleta/tree/main/examples/minimal-worker).

## License

MIT
