import type { RGB } from "./types";

export const rgbString = ([r, g, b]: RGB) => `rgb(${r} ${g} ${b})`;

/**
 * Parse a user-typed hex (`#fff`, `#ffffff`, `ffffff`) into RGB.
 * Returns null for malformed input so callers can render a validation hint.
 */
export function parseHex(raw: string): RGB | null {
  const m = raw.trim().replace(/^#/, "");
  if (m.length !== 3 && m.length !== 6) return null;
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function formatMs(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "—";
  if (n < 1) return `${n.toFixed(2)}ms`;
  if (n < 10) return `${n.toFixed(1)}ms`;
  return `${Math.round(n)}ms`;
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
