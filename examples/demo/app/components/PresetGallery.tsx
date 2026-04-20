import { PRESETS } from "../lib/presets";

export function PresetGallery({
  activeUrl,
  onPick,
}: {
  activeUrl: string | null;
  onPick: (url: string) => void;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-ink-faint)]">
          or try one of these
        </h2>
        <span className="mono text-[11px] text-[color:var(--color-ink-faint)]">
          {PRESETS.length} presets · unsplash
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {PRESETS.map((p) => {
          const active = activeUrl === p.url;
          return (
            <button
              key={p.id}
              onClick={() => onPick(p.url)}
              aria-label={`Extract palette from ${p.label}`}
              aria-pressed={active}
              className={`group relative aspect-[4/5] overflow-hidden rounded-lg hairline transition-all ${
                active
                  ? "ring-2 ring-[color:var(--accent)] ring-offset-2 ring-offset-[color:var(--color-canvas)]"
                  : "hover:ring-1 hover:ring-[color:var(--color-line-strong)]"
              }`}
            >
              <img
                src={p.thumb}
                alt={p.label}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                <div className="mono text-[10px] uppercase tracking-wider text-white/60">
                  {p.category}
                </div>
                <div className="text-xs text-white truncate">{p.label}</div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
