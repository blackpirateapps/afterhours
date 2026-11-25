import type { PoolClient } from "pg";
import { getPool, transaction } from "@/server/db";
import type { Play } from "@/server/lastfm/parse";
import { accountForPayload, lockBudget } from "@/server/sync/storage";

import { requireTestDatabase } from "./test-target";
export { requireTestDatabase } from "./test-target";

export async function addIdentity(id: string, githubId: string, name = id) {
  await transaction(async (client) => {
    await client.query(
      'INSERT INTO "user"(id, name, email) VALUES ($1, $2, $3)',
      [id, name, `${id}@example.test`],
    );
    await client.query(
      `
      INSERT INTO account(id, account_id, provider_id, user_id, updated_at)
      VALUES ($1, $2, 'github', $3, now())`,
      [`account-${id}`, githubId, id],
    );
  });
}

export async function seedPlays(connectionId: string, plays: Play[]) {
  await transaction(async (client) => {
    await lockBudget(client);
    await client.query(
      "SELECT id FROM lastfm_connections WHERE id = $1 FOR UPDATE",
      [connectionId],
    );
    await insertFixturePlays(client, connectionId, plays);
    await accountForPayload(client, connectionId);
  });
}

async function insertFixturePlays(
  client: PoolClient,
  id: string,
  plays: Play[],
) {
  const page = JSON.stringify(plays);
  await client.query(
    `
    INSERT INTO scrobbles(connection_id, played_at, artist, track, album, artist_norm, track_norm, album_norm, source_identity_hash)
    SELECT $1::uuid, to_timestamp((item->>'unixSecond')::bigint), item->>'artist', item->>'track', item->>'album',
      item->>'artistNorm', item->>'trackNorm', item->>'albumNorm', item->>'hash'
    FROM jsonb_array_elements($2::jsonb) AS src(item) ON CONFLICT DO NOTHING`,
    [id, page],
  );
  await client.query(
    `
    INSERT INTO album_art(connection_id, artist_norm, album_norm, url, source_played_at)
    SELECT DISTINCT ON (item->>'artistNorm', item->>'albumNorm')
      $1::uuid, item->>'artistNorm', item->>'albumNorm', item->>'cover', to_timestamp((item->>'unixSecond')::bigint)
    FROM jsonb_array_elements($2::jsonb) AS src(item) WHERE item->>'cover' IS NOT NULL
    ORDER BY item->>'artistNorm', item->>'albumNorm', (item->>'unixSecond')::bigint DESC
    ON CONFLICT DO NOTHING`,
    [id, page],
  );
}

export async function resetDatabase() {
  requireTestDatabase();
  await getPool().query(
    `TRUNCATE "user", verification RESTART IDENTITY CASCADE`,
  );
  await getPool().query(
    "UPDATE provider_gate SET next_start_at = '-infinity', backoff_until = '-infinity'",
  );
  await getPool().query(
    "UPDATE cron_lease SET token = null, expires_at = null",
  );
}
