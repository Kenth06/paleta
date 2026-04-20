#!/usr/bin/env node
/**
 * Byte-flip fuzzer for the DC-only JPEG decoder. Any panic surfaces here
 * as a caught JS error with the file offset that triggered it. A clean
 * run = no panics across every (offset, xor) pair in the fixture set.
 *
 * Usage: `node scripts/find-panic.mjs`
 */

import { readFile, readdir } from "node:fs/promises";
import { decodeJpegDcOnly, initWasm } from "@ken0106/core";

await initWasm(await readFile("./packages/core/wasm/paleta_core_bg.wasm"));

const fixtures = (await readdir("./test/fixtures")).filter((f) => f.endsWith(".jpg"));
const xors = [0x01, 0x10, 0x80, 0xff];

let total = 0;
let panics = 0;
for (const name of fixtures) {
  const base = new Uint8Array(await readFile(`./test/fixtures/${name}`));
  for (let off = 0; off < base.length; off++) {
    for (const xor of xors) {
      total++;
      const mangled = base.slice();
      mangled[off] ^= xor;
      try {
        await decodeJpegDcOnly(mangled);
      } catch (e) {
        panics++;
        console.log(
          `PANIC  ${name}  off=${off}  byte=0x${base[off].toString(16).padStart(2, "0")}  → 0x${(base[off] ^ xor).toString(16).padStart(2, "0")}  ${e.message}`,
        );
        if (panics >= 10) {
          console.log("stopping after 10 panics");
          process.exit(1);
        }
      }
    }
  }
}
console.log(`ran ${total} mutations across ${fixtures.length} fixtures — ${panics} panics`);
