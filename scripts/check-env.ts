import { loadEnvFile } from "node:process";
import {
  allowedIds,
  appOrigin,
  databaseConfig,
  required,
  secret,
} from "../src/server/env";

if (process.env.ENV_FILE) loadEnvFile(process.env.ENV_FILE);

const checks: Record<string, () => unknown> = {
  DATABASE_URL: () => databaseConfig("DATABASE_URL"),
  BETTER_AUTH_URL: appOrigin,
  BETTER_AUTH_SECRET: () => secret("BETTER_AUTH_SECRET"),
  GITHUB_CLIENT_ID: () => required("GITHUB_CLIENT_ID"),
  GITHUB_CLIENT_SECRET: () => required("GITHUB_CLIENT_SECRET"),
  APP_ALLOWED_GITHUB_IDS: allowedIds,
  LASTFM_API_KEY: () => required("LASTFM_API_KEY"),
  CRON_SECRET: () => secret("CRON_SECRET"),
  "Independent secrets": () => {
    if (secret("BETTER_AUTH_SECRET") === secret("CRON_SECRET"))
      throw new Error("Duplicate secrets");
  },
};
if (process.argv.includes("--operator"))
  checks.DATABASE_URL_UNPOOLED = () => databaseConfig("DATABASE_URL_UNPOOLED");
for (const [key, check] of Object.entries(checks)) {
  try {
    check();
    console.info(`${key} OK`);
  } catch {
    console.error(`${key} INVALID`);
    process.exitCode = 1;
  }
}
