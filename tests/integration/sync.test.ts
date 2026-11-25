import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getPool, transaction } from "@/server/db";
import { lastFm, type LastFm } from "@/server/lastfm/client";
import { makePlay, ProviderError } from "@/server/lastfm/parse";
import { getHistory, getLatest } from "@/server/queries/history";
import { getStats, retainedCount } from "@/server/queries/stats";
import { DAY } from "@/server/queries/time";
import { runSync } from "@/server/sync";
import {
  connect,
  disconnect,
  getConnection,
  getPreferences,
  setPreferences,
} from "@/server/sync/connections";
import { authorizeCron, runCron } from "@/server/sync/cron";
import {
  accountForPayload,
  lockBudget,
  STORAGE_LIMIT,
} from "@/server/sync/storage";
import {
  addIdentity,
  requireTestDatabase,
  resetDatabase,
  seedPlays,
} from "../fixtures/database";

const cover = "https://lastfm.freetls.fastly.net/i/u/300x300/a.jpg";
const newer = "https://lastfm-img2.akamaized.net/i/u/300x300/b.png";

function stub(
  page: LastFm["page"] = async () => ({ plays: [], end: true }),
): LastFm {
  return { user: async (username) => username, page };
}

const epoch = () => Math.floor(Date.now() / 1000);
const completed = (time: number, name = "Evening", image = cover) => ({
  artist: { "#text": "City Signal" },
  name,
  album: { "#text": "Soft Rain" },
  date: { uts: String(time) },
  image: [{ size: "large", "#text": image }],
});

function providerPage(
  track: unknown[],
  page: number,
  total: number,
  perPage = 200,
) {
  return Response.json({
    recenttracks: {
      track,
      "@attr": { page, total, perPage, totalPages: Math.ceil(total / perPage) },
    },
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function checkpoint(owner = "owner-a") {
  const {
    rows: [row],
  } = await getPool().query(
    `
    SELECT window_from::float8, window_to::float8, next_page, restarted, successful_through::float8,
      initial_imported, payload_bytes::float8
    FROM lastfm_connections WHERE user_id = $1`,
    [owner],
  );
  return row;
}

beforeAll(() => {
  requireTestDatabase();
  process.env.LASTFM_API_KEY = "local-fixture-key";
  process.env.APP_ALLOWED_GITHUB_IDS = "101,102";
  process.env.CRON_SECRET = "integration-fixture-only-cron-key-00001";
});

beforeEach(async () => {
  await resetDatabase();
  await addIdentity("owner-a", "101");
  await addIdentity("owner-b", "102");
});

afterAll(async () => {
  if (process.env.DATABASE_URL) {
    requireTestDatabase();
    await getPool().end();
  }
});

describe("connection and provider transport", () => {
  it("connects canonical usernames, repeats them idempotently, and isolates the same Last.fm account across owners", async () => {
    const requests: URL[] = [];
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      requests.push(new URL(String(url)));
      expect(init).toMatchObject({ redirect: "manual", cache: "no-store" });
      return Response.json({ user: { name: "NightOwl" } });
    });
    const provider = lastFm(transport);
    const first = await connect("owner-a", "nightowl", provider);
    expect(first).toMatchObject({ status: 201, username: "NightOwl" });
    expect(await connect("owner-a", "NIGHTOWL", provider)).toMatchObject({
      status: 200,
    });
    await expect(
      connect("owner-a", "different", provider),
    ).rejects.toMatchObject({ status: 409 });
    expect(requests).toHaveLength(1);
    expect(requests[0].origin + requests[0].pathname).toBe(
      "https://ws.audioscrobbler.com/2.0/",
    );
    expect(requests[0].searchParams.get("method")).toBe("user.getInfo");
    await connect("owner-b", "NightOwl", stub());
    expect((await getConnection("owner-a"))?.id).not.toBe(
      (await getConnection("owner-b"))?.id,
    );
    expect(await getPreferences("owner-a")).toEqual({
      timeZone: "UTC",
      reduceMotion: false,
    });
  });

  it("leaves the connection absent on unknown user, limits validations, and retains a persistent restricted history error", async () => {
    const provider = lastFm(
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 6 })),
    );
    try {
      await expect(
        connect("owner-a", "unknown", provider),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      expect(await getConnection("owner-a")).toBeNull();
    }
    await expect(connect("owner-a", "unknown", stub())).rejects.toMatchObject({
      status: 429,
      retryAfter: expect.any(Number),
    });

    await connect("owner-b", "restricted", stub());
    const historyProvider = lastFm(
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 17 })),
    );
    await expect(
      runSync("owner-b", { manual: false, provider: historyProvider }),
    ).rejects.toMatchObject({ code: "profile_unavailable" });
    expect(await getConnection("owner-b")).toMatchObject({
      state: "error",
      errorCode: "profile_unavailable",
    });
    expect((await checkpoint("owner-b")).next_page).toBe(1);
    const denied = lastFm(
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 10 })),
    );
    await expect(
      runSync("owner-b", { manual: false, provider: denied }),
    ).rejects.toMatchObject({ code: "provider_configuration" });
  });

  it("uses bounded fixed request windows, commits partial progress, retries once, and resumes without duplicates", async () => {
    await connect("owner-a", "owl", stub());
    const { window_from: from, window_to: to } = await checkpoint();
    const requests: { at: number; page: number }[] = [];
    let recover = false;
    const provider = lastFm(
      vi.fn<typeof fetch>(async (url) => {
        const { searchParams } = new URL(String(url));
        const number = Number(searchParams.get("page"));
        requests.push({ at: performance.now(), page: number });
        expect(searchParams.get("from")).toBe(String(from - 1));
        expect(searchParams.get("to")).toBe(String(to + 1));
        expect(searchParams.get("extended")).toBe("0");
        expect(searchParams.get("limit")).toBe("200");
        if (number === 1)
          return providerPage(
            [
              completed(to),
              completed(to - 2),
              completed(to - 2),
              completed(to - 3),
              { "@attr": { nowplaying: "true" } },
            ],
            1,
            201,
          );
        if (!recover) return new Response(null, { status: 503 });
        return providerPage(
          [
            completed(to - 3, "Evening", newer),
            completed(from, "Boundary"),
            completed(from - 1),
          ],
          2,
          201,
        );
      }),
    );
    await expect(
      runSync("owner-a", { manual: true, provider }),
    ).rejects.toMatchObject({ code: "provider_temporary" });
    expect(requests.map(({ page }) => page)).toEqual([1, 2, 2]);
    expect(requests[1].at - requests[0].at).toBeGreaterThan(900);
    expect(requests[2].at - requests[1].at).toBeGreaterThan(900);
    expect(await retainedCount("owner-a")).toBe(2);
    expect(await checkpoint()).toMatchObject({
      next_page: 2,
      initial_imported: 2,
      successful_through: null,
    });
    await expect(
      runSync("owner-a", { manual: true, provider }),
    ).rejects.toMatchObject({ status: 429 });
    recover = true;
    expect(await runSync("owner-a", { manual: false, provider })).toMatchObject(
      {
        state: "success",
        initialStatus: "complete",
        initialImported: 3,
        lastSuccessfulSyncAt: expect.any(String),
      },
    );
    expect(await checkpoint()).toMatchObject({
      next_page: 1,
      successful_through: to,
    });
    expect(
      (await getLatest("owner-a")).map(({ track, cover: image }) => [
        track,
        image,
      ]),
    ).toEqual([
      ["Evening", cover],
      ["Evening", cover],
      ["Boundary", cover],
    ]);
    const overlap = vi.fn<LastFm["page"]>(async (_username, work) => {
      expect(work.from).toBe(to - 600);
      return {
        plays: [makePlay(to - 2, "City Signal", "Evening", "Soft Rain", newer)],
        end: true,
      };
    });
    await runSync("owner-a", { manual: false, provider: stub(overlap) });
    expect(await retainedCount("owner-a")).toBe(3);
    expect((await getLatest("owner-a"))[0].cover).toBe(newer);
  });

  it("persists a global provider backoff across owners and honors it before contacting transport", async () => {
    await connect("owner-a", "a", stub());
    await connect("owner-b", "b", stub());
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 429, headers: { "Retry-After": "75" } }),
      );
    const provider = lastFm(transport);
    await expect(
      runSync("owner-a", { manual: false, provider }),
    ).rejects.toMatchObject({ code: "provider_rate", retryAfter: 75 });
    await expect(
      runSync("owner-b", { manual: false, provider }),
    ).rejects.toMatchObject({ code: "provider_rate" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("leases, transactions and retention", () => {
  it("limits work to six pages and caps initial unique imports mid-page in newest-first order", async () => {
    await connect("owner-a", "owl", stub());
    const page = vi.fn<LastFm["page"]>(async (_username, work) => {
      const plays = Array.from({ length: 199 }, (_, i) =>
        makePlay(
          work.to - (work.page - 1) * 199 - i - 1,
          "Artist",
          "Track",
          "",
        ),
      );
      return { plays: [plays[0], ...plays], end: work.page === 11 };
    });
    expect(
      await runSync("owner-a", { manual: false, provider: stub(page) }),
    ).toMatchObject({ state: "pending", initialImported: 1194 });
    expect(page).toHaveBeenCalledTimes(6);
    expect(await checkpoint()).toMatchObject({
      next_page: 7,
      successful_through: null,
    });
    expect(
      await runSync("owner-a", { manual: false, provider: stub(page) }),
    ).toMatchObject({
      state: "success",
      initialImported: 2000,
      initialStatus: "capped",
    });
    expect(await retainedCount("owner-a")).toBe(2000);
    const { rows } = await getPool().query(
      "SELECT max(played_at) - min(played_at) AS span FROM scrobbles",
    );
    expect(rows[0].span).toMatchObject({ minutes: 33, seconds: 19 });
  });

  it("allows one persisted restart for an invalidated page and preserves the watermark on recurring problems", async () => {
    await connect("owner-a", "owl", stub());
    await getPool().query(
      "UPDATE lastfm_connections SET next_page = 3 WHERE user_id = 'owner-a'",
    );
    const seen: number[] = [];
    const provider = stub(async (_username, work) => {
      seen.push(work.page);
      if (work.page > 1)
        throw new ProviderError(
          "provider_page_shrank",
          "Pages changed.",
          "shrunk",
        );
      return {
        plays: [makePlay(work.to - 1, "Artist", "Track", "")],
        end: false,
      };
    });
    await expect(
      runSync("owner-a", { manual: false, provider }),
    ).rejects.toMatchObject({ code: "provider_page_shrank" });
    expect(seen).toEqual([3, 1, 2]);
    expect(await checkpoint()).toMatchObject({
      restarted: true,
      next_page: 2,
      successful_through: null,
    });
    await expect(
      runSync("owner-a", { manual: false, provider }),
    ).rejects.toMatchObject({ code: "provider_page_shrank" });
    expect(seen).toEqual([3, 1, 2, 2]);
  });

  it("fences an expired worker and makes manual and scheduled runs contend on the same lease", async () => {
    await connect("owner-a", "owl", stub());
    const fetching = deferred();
    const returnPage = deferred();
    const blocked = stub(async (_username, work) => {
      fetching.resolve();
      await returnPage.promise;
      return {
        plays: [makePlay(work.to - 1, "Fenced artist", "Old worker", "")],
        end: true,
      };
    });
    const old = runSync("owner-a", { manual: true, provider: blocked });
    const rejected = expect(old).rejects.toMatchObject({ status: 409 });
    await fetching.promise;
    await expect(
      runSync("owner-a", { manual: false, provider: stub() }),
    ).rejects.toMatchObject({ code: "sync_running" });
    await getPool().query(
      "UPDATE lastfm_connections SET lease_expires_at = clock_timestamp() - interval '1 second'",
    );
    await runSync("owner-a", {
      manual: false,
      provider: stub(async (_username, work) => ({
        plays: [makePlay(work.to - 1, "New artist", "New worker", "")],
        end: true,
      })),
    });
    returnPage.resolve();
    await rejected;
    expect((await getLatest("owner-a")).map(({ track }) => track)).toEqual([
      "New worker",
    ]);
    expect(await getConnection("owner-a")).toMatchObject({ state: "success" });
  });

  it("cascades disconnect during a fetch, fences the original UUID, and keeps owner cooldown and preferences", async () => {
    await connect("owner-a", "owl", stub());
    await setPreferences("owner-a", {
      timeZone: "Asia/Kolkata",
      reduceMotion: true,
    });
    const oldId = (await getConnection("owner-a"))!.id;
    await seedPlays(oldId, [
      makePlay(epoch() - 1000, "Artist", "Original", "Album", cover),
    ]);
    const fetching = deferred();
    const returnPage = deferred();
    const old = runSync("owner-a", {
      manual: true,
      provider: stub(async (_username, work) => {
        fetching.resolve();
        await returnPage.promise;
        return {
          plays: [
            makePlay(work.to - 1, "Artist", "Should disappear", "Album", newer),
          ],
          end: true,
        };
      }),
    });
    const rejected = expect(old).rejects.toMatchObject({ status: 409 });
    await fetching.promise;
    expect(await disconnect("owner-a")).toBe(true);
    expect(await disconnect("owner-a")).toBe(false);
    await getPool().query(
      "UPDATE user_preferences SET next_validation_at = null WHERE user_id = 'owner-a'",
    );
    await connect("owner-a", "new-owl", stub());
    expect((await getConnection("owner-a"))?.id).not.toBe(oldId);
    await expect(
      runSync("owner-a", { manual: true, provider: stub() }),
    ).rejects.toMatchObject({ status: 429 });
    returnPage.resolve();
    await rejected;
    expect(await getLatest("owner-a")).toEqual([]);
    expect((await getPool().query("SELECT url FROM album_art")).rowCount).toBe(
      0,
    );
    expect(await getPreferences("owner-a")).toEqual({
      timeZone: "Asia/Kolkata",
      reduceMotion: true,
    });
  });

  it("rolls back plays and artwork when the database rejects the checkpoint, then resumes that page", async () => {
    await connect("owner-a", "owl", stub());
    await getPool()
      .query(`CREATE FUNCTION test_interrupt_checkpoint() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'test checkpoint interruption'; END;
      $$ LANGUAGE plpgsql`);
    await getPool()
      .query(`CREATE TRIGGER test_interrupt_checkpoint BEFORE UPDATE ON lastfm_connections
      FOR EACH ROW WHEN (OLD.successful_through IS DISTINCT FROM NEW.successful_through)
      EXECUTE FUNCTION test_interrupt_checkpoint()`);
    const provider = stub(async (_username, work) => ({
      plays: [makePlay(work.to - 1, "Artist", "Track", "Album", cover)],
      end: true,
    }));
    try {
      await expect(
        runSync("owner-a", { manual: false, provider }),
      ).rejects.toMatchObject({ code: "storage_failure" });
      expect(await retainedCount("owner-a")).toBe(0);
      expect((await getPool().query("SELECT id FROM scrobbles")).rowCount).toBe(
        0,
      );
      expect(
        (await getPool().query("SELECT url FROM album_art")).rowCount,
      ).toBe(0);
      expect(await checkpoint()).toMatchObject({
        next_page: 1,
        successful_through: null,
        initial_imported: 0,
      });
    } finally {
      await getPool().query(
        "DROP TRIGGER test_interrupt_checkpoint ON lastfm_connections",
      );
      await getPool().query("DROP FUNCTION test_interrupt_checkpoint()");
    }
    await runSync("owner-a", { manual: false, provider });
    expect(await retainedCount("owner-a")).toBe(1);
  });

  it("serializes concurrent payload writers near the cap and restores capacity on disconnect", async () => {
    await addIdentity("budget-owner", "103");
    for (const owner of ["budget-owner", "owner-a", "owner-b"])
      await connect(owner, owner, stub());
    const fixture = (await getConnection("budget-owner"))!.id;
    const multiByte = "🎧".repeat(500);
    await transaction(async (client) => {
      await lockBudget(client);
      await client.query(
        "SELECT id FROM lastfm_connections WHERE id = $1 FOR UPDATE",
        [fixture],
      );
      const {
        rows: [size],
      } = await client.query<{ bytes: number }>(
        `
        SELECT octet_length(json_build_array(1234567890::bigint,
          $1::text, $1, $1, $1, $1, $1, repeat('0',64))::text) + 1 AS bytes`,
        [multiByte],
      );
      const rows = Math.floor((STORAGE_LIMIT - 2000) / size.bytes);
      await client.query(
        `
        INSERT INTO scrobbles(connection_id, played_at, artist, track, album, artist_norm, track_norm, album_norm, source_identity_hash)
        SELECT $1, to_timestamp(\$2::bigint - n), $3, $3, $3, $3, $3, $3, repeat(md5(n::text), 2)
        FROM generate_series(1, $4) n`,
        [fixture, epoch(), multiByte, rows],
      );
      await accountForPayload(client, fixture);
    });
    const budgets = async () =>
      Number(
        (
          await getPool().query(
            "SELECT sum(payload_bytes) AS total FROM lastfm_connections",
          )
        ).rows[0].total,
      );
    const before = await budgets();
    const available = STORAGE_LIMIT - before;
    // Both pages are individually affordable and exceed the remaining space together.
    const targetLength = Math.floor((available * 0.57) / 8);
    const split = [
      Math.min(targetLength, 500),
      Math.max(0, targetLength - 500),
    ];
    const provider = (word: string) =>
      stub(async (_username, work) => ({
        plays: [
          makePlay(
            work.to - 1,
            "🎸".repeat(split[0]),
            "🎵".repeat(split[1]) + word,
            "",
            null,
          ),
        ],
        end: true,
      }));
    const results = await Promise.allSettled([
      runSync("owner-a", { manual: false, provider: provider("a") }),
      runSync("owner-b", { manual: false, provider: provider("b") }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const failed = results.findIndex(({ status }) => status === "rejected");
    expect(results[failed]).toMatchObject({
      reason: { code: "storage_limit" },
    });
    expect(await budgets()).toBeLessThanOrEqual(STORAGE_LIMIT);
    const loser = failed === 0 ? "owner-a" : "owner-b";
    expect(await checkpoint(loser)).toMatchObject({
      next_page: 1,
      initial_imported: 0,
      successful_through: null,
    });
    expect(await retainedCount(loser)).toBe(0);
    await disconnect("budget-owner");
    await runSync(loser, { manual: false, provider: provider("retry") });
    expect(await retainedCount(loser)).toBe(1);
  });

  it("prunes elapsed history and orphan covers even for revoked users, honors the cron lease and key", async () => {
    await addIdentity("revoked", "103");
    await connect("revoked", "revoked-owl", stub());
    const { id } = (await getConnection("revoked"))!;
    await seedPlays(id, [
      makePlay(epoch() - 91 * DAY, "Artist", "Old", "Old album", cover),
      makePlay(epoch() - 89 * DAY, "Artist", "Retained", "New album", newer),
    ]);
    expect(await retainedCount("revoked")).toBe(1);
    expect((await getLatest("revoked"))[0].track).toBe("Retained");
    const request = (secret?: string) =>
      new Request("http://localhost", {
        headers: secret ? { Authorization: secret } : {},
      });
    expect(() => authorizeCron(request())).toThrow(
      expect.objectContaining({ status: 401 }),
    );
    expect(() =>
      authorizeCron(request(`bearer ${process.env.CRON_SECRET}`)),
    ).toThrow(expect.objectContaining({ status: 401 }));
    expect(() =>
      authorizeCron(request(`Bearer ${process.env.CRON_SECRET}`)),
    ).not.toThrow();
    await getPool().query(
      "UPDATE cron_lease SET token = gen_random_uuid(), expires_at = clock_timestamp() + interval '1 minute'",
    );
    expect(await runCron()).toEqual({
      processed: 0,
      succeeded: 0,
      pending: 0,
      skipped: 1,
      failed: 0,
    });
    await getPool().query(
      "UPDATE cron_lease SET expires_at = clock_timestamp()",
    );
    expect(await runCron()).toEqual({
      processed: 0,
      succeeded: 0,
      pending: 0,
      skipped: 0,
      failed: 0,
    });
    expect((await getPool().query("SELECT url FROM album_art")).rows).toEqual([
      { url: newer },
    ]);
    expect((await getPool().query("SELECT id FROM scrobbles")).rowCount).toBe(
      1,
    );
  });

  it("clips expired saved windows to retention and keeps only the newest 10,000 records", async () => {
    await connect("owner-a", "owl", stub());
    const { id } = (await getConnection("owner-a"))!;
    await getPool().query(
      `
      UPDATE lastfm_connections SET window_from = $1, window_to = $2 WHERE id = $3`,
      [epoch() - 130 * DAY, epoch() - 100 * DAY, id],
    );
    const oldEpoch = epoch() - 200;
    await getPool().query(
      `
      INSERT INTO scrobbles(connection_id, played_at, artist, track, album, artist_norm, track_norm, album_norm, source_identity_hash)
      SELECT $1, to_timestamp($2::bigint - n), 'Artist', 'Track', '', 'artist', 'track', '', repeat(md5(n::text), 2)
      FROM generate_series(1, 10002) n`,
      [id, oldEpoch],
    );
    const page = vi.fn<LastFm["page"]>(async (_username, work) => {
      expect(work.from).toBeGreaterThanOrEqual(epoch() - 90 * DAY - 2);
      expect(work.page).toBe(1);
      return { plays: [], end: true };
    });
    expect(
      await runSync("owner-a", { manual: false, provider: stub(page) }),
    ).toMatchObject({ state: "success", retentionGap: true });
    expect(await retainedCount("owner-a")).toBe(10000);
  });
});

it("uses literal filters, safe signed bigint tie pagination, zero-filled buckets, and deterministic totals", async () => {
  await connect("owner-a", "same-owl", stub());
  await connect("owner-b", "same-owl", stub());
  const connection = (await getConnection("owner-a"))!;
  const t = Math.floor(Date.parse("2026-11-01T05:20:00Z") / 1000);
  const records = Array.from({ length: 52 }, (_, index) =>
    makePlay(
      t,
      index % 2 ? "zebra" : "Amber",
      index < 50 ? `Beat ${index}` : `Literal %_! ${index}`,
      index === 0 ? "" : "Album",
    ),
  );
  await seedPlays(connection.id, records);
  const other = (await getConnection("owner-b"))!;
  await seedPlays(other.id, [makePlay(t, "Other Account", "Separate", "")]);
  const now = new Date("2026-11-02T05:00:00Z");
  const filter = { range: "7d" as const, q: "" };
  const p1 = await getHistory("owner-a", "America/New_York", filter, null, now);
  const p2 = await getHistory(
    "owner-a",
    "America/New_York",
    filter,
    p1.nextCursor,
    now,
  );
  const p3 = await getHistory(
    "owner-a",
    "America/New_York",
    filter,
    p2.nextCursor,
    now,
  );
  expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([
    25, 25, 2,
  ]);
  expect(
    new Set([...p1.items, ...p2.items, ...p3.items].map(({ id }) => id)).size,
  ).toBe(52);
  expect(p3.nextCursor).toBeNull();
  expect(typeof p1.items[0].id).toBe("string");
  await expect(
    getHistory("owner-a", "UTC", filter, p1.nextCursor, now),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    getHistory(
      "owner-a",
      "America/New_York",
      { ...filter, q: "other" },
      p1.nextCursor,
      now,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    getHistory("owner-a", "America/New_York", filter, "bad!", now),
  ).rejects.toMatchObject({ status: 400 });
  expect(
    (
      await getHistory(
        "owner-a",
        "America/New_York",
        { ...filter, q: "literal %_!" },
        null,
        now,
      )
    ).items,
  ).toHaveLength(2);
  const summary = await getStats("owner-a", "America/New_York", "7d", now);
  expect(summary.totals).toEqual({
    plays: 52,
    artists: 2,
    tracks: 52,
    albums: 2,
  });
  expect(summary.daily.filter(({ count }) => count > 0)).toEqual([
    { date: "2026-11-01", count: 52 },
  ]);
  expect(summary.daily).toHaveLength(7);
  expect(summary.rank.artists.map(({ name }) => name)).toEqual([
    "Amber",
    "zebra",
  ]);
  expect(
    (await getStats("owner-b", "America/New_York", "7d", now)).totals.plays,
  ).toBe(1);
});
