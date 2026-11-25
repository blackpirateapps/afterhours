import "server-only";
import { z } from "zod";
import { approvedCover } from "@/shared/media";
import { rangeInput, searchInput, type Range } from "@/shared/validation";
import { getPool } from "../db";
import { AppError } from "../errors";
import { rangeWindow, RETENTION_SECONDS } from "./time";

const cursorSchema = z.strictObject({
  at: z.iso.datetime({ precision: 3 }),
  id: z
    .string()
    .regex(/^[1-9]\d{0,18}$/)
    .refine((value) => BigInt(value) <= 9223372036854775807n),
  range: rangeInput,
  q: searchInput,
  zone: z.string().max(100),
});

type Cursor = z.infer<typeof cursorSchema>;
export type HistoryItem = {
  id: string;
  playedAt: string;
  track: string;
  artist: string;
  album: string;
  cover: string | null;
};
export type HistoryFilters = { range: Range; q: string };

const invalidFilters = () =>
  new AppError(
    400,
    "invalid_filters",
    "Check the range, search, or page link.",
  );

export function historyFilters(
  rawRange?: string | string[] | null,
  rawQuery?: string | string[] | null,
): HistoryFilters {
  const range = rangeInput.safeParse(rawRange ?? "90d");
  const q = searchInput.safeParse(rawQuery ?? "");
  if (!range.success || !q.success || q.data.includes("\0"))
    throw invalidFilters();
  return { range: range.data, q: q.data };
}

function decodeCursor(
  encoded: string,
  filters: HistoryFilters,
  zone: string,
): Cursor {
  try {
    if (encoded.length > 2400 || !/^[A-Za-z0-9_-]+$/.test(encoded))
      throw invalidFilters();
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) throw invalidFilters();
    const cursor = cursorSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (
      cursor.range !== filters.range ||
      cursor.q !== filters.q ||
      cursor.zone !== zone
    )
      throw invalidFilters();
    return cursor;
  } catch {
    throw invalidFilters();
  }
}

export function literalSearch(value: string): string {
  return `%${value.replace(/[!%_]/g, (character) => `!${character}`)}%`;
}

export async function getHistory(
  owner: string,
  zone: string,
  filters: HistoryFilters,
  encoded?: string | null,
  now = new Date(),
) {
  const cursor = encoded != null ? decodeCursor(encoded, filters, zone) : null;
  const { start, end } = rangeWindow(filters.range, zone, now);
  return queryHistory(
    owner,
    new Date(
      Math.max(start.getTime(), now.getTime() - RETENTION_SECONDS * 1000),
    ),
    end,
    filters,
    cursor,
    zone,
    25,
  );
}

export async function getLatest(owner: string, now = new Date()) {
  const { items } = await queryHistory(
    owner,
    new Date(now.getTime() - RETENTION_SECONDS * 1000),
    null,
    { range: "90d", q: "" },
    null,
    "UTC",
    10,
  );
  return items;
}

async function queryHistory(
  owner: string,
  start: Date,
  end: Date | null,
  filters: HistoryFilters,
  cursor: Cursor | null,
  zone: string,
  limit: number,
) {
  const { rows } = await getPool().query<
    Omit<HistoryItem, "playedAt"> & { playedAt: Date }
  >(
    `
    SELECT s.id::text AS id, s.played_at AS "playedAt", s.track, s.artist, s.album, a.url AS cover
    FROM lastfm_connections c JOIN scrobbles s ON s.connection_id = c.id
    LEFT JOIN album_art a ON a.connection_id = s.connection_id
      AND a.artist_norm = s.artist_norm AND a.album_norm = s.album_norm
    WHERE c.user_id = $1 AND s.played_at >= $2
      AND ($3::timestamptz IS NULL OR s.played_at < $3)
      AND ($4::text IS NULL OR s.track ILIKE $4 ESCAPE '!' OR s.artist ILIKE $4 ESCAPE '!' OR s.album ILIKE $4 ESCAPE '!')
      AND ($5::timestamptz IS NULL OR (s.played_at, s.id) < ($5, $6::bigint))
    ORDER BY s.played_at DESC, s.id DESC LIMIT $7`,
    [
      owner,
      start,
      end,
      filters.q ? literalSearch(filters.q) : null,
      cursor?.at ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );
  const items: HistoryItem[] = rows.slice(0, limit).map((row) => ({
    ...row,
    cover: approvedCover(row.cover),
    playedAt: row.playedAt.toISOString(),
  }));
  const last = items.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? Buffer.from(
          JSON.stringify({
            at: last.playedAt,
            id: last.id,
            ...filters,
            zone,
          } satisfies Cursor),
        ).toString("base64url")
      : null;
  return { items, nextCursor };
}
