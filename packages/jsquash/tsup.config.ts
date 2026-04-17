import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/jpeg.ts",
    "src/png.ts",
    "src/webp.ts",
    "src/avif.ts",
  ],
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ["@jsquash/jpeg", "@jsquash/png", "@jsquash/webp", "@jsquash/avif"],
});
