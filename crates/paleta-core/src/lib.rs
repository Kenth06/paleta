//! paleta-core — SIMD-accelerated color quantization for WASM.
//!
//! Port of the TS histogram + Wu implementation in `packages/core/src/quantize`.
//! Compile with `RUSTFLAGS='-C target-feature=+simd128'` to enable WASM SIMD.

#![deny(unsafe_op_in_unsafe_fn)]

mod histogram;
mod wu;

use wasm_bindgen::prelude::*;

pub(crate) const HIST_BITS: u32 = 5;
pub(crate) const HIST_SIDE: u32 = 1 << HIST_BITS; // 32
pub(crate) const HIST_STRIDE: usize = 5;

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Quantize an RGBA buffer to `count` colors.
///
/// Returns a flat `Uint8Array`-friendly layout:
///   [r0, g0, b0, pop0_le_u32(4 bytes), r1, g1, b1, pop1_le_u32(4 bytes), ...]
/// so each palette entry occupies 7 bytes: 3 for RGB + 4 for the 32-bit
/// little-endian population count.
///
/// The JS wrapper decodes this into `{ palette: RGB[], populations: u32[] }`.
#[wasm_bindgen]
pub fn quantize_wu(
    rgba: &[u8],
    width: u32,
    height: u32,
    count: u32,
    step: u32,
    alpha_threshold: u8,
    include_white: bool,
) -> Vec<u8> {
    let step = step.max(1) as usize;
    let count = count.max(2).min(32) as usize;

    let hist = histogram::build(
        rgba,
        width as usize,
        height as usize,
        step,
        alpha_threshold,
        include_white,
    );
    let result = wu::quantize(&hist, count);

    let mut out = Vec::with_capacity(result.palette.len() * 7);
    for (i, rgb) in result.palette.iter().enumerate() {
        out.push(rgb[0]);
        out.push(rgb[1]);
        out.push(rgb[2]);
        let pop = result.populations[i] as u32;
        out.extend_from_slice(&pop.to_le_bytes());
    }
    out
}

/// Exposed for direct-access benchmarks that want to time histogram alone.
#[wasm_bindgen]
pub fn build_histogram_total(
    rgba: &[u8],
    width: u32,
    height: u32,
    step: u32,
    alpha_threshold: u8,
    include_white: bool,
) -> u32 {
    let h = histogram::build(
        rgba,
        width as usize,
        height as usize,
        (step as usize).max(1),
        alpha_threshold,
        include_white,
    );
    h.total as u32
}
