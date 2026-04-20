import { useCallback, useRef, useState } from "react";
import type { ApiError, PaletteResponse } from "../lib/types";

type Status = "idle" | "loading" | "success" | "error";

export interface UsePaletteState {
  status: Status;
  data: PaletteResponse | null;
  error: string | null;
  sourceUrl: string | null;
  elapsedMs: number | null;
}

export function usePalette() {
  const [state, setState] = useState<UsePaletteState>({
    status: "idle",
    data: null,
    error: null,
    sourceUrl: null,
    elapsedMs: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const extract = useCallback(async (url: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setState((s) => ({ ...s, status: "loading", error: null, sourceUrl: url }));
    const t0 = performance.now();
    try {
      const res = await fetch(`/api/palette?url=${encodeURIComponent(url)}&count=8`, {
        signal: ac.signal,
      });
      const body = (await res.json()) as PaletteResponse | ApiError;
      if (!res.ok || "error" in body) {
        const msg =
          "message" in body && body.message
            ? body.message
            : "error" in body
              ? body.error
              : `HTTP ${res.status}`;
        setState({
          status: "error",
          data: null,
          error: msg,
          sourceUrl: url,
          elapsedMs: performance.now() - t0,
        });
        return;
      }
      setState({
        status: "success",
        data: body as PaletteResponse,
        error: null,
        sourceUrl: url,
        elapsedMs: performance.now() - t0,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState({
        status: "error",
        data: null,
        error: (err as Error).message,
        sourceUrl: url,
        elapsedMs: performance.now() - t0,
      });
    }
  }, []);

  return { ...state, extract };
}
