import { Heart, ShareNetwork, Sparkle } from "@phosphor-icons/react";
import type { PaletteResponse } from "../lib/types";

/**
 * Tiny faux product UI re-tinted with the extracted palette. Gives visitors
 * an immediate sense of "what would this palette feel like in my app?" without
 * them having to imagine it.
 *
 * Uses the dominant as the feature surface, accent (onDark) for CTAs, and a
 * lighter palette entry for supporting surfaces. All computed off `data`.
 */
export function LiveMockup({ data }: { data: PaletteResponse }) {
  const dom = data.dominant.hex;
  const accent = data.accents.onBlack.hex;
  const surface = data.palette[1]?.hex ?? data.palette[0]!.hex;
  const soft = data.palette[data.palette.length - 1]?.hex ?? surface;

  return (
    <section className="rounded-2xl hairline overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-[color:var(--color-line)]">
        <div>
          <h3 className="text-sm font-medium">Live preview</h3>
          <p className="text-[12px] text-[color:var(--color-ink-dim)] mt-0.5">
            A tiny UI re-tinted from the palette. This is what these colors feel like.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr]">
        {/* Nav rail */}
        <div
          className="p-4 border-b md:border-b-0 md:border-r border-[color:var(--color-line)]"
          style={{ background: soft }}
        >
          <div className="mono text-[10px] uppercase tracking-[0.2em] mb-4" style={{ color: dom }}>
            paleta · studio
          </div>
          <nav className="flex flex-col gap-1 text-[13px]">
            {["Library", "Palettes", "Playground", "Export"].map((item, i) => (
              <a
                key={item}
                href="#"
                onClick={(e) => e.preventDefault()}
                className="px-2.5 py-1.5 rounded-md transition-colors"
                style={
                  i === 0
                    ? { background: dom, color: accent }
                    : { color: dom, opacity: 0.75 }
                }
              >
                {item}
              </a>
            ))}
          </nav>
        </div>

        {/* Main */}
        <div className="p-5" style={{ background: surface }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="mono text-[10px] uppercase tracking-[0.2em]" style={{ color: dom, opacity: 0.7 }}>
                featured
              </div>
              <div className="text-lg font-semibold mt-0.5" style={{ color: dom }}>
                Autumn — editorial set
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <IconBtn color={dom}><Heart size={14} /></IconBtn>
              <IconBtn color={dom}><ShareNetwork size={14} /></IconBtn>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {data.palette.slice(0, 3).map((s) => (
              <div
                key={s.hex}
                className="aspect-[4/3] rounded-md"
                style={{ background: s.hex }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md mono text-[12px] tracking-wide transition-transform hover:scale-[1.02]"
              style={{ background: dom, color: accent }}
            >
              <Sparkle size={12} weight="fill" /> Apply palette
            </button>
            <button
              className="px-3 py-2 rounded-md mono text-[12px] transition-colors"
              style={{
                border: `1px solid ${dom}`,
                color: dom,
                background: "transparent",
              }}
            >
              Copy CSS vars
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function IconBtn({
  children,
  color,
}: {
  children: React.ReactNode;
  color: string;
}) {
  return (
    <button
      className="w-7 h-7 grid place-items-center rounded-md transition-opacity hover:opacity-100"
      style={{ color, border: `1px solid ${color}30`, opacity: 0.8 }}
    >
      {children}
    </button>
  );
}
