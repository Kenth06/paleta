# paleta-rpc-service example

Two Workers:

- **`paleta-service`** — deploys the full paleta pipeline with WASM, the
  default Cache API layer, and a Durable Object cross-colo cache.
- **`paleta-consumer`** — a thin Worker that binds `paleta-service` as a
  Service Binding and calls its RPC methods directly.

Why this pattern:

- **Zero network cost.** Service Bindings run on the same thread, so there's
  no TCP, TLS, or HTTP serialization between caller and service.
- **One billed request.** The caller's invocation counts; the service's
  method call does not.
- **Single source of truth.** Update `paleta-service` once — every consumer
  picks up the new version on next deploy.

## RPC surface

```ts
await env.PALETA.palette(url, opts?)   // full PaletteResult
await env.PALETA.dominant(url)         // RGB
await env.PALETA.accent(url, bg, min?) // { palette, dominant, accent, contrast }
await env.PALETA.healthz()             // { ok, wasm }
```

## Deploy

```sh
pnpm install
pnpm deploy              # paleta-service
pnpm deploy:consumer     # paleta-consumer
```

## Local dev

In two terminals:

```sh
pnpm dev            # terminal 1 — paleta-service on :8787
pnpm dev:consumer   # terminal 2 — paleta-consumer on :8788
```

Then: `curl 'http://127.0.0.1:8788/?url=https://…&bg=%23ffffff'`
