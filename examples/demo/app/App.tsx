import { usePalette } from "./hooks/use-palette";
import { UrlInput } from "./components/UrlInput";
import { Swatch } from "./components/Swatch";

export function App() {
  const palette = usePalette();

  return (
    <main className="mx-auto max-w-[720px] px-6 py-20 flex flex-col gap-8">
      <div className="mono text-xs tracking-[0.22em] uppercase text-[color:var(--color-ink-faint)]">
        paleta
      </div>

      <UrlInput busy={palette.status === "loading"} onSubmit={palette.extract} />

      {palette.status === "error" && palette.error && (
        <div className="mono text-sm text-red-400">{palette.error}</div>
      )}

      {palette.data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {palette.data.palette.map((s, i) => (
            <Swatch key={`${s.hex}-${i}`} swatch={s} index={i} />
          ))}
        </div>
      )}
    </main>
  );
}
