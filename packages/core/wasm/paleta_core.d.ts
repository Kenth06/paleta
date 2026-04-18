/**
 * Hand-written declarations for the wasm-bindgen output. We passed
 * `--no-typescript` because the generated .d.ts uses `any` for the
 * default export and leaks unnecessary types. This mirrors the
 * functions actually exposed by the Rust crate (see `crates/paleta-core/src/lib.rs`).
 */

export function version(): string;

export function build_histogram_total(
  rgba: Uint8Array,
  width: number,
  height: number,
  step: number,
  alpha_threshold: number,
  include_white: boolean,
): number;

export function quantize_wu(
  rgba: Uint8Array,
  width: number,
  height: number,
  count: number,
  step: number,
  alpha_threshold: number,
  include_white: boolean,
): Uint8Array;

/**
 * Experimental: decode only the DC coefficients of a JPEG, yielding a 1/8×1/8
 * downsampled RGBA image. Returns an empty array if the JPEG is not
 * supported (progressive, non-YCbCr, non-4:4:4/4:2:0, etc.) — caller must
 * fall back to full decode.
 *
 * Output layout: [w_le_u32(4), h_le_u32(4), rgba_bytes...]
 */
export function dc_only_decode_jpeg(bytes: Uint8Array): Uint8Array;

export function initSync(module: WebAssembly.Module | { module: WebAssembly.Module }): unknown;

declare const __init: (
  source?:
    | string
    | URL
    | Request
    | Response
    | BufferSource
    | WebAssembly.Module
    | Promise<Response>
    | { module_or_path: string | URL | Request | Response | BufferSource | WebAssembly.Module },
) => Promise<unknown>;

export default __init;
