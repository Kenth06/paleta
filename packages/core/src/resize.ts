/**
 * Nearest-neighbor RGBA resize.
 *
 * Why NN? Palette extraction doesn't care about aliasing — we want color
 * frequencies preserved, not smooth edges. NN is the fastest possible resize
 * and avoids introducing colors that weren't in the source.
 *
 * Runs as a single pass over the destination pixels. No allocations past the
 * output buffer.
 */

export interface ResizeInput {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface ResizeOutput {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Resize RGBA image so the longer edge is at most `maxDimension`. If the image
 * is already smaller, the input is returned unchanged.
 */
export function resizeNearestRGBA(input: ResizeInput, maxDimension: number): ResizeOutput {
  const { data, width, height } = input;
  const longer = Math.max(width, height);
  if (longer <= maxDimension) return { data, width, height };

  const scale = maxDimension / longer;
  const dstW = Math.max(1, Math.round(width * scale));
  const dstH = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(dstW * dstH * 4);

  // Precompute source x for each dst x to avoid per-pixel mul+floor.
  const srcX = new Uint32Array(dstW);
  for (let x = 0; x < dstW; x++) srcX[x] = Math.min(width - 1, Math.floor((x * width) / dstW));

  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / dstH));
    const srcRow = sy * width * 4;
    const dstRow = y * dstW * 4;
    for (let x = 0; x < dstW; x++) {
      const sOff = srcRow + srcX[x]! * 4;
      const dOff = dstRow + x * 4;
      out[dOff] = data[sOff]!;
      out[dOff + 1] = data[sOff + 1]!;
      out[dOff + 2] = data[sOff + 2]!;
      out[dOff + 3] = data[sOff + 3]!;
    }
  }

  return { data: out, width: dstW, height: dstH };
}
