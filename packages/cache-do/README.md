# @paleta/cache-do

> Durable Object SQLite cache backend for
> [@paleta/core](https://www.npmjs.com/package/@paleta/core).
> Cross-colo palette cache, free-tier compatible, ~2.7 KB of wrapper
> code on top of the DO runtime.

```sh
npm install @paleta/core @paleta/cache-do
```

## Why

`caches.default` is colo-local — a request that decodes an image in
Ashburn doesn't benefit users hitting the same URL from Frankfurt. A
Durable Object with SQLite storage gives you one globally-consistent
cache for ~free (SQLite DOs are on the Workers Free plan).

Paleta JSON is tiny (~300 bytes per entry), so a single 10 GB DO fits
~35M distinct palettes before you need to shard.

## Setup

`wrangler.jsonc`:

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "PALETA_CACHE", "class_name": "PaletaCacheDO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["PaletaCacheDO"] }
  ]
}
```

Worker entrypoint — re-export the class so wrangler can instantiate it:

```ts
import { paletaDurableCache } from "@paleta/cache-do";
export { PaletaCacheDO } from "@paleta/cache-do";

export default {
  async fetch(req, env) {
    const result = await getPalette(url, {
      cache: caches.default,                          // colo-local tier
      crossColoCache: paletaDurableCache(env.PALETA_CACHE),  // cross-colo tier
      // …
    });
    return Response.json(result);
  },
};
```

## How the tiers interact

1. `caches.default` hit → instant (~1 ms).
2. Miss → DO cross-colo lookup (~15–30 ms, globally consistent).
3. DO hit → value promoted into `caches.default` so neighboring
   requests in the same colo hit tier 1 next time.
4. Miss → run the pipeline, write both tiers.
5. DO writes are fire-and-forget — a slow DO never blocks the response.

## Sharding

For workloads that exceed a single DO's 10 GB limit:

```ts
paletaDurableCache(env.PALETA_CACHE, (key) => `shard-${key[0]}`);
```

The hash-shard function is called per key and must be deterministic.

## Expiry

`PaletaCacheDO` self-manages expired entries via a `storage.setAlarm` that
fires at the next-earliest TTL and sweeps the SQLite table.

## License

MIT
