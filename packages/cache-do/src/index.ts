/**
 * @paleta/cache-do — Durable Object SQLite cache backend.
 *
 * Why a Durable Object:
 *   - `caches.default` is colo-local. Cold requests in a different colo pay
 *     the full decode+quantize again.
 *   - A DO with SQLite storage gives you a single consistent cache across
 *     every colo for ~free (free-tier DOs are available, storage billed
 *     per-GB at rest beyond the free allowance).
 *   - Palette JSON is tiny (~300 bytes). 10 GB fits ~35M palettes.
 *
 * Contract:
 *   The DO exposes three RPC methods: `cacheGet`, `cachePut`, `cachePurge`.
 *   A thin JS adapter (`paletaDurableCache`) wraps an `env.PALETA_CACHE`
 *   binding into the `PaletteCacheBackend` shape that `@paleta/core`
 *   understands.
 *
 * Wrangler setup (minimal):
 *   [[durable_objects.bindings]]
 *   name = "PALETA_CACHE"
 *   class_name = "PaletaCacheDO"
 *
 *   [[migrations]]
 *   tag = "v1"
 *   new_sqlite_classes = ["PaletaCacheDO"]
 */

import { DurableObject } from "cloudflare:workers";
import type { PaletteCacheBackend, PaletteResult } from "@paleta/core";

interface Env {
  [key: string]: unknown;
}

/**
 * Durable Object class to deploy. Exported so consumers can re-export it
 * from their Worker entry (Cloudflare needs DO classes to be at the Worker
 * module level to instantiate them).
 */
export class PaletaCacheDO extends DurableObject<Env> {
  #initialized = false;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  #ensureSchema(): void {
    if (this.#initialized) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS palettes (
        key TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(
      `CREATE INDEX IF NOT EXISTS palettes_expires_at ON palettes (expires_at)`,
    );
    this.#initialized = true;
  }

  async cacheGet(key: string): Promise<PaletteResult | undefined> {
    this.#ensureSchema();
    const now = Math.floor(Date.now() / 1000);
    const rows = this.ctx.storage.sql
      .exec<{ json: string; expires_at: number }>(
        `SELECT json, expires_at FROM palettes WHERE key = ? LIMIT 1`,
        key,
      )
      .toArray();
    const row = rows[0];
    if (!row) return undefined;
    if (row.expires_at <= now) {
      this.ctx.storage.sql.exec(`DELETE FROM palettes WHERE key = ?`, key);
      return undefined;
    }
    try {
      return JSON.parse(row.json) as PaletteResult;
    } catch {
      return undefined;
    }
  }

  async cachePut(key: string, value: PaletteResult, ttlSeconds: number): Promise<void> {
    this.#ensureSchema();
    const expires = Math.floor(Date.now() / 1000) + Math.max(1, ttlSeconds | 0);
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO palettes (key, json, expires_at) VALUES (?, ?, ?)`,
      key,
      JSON.stringify(value),
      expires,
    );
    // Schedule a cleanup alarm at the earliest expiry if one isn't set.
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + ttlSeconds * 1000);
    }
  }

  async cachePurge(): Promise<number> {
    this.#ensureSchema();
    const now = Math.floor(Date.now() / 1000);
    const before = this.ctx.storage.sql
      .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM palettes WHERE expires_at <= ?`, now)
      .toArray()[0]?.n ?? 0;
    this.ctx.storage.sql.exec(`DELETE FROM palettes WHERE expires_at <= ?`, now);
    return before;
  }

  override async alarm(): Promise<void> {
    const purged = await this.cachePurge();
    // Schedule the next purge when the next expiry would happen, or skip
    // if the table is empty.
    const next = this.ctx.storage.sql
      .exec<{ expires_at: number }>(`SELECT MIN(expires_at) AS expires_at FROM palettes`)
      .toArray()[0]?.expires_at;
    if (next) {
      await this.ctx.storage.setAlarm(next * 1000);
    }
    void purged;
  }
}

/**
 * Minimal stub — the DO handle exposes the methods we invoke via RPC.
 * We keep this narrow so consumers don't accidentally rely on internals.
 */
export interface PaletaCacheStub {
  cacheGet(key: string): Promise<PaletteResult | undefined>;
  cachePut(key: string, value: PaletteResult, ttl: number): Promise<void>;
}

/** Namespace shape callers need to bind in wrangler.jsonc. */
export interface PaletaCacheNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): PaletaCacheStub;
}

/**
 * Wrap a DO namespace into the `PaletteCacheBackend` shape expected by
 * `@paleta/core`.
 *
 * `shardKey` lets you scale out past a single DO's 10 GB ceiling by hashing
 * the palette key into N buckets. Default "default" = everything in one DO,
 * which is fine until ~35M cached palettes.
 */
export function paletaDurableCache(
  namespace: PaletaCacheNamespace,
  shardKey: string | ((key: string) => string) = "default",
): PaletteCacheBackend {
  const shard = (key: string): string =>
    typeof shardKey === "function" ? shardKey(key) : shardKey;

  return {
    async get(key) {
      const stub = namespace.get(namespace.idFromName(shard(key)));
      return stub.cacheGet(key);
    },
    async put(key, value, ttlSeconds) {
      const stub = namespace.get(namespace.idFromName(shard(key)));
      await stub.cachePut(key, value, ttlSeconds);
    },
  };
}
