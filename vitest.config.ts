import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: ["default"],
    alias: {
      "cloudflare:workers": new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)
        .pathname,
    },
  },
});
