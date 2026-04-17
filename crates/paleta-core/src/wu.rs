//! Wu's color quantization algorithm, Rust port.
//!
//! Parallel to `packages/core/src/quantize/wu.ts` — same math, same correctness
//! contract. The Rust version wins by not going through the V8 object-hash
//! heap for `Box` and by letting LLVM inline the inner volume() helpers.

use crate::{histogram::Histogram, HIST_SIDE, HIST_STRIDE};

const SIDE: usize = (HIST_SIDE as usize) + 1;
const TABLE: usize = SIDE * SIDE * SIDE;

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

struct Tables {
    wt: Vec<f64>,
    mr: Vec<f64>,
    mg: Vec<f64>,
    mb: Vec<f64>,
    m2: Vec<f64>,
}

fn build_cumulative(hist: &Histogram) -> Tables {
    let mut wt = vec![0.0; TABLE];
    let mut mr = vec![0.0; TABLE];
    let mut mg = vec![0.0; TABLE];
    let mut mb = vec![0.0; TABLE];
    let mut m2 = vec![0.0; TABLE];

    // Copy raw histogram into the r>=1 / g>=1 / b>=1 region.
    for r in 1..=(HIST_SIDE as usize) {
        for g in 1..=(HIST_SIDE as usize) {
            for b in 1..=(HIST_SIDE as usize) {
                let h = ((((r - 1) << 10) | ((g - 1) << 5) | (b - 1)) * HIST_STRIDE) as usize;
                let c = idx(r, g, b);
                wt[c] = hist.moments[h];
                mr[c] = hist.moments[h + 1];
                mg[c] = hist.moments[h + 2];
                mb[c] = hist.moments[h + 3];
                m2[c] = hist.moments[h + 4];
            }
        }
    }

    // 3D prefix sum (b, then g, then r).
    for r in 1..=(HIST_SIDE as usize) {
        let mut area_wt = [0f64; SIDE];
        let mut area_mr = [0f64; SIDE];
        let mut area_mg = [0f64; SIDE];
        let mut area_mb = [0f64; SIDE];
        let mut area_m2 = [0f64; SIDE];

        for g in 1..=(HIST_SIDE as usize) {
            let mut line_wt = 0.0;
            let mut line_mr = 0.0;
            let mut line_mg = 0.0;
            let mut line_mb = 0.0;
            let mut line_m2 = 0.0;
            for b in 1..=(HIST_SIDE as usize) {
                let i = idx(r, g, b);
                line_wt += wt[i];
                line_mr += mr[i];
                line_mg += mg[i];
                line_mb += mb[i];
                line_m2 += m2[i];
                area_wt[b] += line_wt;
                area_mr[b] += line_mr;
                area_mg[b] += line_mg;
                area_mb[b] += line_mb;
                area_m2[b] += line_m2;
                let prev = idx(r - 1, g, b);
                wt[i] = wt[prev] + area_wt[b];
                mr[i] = mr[prev] + area_mr[b];
                mg[i] = mg[prev] + area_mg[b];
                mb[i] = mb[prev] + area_mb[b];
                m2[i] = m2[prev] + area_m2[b];
            }
        }
    }

    Tables { wt, mr, mg, mb, m2 }
}

#[inline(always)]
fn volume(t: &[f64], bx: &Box3) -> f64 {
    t[idx(bx.r1, bx.g1, bx.b1)]
        - t[idx(bx.r1, bx.g1, bx.b0)]
        - t[idx(bx.r1, bx.g0, bx.b1)]
        + t[idx(bx.r1, bx.g0, bx.b0)]
        - t[idx(bx.r0, bx.g1, bx.b1)]
        + t[idx(bx.r0, bx.g1, bx.b0)]
        + t[idx(bx.r0, bx.g0, bx.b1)]
        - t[idx(bx.r0, bx.g0, bx.b0)]
}

fn variance(t: &Tables, bx: &Box3) -> f64 {
    let w = volume(&t.wt, bx);
    if w == 0.0 {
        return 0.0;
    }
    let r = volume(&t.mr, bx);
    let g = volume(&t.mg, bx);
    let b = volume(&t.mb, bx);
    let sq = volume(&t.m2, bx);
    sq - (r * r + g * g + b * b) / w
}

#[derive(Clone, Copy)]
enum Axis {
    R,
    G,
    B,
}

struct Moment {
    w: f64,
    r: f64,
    g: f64,
    b: f64,
    sq: f64,
}

fn bottom(t: &Tables, axis: Axis, bx: &Box3) -> Moment {
    let f = |a: &[f64]| -> f64 {
        match axis {
            Axis::R => {
                -a[idx(bx.r0, bx.g1, bx.b1)]
                    + a[idx(bx.r0, bx.g1, bx.b0)]
                    + a[idx(bx.r0, bx.g0, bx.b1)]
                    - a[idx(bx.r0, bx.g0, bx.b0)]
            }
            Axis::G => {
                -a[idx(bx.r1, bx.g0, bx.b1)]
                    + a[idx(bx.r1, bx.g0, bx.b0)]
                    + a[idx(bx.r0, bx.g0, bx.b1)]
                    - a[idx(bx.r0, bx.g0, bx.b0)]
            }
            Axis::B => {
                -a[idx(bx.r1, bx.g1, bx.b0)]
                    + a[idx(bx.r1, bx.g0, bx.b0)]
                    + a[idx(bx.r0, bx.g1, bx.b0)]
                    - a[idx(bx.r0, bx.g0, bx.b0)]
            }
        }
    };
    Moment {
        w: f(&t.wt),
        r: f(&t.mr),
        g: f(&t.mg),
        b: f(&t.mb),
        sq: f(&t.m2),
    }
}

fn top(t: &Tables, axis: Axis, pos: usize, bx: &Box3) -> Moment {
    let f = |a: &[f64]| -> f64 {
        match axis {
            Axis::R => {
                a[idx(pos, bx.g1, bx.b1)]
                    - a[idx(pos, bx.g1, bx.b0)]
                    - a[idx(pos, bx.g0, bx.b1)]
                    + a[idx(pos, bx.g0, bx.b0)]
            }
            Axis::G => {
                a[idx(bx.r1, pos, bx.b1)]
                    - a[idx(bx.r1, pos, bx.b0)]
                    - a[idx(bx.r0, pos, bx.b1)]
                    + a[idx(bx.r0, pos, bx.b0)]
            }
            Axis::B => {
                a[idx(bx.r1, bx.g1, pos)]
                    - a[idx(bx.r1, bx.g0, pos)]
                    - a[idx(bx.r0, bx.g1, pos)]
                    + a[idx(bx.r0, bx.g0, pos)]
            }
        }
    };
    Moment {
        w: f(&t.wt),
        r: f(&t.mr),
        g: f(&t.mg),
        b: f(&t.mb),
        sq: f(&t.m2),
    }
}

fn maximize(
    t: &Tables,
    bx: &Box3,
    axis: Axis,
    from: usize,
    to: usize,
    whole: Moment,
) -> (f64, isize) {
    let base = bottom(t, axis, bx);
    let mut max = 0.0;
    let mut cut: isize = -1;
    for i in from..to {
        let half = top(t, axis, i, bx);
        let w1 = base.w + half.w;
        if w1 == 0.0 {
            continue;
        }
        let r1 = base.r + half.r;
        let g1 = base.g + half.g;
        let b1 = base.b + half.b;
        let w2 = whole.w - w1;
        if w2 == 0.0 {
            continue;
        }
        let r2 = whole.r - r1;
        let g2 = whole.g - g1;
        let b2 = whole.b - b1;
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
    let whole = Moment {
        w: volume(&t.wt, s1),
        r: volume(&t.mr, s1),
        g: volume(&t.mg, s1),
        b: volume(&t.mb, s1),
        sq: 0.0,
    };
    let whole_copy = Moment { ..whole };
    let (mr, cr) = maximize(t, s1, Axis::R, s1.r0 + 1, s1.r1, whole);
    let (mg, cg) = maximize(
        t,
        s1,
        Axis::G,
        s1.g0 + 1,
        s1.g1,
        Moment { ..whole_copy },
    );
    let (mb, cb) = maximize(
        t,
        s1,
        Axis::B,
        s1.b0 + 1,
        s1.b1,
        Moment { ..whole_copy },
    );

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

// `whole` is consumed by `maximize`, so we implement Clone via struct-update.
impl Clone for Moment {
    fn clone(&self) -> Moment {
        Moment {
            w: self.w,
            r: self.r,
            g: self.g,
            b: self.b,
            sq: self.sq,
        }
    }
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
        // Split boxes[next] into boxes[next] and boxes[i].
        let (left, right) = boxes.split_at_mut(i);
        let s1 = &mut left[next];
        let s2 = &mut right[0];
        if cut(&tables, s1, s2) {
            vv[next] = if s1.vol > 1 { variance(&tables, s1) } else { 0.0 };
            vv[i] = if s2.vol > 1 { variance(&tables, s2) } else { 0.0 };
        } else {
            vv[next] = 0.0;
            // Retry this slot.
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
        let w = volume(&tables.wt, bx);
        if w <= 0.0 {
            continue;
        }
        let r = (volume(&tables.mr, bx) / w).round().clamp(0.0, 255.0) as u8;
        let g = (volume(&tables.mg, bx) / w).round().clamp(0.0, 255.0) as u8;
        let b = (volume(&tables.mb, bx) / w).round().clamp(0.0, 255.0) as u8;
        palette.push([r, g, b]);
        populations.push(w);
    }
    WuResult { palette, populations }
}
