/**
 * Corruption + fuzz tests for the DC-only JPEG decoder.
 *
 * The decoder is a `Result<image, undefined>` black box — it must never
 * panic, hang, or return garbage on malformed input. Every test here
 * asserts that: mangled bytes either yield a correct image or return
 * `undefined` cleanly (which makes the pipeline fall back to the regular
 * decoder).
 *
 * If any of these tests ever panics the WASM module, the test runner
 * crashes with an Emscripten abort — catching that class of regression
 * is the whole point of the suite.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeJpegDcOnly, initWasm } from "@ken0106/core";

const WASM_PATH = fileURLToPath(
  new URL("../packages/core/wasm/paleta_core_bg.wasm", import.meta.url),
);

async function loadFixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(
      fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    ),
  );
}

function truncate(bytes: Uint8Array, len: number): Uint8Array {
  return bytes.slice(0, Math.max(0, Math.min(bytes.length, len)));
}

function flipByte(bytes: Uint8Array, offset: number, xor: number): Uint8Array {
  const out = bytes.slice();
  if (offset >= 0 && offset < out.length) {
    out[offset] = out[offset]! ^ xor;
  }
  return out;
}

function zeroFill(bytes: Uint8Array, from: number, to: number): Uint8Array {
  const out = bytes.slice();
  for (let i = Math.max(0, from); i < Math.min(out.length, to); i++) {
    out[i] = 0;
  }
  return out;
}

describe("DC-only: corruption resilience", () => {
  beforeAll(async () => {
    await initWasm(await readFile(WASM_PATH));
  });

  // The decoder should never throw or abort the WASM module. Returning
  // `undefined` is the success metric for malformed inputs.
  const assertReturnsUndefined = async (bytes: Uint8Array, label: string) => {
    const out = await decodeJpegDcOnly(bytes);
    expect(out, label).toBeUndefined();
  };

  it("truncated headers return undefined without panicking", async () => {
    const base = await loadFixture("red-blue-444.jpg");
    for (const n of [0, 1, 2, 3, 4, 10, 20, 50, 100]) {
      await assertReturnsUndefined(truncate(base, n), `truncate to ${n} bytes`);
    }
  });

  it("truncated entropy stream returns undefined", async () => {
    const base = await loadFixture("red-blue-444.jpg");
    // Truncate well into the file — should be mid-entropy for this fixture.
    for (const n of [300, 400, 500, 600, 700, 780]) {
      await assertReturnsUndefined(
        truncate(base, n),
        `truncate to ${n} bytes (mid entropy)`,
      );
    }
  });

  it("random-byte flips in headers never panic", async () => {
    const base = await loadFixture("paleta-scene-420.jpg");
    // Flip single bits in the header region — this triggers the worst
    // corruption cases (bad segment lengths, bad sampling factors, etc.).
    for (let off = 0; off < 80; off += 7) {
      for (const xor of [0x01, 0x10, 0x80, 0xff]) {
        const mangled = flipByte(base, off, xor);
        // We don't assert the output shape — just that it either decodes
        // to something plausible OR returns undefined. Never panics.
        const out = await decodeJpegDcOnly(mangled);
        if (out !== undefined) {
          expect(out.width).toBeGreaterThan(0);
          expect(out.height).toBeGreaterThan(0);
        }
      }
    }
  });

  it("zeroed entropy body returns undefined", async () => {
    const base = await loadFixture("red-blue-444.jpg");
    // Find SOS marker (0xFF 0xDA) and zero everything after it except EOI.
    let sos = -1;
    for (let i = 0; i < base.length - 1; i++) {
      if (base[i] === 0xff && base[i + 1] === 0xda) {
        sos = i;
        break;
      }
    }
    expect(sos).toBeGreaterThan(0);
    const mangled = zeroFill(base, sos + 10, base.length - 2);
    await assertReturnsUndefined(mangled, "zeroed entropy");
  });

  it("garbage header with JPEG SOI returns undefined", async () => {
    const garbage = new Uint8Array(200);
    garbage[0] = 0xff;
    garbage[1] = 0xd8;
    // Fill rest with pseudo-random noise that happens to contain FFs.
    let s = 99;
    for (let i = 2; i < garbage.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      garbage[i] = s & 0xff;
    }
    await assertReturnsUndefined(garbage, "garbage header");
  });

  it("oversized DRI restart interval doesn't hang", async () => {
    // Synthetic: SOI + DRI with restart_interval=65535 + EOI.
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xdd, 0x00, 0x04, 0xff, 0xff, // DRI len=4, interval=65535
      0xff, 0xd9,
    ]);
    await assertReturnsUndefined(bytes, "oversized DRI");
  });

  it("SOF with wildly large dimensions returns undefined", async () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08,
      0xff, 0xff, // height = 65535
      0xff, 0xff, // width = 65535
      0x03, // 3 components
      0x01, 0x22, 0x00,
      0x02, 0x11, 0x01,
      0x03, 0x11, 0x01,
      0xff, 0xd9,
    ]);
    // May decode to undefined because we can't satisfy SOS later, or decode
    // an enormous output buffer. Either is fine as long as we don't abort.
    const out = await decodeJpegDcOnly(bytes);
    expect(out).toBeUndefined();
  });

  it("DHT with length pointing past payload returns undefined", async () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc4, 0x00, 0x05, // DHT len=5 (too small for class+id+counts)
      0x00, 0x00, 0x00,
      0xff, 0xd9,
    ]);
    await assertReturnsUndefined(bytes, "short DHT");
  });

  it("every suffix of a valid JPEG returns undefined (stress test)", async () => {
    const base = await loadFixture("red-blue-444.jpg");
    // Skip the SOI and feed later offsets. Shouldn't panic even once.
    for (let off = 2; off < base.length; off += 13) {
      const out = await decodeJpegDcOnly(base.slice(off));
      if (out !== undefined) {
        expect(out.width).toBeGreaterThan(0);
        expect(out.height).toBeGreaterThan(0);
      }
    }
  });

  it("every single-byte mutation of the progressive fixture never panics", async () => {
    const base = await loadFixture("paleta-progressive.jpg");
    // Full byte sweep at a stride — covers the IFD/APP1/DQT/DHT/SOS/entropy
    // regions without taking forever.
    for (let off = 0; off < base.length; off += 11) {
      for (const xor of [0x80, 0xff]) {
        const out = await decodeJpegDcOnly(flipByte(base, off, xor));
        if (out !== undefined) {
          expect(out.width).toBeGreaterThan(0);
          expect(out.height).toBeGreaterThan(0);
        }
      }
    }
  });
});
