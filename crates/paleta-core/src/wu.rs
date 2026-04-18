//! Wu's color quantization algorithm, Rust port with packed moment layout.
//!
//! Parallel to `packages/core/src/quantize/wu.ts` — same math, same correctness
//! contract. This version stores the 5 cumulative moments (count, sumR, sumG,
//! sumB, sumSq) packed into a single `Vec<f64>` with stride 5, so a single
//! `volume5` pass across 8 cube corners retrieves all 5 moments in one go
//! instead of calling the scalar volume() 5 times (5× load reduction on the
//! hot path inside cut/maximize).

use crate::{histogram::Histogram, HIST_SIDE, HIST_STRIDE};

const SIDE: usize = (HIST_SIDE as usize) + 1;
const TABLE: usize = SIDE * SIDE * SIDE;
const M: usize = 5; // moments per bucket

#[derive(Clone, Copy, Default)]
struct Box3 {
    r0: usize,
    r1: usize,
    g0: usize,
    g1: usize,
    b0: usize,
    b1: usize,
    vol: usize,
}

#[inline(always)]
fn idx(r: usize, g: usize, b: usize) -> usize {
    (r * SIDE + g) * SIDE + b
}

/// Packed cumulative tables: 5 moments per bucket, stored contiguously.
/// `tables[idx(r,g,b)*M + k]` = k-th cumulative moment at (r,g,b).
struct Tables {
    t: Vec<f64>,
}

fn build_cumulative(hist: &Histogram) -> Tables {
    let mut t = vec![0.0f64; TABLE * M];

    // 1) Copy raw histogram into the r>=1 / g>=1 / b>=1 region.
    for r in 1..=(HIST_SIDE as usize) {
        for g in 1..=(HIST_SIDE as usize) {
            for b in 1..=(HIST_SIDE as usize) {
                let h = ((((r - 1) << 10) | ((g - 1) << 5) | (b - 1)) * HIST_STRIDE) as usize;
                let c = idx(r, g, b) * M;
                t[c] = hist.moments[h];
                t[c + 1] = hist.moments[h + 1];
                t[c + 2] = hist.moments[h + 2];
                t[c + 3] = hist.moments[h + 3];
                t[c + 4] = hist.moments[h + 4];
            }
        }
    }

    // 2) 3D prefix sum (b, then g, then r). One pass updates all 5 moments
    //    at each position in lockstep — LLVM will emit SIMD adds since the
    //    data is flat and contiguous.
    for r in 1..=(HIST_SIDE as usize) {
        let mut area = vec![0.0f64; SIDE * M];
        for g in 1..=(HIST_SIDE as usize) {
            let mut line = [0.0f64; M];
            for b in 1..=(HIST_SIDE as usize) {
                let i = idx(r, g, b) * M;
                for k in 0..M {
                    line[k] += t[i + k];
                    area[b * M + k] += line[k];
                }
                let prev = idx(r - 1, g, b) * M;
                for k in 0..M {
                    t[i + k] = t[prev + k] + area[b * M + k];
                }
            }
        }
    }

    Tables { t }
}

/// Single-moment volume — rarely used; `volume5` is the hot path.
#[inline(always)]
fn volume1(t: &[f64], k: usize, bx: &Box3) -> f64 {
    let step = M;
    t[idx(bx.r1, bx.g1, bx.b1) * step + k]
        - t[idx(bx.r1, bx.g1, bx.b0) * step + k]
        - t[idx(bx.r1, bx.g0, bx.b1) * step + k]
        + t[idx(bx.r1, bx.g0, bx.b0) * step + k]
        - t[idx(bx.r0, bx.g1, bx.b1) * step + k]
        + t[idx(bx.r0, bx.g1, bx.b0) * step + k]
        + t[idx(bx.r0, bx.g0, bx.b1) * step + k]
        - t[idx(bx.r0, bx.g0, bx.b0) * step + k]
}

/// All-5-moment volume in a single pass.
/// Loads 8 corners × 5 moments with packed memory access; LLVM can keep the
/// 5 accumulators in SIMD lanes on the +simd128 target.
#[inline(always)]
fn volume5(t: &[f64], bx: &Box3) -> [f64; M] {
    let i0 = idx(bx.r1, bx.g1, bx.b1) * M;
    let i1 = idx(bx.r1, bx.g1, bx.b0) * M;
    let i2 = idx(bx.r1, bx.g0, bx.b1) * M;
    let i3 = idx(bx.r1, bx.g0, bx.b0) * M;
    let i4 = idx(bx.r0, bx.g1, bx.b1) * M;
    let i5 = idx(bx.r0, bx.g1, bx.b0) * M;
    let i6 = idx(bx.r0, bx.g0, bx.b1) * M;
    let i7 = idx(bx.r0, bx.g0, bx.b0) * M;
    let mut out = [0.0f64; M];
    for k in 0..M {
        out[k] = t[i0 + k] - t[i1 + k] - t[i2 + k] + t[i3 + k]
            - t[i4 + k] + t[i5 + k] + t[i6 + k] - t[i7 + k];
    }
    out
}

#[inline(always)]
fn variance(t: &Tables, bx: &Box3) -> f64 {
    let m = volume5(&t.t, bx);
    let w = m[0];
    if w == 0.0 {
        return 0.0;
    }
    let r = m[1];
    let g = m[2];
    let b = m[3];
    let sq = m[4];
    sq - (r * r + g * g + b * b) / w
}

#[derive(Clone, Copy)]
enum Axis {
    R,
    G,
    B,
}

#[derive(Clone, Copy)]
struct Moment5 {
    m: [f64; M],
}

/// Bottom slab for the box along `axis`. Returns all 5 moments fused.
#[inline(always)]
fn bottom5(t: &[f64], axis: Axis, bx: &Box3) -> Moment5 {
    let (i0, i1, i2, i3): (usize, usize, usize, usize);
    match axis {
        Axis::R => {
            i0 = idx(bx.r0, bx.g1, bx.b1) * M;
            i1 = idx(bx.r0, bx.g1, bx.b0) * M;
            i2 = idx(bx.r0, bx.g0, bx.b1) * M;
            i3 = idx(bx.r0, bx.g0, bx.b0) * M;
        }
        Axis::G => {
            i0 = idx(bx.r1, bx.g0, bx.b1) * M;
            i1 = idx(bx.r1, bx.g0, bx.b0) * M;
            i2 = idx(bx.r0, bx.g0, bx.b1) * M;
            i3 = idx(bx.r0, bx.g0, bx.b0) * M;
        }
        Axis::B => {
            i0 = idx(bx.r1, bx.g1, bx.b0) * M;
            i1 = idx(bx.r1, bx.g0, bx.b0) * M;
            i2 = idx(bx.r0, bx.g1, bx.b0) * M;
            i3 = idx(bx.r0, bx.g0, bx.b0) * M;
        }
    }
    let mut out = [0.0f64; M];
    for k in 0..M {
        out[k] = -t[i0 + k] + t[i1 + k] + t[i2 + k] - t[i3 + k];
    }
    Moment5 { m: out }
}

/// Top slab at position `pos` along `axis`. Returns all 5 moments fused.
#[inline(always)]
fn top5(t: &[f64], axis: Axis, pos: usize, bx: &Box3) -> Moment5 {
    let (i0, i1, i2, i3): (usize, usize, usize, usize);
    match axis {
        Axis::R => {
            i0 = idx(pos, bx.g1, bx.b1) * M;
            i1 = idx(pos, bx.g1, bx.b0) * M;
            i2 = idx(pos, bx.g0, bx.b1) * M;
            i3 = idx(pos, bx.g0, bx.b0) * M;
        }
        Axis::G => {
            i0 = idx(bx.r1, pos, bx.b1) * M;
            i1 = idx(bx.r1, pos, bx.b0) * M;
            i2 = idx(bx.r0, pos, bx.b1) * M;
            i3 = idx(bx.r0, pos, bx.b0) * M;
        }
        Axis::B => {
            i0 = idx(bx.r1, bx.g1, pos) * M;
            i1 = idx(bx.r1, bx.g0, pos) * M;
            i2 = idx(bx.r0, bx.g1, pos) * M;
            i3 = idx(bx.r0, bx.g0, pos) * M;
        }
    }
    let mut out = [0.0f64; M];
    for k in 0..M {
        out[k] = t[i0 + k] - t[i1 + k] - t[i2 + k] + t[i3 + k];
    }
    Moment5 { m: out }
}

fn maximize(
    t: &Tables,
    bx: &Box3,
    axis: Axis,
    from: usize,
    to: usize,
    whole: Moment5,
) -> (f64, isize) {
    let base = bottom5(&t.t, axis, bx);
    let mut max = 0.0;
    let mut cut: isize = -1;
    for i in from..to {
        let half = top5(&t.t, axis, i, bx);
        let w1 = base.m[0] + half.m[0];
        if w1 == 0.0 {
            continue;
        }
        let r1 = base.m[1] + half.m[1];
        let g1 = base.m[2] + half.m[2];
        let b1 = base.m[3] + half.m[3];
        let w2 = whole.m[0] - w1;
        if w2 == 0.0 {
            continue;
        }
        let r2 = whole.m[1] - r1;
        let g2 = whole.m[2] - g1;
        let b2 = whole.m[3] - b1;
        let temp =
            (r1 * r1 + g1 * g1 + b1 * b1) / w1 + (r2 * r2 + g2 * g2 + b2 * b2) / w2;
        if temp > max {
            max = temp;
            cut = i as isize;
        }
    }
    (max, cut)
}

fn cut(t: &Tables, s1: &mut Box3, s2: &mut Box3) -> bool {
    let whole_arr = volume5(&t.t, s1);
    let whole = Moment5 { m: whole_arr };
    let (mr, cr) = maximize(t, s1, Axis::R, s1.r0 + 1, s1.r1, whole);
    let (mg, cg) = maximize(t, s1, Axis::G, s1.g0 + 1, s1.g1, whole);
    let (mb, cb) = maximize(t, s1, Axis::B, s1.b0 + 1, s1.b1, whole);

    let (axis, cut_pos) = if mr >= mg && mr >= mb {
        if cr < 0 {
            return false;
        }
        (Axis::R, cr as usize)
    } else if mg >= mr && mg >= mb {
        (Axis::G, cg as usize)
    } else {
        (Axis::B, cb as usize)
    };

    s2.r1 = s1.r1;
    s2.g1 = s1.g1;
    s2.b1 = s1.b1;

    match axis {
        Axis::R => {
            s2.r0 = cut_pos;
            s1.r1 = cut_pos;
            s2.g0 = s1.g0;
            s2.b0 = s1.b0;
        }
        Axis::G => {
            s2.g0 = cut_pos;
            s1.g1 = cut_pos;
            s2.r0 = s1.r0;
            s2.b0 = s1.b0;
        }
        Axis::B => {
            s2.b0 = cut_pos;
            s1.b1 = cut_pos;
            s2.r0 = s1.r0;
            s2.g0 = s1.g0;
        }
    }

    s1.vol = (s1.r1 - s1.r0) * (s1.g1 - s1.g0) * (s1.b1 - s1.b0);
    s2.vol = (s2.r1 - s2.r0) * (s2.g1 - s2.g0) * (s2.b1 - s2.b0);
    true
}

pub struct WuResult {
    pub palette: Vec<[u8; 3]>,
    pub populations: Vec<f64>,
}

pub fn quantize(hist: &Histogram, count: usize) -> WuResult {
    let count = count.clamp(2, 32);
    let tables = build_cumulative(hist);

    let mut boxes: Vec<Box3> = vec![Box3::default(); count];
    boxes[0] = Box3 {
        r0: 0,
        r1: HIST_SIDE as usize,
        g0: 0,
        g1: HIST_SIDE as usize,
        b0: 0,
        b1: HIST_SIDE as usize,
        vol: 0,
    };

    let mut vv = vec![0f64; count];
    let mut next = 0usize;

    let mut i = 1usize;
    let mut active_count = count;
    while i < active_count {
        let (left, right) = boxes.split_at_mut(i);
        let s1 = &mut left[next];
        let s2 = &mut right[0];
        if cut(&tables, s1, s2) {
            vv[next] = if s1.vol > 1 { variance(&tables, s1) } else { 0.0 };
            vv[i] = if s2.vol > 1 { variance(&tables, s2) } else { 0.0 };
        } else {
            vv[next] = 0.0;
            next = 0;
            let mut max = vv[0];
            for k in 1..=i {
                if vv[k] > max {
                    max = vv[k];
                    next = k;
                }
            }
            if max <= 0.0 {
                active_count = i;
                break;
            }
            continue;
        }

        next = 0;
        let mut max = vv[0];
        for k in 1..=i {
            if vv[k] > max {
                max = vv[k];
                next = k;
            }
        }
        if max <= 0.0 {
            active_count = i + 1;
            break;
        }
        i += 1;
    }

    boxes.truncate(active_count);

    let mut palette: Vec<[u8; 3]> = Vec::with_capacity(boxes.len());
    let mut populations: Vec<f64> = Vec::with_capacity(boxes.len());
    for bx in boxes.iter() {
        let w = volume1(&tables.t, 0, bx);
        if w <= 0.0 {
            continue;
        }
        let r = (volume1(&tables.t, 1, bx) / w).round().clamp(0.0, 255.0) as u8;
        let g = (volume1(&tables.t, 2, bx) / w).round().clamp(0.0, 255.0) as u8;
        let b = (volume1(&tables.t, 3, bx) / w).round().clamp(0.0, 255.0) as u8;
        palette.push([r, g, b]);
        populations.push(w);
    }
    WuResult { palette, populations }
}
