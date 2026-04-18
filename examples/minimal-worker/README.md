# paleta-minimal-worker

Deployable Cloudflare Worker that exposes `/palette?url=<image-url>`.

## Endpoints

- `GET /` — health check
- `GET /palette?url=<image-url>&count=<2..32>&bg=<#hex>` — palette JSON

When `bg` is provided, the response includes an `accent` block with the palette
entry that has the best WCAG contrast against that background.

## Config

- `ALLOWED_HOSTS` (env var, optional) — comma-separated allowlist, e.g.
  `cdn.example.com,*.imgix.net`. When unset, any host is allowed.
- `PALETA_CACHE` (Durable Object binding, optional) — cross-colo SQLite
  palette cache. When bound, warm requests from any colo hit the cache;
  unbound, only the originating colo hits. Free-tier compatible.

## Deploy

```sh
pnpm install
pnpm deploy
```

## Notes

- Palettes are cached in `caches.default` keyed by the source URL + ETag +
  options hash, so repeat calls cost ~1ms per colo.
- When `PALETA_CACHE` is bound, cross-colo requests also hit the shared
  Durable Object cache (SQLite-backed). This is free-tier compatible and
  meaningfully reduces p95 for global traffic.
- Smart Placement is enabled so the Worker runs close to the origin image
  server once traffic patterns are observed.
- `nodejs_compat` is on purely to satisfy jSquash's rare `Buffer` usage
  during init; the Worker is otherwise standards-only.
