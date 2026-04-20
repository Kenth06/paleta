import { Check, Copy } from "@phosphor-icons/react";
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
      className="group flex items-center justify-between gap-3 py-2 px-3 rounded-md hairline hover:border-[color:var(--color-line-strong)] text-left w-full"
    >
      <span className="mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
        {label}
      </span>
      <span className="mono text-[13px] flex items-center gap-2">
        {value}
        <span className="opacity-0 group-hover:opacity-100 transition-opacity">
          {copied === value ? <Check size={12} weight="bold" /> : <Copy size={12} />}
        </span>
      </span>
    </button>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr] gap-4">
      <div
        className="relative aspect-[4/3] md:aspect-auto md:min-h-[320px] rounded-xl overflow-hidden hairline"
        style={{ background: dominant.hex }}
      >
        <img
          src={sourceUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-75 mix-blend-luminosity"
        />
        <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 via-black/20 to-transparent">
          <div className="mono text-[10px] uppercase tracking-[0.18em] text-white/60">
            dominant
          </div>
          <div
            className="mono text-3xl md:text-4xl font-medium tracking-tight text-white"
            style={{ textShadow: "0 2px 14px rgb(0 0 0 / 0.5)" }}
          >
            {dominant.hex}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 justify-center">
        <Row label="HEX" value={dominant.hex} />
        <Row label="RGB" value={rgbString(dominant.rgb)} />
        <Row label="OKLCH" value={dominant.oklch} />
      </div>
    </div>
  );
}
