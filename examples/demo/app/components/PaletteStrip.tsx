import type { PaletteResponse } from "../lib/types";
import { Swatch } from "./Swatch";

export function PaletteStrip({ data }: { data: PaletteResponse }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-ink-faint)]">
          palette · sorted by oklab dominance
        </h3>
        <span className="mono text-[11px] text-[color:var(--color-ink-faint)]">
          {data.palette.length} colors · click to copy
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {data.palette.map((s, i) => (
          <Swatch key={`${s.hex}-${i}`} swatch={s} index={i} />
        ))}
      </div>
    </section>
  );
}
