import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { authOptions } from "@/server/auth/options";
import { getDb, getPool } from "@/server/db";
import * as schema from "@/server/db/auth-schema";
import { makePlay, type Play } from "@/server/lastfm/parse";
import { connect, getConnection } from "@/server/sync/connections";
import { requireTestDatabase, resetDatabase, seedPlays } from "./database";

requireTestDatabase();
const pool = getPool();
try {
  await resetDatabase();
  const auth = betterAuth({
    ...authOptions(),
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema,
      transaction: true,
    }),
    plugins: [testUtils()],
  });
  const { test } = await auth.$context;
  const users = [
    {
      key: "listener",
      name: "Alex Rivera",
      id: "10101",
      image: "https://avatars.githubusercontent.com/u/101010",
    },
    { key: "empty", name: "Charlie Park", id: "20202", image: null },
    { key: "revoked", name: "Revoked Listener", id: "30303", image: null },
    { key: "error", name: "Sam Wilson", id: "40404", image: null },
    { key: "media", name: "Media Fixture", id: "50505", image: null },
  ];
  const cookies = Object.fromEntries(
    await Promise.all(
      users.map(async ({ key, name, id, image }) => {
        const user = await test.saveUser(
          test.createUser({
            id: key,
            name,
            image,
            email: `${key}@example.test`,
          }),
        );
        await pool.query(
          `
      INSERT INTO account(id, account_id, provider_id, user_id, updated_at) VALUES ($1, $2, 'github', $3, now())`,
          [`fixture-${key}`, id, user.id],
        );
        const cookies = await test.getCookies({
          userId: user.id,
          domain: "127.0.0.1",
        });
        // The server uses fixed time. Let the browser treat its fixture cookie as a session cookie.
        return [key, cookies.map((cookie) => ({ ...cookie, expires: -1 }))];
      }),
    ),
  );

  const provider = {
    user: async (username: string) => username,
    page: async () => ({ plays: [], end: true }),
  };
  await connect("listener", "afterdark_demo", provider);
  await connect("error", "sam_fixture", provider);
  await connect("media", "media_fixture", provider);
  await pool.query(
    `UPDATE lastfm_connections SET state = 'success', initial_status = 'complete', window_from = null,
    window_to = null, window_mode = null, last_successful_sync_at = $1 WHERE user_id = 'listener'`,
    [new Date("2026-11-25T19:36:00Z")],
  );
  await pool.query(
    "UPDATE lastfm_connections SET state = 'error', error_code = 'profile_unavailable', initial_imported = 4 WHERE user_id = 'error'",
  );
  await pool.query(
    "UPDATE provider_gate SET backoff_until = '2100-01-01T00:00:00Z' WHERE id = 1",
  );
  await pool.query(
    "UPDATE cron_lease SET token = gen_random_uuid(), expires_at = '2100-01-01T00:00:00Z' WHERE id = 1",
  );

  const artists = [
    ["Midnight Signals", "Neon Borough", "Northbound", "city"],
    ["Juniper Echo", "Coral Hours", "Low Tide", "coral"],
    ["Window Seat", "Golden Mile", "Late Transfer", "train"],
    ["Second Silhouette", "Silver Light", "Quiet Room", "mono"],
  ] as const;
  const trend = [
    31, 26, 18, 18, 25, 35, 26, 23, 29, 23, 20, 26, 33, 31, 38, 43, 42, 48, 38,
    34, 39, 37, 62, 51, 41, 38, 43, 42, 47, 54,
  ];
  const plays: Play[] = [];
  const noon = Date.parse("2026-11-25T15:00:00Z") / 1000;
  for (const [day, count] of trend.entries()) {
    for (let i = 0; i < count; i++) {
      const artist =
        artists[i % 11 < 4 ? 0 : i % 11 < 7 ? 1 : i % 11 < 9 ? 2 : 3];
      const [name, album, title, art] = artist;
      const time = noon - (29 - day) * 86_400 - i * 65;
      const track =
        i === 0 && day === 29
          ? "Literal %_! Midnight"
          : `${title}${i % 6 === 0 ? "" : ` (${(i % 6) + 1})`}`;
      plays.push(
        makePlay(
          time,
          name,
          track,
          album,
          `https://lastfm-img.freetls.fastly.net/i/u/300x300/fixture-${art}.jpg`,
        ),
      );
    }
  }
  const id = (await getConnection("listener"))!.id;
  await seedPlays(id, plays);
  plays.push(makePlay(noon + 250, "After Dark Trio", "No sleeve", ""));
  plays.push(
    makePlay(
      noon + 450,
      "Transit Maps",
      "Sleeve missing",
      "Transit Tapes",
      "https://lastfm-img.freetls.fastly.net/i/u/300x300/fixture-broken.jpg",
    ),
  );
  const mediaId = (await getConnection("media"))!.id;
  await seedPlays(mediaId, plays);
  // Bypass ingestion for this legacy bad URL so the rendering allowlist gets exercised.
  await pool.query(
    `
    INSERT INTO album_art(connection_id, artist_norm, album_norm, url, source_played_at)
    VALUES ($1, 'after dark trio', 'night archive', 'https://example.test/i/u/bad.jpg', to_timestamp($2::bigint))`,
    [mediaId, noon],
  );
  await seedPlays(mediaId, [
    makePlay(noon + 660, "After Dark Trio", "Outside Host", "Night Archive"),
  ]);
  const errorId = (await getConnection("error"))!.id;
  await seedPlays(errorId, [
    makePlay(noon - 28 * 86_400, "Separate Listener", "Older Play", ""),
  ]);
  console.info(JSON.stringify(cookies));
} finally {
  await pool.end();
}
