import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: process.env.KORU_E2E_BASE_URL || "http://127.0.0.1:10102",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: "line",
});
