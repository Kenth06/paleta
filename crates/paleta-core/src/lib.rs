//! paleta-core — SIMD-accelerated color quantization for WASM.
//!
//! v0.1 scaffold. The TS kernel in `packages/core` is authoritative today;
//! v0.2 will replace the histogram + Wu hot paths with calls into this crate.
//!
//! Target: sub-0.15ms quantize on 128×128 input inside a Workers isolate.
//! Build with `scripts/build-wasm.sh` which sets `-C target-feature=+simd128`.

#![deny(unsafe_op_in_unsafe_fn)]

use wasm_bindgen::prelude::*;

/// Returns the crate version so JS callers can verify the right WASM is loaded.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Placeholder for the Wu quantizer. v0.2 will port the TS implementation.
#[wasm_bindgen]
pub fn quantize_wu(_rgba: &[u8], _width: u32, _height: u32, _count: u32) -> Vec<u8> {
    // TODO(v0.2): build 5-bit histogram with SIMD lane packing, then Wu.
    // Returned buffer layout will be: [r,g,b, pop_le_u32] * K.
    Vec::new()
}
