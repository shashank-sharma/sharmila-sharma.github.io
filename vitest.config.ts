import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    cloudflareTest({
      config: false,
      miniflare: {
        compatibilityDate: "2026-11-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["IMAGES"],
        bindings: {
          IMAGE_BASE_URL: "/media",
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
      },
    }),
  ],
  test: { include: ["tests/**/*.test.ts"] },
});
