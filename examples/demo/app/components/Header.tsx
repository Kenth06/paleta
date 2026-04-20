import { GithubLogo } from "@phosphor-icons/react";

export function Header() {
  return (
    <header className="border-b border-[color:var(--color-line)]">
      <div className="mx-auto max-w-[1100px] px-6 h-12 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            aria-hidden
            className="grid grid-cols-2 gap-[2px] w-4 h-4 rounded-sm overflow-hidden"
          >
            <span className="bg-[#ff5d5d]" />
            <span className="bg-[#4cc9f0]" />
            <span className="bg-[#ffd166]" />
            <span className="bg-[color:var(--accent)]" />
          </div>
          <span className="mono text-sm">paleta</span>
        </div>
        <a
          href="https://github.com/Kenth06/paleta"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-sm text-[color:var(--color-ink-dim)] hover:text-[color:var(--color-ink)] transition-colors"
        >
          <GithubLogo size={14} /> GitHub
        </a>
      </div>
    </header>
  );
}
