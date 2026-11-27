import "server-only";
import type { PoolClient } from "pg";
import { AppError } from "../errors";
import type { Play } from "../lastfm/parse";
import { RETENTION_SECONDS } from "../queries/time";

export const STORAGE_LIMIT = 50_000_000;
export const PLAY_LIMIT = 10_000;

export async function lockBudget(client: PoolClient): Promise<void> {
  const result = await client.query(
    "SELECT id FROM storage_budget WHERE id = 1 FOR UPDATE",
  );
  if (!result.rowCount) throw new Error("Storage budget not initialized");
}

export async function upsertArt(
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

export async function prune(
  client: PoolClient,
  connectionId: string,
): Promise<boolean> {
  const expired = await client.query(
    `
    DELETE FROM scrobbles WHERE connection_id = $1
      AND played_at < clock_timestamp() - $2 * interval '1 second'`,
    [connectionId, RETENTION_SECONDS],
  );
  const excess = await client.query(
    `
    DELETE FROM scrobbles WHERE id IN (
      SELECT id FROM scrobbles WHERE connection_id = $1 ORDER BY played_at DESC, id DESC OFFSET $2
    )`,
    [connectionId, PLAY_LIMIT],
  );
  const orphaned = await client.query(
    `
    DELETE FROM album_art a WHERE a.connection_id = $1 AND NOT EXISTS (
      SELECT 1 FROM scrobbles s WHERE s.connection_id = a.connection_id
        AND s.artist_norm = a.artist_norm AND s.album_norm = a.album_norm
    )`,
    [connectionId],
  );
  return Boolean(expired.rowCount || excess.rowCount || orphaned.rowCount);
}

export async function accountForPayload(
  client: PoolClient,
  connectionId: string,
): Promise<void> {
  await client.query(
    `
    UPDATE lastfm_connections c SET payload_bytes =
      octet_length(json_build_array(username)::text) + 1
      + coalesce((SELECT sum(octet_length(json_build_array(
          extract(epoch FROM played_at)::bigint, artist, track, album,
          artist_norm, track_norm, album_norm, source_identity_hash)::text) + 1)
          FROM scrobbles WHERE connection_id = c.id), 0)
      + coalesce((SELECT sum(octet_length(json_build_array(
          artist_norm, album_norm, url, extract(epoch FROM source_played_at)::bigint)::text) + 1)
          FROM album_art WHERE connection_id = c.id), 0)
    WHERE id = $1`,
    [connectionId],
  );
  const result = await client.query<{ within_limit: boolean }>(
    "SELECT coalesce(sum(payload_bytes), 0) <= $1 AS within_limit FROM lastfm_connections",
    [STORAGE_LIMIT],
  );
  if (!result.rows[0].within_limit) {
    throw new AppError(
      503,
      "storage_limit",
      "Import paused: storage limit reached.",
    );
  }
}
