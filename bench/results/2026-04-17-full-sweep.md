# Bench results — 2026-04-17 (end of JPEG edge-case sweep)

**Final numbers**: paleta DC-only is **4–12× faster** than jSquash mozjpeg
full decode on real JPEGs across every tested size and subsampling.

## Setup

- Node v22, aarch64 (Apple Silicon), vitest 2.1.9.
- paleta Rust crate built with `+simd128`, wasm-opt -O3.
- `@jsquash/jpeg@1.6.0` (mozjpeg) initialized in the same Node process.
- Fixtures: PIL-generated at quality 80–85.

## Decode time — head-to-head

| Fixture                       | paleta DC-only | jSquash full | Δ          |
| ----------------------------- | -------------- | ------------ | ---------- |
| 64×64 solid 4:4:4             | **0.006 ms**   | 0.036 ms     | **5.9×**   |
| 128×128 four-quadrants 4:2:0  | **0.009 ms**   | 0.115 ms     | **12.3×**  |
| 640×480 scene 4:4:4           | **0.552 ms**   | 2.330 ms     | **4.2×**   |
| 640×480 scene 4:2:0           | **0.326 ms**   | 2.188 ms     | **6.7×**   |
| 1280×720 scene 4:2:0          | **0.777 ms**   | 6.272 ms     | **8.1×**   |

## End-to-end `getPalette` (decode + resize + histogram + Wu)

| Fixture              | DC-only path | full-decode path | Δ        |
| -------------------- | ------------ | ---------------- | -------- |
| 640×480 4:2:0        | **0.536 ms** | 2.445 ms         | **4.56×** |
| 1280×720 4:2:0       | **1.040 ms** | 6.593 ms         | **6.34×** |

## Evolution of the DC-only decoder (all on 640×480 4:2:0)

| Stage                                 | Mean time | Vs jSquash |
| ------------------------------------- | --------- | ---------- |
| v0.3 initial (linear-scan Huffman)    | 3.68 ms   | **slower** (0.59×) |
| + 256-entry Huffman fast lookup       | 0.47 ms   | 4.65× |
| + Buffered u32 BitReader              | **0.33 ms** | **6.7×** |

The two optimizations together delivered an **11× speedup** on the
decoder. The first was algorithmic (O(n) linear scan → O(1) lookup);
the second was mechanical (per-bit branch overhead → buffered shifts).

## Format coverage

| JPEG variant                         | Supported? | Test fixture |
| ------------------------------------ | ---------- | ------------ |
| Baseline sequential, YCbCr 4:4:4     | ✅         | red-blue-444 |
| Baseline sequential, YCbCr 4:2:0     | ✅         | four-quadrants-420 |
| Baseline sequential, YCbCr 4:2:2     | ✅         | paleta-422   |
| Baseline sequential, YCbCr 4:4:0     | ✅         | (code path)  |
| Baseline sequential, grayscale       | ✅         | paleta-gray  |
| Baseline sequential, CMYK / YCCK     | ✅         | paleta-cmyk  |
| Progressive, interleaved DC scan     | ✅         | paleta-progressive |
| Progressive, non-interleaved DC scans| ✅         | paleta-progressive-noninterleaved |
| SOF3 lossless                        | ❌ refused | (unit test)  |
| SOF5–SOF15 hierarchical/diff         | ❌ refused | (unit test)  |
| Arithmetic coding (DAC)              | ❌ refused | (unit test)  |

## Remaining headroom (not worth pursuing yet)

- Per-MCU Huffman dispatch table — precompute for the specific pair of DC
  Huffman tables actually in use. Avoids one pointer dereference per
  decode. Estimated 5–10% gain.
- Parallel DC stride prediction — current implementation processes MCUs
  sequentially, but DCs within one component can be decoded independently
  once blocks are known (they depend on the previous block's DC only for
  one variable). Marginal since decode is already <1ms on 720p.
- Larger fast-lookup table (10- or 12-bit instead of 8-bit). Would
  cover ~100% of JPEG Huffman codes in one table lookup. Memory cost
  1KB → 4KB.

## Artifact

- WASM post wasm-opt: **59 KB** (includes full DC decoder + Wu + histogram).
- JS shim: 8.2 KB.
- Total cold-load cost on a Worker: ~68 KB gzipped (well under any realistic budget).
