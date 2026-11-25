import "server-only";
import { DateTime } from "luxon";
import { approvedCover } from "@/shared/media";
import type { Range } from "@/shared/validation";
import { getPool } from "../db";
import { rangeWindow, RETENTION_SECONDS } from "./time";

export type RankItem = {
  name: string;
  artist: string;
  count: number;
  cover: string | null;
};
export type DayCount = { date: string; count: number };
type Totals = {
  plays: number;
  artists: number;
  tracks: number;
  albums: number;
};
type Rank = { artists: RankItem[]; tracks: RankItem[]; albums: RankItem[] };

const ranking = {
  artists: { key: "artist_norm", label: "artist", name: "artist_norm" },
  tracks: {
    key: "artist_norm, track_norm",
    label: "track",
    name: "track_norm",
  },
  albums: {
    key: "artist_norm, album_norm",
    label: "album",
    name: "album_norm",
  },
} as const;

function rankingQuery(kind: keyof Rank) {
  const { key, name, label } = ranking[kind];
  return `SELECT coalesce(json_agg(json_build_object('name', name, 'artist', artist, 'count', count, 'cover', cover)
               ORDER BY count DESC, name_key COLLATE "C", artist_key COLLATE "C"), '[]'::json)
    FROM (
      SELECT (array_agg(${label} ORDER BY played_at DESC, id DESC))[1] AS name,
             (array_agg(artist ORDER BY played_at DESC, id DESC))[1] AS artist,
             (array_agg(url ORDER BY played_at DESC, id DESC) FILTER (WHERE url IS NOT NULL))[1] AS cover,
             count(*)::int AS count, ${name} AS name_key, artist_norm AS artist_key
      FROM selected ${kind === "albums" ? "WHERE album_norm <> ''" : ""}
      GROUP BY ${key}
      ORDER BY count DESC, ${name} COLLATE "C", artist_norm COLLATE "C"
      LIMIT 10
    ) ranked`;
}

async function summarize(
  owner: string,
  zone: string,
  window: ReturnType<typeof rangeWindow>,
  now: Date,
) {
  const {
    rows: [row],
  } = await getPool().query<{
    totals: Totals;
    daily: DayCount[];
    artists: RankItem[];
    tracks: RankItem[];
    albums: RankItem[];
  }>(
    `
    WITH selected AS MATERIALIZED (
      SELECT s.*, a.url FROM lastfm_connections c JOIN scrobbles s ON s.connection_id = c.id
      LEFT JOIN album_art a ON a.connection_id = s.connection_id
        AND a.artist_norm = s.artist_norm AND a.album_norm = s.album_norm
      WHERE c.user_id = $1 AND s.played_at >= $2 AND s.played_at < $3
    )
    SELECT (
      SELECT json_build_object('plays', count(*), 'artists', count(DISTINCT artist_norm),
        'tracks', count(DISTINCT (artist_norm, track_norm)),
        'albums', count(DISTINCT (artist_norm, album_norm)) FILTER (WHERE album_norm <> ''))
      FROM selected
    ) AS totals, (
      SELECT coalesce(json_agg(json_build_object('date', day::text, 'count', count)), '[]'::json)
      FROM (SELECT (played_at AT TIME ZONE $4)::date AS day, count(*)::int AS count FROM selected GROUP BY day) per_day
    ) AS daily,
      (${rankingQuery("artists")}) AS artists,
      (${rankingQuery("tracks")}) AS tracks,
      (${rankingQuery("albums")}) AS albums`,
    [
      owner,
      new Date(
        Math.max(
          window.start.getTime(),
          now.getTime() - RETENTION_SECONDS * 1000,
        ),
      ),
      window.end,
      zone,
    ],
  );
  const daily = new Map(row.daily.map(({ date, count }) => [date, count]));
  const safeRank = (items: RankItem[]) =>
    items.map((item) => ({ ...item, cover: approvedCover(item.cover) }));
  return {
    totals: row.totals,
    daily: window.dates.map((date) => ({ date, count: daily.get(date) ?? 0 })),
    rank: {
      artists: safeRank(row.artists),
      tracks: safeRank(row.tracks),
      albums: safeRank(row.albums),
    },
  };
}

export function getStats(
  owner: string,
  zone: string,
  range: Range,
  now = new Date(),
) {
  return summarize(owner, zone, rangeWindow(range, zone, now), now);
}

export async function getRecap(owner: string, zone: string, now = new Date()) {
  const today = DateTime.fromJSDate(now, { zone }).setLocale("en");
  const window = {
    start: today.startOf("month").toJSDate(),
    end: today.plus({ days: 1 }).startOf("day").toJSDate(),
    dates: [],
  };
  const data = await summarize(owner, zone, window, now);
  return { ...data, month: today.toFormat("LLLL") };
}

export async function retainedCount(owner: string, now = new Date()) {
  const {
    rows: [row],
  } = await getPool().query<{ total: number }>(
    `
    SELECT count(*)::int AS total FROM lastfm_connections c JOIN scrobbles s ON s.connection_id = c.id
    WHERE c.user_id = $1 AND s.played_at >= $2`,
    [owner, new Date(now.getTime() - RETENTION_SECONDS * 1000)],
  );
  return row.total;
}
