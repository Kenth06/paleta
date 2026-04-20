import { useEffect, useState } from "react";
import { usePalette } from "./hooks/use-palette";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { UrlInput } from "./components/UrlInput";
import { PresetGallery } from "./components/PresetGallery";
import { DominantCard } from "./components/DominantCard";
import { PaletteStrip } from "./components/PaletteStrip";
import { AccentPlayground } from "./components/AccentPlayground";
import { MetaPanel } from "./components/MetaPanel";
import { LiveMockup } from "./components/LiveMockup";
import { ErrorBanner } from "./components/ErrorBanner";
import { ResultsSkeleton } from "./components/ResultsSkeleton";
import { Footer } from "./components/Footer";
import { PRESETS } from "./lib/presets";

export function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const palette = usePalette();

  // Kick off with a preset on first load so the page never looks empty.
  useEffect(() => {
    palette.extract(PRESETS[0]!.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect the theme choice on <html> so CSS vars swap for light/dark.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Live re-tint — site accent tracks the dominant color.
  useEffect(() => {
    if (!palette.data) return;
    const { dominant, accents } = palette.data;
    const root = document.documentElement;
    root.style.setProperty("--accent", dominant.hex);
    // Use the highest-contrast palette entry on the dominant surface for fg.
    const fg = theme === "dark" ? accents.onBlack.hex : accents.onWhite.hex;
    root.style.setProperty("--accent-fg", fg);
    const [r, g, b] = dominant.rgb;
    root.style.setProperty("--accent-glow", `${r} ${g} ${b}`);
  }, [palette.data, theme]);

  return (
    <>
      <Header theme={theme} onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />

      <main className="mx-auto max-w-[1200px] px-6 pb-12">
        <Hero>
          <UrlInput busy={palette.status === "loading"} onSubmit={palette.extract} />
          <PresetGallery activeUrl={palette.sourceUrl} onPick={palette.extract} />
        </Hero>

        <section className="flex flex-col gap-8 pb-12">
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

          {palette.status === "loading" && !palette.data && <ResultsSkeleton />}

          {palette.data && palette.sourceUrl && (
            <div
              key={palette.sourceUrl}
              className="cross-fade flex flex-col gap-8"
            >
              <DominantCard data={palette.data} sourceUrl={palette.sourceUrl} />
              <PaletteStrip data={palette.data} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <AccentPlayground data={palette.data} />
                <MetaPanel meta={palette.data.meta} />
              </div>
              <LiveMockup data={palette.data} />
            </div>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}
