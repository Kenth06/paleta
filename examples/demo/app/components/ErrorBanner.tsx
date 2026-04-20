import { Warning } from "@phosphor-icons/react";

export function ErrorBanner({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="slide-in flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/25">
      <Warning size={18} weight="fill" className="text-red-400 shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="text-sm font-medium text-red-200">Extraction failed</div>
        <div className="mono text-[12px] text-red-300/80 mt-1 break-all">{error}</div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mono text-[11px] uppercase tracking-wider px-2.5 py-1 rounded-md border border-red-500/30 text-red-200 hover:bg-red-500/10"
        >
          retry
        </button>
      )}
    </div>
  );
}
