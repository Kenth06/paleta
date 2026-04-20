import { PRESETS } from "../lib/presets";

export function PresetGallery({
  activeUrl,
  onPick,
}: {
  activeUrl: string | null;
  onPick: (url: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {PRESETS.map((p) => {
        const active = activeUrl === p.url;
        return (
          <button
            key={p.id}
            onClick={() => onPick(p.url)}
            aria-label={p.label}
            aria-pressed={active}
            className={`aspect-square overflow-hidden rounded-md hairline transition-all ${
              active
                ? "ring-2 ring-[color:var(--accent)]"
                : "hover:border-[color:var(--color-line-strong)]"
            }`}
          >
            <img src={p.thumb} alt={p.label} loading="lazy" className="w-full h-full object-cover" />
          </button>
        );
      })}
    </div>
  );
}
