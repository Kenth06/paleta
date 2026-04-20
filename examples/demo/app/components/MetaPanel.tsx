import type { PaletteMeta, PipelinePath } from "../lib/types";
import { formatBytes, formatMs } from "../lib/format";

const PATH_COPY: Record<PipelinePath, { title: string; blurb: string; tone: string }> = {
  "dc-only": {
    title: "DC-only",
    blurb: "Rust WASM decode of only the JPEG DC coefficients. 4–12× faster than mozjpeg.",
    tone: "bg-[color:var(--accent)] text-[color:var(--accent-fg)]",
  },
  "cache-hit": {
    title: "Cache hit",
    blurb: "Served from caches.default. Sub-millisecond round-trip.",
    tone: "bg-emerald-400/20 text-emerald-300 border border-emerald-400/30",
  },
  "exif-thumb": {
    title: "EXIF thumbnail",
    blurb: "JPEG carried its own thumbnail — we decoded that instead of the full frame.",
    tone: "bg-sky-400/20 text-sky-300 border border-sky-400/30",
  },
  "full-decode": {
    title: "Full decode",
    blurb: "jSquash's mozjpeg/png/webp/avif decoder. Fallback when DC isn't available.",
    tone: "bg-zinc-500/20 text-zinc-200 border border-zinc-500/30",
  },
};

export function MetaPanel({ meta }: { meta: PaletteMeta }) {
  const path = PATH_COPY[meta.path] ?? PATH_COPY["full-decode"];

  return (
    <section className="rounded-2xl hairline overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-[color:var(--color-line)]">
        <div>
          <h3 className="text-sm font-medium">Pipeline</h3>
          <p className="text-[12px] text-[color:var(--color-ink-dim)] mt-0.5">
            How paleta got from bytes to palette.
          </p>
        </div>
        <div
          className={`slide-in mono text-[11px] uppercase tracking-wider px-2.5 py-1 rounded-md ${path.tone}`}
        >
          {path.title}
        </div>
      </div>
      <div className="px-5 py-4 text-[13px] text-[color:var(--color-ink-dim)] leading-relaxed border-b border-[color:var(--color-line)]">
        {path.blurb}
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-[color:var(--color-line)]">
        <Stat label="Format" value={meta.format.toUpperCase()} mono />
        <Stat label="Dimensions" value={`${meta.width} × ${meta.height}`} mono />
        <Stat label="Bytes" value={formatBytes(meta.bytes)} mono />
        <Stat label="Decode" value={formatMs(meta.decodeMs)} mono highlight={meta.path === "dc-only"} />
        <Stat label="Quantize" value={formatMs(meta.quantizeMs)} mono />
        <Stat label="Total" value={formatMs(meta.totalMs)} mono emphasis />
      </dl>
    </section>
  );
}

function Stat({
  label,
  value,
  mono,
  highlight,
  emphasis,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="bg-[color:var(--color-surface)] px-4 py-3">
      <div className="mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
        {label}
      </div>
      <div
        className={`${mono ? "mono" : ""} mt-1 ${
          emphasis ? "text-xl" : "text-[15px]"
        } ${highlight ? "text-[color:var(--accent)]" : "text-[color:var(--color-ink)]"}`}
      >
        {value}
      </div>
    </div>
  );
}
