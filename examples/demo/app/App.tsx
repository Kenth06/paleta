import { useEffect } from "react";
import { usePalette } from "./hooks/use-palette";
import { Header } from "./components/Header";
import { UrlInput } from "./components/UrlInput";
import { PresetGallery } from "./components/PresetGallery";
import { DominantCard } from "./components/DominantCard";
import { PaletteStrip } from "./components/PaletteStrip";
import { MetaPanel } from "./components/MetaPanel";
import { ErrorBanner } from "./components/ErrorBanner";
import { PRESETS } from "./lib/presets";

export function App() {
  const palette = usePalette();

  useEffect(() => {
    palette.extract(PRESETS[0]!.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live re-tint: dominant color → site accent. The whole point of the demo.
  useEffect(() => {
    if (!palette.data) return;
    const { dominant, accents } = palette.data;
    const root = document.documentElement;
    root.style.setProperty("--accent", dominant.hex);
    root.style.setProperty("--accent-fg", accents.onBlack.hex);
    const [r, g, b] = dominant.rgb;
    root.style.setProperty("--accent-glow", `${r} ${g} ${b}`);
  }, [palette.data]);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-[1100px] px-6 pt-14 pb-16">
        <section className="flex flex-col gap-4 max-w-[680px]">
          <div className="mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
            paleta · color palettes at the edge
          </div>
          <h1 className="font-semibold tracking-tight leading-[0.95] text-[clamp(2.2rem,5.6vw,3.6rem)]">
            The color behind <span className="text-[color:var(--accent)]">every pixel</span>,
            extracted at the edge.
          </h1>
          <p className="text-[color:var(--color-ink-dim)] leading-relaxed">
            Perceptually-sorted palettes from JPEG, PNG, WebP and AVIF on a free
            Cloudflare Worker.{" "}
            <span className="mono text-[color:var(--color-ink)]">4–12×</span> faster than
            mozjpeg via a DC-only Rust WASM decoder.
          </p>
        </section>

        <div className="mt-8 flex flex-col gap-3">
          <UrlInput busy={palette.status === "loading"} onSubmit={palette.extract} />
          <PresetGallery activeUrl={palette.sourceUrl} onPick={palette.extract} />
        </div>

        <section className="flex flex-col gap-6 mt-10">
          {palette.status === "error" && palette.error && (
            <ErrorBanner
              error={palette.error}
              {...(palette.sourceUrl
                ? {
                    onRetry: () => {
                      void palette.extract(palette.sourceUrl!);
                    },
                  }
                : {})}
            />
          )}
          {palette.data && palette.sourceUrl && (
            <>
              <DominantCard data={palette.data} sourceUrl={palette.sourceUrl} />
              <PaletteStrip data={palette.data} />
              <MetaPanel meta={palette.data.meta} />
            </>
          )}
        </section>
      </main>
    </>
  );
}
