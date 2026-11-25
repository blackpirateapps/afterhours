import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";
const instant = (name: string) => timestamp(name, { withTimezone: true });
const epoch = (name: string) => bigint(name, { mode: "number" });

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  timeZone: text("time_zone").notNull().default("UTC"),
  reduceMotion: boolean("reduce_motion").notNull().default(false),
  nextManualAt: instant("next_manual_at"),
  nextValidationAt: instant("next_validation_at"),
});

export const lastfmConnections = pgTable(
  "lastfm_connections",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    username: text().notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
    state: text().notNull().default("pending"),
    initialStatus: text("initial_status").notNull().default("pending"),
    initialImported: integer("initial_imported").notNull().default(0),
    windowMode: text("window_mode"),
    windowFrom: epoch("window_from"),
    windowTo: epoch("window_to"),
    nextPage: integer("next_page").notNull().default(1),
    restarted: boolean().notNull().default(false),
    successfulThrough: epoch("successful_through"),
    lastSuccessfulSyncAt: instant("last_successful_sync_at"),
    lastAttemptedAt: instant("last_attempted_at"),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: instant("lease_expires_at"),
    retentionGap: boolean("retention_gap").notNull().default(false),
    errorCode: text("error_code"),
    payloadBytes: epoch("payload_bytes").notNull().default(0),
  },
  (t) => [
    check(
      "connection_username_format",
      sql`${t.username} ~ '^[A-Za-z0-9_-]{1,64}$'`,
    ),
    check(
      "connection_state",
      sql`${t.state} in ('idle','pending','running','success','error')`,
    ),
    check(
      "connection_initial_state",
      sql`${t.initialStatus} in ('pending','complete','capped') and ${t.initialImported} between 0 and 2000`,
    ),
    check(
      "connection_window",
      sql`
    (${t.windowMode} is null and ${t.windowFrom} is null and ${t.windowTo} is null)
    or (${t.windowMode} is not null and ${t.windowMode} in ('initial','incremental') and
        ${t.windowFrom} is not null and ${t.windowTo} is not null and ${t.windowFrom} < ${t.windowTo})
  `,
    ),
    check(
      "connection_progress",
      sql`${t.nextPage} > 0 and ${t.payloadBytes} >= 0`,
    ),
    check(
      "connection_lease",
      sql`(${t.leaseToken} is null) = (${t.leaseExpiresAt} is null)`,
    ),
  ],
);

export const scrobbles = pgTable(
  "scrobbles",
  {
    id: bigint({ mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => lastfmConnections.id, { onDelete: "cascade" }),
    playedAt: instant("played_at").notNull(),
    artist: text().notNull(),
    track: text().notNull(),
    album: text().notNull(),
    artistNorm: text("artist_norm").notNull(),
    trackNorm: text("track_norm").notNull(),
    albumNorm: text("album_norm").notNull(),
    sourceIdentityHash: text("source_identity_hash").notNull(),
  },
  (t) => [
    unique("scrobble_source_identity").on(t.connectionId, t.sourceIdentityHash),
    index("scrobble_history").on(
      t.connectionId,
      t.playedAt.desc(),
      t.id.desc(),
    ),
    check(
      "scrobble_required_fields",
      sql`length(${t.artistNorm}) > 0 and length(${t.trackNorm}) > 0 and ${t.sourceIdentityHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const albumArt = pgTable(
  "album_art",
  {
    connectionId: uuid("connection_id").notNull(),
    artistNorm: text("artist_norm").notNull(),
    albumNorm: text("album_norm").notNull(),
    url: text().notNull(),
    sourcePlayedAt: instant("source_played_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.connectionId, t.artistNorm, t.albumNorm] }),
    foreignKey({
      columns: [t.connectionId],
      foreignColumns: [lastfmConnections.id],
    }).onDelete("cascade"),
    check(
      "art_album",
      sql`${t.albumNorm} <> '' and octet_length(${t.url}) <= 2048`,
    ),
  ],
);

export const storageBudget = pgTable(
  "storage_budget",
  {
    id: integer().primaryKey(),
  },
  (t) => [check("singleton_budget", sql`${t.id} = 1`)],
);

export const providerGate = pgTable(
  "provider_gate",
  {
    id: integer().primaryKey(),
    nextStartAt: instant("next_start_at")
      .notNull()
      .default(sql`'-infinity'::timestamptz`),
    backoffUntil: instant("backoff_until")
      .notNull()
      .default(sql`'-infinity'::timestamptz`),
  },
  (t) => [check("singleton_provider_gate", sql`${t.id} = 1`)],
);

export const cronLease = pgTable(
  "cron_lease",
  {
    id: integer().primaryKey(),
    token: uuid(),
    expiresAt: instant("expires_at"),
  },
  (t) => [check("singleton_cron_lease", sql`${t.id} = 1`)],
);
