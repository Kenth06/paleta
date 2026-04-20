import { useState, type FormEvent } from "react";

export function UrlInput({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (url: string) => void;
}) {
  const [value, setValue] = useState("");

  function handle(e: FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (v) onSubmit(v);
  }

  return (
    <form
      onSubmit={handle}
      className="flex gap-2 p-1.5 pl-4 rounded-xl bg-[color:var(--color-surface)] hairline focus-within:border-[color:var(--color-ink)] transition-colors"
    >
      <input
        type="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="paste an image URL"
        className="flex-1 bg-transparent outline-none py-2.5 text-[15px] placeholder:text-[color:var(--color-ink-faint)]"
        spellCheck={false}
        autoComplete="off"
      />
      <button
        type="submit"
        disabled={busy || value.trim().length === 0}
        className="mono text-xs px-4 py-2.5 rounded-lg bg-[color:var(--color-ink)] text-[color:var(--color-canvas)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? "extracting" : "extract"}
      </button>
    </form>
  );
}
