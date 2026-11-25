import { defineConfig, devices } from "@playwright/test";
import { fixtureEnv, testOrigin } from "./tests/fixtures/e2e-config";
import { requireTestDatabase } from "./tests/fixtures/test-target";

requireTestDatabase();

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/setup.ts",
  workers: 1,
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: testOrigin,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm start --hostname 127.0.0.1 --port 3170",
      url: `${testOrigin}/sign-in`,
      env: fixtureEnv,
      reuseExistingServer: false,
      timeout: 45_000,
    },
    {
      command: "pnpm start --hostname 127.0.0.1 --port 3171",
      url: "http://127.0.0.1:3171/sign-in",
      env: {
        ...fixtureEnv,
        BETTER_AUTH_URL: "http://127.0.0.1:3171",
        APP_ALLOWED_GITHUB_IDS: "20202,40404",
      },
      reuseExistingServer: false,
      timeout: 45_000,
    },
  ],
});
