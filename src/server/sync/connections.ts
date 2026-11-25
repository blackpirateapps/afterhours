import "server-only";
import { getPool, transaction } from "../db";
import { AppError } from "../errors";
import { lastFm, OutOfTime, type LastFm } from "../lastfm/client";
import { DAY } from "../queries/time";
import { accountForPayload, lockBudget } from "./storage";

export type Progress = {
  state: "idle" | "pending" | "running" | "success" | "error";
  initialStatus: "pending" | "complete" | "capped";
  initialImported: number;
  lastSuccessfulSyncAt: string | null;
  nextAllowedAt: string | null;
  retentionGap: boolean;
  errorCode: string | null;
};

type ConnectionView = Progress & { id: string; username: string };
export type Preferences = { timeZone: string; reduceMotion: boolean };

export async function getConnection(
  owner: string,
): Promise<ConnectionView | null> {
  const { rows } = await getPool().query<ConnectionView>(
    `
    SELECT c.id, c.username, CASE WHEN c.state = 'running' AND c.lease_expires_at <= clock_timestamp()
      THEN 'pending' ELSE c.state END AS state,
      c.initial_status AS "initialStatus", c.initial_imported AS "initialImported",
      to_char(c.last_successful_sync_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastSuccessfulSyncAt",
      to_char(p.next_manual_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "nextAllowedAt",
      c.retention_gap AS "retentionGap", c.error_code AS "errorCode"
    FROM lastfm_connections c LEFT JOIN user_preferences p ON p.user_id = c.user_id
    WHERE c.user_id = $1`,
    [owner],
  );
  return rows[0] ?? null;
}

export function progress(connection: ConnectionView): Progress {
  const {
    state,
    initialStatus,
    initialImported,
    lastSuccessfulSyncAt,
    nextAllowedAt,
    retentionGap,
    errorCode,
  } = connection;
  return {
    state,
    initialStatus,
    initialImported,
    lastSuccessfulSyncAt,
    nextAllowedAt,
    retentionGap,
    errorCode,
  };
}

export async function getPreferences(owner: string): Promise<Preferences> {
  const { rows } = await getPool().query<Preferences>(
    `
    SELECT time_zone AS "timeZone", reduce_motion AS "reduceMotion" FROM user_preferences WHERE user_id = $1`,
    [owner],
  );
  return rows[0] ?? { timeZone: "UTC", reduceMotion: false };
}

export async function setPreferences(
  owner: string,
  preferences: Preferences,
): Promise<Preferences> {
  const { rows } = await getPool().query<Preferences>(
    `
    INSERT INTO user_preferences(user_id, time_zone, reduce_motion) VALUES ($1, $2, $3)
    ON CONFLICT (user_id) DO UPDATE SET time_zone = excluded.time_zone, reduce_motion = excluded.reduce_motion
    RETURNING time_zone AS "timeZone", reduce_motion AS "reduceMotion"`,
    [owner, preferences.timeZone, preferences.reduceMotion],
  );
  return rows[0];
}

const differentAccount = () =>
  new AppError(
    409,
    "connection_exists",
    "Disconnect your current Last.fm account before connecting a different one.",
  );

export async function connect(
  owner: string,
  username: string,
  provider: LastFm = lastFm(),
) {
  const current = await getConnection(owner);
  if (current) {
    if (current.username.toLowerCase() !== username.toLowerCase())
      throw differentAccount();
    return {
      status: 200,
      username: current.username,
      progress: progress(current),
    };
  }
  const allowed = await getPool().query(
    `
    INSERT INTO user_preferences(user_id, next_validation_at) VALUES ($1, clock_timestamp() + interval '15 seconds')
    ON CONFLICT (user_id) DO UPDATE SET next_validation_at = clock_timestamp() + interval '15 seconds'
    WHERE user_preferences.next_validation_at IS NULL OR user_preferences.next_validation_at <= clock_timestamp()
    RETURNING user_id`,
    [owner],
  );
  if (!allowed.rowCount) {
    const existing = await getConnection(owner);
    if (existing) {
      if (existing.username.toLowerCase() !== username.toLowerCase())
        throw differentAccount();
      return {
        status: 200,
        username: existing.username,
        progress: progress(existing),
      };
    }
    const {
      rows: [cooldown],
    } = await getPool().query<{ seconds: number }>(
      `
      SELECT greatest(1, ceil(extract(epoch FROM next_validation_at - clock_timestamp())))::int AS seconds
      FROM user_preferences WHERE user_id = $1`,
      [owner],
    );
    throw new AppError(
      429,
      "validation_cooldown",
      "Wait before checking another Last.fm username.",
      cooldown?.seconds ?? 15,
    );
  }

  let canonical: string;
  try {
    canonical = await provider.user(username, performance.now() + 14_000);
  } catch (error) {
    if (error instanceof OutOfTime)
      throw new AppError(
        503,
        "provider_busy",
        "Last.fm is busy. Try connecting again shortly.",
      );
    throw error;
  }
  const status = await transaction(async (client) => {
    await lockBudget(client);
    const {
      rows: [existing],
    } = await client.query<{ username: string }>(
      "SELECT username FROM lastfm_connections WHERE user_id = $1 FOR UPDATE",
      [owner],
    );
    if (existing) {
      if (existing.username.toLowerCase() !== canonical.toLowerCase())
        throw differentAccount();
      return 200;
    }
    const {
      rows: [created],
    } = await client.query<{ id: string }>(
      `
      INSERT INTO lastfm_connections (user_id, username, window_mode, window_from, window_to)
      SELECT $1, $2, 'initial', upper_bound - $3, upper_bound
      FROM (SELECT floor(extract(epoch FROM clock_timestamp()))::bigint - 120 AS upper_bound) bounds
      RETURNING id`,
      [owner, canonical, 30 * DAY],
    );
    await accountForPayload(client, created.id);
    return 201;
  });
  const connected = await getConnection(owner);
  if (!connected)
    throw new AppError(
      409,
      "connection_changed",
      "The Last.fm connection changed. Try again.",
    );
  return {
    status,
    username: connected.username,
    progress: progress(connected),
  };
}

export async function disconnect(owner: string): Promise<boolean> {
  return transaction(async (client) => {
    await lockBudget(client);
    const result = await client.query(
      "DELETE FROM lastfm_connections WHERE user_id = $1",
      [owner],
    );
    return Boolean(result.rowCount);
  });
}
