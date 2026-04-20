import type { PaletteMeta, PipelinePath } from "../lib/types";
import { formatBytes, formatMs } from "../lib/format";

const PATH_TONE: Record<PipelinePath, string> = {
  "dc-only": "bg-[color:var(--accent)] text-[color:var(--accent-fg)]",
  "cache-hit": "bg-emerald-400/20 text-emerald-300 border border-emerald-400/30",
  "exif-thumb": "bg-sky-400/20 text-sky-300 border border-sky-400/30",
  "full-decode": "bg-zinc-500/20 text-zinc-200 border border-zinc-500/30",
};

export function MetaPanel({ meta }: { meta: PaletteMeta }) {
  return (
    <section className="rounded-xl hairline overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-[color:var(--color-line)]">
        <span className="mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
          pipeline
        </span>
        <span className={`mono text-[11px] uppercase tracking-wider px-2 py-0.5 rounded ${PATH_TONE[meta.path]}`}>
          {meta.path}
        </span>
      </div>
      <dl className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-[color:var(--color-line)]">
        <Stat label="Format" value={meta.format.toUpperCase()} />
        <Stat label="Dims" value={`${meta.width}×${meta.height}`} />
        <Stat label="Bytes" value={formatBytes(meta.bytes)} />
        <Stat label="Decode" value={formatMs(meta.decodeMs)} highlight={meta.path === "dc-only"} />
        <Stat label="Quantize" value={formatMs(meta.quantizeMs)} />
        <Stat label="Total" value={formatMs(meta.totalMs)} />
      </dl>
    </section>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-[color:var(--color-surface)] px-3 py-2.5">
      <div className="mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-faint)]">
        {label}
      </div>
      <div className={`mono mt-0.5 text-[13px] ${highlight ? "text-[color:var(--accent)]" : "text-[color:var(--color-ink)]"}`}>
        {value}
      </div>
    </div>
  );
}
