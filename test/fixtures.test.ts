/**
 * End-to-end fixture tests: real PNG bytes → full pipeline → palette quality.
 *
 * For each procedural fixture we:
 *   1. Encode to a real PNG (so the pipeline actually runs the sniffer on
 *      PNG magic bytes and goes through the decode step).
 *   2. Run getPalette with a custom PNG decoder (our native helper — keeps
 *      the test Node-only, no WASM init race).
 *   3. Assert each `expectedColors` entry is present in the returned palette
 *      within ΔE_OK < EPS. This is "perceptually indistinguishable" for
 *      palette purposes.
 *   4. Verify `dominant` matches the highest-population expected color.
 */

import { describe, expect, it } from "vitest";
import {
  deltaE_OK,
  getPalette,
  rgbToOKLab,
  type DecodeFn,
  type RGB,
} from "@paleta/core";
import { decodePNG, encodePNG } from "./helpers/png.js";
import { ALL_FIXTURES, type Fixture } from "./helpers/fixtures.js";

const PNG_DECODER: DecodeFn = async (bytes) => {
  const { data, width, height } = decodePNG(bytes);
  return { data, width, height };
};

/** Perceptual distance ΔE_OK threshold. ~2 is "just noticeable". */
const EPS = 4;

function minDistanceToPalette(target: RGB, palette: readonly RGB[]): number {
  const a = rgbToOKLab(target[0], target[1], target[2]);
  let best = Number.POSITIVE_INFINITY;
  for (const entry of palette) {
    const b = rgbToOKLab(entry[0], entry[1], entry[2]);
    const d = deltaE_OK(a, b);
    if (d < best) best = d;
  }
  return best;
}

async function extractFixture(fixture: Fixture): Promise<{
  palette: RGB[];
  dominant: RGB;
}> {
  const png = encodePNG(fixture.rgba, fixture.width, fixture.height);
  const result = await getPalette(png, {
    decoder: PNG_DECODER,
    colorCount: Math.max(fixture.expectedColors.length + 2, 6),
    includeWhite: true,
  });
  return { palette: result.palette, dominant: result.dominant };
}

describe("fixture suite — palette quality end-to-end", () => {
  for (const makeFixture of ALL_FIXTURES) {
    const fixture = makeFixture();
    it(`${fixture.name}: recovers all expected colors within ΔE_OK < ${EPS}`, async () => {
      const { palette } = await extractFixture(fixture);

      for (const expected of fixture.expectedColors) {
        const distance = minDistanceToPalette(expected, palette);
        expect(
          distance,
          `expected ${JSON.stringify(expected)} within ΔE < ${EPS} of palette ${JSON.stringify(palette)}, got ΔE=${distance.toFixed(3)}`,
        ).toBeLessThan(EPS);
      }
    });

    it(`${fixture.name}: dominant matches the primary expected color`, async () => {
      const { dominant } = await extractFixture(fixture);
      const primary = fixture.expectedColors[0]!;
      const distance = minDistanceToPalette(primary, [dominant]);
      expect(
        distance,
        `dominant ${JSON.stringify(dominant)} should match primary ${JSON.stringify(primary)} within ΔE < ${EPS}, got ΔE=${distance.toFixed(3)}`,
      ).toBeLessThan(EPS);
    });
  }
});

describe("fixture suite — PNG round-trip sanity", () => {
  it("round-trips pixel-exact through encodePNG + decodePNG", () => {
    const fixture = ALL_FIXTURES[2]!();
    const png = encodePNG(fixture.rgba, fixture.width, fixture.height);
    const decoded = decodePNG(png);
    expect(decoded.width).toBe(fixture.width);
    expect(decoded.height).toBe(fixture.height);
    expect(decoded.data).toEqual(fixture.rgba);
  });
});
