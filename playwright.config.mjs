import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:5175";
const backendURL = process.env.E2E_BACKEND_URL || "http://127.0.0.1:3174";
const storageState = process.env.E2E_STORAGE_STATE || undefined;
const skipWebServer = process.env.E2E_SKIP_WEB_SERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    storageState,
  },
  webServer: skipWebServer
    ? undefined
    : [
        {
          command: "npm run backend",
          url: `${backendURL}/api/health`,
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: "npm run dev",
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 920 },
      },
    },
  ],
});
