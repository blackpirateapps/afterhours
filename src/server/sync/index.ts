import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool, transaction } from "../db";
import { AppError } from "../errors";
import {
  hasRequestTime,
  lastFm,
  OutOfTime,
  type LastFm,
} from "../lastfm/client";
import {
  ProviderError,
  type Page,
  type Play,
  type Window,
} from "../lastfm/parse";
import { RETENTION_SECONDS } from "../queries/time";
import { getConnection, progress } from "./connections";
import { accountForPayload, lockBudget, prune } from "./storage";

export const INVOCATION_MS = 18_000;
const PAGE_CAP = 6;
const INITIAL_CAP = 2000;

type Lease = { id: string; token: string; username: string };
type Work = Window & {
  mode: "initial" | "incremental";
  initialImported: number;
  restarted: boolean;
};

const changed = () =>
  new AppError(
    409,
    "connection_changed",
    "The Last.fm connection changed. Try again.",
  );
const busy = () =>
  new AppError(409, "sync_running", "A sync is already running.");

async function acquire(
  owner: string,
  manual: boolean,
  expectedId?: string,
): Promise<Lease> {
  return transaction(async (client) => {
    const {
      rows: [connection],
    } = await client.query<{ id: string; username: string; active: boolean }>(
      `
      SELECT id, username, coalesce(lease_expires_at > clock_timestamp(), false) AS active
      FROM lastfm_connections WHERE user_id = $1 FOR UPDATE`,
      [owner],
    );
    if (!connection || (expectedId && connection.id !== expectedId))
      throw changed();
    if (connection.active) throw busy();
    if (manual) {
      const { rowCount } = await client.query(
        `
        INSERT INTO user_preferences(user_id, next_manual_at)
        VALUES ($1, clock_timestamp() + interval '60 seconds')
        ON CONFLICT (user_id) DO UPDATE SET next_manual_at = clock_timestamp() + interval '60 seconds'
        WHERE user_preferences.next_manual_at IS NULL OR user_preferences.next_manual_at <= clock_timestamp()`,
        [owner],
      );
      if (!rowCount) {
        const {
          rows: [cooldown],
        } = await client.query<{ seconds: number }>(
          `
          SELECT greatest(1, ceil(extract(epoch FROM next_manual_at - clock_timestamp())))::int AS seconds
          FROM user_preferences WHERE user_id = $1`,
          [owner],
        );
        throw new AppError(
          429,
          "sync_cooldown",
          "Wait before starting another manual sync.",
          cooldown.seconds,
        );
      }
    }
    const token = randomUUID();
    await client.query(
      `
      UPDATE lastfm_connections SET lease_token = $2, lease_expires_at = clock_timestamp() + interval '45 seconds',
        last_attempted_at = clock_timestamp(), state = 'running', error_code = null WHERE id = $1`,
      [connection.id, token],
    );
    return { id: connection.id, token, username: connection.username };
  });
}

async function prepare(lease: Lease): Promise<Work | null> {
  // The lease fences this checkpoint-only statement. It touches no provider-sourced data.
  const {
    rows: [work],
  } = await getPool().query<{
    from: string | null;
    to: string | null;
    page: number;
    mode: Work["mode"] | null;
    initialImported: number;
    restarted: boolean;
  }>(
    `
    WITH bounds AS (
      SELECT floor(extract(epoch FROM clock_timestamp()))::bigint - 120 AS upper_bound,
             floor(extract(epoch FROM clock_timestamp()))::bigint - $3 AS cutoff
    ), planned AS (
      SELECT c.id, b.upper_bound, b.cutoff,
        c.window_to IS NOT NULL AND c.window_to <= b.cutoff AS expired,
        greatest(b.cutoff, coalesce(c.successful_through - 600, b.cutoff)) AS lower_bound
      FROM lastfm_connections c CROSS JOIN bounds b WHERE c.id = $1
    )
    UPDATE lastfm_connections c SET
      window_mode = CASE WHEN c.window_mode IS NOT NULL AND NOT p.expired THEN c.window_mode
        WHEN p.lower_bound < p.upper_bound THEN 'incremental' END,
      window_from = CASE WHEN c.window_mode IS NOT NULL AND NOT p.expired THEN c.window_from
        WHEN p.lower_bound < p.upper_bound THEN p.lower_bound END,
      window_to = CASE WHEN c.window_mode IS NOT NULL AND NOT p.expired THEN c.window_to
        WHEN p.lower_bound < p.upper_bound THEN p.upper_bound END,
      next_page = CASE WHEN c.window_mode IS NULL OR p.expired THEN 1 ELSE c.next_page END,
      restarted = CASE WHEN c.window_mode IS NULL OR p.expired THEN false ELSE c.restarted END,
      initial_status = CASE WHEN p.expired AND c.window_mode = 'initial' THEN 'complete' ELSE c.initial_status END,
      retention_gap = c.retention_gap OR p.expired OR coalesce(c.successful_through < p.cutoff, false)
    FROM planned p WHERE c.id = p.id AND c.lease_token = $2 AND c.lease_expires_at > clock_timestamp()
    RETURNING c.window_from AS "from", c.window_to AS "to", c.next_page AS page, c.window_mode AS mode,
      c.initial_imported AS "initialImported", c.restarted`,
    [lease.id, lease.token, RETENTION_SECONDS],
  );
  if (!work) throw changed();
  if (!work.mode || work.from === null || work.to === null) return null;
  return {
    ...work,
    mode: work.mode,
    from: Number(work.from),
    to: Number(work.to),
  };
}

async function lockLease(client: PoolClient, lease: Lease): Promise<void> {
  const result = await client.query(
    "SELECT id FROM lastfm_connections WHERE id = $1 AND lease_token = $2 AND lease_expires_at > clock_timestamp() FOR UPDATE",
    [lease.id, lease.token],
  );
  if (!result.rowCount) throw changed();
}

async function insertPlays(
  client: PoolClient,
  id: string,
  plays: Play[],
  remaining: number | null,
) {
  const {
    rows: [result],
  } = await client.query<{ inserted: number; last_index: number | null }>(
    `
    WITH incoming AS (
      SELECT item, ix::int FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY src(item, ix)
      WHERE to_timestamp((item->>'unixSecond')::bigint) >= clock_timestamp() - $4 * interval '1 second'
    ), candidates AS (
      SELECT DISTINCT ON (item->>'hash') item, ix FROM incoming
      WHERE NOT EXISTS (SELECT 1 FROM scrobbles s WHERE s.connection_id = $1 AND s.source_identity_hash = item->>'hash')
      ORDER BY item->>'hash', ix
    ), accepted AS (
      SELECT item, ix FROM candidates ORDER BY ix LIMIT $3
    ), inserted AS (
      INSERT INTO scrobbles(connection_id, played_at, artist, track, album, artist_norm, track_norm, album_norm, source_identity_hash)
      SELECT $1::uuid, to_timestamp((item->>'unixSecond')::bigint), item->>'artist', item->>'track', item->>'album',
             item->>'artistNorm', item->>'trackNorm', item->>'albumNorm', item->>'hash'
      FROM accepted ORDER BY ix ON CONFLICT (connection_id, source_identity_hash) DO NOTHING
      RETURNING id
    )
    SELECT (SELECT count(*)::int FROM inserted) AS inserted, (SELECT max(ix) FROM accepted) AS last_index`,
    [id, JSON.stringify(plays), remaining, RETENTION_SECONDS],
  );
  return result;
}

async function upsertArt(
  client: PoolClient,
  id: string,
  plays: Play[],
): Promise<void> {
  const covers = plays.filter((play) => play.cover !== null);
  if (!covers.length) return;
  await client.query(
    `
    INSERT INTO album_art(connection_id, artist_norm, album_norm, url, source_played_at)
    SELECT DISTINCT ON (item->>'artistNorm', item->>'albumNorm') $1::uuid, item->>'artistNorm', item->>'albumNorm',
           item->>'cover', to_timestamp((item->>'unixSecond')::bigint)
    FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY src(item, ix)
    WHERE to_timestamp((item->>'unixSecond')::bigint) >= clock_timestamp() - $3 * interval '1 second'
    ORDER BY item->>'artistNorm', item->>'albumNorm', (item->>'unixSecond')::bigint DESC, ix
    ON CONFLICT (connection_id, artist_norm, album_norm) DO UPDATE
      SET url = excluded.url, source_played_at = excluded.source_played_at
      WHERE excluded.source_played_at >= album_art.source_played_at`,
    [id, JSON.stringify(covers), RETENTION_SECONDS],
  );
}

async function commitPage(
  lease: Lease,
  work: Work,
  page: Page,
  deadline: number,
): Promise<{ done: boolean; inserted: number }> {
  return transaction(async (client) => {
    await lockBudget(client);
    await lockLease(client, lease);
    if (performance.now() >= deadline) throw new OutOfTime();
    const remaining =
      work.mode === "initial" ? INITIAL_CAP - work.initialImported : null;
    const { inserted, last_index } = await insertPlays(
      client,
      lease.id,
      page.plays,
      remaining,
    );
    const hitCap = remaining !== null && inserted === remaining;
    const unprocessed = hitCap && (last_index ?? 0) < page.plays.length;
    const done = hitCap || page.end;
    const capped = hitCap && (unprocessed || !page.end);
    await upsertArt(
      client,
      lease.id,
      hitCap ? page.plays.slice(0, last_index ?? 0) : page.plays,
    );
    await prune(client, lease.id);
    await accountForPayload(client, lease.id);
    if (performance.now() >= deadline) throw new OutOfTime();
    const checkpoint = await client.query(
      `
      UPDATE lastfm_connections SET
        initial_imported = initial_imported + $3,
        initial_status = coalesce($4, initial_status),
        successful_through = CASE WHEN $5 THEN window_to ELSE successful_through END,
        last_successful_sync_at = CASE WHEN $5 THEN clock_timestamp() ELSE last_successful_sync_at END,
        window_mode = CASE WHEN $5 THEN null ELSE window_mode END,
        window_from = CASE WHEN $5 THEN null ELSE window_from END,
        window_to = CASE WHEN $5 THEN null ELSE window_to END,
        next_page = CASE WHEN $5 THEN 1 ELSE next_page + 1 END,
        restarted = CASE WHEN $5 THEN false ELSE restarted END,
        state = CASE WHEN $5 THEN 'success' ELSE 'running' END
      WHERE id = $1 AND lease_token = $2 AND lease_expires_at > clock_timestamp()`,
      [
        lease.id,
        lease.token,
        work.mode === "initial" ? inserted : 0,
        work.mode === "initial" && done
          ? capped
            ? "capped"
            : "complete"
          : null,
        done,
      ],
    );
    if (!checkpoint.rowCount) throw changed();
    if (performance.now() >= deadline) throw new OutOfTime();
    return { done, inserted };
  });
}

async function restart(lease: Lease): Promise<void> {
  const result = await getPool().query(
    `
    UPDATE lastfm_connections SET restarted = true, next_page = 1
    WHERE id = $1 AND lease_token = $2 AND lease_expires_at > clock_timestamp() AND NOT restarted`,
    [lease.id, lease.token],
  );
  if (!result.rowCount) throw changed();
}

async function setOutcome(
  lease: Lease,
  state: string,
  code?: string,
): Promise<void> {
  const result = await getPool().query(
    `
    UPDATE lastfm_connections SET state = $3, error_code = $4 WHERE id = $1 AND lease_token = $2
      AND lease_expires_at > clock_timestamp()`,
    [lease.id, lease.token, state, code ?? null],
  );
  if (!result.rowCount) throw changed();
}

export async function runSync(
  owner: string,
  options: { manual: boolean; expectedId?: string; provider?: LastFm },
) {
  const started = performance.now();
  const deadline = started + INVOCATION_MS;
  const lease = await acquire(owner, options.manual, options.expectedId);
  const provider = options.provider ?? lastFm();
  let pages = 0;
  let inserted = 0;
  let outcome = "pending";
  try {
    const work = await prepare(lease);
    if (!work) outcome = "idle";
    while (work && pages < PAGE_CAP && hasRequestTime(deadline)) {
      pages++;
      let page;
      try {
        page = await provider.page(lease.username, work, deadline);
      } catch (error) {
        if (error instanceof OutOfTime) break;
        if (
          error instanceof ProviderError &&
          error.kind === "shrunk" &&
          !work.restarted
        ) {
          await restart(lease);
          work.restarted = true;
          work.page = 1;
          continue;
        }
        throw error;
      }
      if (performance.now() >= deadline) break;
      let committed;
      try {
        committed = await commitPage(lease, work, page, deadline);
      } catch (error) {
        if (error instanceof OutOfTime) break;
        throw error;
      }
      inserted += committed.inserted;
      if (committed.done) {
        outcome = "success";
        break;
      }
      if (work.mode === "initial") work.initialImported += committed.inserted;
      work.page++;
    }
    if (outcome !== "success") await setOutcome(lease, outcome);
  } catch (error) {
    outcome = error instanceof AppError ? error.code : "storage_failure";
    await setOutcome(lease, "error", outcome);
    if (error instanceof AppError) throw error;
    throw new AppError(
      503,
      "storage_failure",
      "Afterhours could not save this page. Try syncing again.",
    );
  } finally {
    try {
      await getPool().query(
        `
        UPDATE lastfm_connections SET lease_token = null, lease_expires_at = null,
          state = CASE WHEN state = 'running' THEN 'pending' ELSE state END
        WHERE id = $1 AND lease_token = $2`,
        [lease.id, lease.token],
      );
    } catch {
      console.error(
        JSON.stringify({
          operation: "sync.release",
          result: "lease_release_failed",
        }),
      );
    }
    console.info(
      JSON.stringify({
        operation: "sync.pages",
        result: outcome,
        pages,
        inserted,
        durationMs: Math.round(performance.now() - started),
      }),
    );
  }
  const connected = await getConnection(owner);
  if (!connected || connected.id !== lease.id) throw changed();
  return progress(connected);
}
