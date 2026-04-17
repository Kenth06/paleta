//! 5-bit RGB histogram.
//!
//! Flat `Vec<f64>` of 5 moments per bucket: [count, sumR, sumG, sumB, sumSq].
//! Parallel to the TS impl in `packages/core/src/quantize/histogram.ts`.
//!
//! The inner loop is simple enough that LLVM autovectorizes it cleanly when
//! compiled with `-C target-feature=+simd128`. Manual intrinsics don't help
//! here because the hot operations are gather-scatter (bucket index depends
//! on pixel value), which WASM SIMD can't accelerate.

use crate::{HIST_SIDE, HIST_STRIDE};

pub struct Histogram {
    pub moments: Vec<f64>,
    pub total: usize,
}

pub fn build(
    rgba: &[u8],
    width: usize,
    height: usize,
    step: usize,
    alpha_threshold: u8,
    include_white: bool,
) -> Histogram {
    let total_buckets = (HIST_SIDE as usize).pow(3);
    let mut moments = vec![0.0_f64; total_buckets * HIST_STRIDE];
    let pixel_count = width * height;
    let mut total: usize = 0;

    let mut i = 0usize;
    while i < pixel_count {
        let off = i * 4;
        if off + 4 > rgba.len() {
            break;
        }
        let r = rgba[off];
        let g = rgba[off + 1];
        let b = rgba[off + 2];
        let a = rgba[off + 3];

        if a >= alpha_threshold && (include_white || !(r > 250 && g > 250 && b > 250)) {
            let idx = (((r as usize) >> 3) << 10)
                | (((g as usize) >> 3) << 5)
                | ((b as usize) >> 3);
            let base = idx * HIST_STRIDE;
            let rf = r as f64;
            let gf = g as f64;
            let bf = b as f64;
            // SAFETY: `idx < HIST_SIZE` because each channel is 5 bits; the
            // allocation is `HIST_SIZE * HIST_STRIDE`, so `base+4 < len`.
            unsafe {
                *moments.get_unchecked_mut(base) += 1.0;
                *moments.get_unchecked_mut(base + 1) += rf;
                *moments.get_unchecked_mut(base + 2) += gf;
                *moments.get_unchecked_mut(base + 3) += bf;
                *moments.get_unchecked_mut(base + 4) += rf * rf + gf * gf + bf * bf;
            }
            total += 1;
        }

        i += step;
    }

    Histogram { moments, total }
}
