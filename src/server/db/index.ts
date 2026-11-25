import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { databaseConfig } from "../env";
import * as schema from "./schema";

let pool: Pool | undefined;
let orm: ReturnType<typeof makeOrm> | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      ...databaseConfig("DATABASE_URL"),
      max: 3,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      statement_timeout: 4000,
      query_timeout: 5000,
      lock_timeout: 2500,
      idle_in_transaction_session_timeout: 10000,
    });
    pool.on("error", () =>
      console.error(
        JSON.stringify({
          operation: "db.pool",
          result: "idle_connection_error",
        }),
      ),
    );
  }
  return pool;
}

function makeOrm() {
  return drizzle(getPool(), { schema });
}

export function getDb() {
  return (orm ??= makeOrm());
}

export async function transaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  let releaseError: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      releaseError = new Error("Database rollback failed");
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
