import { ArrowRight, Link as LinkIcon } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";

export function UrlInput({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (url: string) => void;
}) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 p-1.5 pl-4 rounded-xl bg-[color:var(--color-surface)] hairline focus-within:border-[color:var(--accent)] transition-colors"
    >
      <LinkIcon size={16} className="text-[color:var(--color-ink-faint)] shrink-0" />
      <input
        type="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="paste an image URL — jpeg, png, webp, or avif"
        className="flex-1 bg-transparent outline-none py-2.5 text-[15px] placeholder:text-[color:var(--color-ink-faint)]"
        spellCheck={false}
        autoComplete="off"
      />
      <button
        type="submit"
        disabled={busy || value.trim().length === 0}
        className="flex items-center gap-1.5 mono text-xs tracking-wide px-4 py-2.5 rounded-lg bg-[color:var(--accent)] text-[color:var(--accent-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:brightness-105"
      >
        {busy ? "extracting" : "extract"}
        <ArrowRight size={14} weight="bold" />
      </button>
    </form>
  );
}
