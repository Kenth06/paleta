/**
 * Normalize the many accepted input shapes into raw bytes + an optional
 * Response (used for Content-Type sniffing + cache ETag hints).
 */

import { PaletteError, type ImageInput } from "./types.js";

export interface NormalizedInput {
  bytes: Uint8Array;
  response: Response | undefined;
  sourceUrl: string | undefined;
}

async function responseToBytes(res: Response): Promise<Uint8Array> {
  if (!res.ok) {
    throw new PaletteError(
      "FETCH_FAILED",
      `Failed to fetch image: ${res.status} ${res.statusText}`,
    );
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export async function normalizeInput(
  source: ImageInput,
  init?: { signal?: AbortSignal },
): Promise<NormalizedInput> {
  if (source instanceof Uint8Array) {
    return { bytes: source, response: undefined, sourceUrl: undefined };
  }

  if (source instanceof ArrayBuffer) {
    return { bytes: new Uint8Array(source), response: undefined, sourceUrl: undefined };
  }

  if (source instanceof Response) {
    const bytes = await responseToBytes(source);
    return { bytes, response: source, sourceUrl: source.url || undefined };
  }

  if (source instanceof URL || typeof source === "string") {
    const url = typeof source === "string" ? source : source.toString();
    const requestInit: RequestInit = { redirect: "follow" };
    if (init?.signal) requestInit.signal = init.signal;
    const response = await fetch(url, requestInit);
    const bytes = await responseToBytes(response);
    return { bytes, response, sourceUrl: url };
  }

  if (source && typeof source === "object" && "getReader" in source) {
    const bytes = await streamToBytes(source as ReadableStream<Uint8Array>);
    return { bytes, response: undefined, sourceUrl: undefined };
  }

  throw new PaletteError("INVALID_INPUT", "Unsupported input type for getPalette()");
}
