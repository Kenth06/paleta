import { Copy, Check } from "@phosphor-icons/react";
import type { PaletteResponse } from "../lib/types";
import { rgbString } from "../lib/format";
import { useCopy } from "../hooks/use-copy";

export function DominantCard({
  data,
  sourceUrl,
}: {
  data: PaletteResponse;
  sourceUrl: string;
}) {
  const { copied, copy } = useCopy();
  const { dominant } = data;

  const Row = ({ label, value }: { label: string; value: string }) => (
    <button
      onClick={() => copy(value)}
      className="group flex items-center justify-between gap-4 py-2.5 px-4 rounded-lg hairline hover:border-[color:var(--color-line-strong)] transition-colors text-left w-full"
    >
      <span className="mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
        {label}
      </span>
      <span className="mono text-[13px] flex items-center gap-2 text-[color:var(--color-ink)]">
        {value}
        <span className="opacity-0 group-hover:opacity-100 transition-opacity">
          {copied === value ? <Check size={12} weight="bold" /> : <Copy size={12} />}
        </span>
      </span>
    </button>
  );

  return (
    <div className="cross-fade grid grid-cols-1 md:grid-cols-[1.3fr_1fr] gap-4">
      <div
        className="relative aspect-[4/3] md:aspect-auto md:min-h-[360px] rounded-2xl overflow-hidden hairline"
        style={{ background: dominant.hex }}
      >
        <img
          src={sourceUrl}
          alt="source"
          className="absolute inset-0 w-full h-full object-cover opacity-70 mix-blend-luminosity"
        />
        <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/80 via-black/20 to-transparent">
          <div className="mono text-[10px] uppercase tracking-[0.18em] text-white/60">
            dominant
          </div>
          <div
            className="mono text-4xl md:text-5xl font-medium tracking-tight text-white"
            style={{ textShadow: "0 2px 18px rgb(0 0 0 / 0.5)" }}
          >
            {dominant.hex}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 justify-center">
        <div className="mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)] mb-1">
          color values
        </div>
        <Row label="HEX" value={dominant.hex} />
        <Row label="RGB" value={rgbString(dominant.rgb)} />
        <Row label="OKLCH" value={dominant.oklch} />
        <div className="mt-3 p-4 rounded-lg bg-[color:var(--color-surface)] hairline">
          <div className="mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)] mb-2">
            perceptual ranking
          </div>
          <p className="text-[13px] text-[color:var(--color-ink-dim)] leading-relaxed">
            paleta sorts by OKLab population weight, not RGB count. This color
            was the most perceptually present in{" "}
            <span className="mono text-[color:var(--color-ink)]">
              {data.meta.width}×{data.meta.height}
            </span>{" "}
            pixels.
          </p>
        </div>
      </div>
    </div>
  );
}
