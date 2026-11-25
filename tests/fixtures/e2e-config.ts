export const testOrigin = "http://127.0.0.1:3170";

export const fixtureEnv = {
  BETTER_AUTH_URL: testOrigin,
  BETTER_AUTH_SECRET: "fixture-auth-secret-for-local-testing-001",
  CRON_SECRET: "fixture-cron-secret-for-local-testing-001",
  APP_ALLOWED_GITHUB_IDS: "10101,20202,40404,50505",
  GITHUB_CLIENT_ID: "fixture-github-client-id",
  GITHUB_CLIENT_SECRET: "fixture-github-client-secret",
  LASTFM_API_KEY: "fixture-lastfm-key",
  NODE_OPTIONS: "--import=./tests/fixtures/clock.mjs",
  NEXT_TELEMETRY_DISABLED: "1",
};
