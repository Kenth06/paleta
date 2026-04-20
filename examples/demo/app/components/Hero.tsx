import type { PropsWithChildren } from "react";

export function Hero({ children }: PropsWithChildren) {
  return (
    <section className="mx-auto max-w-[1200px] px-6 pt-16 pb-10">
      <div className="flex flex-col gap-5 max-w-[780px]">
        <div className="mono text-xs uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
          paleta · a color-palette extraction library for the edge
        </div>
        <h1 className="font-semibold tracking-tight leading-[0.95] text-[clamp(2.6rem,6.6vw,5rem)]">
          The color behind <span className="text-[color:var(--accent)]">every pixel</span>,
          <br />
          extracted at the edge.
        </h1>
        <p className="text-[color:var(--color-ink-dim)] text-lg max-w-[640px] leading-relaxed">
          paleta pulls perceptually-sorted palettes from JPEG, PNG, WebP and AVIF on
          free Cloudflare Workers. A custom DC-only Rust WASM decoder makes it
          <span className="mono text-[color:var(--color-ink)]"> 4–12× </span>
          faster than mozjpeg. This page is the Worker.
        </p>
        <div className="mt-2 mb-6 flex flex-wrap items-center gap-3">
          <code className="mono text-xs px-3 py-2 rounded-md bg-[color:var(--color-surface)] hairline">
            npm i @ken0106/core @ken0106/jsquash
          </code>
          <a
            href="https://github.com/Kenth06/paleta#quick-start"
            target="_blank"
            rel="noreferrer"
            className="mono text-xs text-[color:var(--color-ink-dim)] underline underline-offset-4 decoration-[color:var(--color-line-strong)] hover:text-[color:var(--color-ink)]"
          >
            read the quick start →
          </a>
        </div>
      </div>
      {children}
    </section>
  );
}
