# paleta — live demo

A visual playground for [paleta](https://github.com/Kenth06/paleta), served
from a single Cloudflare Worker.

- **Frontend:** Vite + React 19 + TypeScript + Tailwind v4 + Kumo
- **Backend:** one Worker that also hosts the SPA via the `[assets]` binding
- **Pipeline:** `@ken0106/core` + `@ken0106/jsquash` with `useDcOnlyJpeg: true`

What the page shows:

- Big dominant color card with HEX, RGB, and OKLCH values.
- Full palette as click-to-copy swatches, sorted by perceptual OKLab dominance.
- Accent playground — WCAG-best palette entry for any background.
- Pipeline panel — which fast path (`dc-only`, `cache-hit`, `exif-thumb`,
  `full-decode`) fired, plus decode / quantize / total timings.
- A tiny mock UI that re-tints itself from the extracted palette.

## Run locally

```sh
# from repo root
pnpm install
pnpm -r --filter=./packages/* build   # make sure dist/ + wasm/ are fresh
pnpm -C examples/demo dev              # vite (5173) + wrangler dev (8787) in parallel
```

Open <http://localhost:5173>. Vite proxies `/api/*` to the Wrangler dev
Worker on `:8787`.

## Deploy

```sh
pnpm -C examples/demo deploy
```

This runs `vite build` (outputs `dist/`) and then `wrangler deploy`, which
uploads the Worker and the built assets together. You'll need:

- A Cloudflare account logged in via `wrangler login`.
- The Worker's name is `paleta-demo` — change it in `wrangler.jsonc` if
  you want a different subdomain.

## Optional: cross-colo Durable Object cache

Uncomment the marked blocks in `wrangler.jsonc` and re-export the DO class
at the top of `src/worker.ts`:

```ts
export { PaletaCacheDO } from "@ken0106/cache-do";
```

Then `pnpm -C examples/demo deploy`. Repeat requests for the same image
URL — from any colo — return in ~1 ms.

## API surface

One endpoint:

```
GET /api/palette?url=<image>&count=<n>&bg=<#hex>
```

Returns the standard paleta result enriched with:

- `palette[].oklch` — CSS OKLCH string per swatch.
- `accents.onBlack` / `accents.onWhite` — pre-computed WCAG picks for the
  two most common backgrounds, including contrast ratio and tier.
- `accents.onCustom` — same, for a user-supplied `bg=` query param.
- `meta.path` — which fast path fired (`dc-only`, `cache-hit`, `exif-thumb`,
  `full-decode`).

`ALLOWED_HOSTS` is a comma-separated allowlist (see `wrangler.jsonc`). It
defaults to Unsplash + a few common CDNs to keep the deployed demo from
getting abused. Open it up at your own risk.

## Architecture

```
Browser ──fetch /api/palette── Worker ──── getPalette() ─── caches.default
   │                              │                     │
   │                              ▼                     └── (opt) PaletaCacheDO
   │                    @ken0106/core pipeline
   │                    + @ken0106/jsquash decoders
   │                    + DC-only JPEG Rust WASM
   │
   └──── static SPA served by [assets] binding (no Worker invocation)
```

Non-API requests never invoke the Worker (`run_worker_first: ["/api/*"]`),
so the free-tier invocation budget is spent on palette extraction, not
on serving `index.html`.
