export function Footer() {
  return (
    <footer className="border-t border-[color:var(--color-line)] mt-20">
      <div className="mx-auto max-w-[1200px] px-6 py-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4 text-[13px] text-[color:var(--color-ink-dim)]">
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-ink-faint)]">
            paleta
          </div>
          <p className="mt-1">
            MIT · Kenneth Rios ·{" "}
            <a
              href="https://github.com/Kenth06/paleta"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-[color:var(--color-line-strong)] underline-offset-4 hover:text-[color:var(--color-ink)]"
            >
              github.com/Kenth06/paleta
            </a>
          </p>
        </div>
        <div className="mono text-[11px] text-[color:var(--color-ink-faint)]">
          served from a single Cloudflare Worker · vite + react 19 · tailwind v4 · kumo
        </div>
      </div>
    </footer>
  );
}
