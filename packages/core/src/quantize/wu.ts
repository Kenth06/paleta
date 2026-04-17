/**
 * Wu's color quantization algorithm on a 5-bit RGB histogram.
 *
 * The algorithm:
 *   1. Build 3D cumulative moment tables from the histogram so any box's
 *      sum-of-counts / sum-of-channels / sum-of-squares is an O(1) lookup.
 *   2. Start with one box covering the whole 32³ histogram.
 *   3. Repeatedly pick the box with the largest sum-of-squares variance,
 *      then split it along the axis + position that yields the greatest
 *      reduction in variance.
 *   4. When you have K boxes, the palette is the weighted mean of each.
 *
 * Cost is dominated by the cumulative-moments build (O(32³) ~ 33k ops) —
 * essentially constant regardless of input size.
 *
 * References:
 *   - Xiaolin Wu, "Efficient Statistical Computations for Optimal Color
 *     Quantization" (Graphics Gems II, 1991).
 *   - https://www.ece.mcmaster.ca/~xwu/cq.c
 */

import type { RGB } from "../types.js";
import { HIST_SIDE, HIST_STRIDE, type HistogramResult } from "./histogram.js";

const SIDE = HIST_SIDE + 1; // +1 for inclusive-exclusive cumulative indexing
const TABLE_SIZE = SIDE * SIDE * SIDE;

interface Box {
  r0: number; r1: number;
  g0: number; g1: number;
  b0: number; b1: number;
  vol: number;
}

function idx(r: number, g: number, b: number): number {
  return (r * SIDE + g) * SIDE + b;
}

/** Build cumulative moment tables from raw histogram moments. */
function buildCumulative(raw: Float64Array): {
  wt: Float64Array;
  mr: Float64Array;
  mg: Float64Array;
  mb: Float64Array;
  m2: Float64Array;
} {
  const wt = new Float64Array(TABLE_SIZE);
  const mr = new Float64Array(TABLE_SIZE);
  const mg = new Float64Array(TABLE_SIZE);
  const mb = new Float64Array(TABLE_SIZE);
  const m2 = new Float64Array(TABLE_SIZE);

  // 1) Copy histogram into the r>=1, g>=1, b>=1 region of the cumulative tables.
  for (let r = 1; r <= HIST_SIDE; r++) {
    for (let g = 1; g <= HIST_SIDE; g++) {
      for (let b = 1; b <= HIST_SIDE; b++) {
        const hIndex =
          (((r - 1) << 10) | ((g - 1) << 5) | (b - 1)) * HIST_STRIDE;
        const cIndex = idx(r, g, b);
        wt[cIndex] = raw[hIndex]!;
        mr[cIndex] = raw[hIndex + 1]!;
        mg[cIndex] = raw[hIndex + 2]!;
        mb[cIndex] = raw[hIndex + 3]!;
        m2[cIndex] = raw[hIndex + 4]!;
      }
    }
  }

  // 2) 3D prefix sum. We accumulate along b, then g, then r.
  for (let r = 1; r <= HIST_SIDE; r++) {
    const area_wt = new Float64Array(SIDE);
    const area_mr = new Float64Array(SIDE);
    const area_mg = new Float64Array(SIDE);
    const area_mb = new Float64Array(SIDE);
    const area_m2 = new Float64Array(SIDE);

    for (let g = 1; g <= HIST_SIDE; g++) {
      let line_wt = 0, line_mr = 0, line_mg = 0, line_mb = 0, line_m2 = 0;
      for (let b = 1; b <= HIST_SIDE; b++) {
        const i = idx(r, g, b);
        line_wt += wt[i]!;
        line_mr += mr[i]!;
        line_mg += mg[i]!;
        line_mb += mb[i]!;
        line_m2 += m2[i]!;
        area_wt[b]! += line_wt;
        area_mr[b]! += line_mr;
        area_mg[b]! += line_mg;
        area_mb[b]! += line_mb;
        area_m2[b]! += line_m2;
        const iPrev = idx(r - 1, g, b);
        wt[i] = wt[iPrev]! + area_wt[b]!;
        mr[i] = mr[iPrev]! + area_mr[b]!;
        mg[i] = mg[iPrev]! + area_mg[b]!;
        mb[i] = mb[iPrev]! + area_mb[b]!;
        m2[i] = m2[iPrev]! + area_m2[b]!;
      }
    }
  }

  return { wt, mr, mg, mb, m2 };
}

type Tables = ReturnType<typeof buildCumulative>;

/** Inclusive–exclusive volume of moment `m` in `box`. */
function volume(t: Float64Array, box: Box): number {
  return (
    t[idx(box.r1, box.g1, box.b1)]! -
    t[idx(box.r1, box.g1, box.b0)]! -
    t[idx(box.r1, box.g0, box.b1)]! +
    t[idx(box.r1, box.g0, box.b0)]! -
    t[idx(box.r0, box.g1, box.b1)]! +
    t[idx(box.r0, box.g1, box.b0)]! +
    t[idx(box.r0, box.g0, box.b1)]! -
    t[idx(box.r0, box.g0, box.b0)]!
  );
}

/** Sum-of-squares variance of the box. Guides which box to split next. */
function variance(t: Tables, box: Box): number {
  const w = volume(t.wt, box);
  if (w === 0) return 0;
  const r = volume(t.mr, box);
  const g = volume(t.mg, box);
  const b = volume(t.mb, box);
  const sq = volume(t.m2, box);
  return sq - (r * r + g * g + b * b) / w;
}

/**
 * Partial sums along one axis at position `pos`, used by the split search.
 * The caller rotates box limits via `axis` to keep a single implementation.
 */
function bottom(t: Tables, axis: "r" | "g" | "b", box: Box): {
  w: number; r: number; g: number; b: number; sq: number;
} {
  const f = (arr: Float64Array): number => {
    if (axis === "r") {
      return (
        -arr[idx(box.r0, box.g1, box.b1)]! +
        arr[idx(box.r0, box.g1, box.b0)]! +
        arr[idx(box.r0, box.g0, box.b1)]! -
        arr[idx(box.r0, box.g0, box.b0)]!
      );
    }
    if (axis === "g") {
      return (
        -arr[idx(box.r1, box.g0, box.b1)]! +
        arr[idx(box.r1, box.g0, box.b0)]! +
        arr[idx(box.r0, box.g0, box.b1)]! -
        arr[idx(box.r0, box.g0, box.b0)]!
      );
    }
    return (
      -arr[idx(box.r1, box.g1, box.b0)]! +
      arr[idx(box.r1, box.g0, box.b0)]! +
      arr[idx(box.r0, box.g1, box.b0)]! -
      arr[idx(box.r0, box.g0, box.b0)]!
    );
  };
  return { w: f(t.wt), r: f(t.mr), g: f(t.mg), b: f(t.mb), sq: f(t.m2) };
}

function top(t: Tables, axis: "r" | "g" | "b", pos: number, box: Box): {
  w: number; r: number; g: number; b: number; sq: number;
} {
  const f = (arr: Float64Array): number => {
    if (axis === "r") {
      return (
        arr[idx(pos, box.g1, box.b1)]! -
        arr[idx(pos, box.g1, box.b0)]! -
        arr[idx(pos, box.g0, box.b1)]! +
        arr[idx(pos, box.g0, box.b0)]!
      );
    }
    if (axis === "g") {
      return (
        arr[idx(box.r1, pos, box.b1)]! -
        arr[idx(box.r1, pos, box.b0)]! -
        arr[idx(box.r0, pos, box.b1)]! +
        arr[idx(box.r0, pos, box.b0)]!
      );
    }
    return (
      arr[idx(box.r1, box.g1, pos)]! -
      arr[idx(box.r1, box.g0, pos)]! -
      arr[idx(box.r0, box.g1, pos)]! +
      arr[idx(box.r0, box.g0, pos)]!
    );
  };
  return { w: f(t.wt), r: f(t.mr), g: f(t.mg), b: f(t.mb), sq: f(t.m2) };
}

/** Best split along `axis`. Returns max-reduction and position, or -1 if none. */
function maximize(
  t: Tables,
  box: Box,
  axis: "r" | "g" | "b",
  from: number,
  to: number,
  whole: { w: number; r: number; g: number; b: number },
): { max: number; cut: number } {
  const base = bottom(t, axis, box);
  let max = 0;
  let cut = -1;

  for (let i = from; i < to; i++) {
    const half = top(t, axis, i, box);
    const w1 = base.w + half.w;
    if (w1 === 0) continue;
    const r1 = base.r + half.r;
    const g1 = base.g + half.g;
    const b1 = base.b + half.b;

    const w2 = whole.w - w1;
    if (w2 === 0) continue;
    const r2 = whole.r - r1;
    const g2 = whole.g - g1;
    const b2 = whole.b - b1;

    const temp =
      (r1 * r1 + g1 * g1 + b1 * b1) / w1 + (r2 * r2 + g2 * g2 + b2 * b2) / w2;

    if (temp > max) {
      max = temp;
      cut = i;
    }
  }

  return { max, cut };
}

function cut(t: Tables, set1: Box, set2: Box): boolean {
  const whole = {
    w: volume(t.wt, set1),
    r: volume(t.mr, set1),
    g: volume(t.mg, set1),
    b: volume(t.mb, set1),
  };

  const r = maximize(t, set1, "r", set1.r0 + 1, set1.r1, whole);
  const g = maximize(t, set1, "g", set1.g0 + 1, set1.g1, whole);
  const b = maximize(t, set1, "b", set1.b0 + 1, set1.b1, whole);

  let axis: "r" | "g" | "b";
  if (r.max >= g.max && r.max >= b.max) {
    axis = "r";
    if (r.cut < 0) return false;
  } else if (g.max >= r.max && g.max >= b.max) {
    axis = "g";
  } else {
    axis = "b";
  }

  set2.r1 = set1.r1;
  set2.g1 = set1.g1;
  set2.b1 = set1.b1;

  if (axis === "r") {
    set2.r0 = set1.r1 = r.cut;
    set2.g0 = set1.g0;
    set2.b0 = set1.b0;
  } else if (axis === "g") {
    set2.g0 = set1.g1 = g.cut;
    set2.r0 = set1.r0;
    set2.b0 = set1.b0;
  } else {
    set2.b0 = set1.b1 = b.cut;
    set2.r0 = set1.r0;
    set2.g0 = set1.g0;
  }

  set1.vol = (set1.r1 - set1.r0) * (set1.g1 - set1.g0) * (set1.b1 - set1.b0);
  set2.vol = (set2.r1 - set2.r0) * (set2.g1 - set2.g0) * (set2.b1 - set2.b0);
  return true;
}

export interface WuResult {
  /** Palette entries. */
  palette: RGB[];
  /** Population of each palette entry. Same order as `palette`. */
  populations: number[];
}

/** Quantize a histogram to at most `colorCount` colors using Wu's algorithm. */
export function quantizeWu(hist: HistogramResult, colorCount: number): WuResult {
  const count = Math.max(2, Math.min(32, colorCount | 0));
  const tables = buildCumulative(hist.moments);

  const boxes: Box[] = new Array(count);
  for (let i = 0; i < count; i++) {
    boxes[i] = { r0: 0, r1: 0, g0: 0, g1: 0, b0: 0, b1: 0, vol: 0 };
  }
  boxes[0] = { r0: 0, g0: 0, b0: 0, r1: HIST_SIDE, g1: HIST_SIDE, b1: HIST_SIDE, vol: 0 };

  const vv = new Float64Array(count);
  let next = 0;

  for (let i = 1; i < count; i++) {
    if (cut(tables, boxes[next]!, boxes[i]!)) {
      vv[next] = boxes[next]!.vol > 1 ? variance(tables, boxes[next]!) : 0;
      vv[i] = boxes[i]!.vol > 1 ? variance(tables, boxes[i]!) : 0;
    } else {
      vv[next] = 0;
      i--;
    }

    next = 0;
    let max = vv[0]!;
    for (let k = 1; k <= i; k++) {
      if (vv[k]! > max) { max = vv[k]!; next = k; }
    }
    if (max <= 0) {
      // No more splits possible; truncate palette at i+1.
      boxes.length = i + 1;
      break;
    }
  }

  const palette: RGB[] = [];
  const populations: number[] = [];
  for (const box of boxes) {
    const w = volume(tables.wt, box);
    if (w <= 0) continue;
    const r = Math.round(volume(tables.mr, box) / w);
    const g = Math.round(volume(tables.mg, box) / w);
    const b = Math.round(volume(tables.mb, box) / w);
    palette.push([r, g, b]);
    populations.push(w);
  }
  return { palette, populations };
}
