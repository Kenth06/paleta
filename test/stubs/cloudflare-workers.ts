/**
 * Stub for `cloudflare:workers` in Node-based test environments.
 *
 * Vitest runs our unit tests in Node, which has no `cloudflare:workers`
 * module. For tests of the DO adapter that don't actually instantiate a
 * DO, we only need the class to exist — not to work.
 */

export class DurableObject<_Env = unknown> {
  readonly ctx: unknown;
  readonly env: unknown;
  constructor(ctx: unknown, env: unknown) {
    this.ctx = ctx;
    this.env = env;
  }
}
