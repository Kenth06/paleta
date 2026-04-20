import { useCallback, useRef, useState } from "react";

export function useCopy(timeout = 1200) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const copy = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(value);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(null), timeout);
      } catch {
        /* no-op; older browsers just won't flash feedback */
      }
    },
    [timeout],
  );

  return { copied, copy };
}
