import { loadEnvFile } from "node:process";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { databaseConfig } from "../src/server/env";

if (process.env.ENV_FILE) loadEnvFile(process.env.ENV_FILE);

try {
  const pool = new Pool({
    ...databaseConfig("DATABASE_URL_UNPOOLED"),
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.info("Afterhours migrations applied.");
  } finally {
    await pool.end();
  }
} catch {
  console.error(
    "Migration failed. Verify the direct URL, target database, permissions, and migration state.",
  );
  process.exitCode = 1;
}
