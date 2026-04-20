import { GithubLogo, Package } from "@phosphor-icons/react";

export function Header({
  theme,
  onToggleTheme,
}: {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 backdrop-blur-md bg-[color:var(--color-canvas)]/70 border-b border-[color:var(--color-line)]">
      <div className="mx-auto max-w-[1200px] px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="grid grid-cols-2 gap-[2px] w-5 h-5 rounded-md overflow-hidden hairline"
          >
            <span className="bg-[#ff5d5d]" />
            <span className="bg-[#4cc9f0]" />
            <span className="bg-[#ffd166]" />
            <span className="bg-[color:var(--accent)]" />
          </div>
          <span className="mono text-sm tracking-tight">paleta</span>
          <span className="mono text-xs text-[color:var(--color-ink-faint)]">
            v0.1.0-alpha
          </span>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          <a
            href="https://www.npmjs.com/package/@ken0106/core"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-dim)] hover:text-[color:var(--color-ink)] transition-colors"
          >
            <Package size={14} weight="regular" /> npm
          </a>
          <a
            href="https://github.com/Kenth06/paleta"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-[color:var(--color-surface-2)] text-[color:var(--color-ink-dim)] hover:text-[color:var(--color-ink)] transition-colors"
          >
            <GithubLogo size={14} weight="regular" /> GitHub
          </a>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="mono text-xs px-3 py-1.5 rounded-md hairline text-[color:var(--color-ink-dim)] hover:text-[color:var(--color-ink)]"
          >
            {theme === "dark" ? "DARK" : "LIGHT"}
          </button>
        </nav>
      </div>
    </header>
  );
}
