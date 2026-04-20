import { Check, Copy } from "@phosphor-icons/react";
import type { Swatch as SwatchT } from "../lib/types";
import { useCopy } from "../hooks/use-copy";

export function Swatch({
  swatch,
  index,
  size = "md",
}: {
  swatch: SwatchT;
  index: number;
  size?: "md" | "lg";
}) {
  const { copied, copy } = useCopy();
  const isCopied = copied === swatch.hex;

  return (
    <button
      onClick={() => copy(swatch.hex)}
      className="swatch-enter group flex flex-col items-stretch rounded-xl overflow-hidden hairline bg-[color:var(--color-surface)] text-left transition-transform hover:-translate-y-0.5"
      style={{ animationDelay: `${index * 55}ms` }}
      title={`Copy ${swatch.hex}`}
    >
      <div
        className={`relative ${size === "lg" ? "h-28" : "h-20"}`}
        style={{ background: swatch.hex }}
      >
        <div className="absolute top-2 right-2 p-1.5 rounded-md bg-black/30 text-white opacity-0 group-hover:opacity-100 transition-opacity">
          {isCopied ? <Check size={12} weight="bold" /> : <Copy size={12} />}
        </div>
      </div>
      <div className="px-3 py-2.5 flex flex-col gap-0.5">
        <span className="mono text-sm tracking-wide">{swatch.hex}</span>
        <span className="mono text-[10px] text-[color:var(--color-ink-faint)] truncate">
          {swatch.oklch}
        </span>
      </div>
    </button>
  );
}
