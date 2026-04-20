import { useMemo, useState } from "react";
import type { AccentPick, PaletteResponse, RGB, WcagTier } from "../lib/types";
import { parseHex } from "../lib/format";

const PRESET_BGS: Array<{ hex: string; label: string }> = [
  { hex: "#000000", label: "Jet" },
  { hex: "#ffffff", label: "Paper" },
  { hex: "#111112", label: "Ink" },
  { hex: "#f6821f", label: "CF Orange" },
];

/**
 * WCAG 2.x contrast for an (RGB, RGB) pair. Kept client-side so custom
 * backgrounds don't round-trip through the Worker.
 */
function luminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
function tier(c: number): WcagTier {
  if (c >= 7) return "AAA";
  if (c >= 4.5) return "AA";
  if (c >= 3) return "AA-large";
  return "fail";
}

export function AccentPlayground({ data }: { data: PaletteResponse }) {
  const [bg, setBg] = useState("#0a0a0a");
  const bgRgb = parseHex(bg);

  const computed = useMemo<AccentPick | null>(() => {
    if (!bgRgb) return null;
    // Best palette entry for the user-chosen background — same contrast
    // heuristic pickAccent uses, implemented client-side for responsiveness.
    let bestIdx = 0;
    let bestC = 0;
    data.palette.forEach((s, i) => {
      const c = contrastRatio(s.rgb, bgRgb);
      if (c > bestC) {
        bestC = c;
        bestIdx = i;
      }
    });
    const chosen = data.palette[bestIdx]!;
    return {
      rgb: chosen.rgb,
      hex: chosen.hex,
      contrast: +bestC.toFixed(2),
      wcag: tier(bestC),
    };
  }, [bgRgb, data.palette]);

  return (
    <section className="rounded-2xl hairline overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-[color:var(--color-line)]">
        <div>
          <h3 className="text-sm font-medium">Accent playground</h3>
          <p className="text-[12px] text-[color:var(--color-ink-dim)] mt-0.5">
            pickAccent(palette, background) — the WCAG-best palette entry.
          </p>
        </div>
        <div className="mono text-[11px] text-[color:var(--color-ink-faint)]">
          client-side · live
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2">
        <div className="p-5 border-b md:border-b-0 md:border-r border-[color:var(--color-line)]">
          <label className="mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--color-ink-faint)]">
            background
          </label>
          <div className="mt-2 flex items-center gap-2">
            <div
              className="w-10 h-10 rounded-md hairline shrink-0"
              style={{ background: bgRgb ? bg : "transparent" }}
            />
            <input
              type="text"
              value={bg}
              onChange={(e) => setBg(e.target.value)}
              className="flex-1 mono text-sm px-3 py-2 bg-[color:var(--color-surface)] hairline rounded-md outline-none focus:border-[color:var(--accent)]"
              spellCheck={false}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {PRESET_BGS.map((p) => (
              <button
                key={p.hex}
                onClick={() => setBg(p.hex)}
                className="flex items-center gap-1.5 mono text-[11px] px-2 py-1 rounded-md hairline hover:border-[color:var(--color-line-strong)]"
              >
                <span
                  className="inline-block w-3 h-3 rounded-sm hairline"
                  style={{ background: p.hex }}
                />
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">
          <label className="mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--color-ink-faint)]">
            picked accent
          </label>
          {computed && bgRgb ? (
            <div
              className="mt-2 rounded-lg p-6 flex flex-col gap-3 transition-colors"
              style={{ background: bg, color: computed.hex }}
            >
              <div className="text-3xl font-semibold tracking-tight">
                Headline text looks like this.
              </div>
              <div className="text-sm opacity-85">
                Body copy inherits the same accent. The contrast ratio determines
                WCAG pass.
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span
                  className="mono text-[11px] px-2 py-0.5 rounded"
                  style={{
                    background: computed.hex,
                    color: bg,
                  }}
                >
                  {computed.hex}
                </span>
                <span className="mono text-[11px] opacity-85">
                  {computed.contrast.toFixed(2)}:1
                </span>
                <WcagBadge tier={computed.wcag} />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-[color:var(--color-ink-dim)]">
              Enter a valid hex to see the picked accent.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function WcagBadge({ tier }: { tier: WcagTier }) {
  const label =
    tier === "AAA"
      ? "AAA"
      : tier === "AA"
        ? "AA"
        : tier === "AA-large"
          ? "AA · large text"
          : "fails WCAG";
  const color =
    tier === "fail"
      ? "#ef4444"
      : tier === "AA-large"
        ? "#eab308"
        : "#22c55e";
  return (
    <span
      className="mono text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider"
      style={{ background: `${color}22`, color }}
    >
      {label}
    </span>
  );
}
