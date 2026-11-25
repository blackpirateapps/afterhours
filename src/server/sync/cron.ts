import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { getPool, transaction } from "../db";
import { allowedIds, secret } from "../env";
import { AppError } from "../errors";
import { RETENTION_SECONDS } from "../queries/time";
import { INVOCATION_MS, runSync } from "./index";
import { accountForPayload, lockBudget, prune } from "./storage";

export function authorizeCron(request: Request) {
  const expected = Buffer.from(`Bearer ${secret("CRON_SECRET")}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new AppError(
      401,
      "cron_unauthorized",
      "Cron authorization is required.",
    );
  }
}

export async function runCron() {
  const deadline = performance.now() + 210_000;
  const pool = getPool();
  const ids = allowedIds();
  const token = randomUUID();
  const totals = {
    processed: 0,
    succeeded: 0,
    pending: 0,
    skipped: 0,
    failed: 0,
  };
  const lease = await pool.query(
    `
    UPDATE cron_lease SET token = $1, expires_at = clock_timestamp() + interval '260 seconds'
    WHERE id = 1 AND (expires_at IS NULL OR expires_at <= clock_timestamp())`,
    [token],
  );
  if (!lease.rowCount) return { ...totals, skipped: 1 };

  try {
    const { rows: due } = await pool.query<{ id: string }>(
      `
      SELECT c.id FROM lastfm_connections c WHERE EXISTS (
        SELECT 1 FROM scrobbles s WHERE s.connection_id = c.id
        AND s.played_at < clock_timestamp() - $1 * interval '1 second'
      ) OR EXISTS (
        SELECT 1 FROM album_art a WHERE a.connection_id = c.id AND NOT EXISTS (
          SELECT 1 FROM scrobbles s WHERE s.connection_id = a.connection_id
          AND s.artist_norm = a.artist_norm AND s.album_norm = a.album_norm
        )
      ) ORDER BY c.created_at, c.id`,
      [RETENTION_SECONDS],
    );
    for (const { id } of due) {
      if (deadline - performance.now() < INVOCATION_MS) break;
      try {
        await transaction(async (client) => {
          await lockBudget(client);
          const current = await client.query(
            "SELECT id FROM lastfm_connections WHERE id = $1 FOR UPDATE",
            [id],
          );
          if (current.rowCount && (await prune(client, id)))
            await accountForPayload(client, id);
        });
      } catch {
        totals.failed++;
      }
    }
    const { rows: users } = await pool.query<{ id: string; user_id: string }>(
      `
      SELECT c.id, c.user_id FROM lastfm_connections c
      JOIN account a ON a.user_id = c.user_id AND a.provider_id = 'github'
      WHERE a.account_id = ANY($1::text[])
      ORDER BY c.last_attempted_at ASC NULLS FIRST, c.id`,
      [ids],
    );
    for (const { id, user_id } of users) {
      if (deadline - performance.now() < INVOCATION_MS) {
        totals.skipped++;
        continue;
      }
      try {
        const result = await runSync(user_id, {
          manual: false,
          expectedId: id,
        });
        totals.processed++;
        if (result.state === "pending") totals.pending++;
        else totals.succeeded++;
      } catch (error) {
        if (error instanceof AppError && error.status === 409) totals.skipped++;
        else {
          totals.processed++;
          totals.failed++;
        }
      }
    }
    return totals;
  } finally {
    await pool.query(
      "UPDATE cron_lease SET token = null, expires_at = null WHERE id = 1 AND token = $1",
      [token],
    );
    console.info(JSON.stringify({ operation: "cron.counts", ...totals }));
  }
}
