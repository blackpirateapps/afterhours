CREATE TABLE "album_art" (
	"connection_id" uuid NOT NULL,
	"artist_norm" text NOT NULL,
	"album_norm" text NOT NULL,
	"url" text NOT NULL,
	"source_played_at" timestamp with time zone NOT NULL,
	CONSTRAINT "album_art_connection_id_artist_norm_album_norm_pk" PRIMARY KEY("connection_id","artist_norm","album_norm"),
	CONSTRAINT "art_album" CHECK ("album_art"."album_norm" <> '' and octet_length("album_art"."url") <= 2048)
);
--> statement-breakpoint
CREATE TABLE "cron_lease" (
	"id" integer PRIMARY KEY NOT NULL,
	"token" uuid,
	"expires_at" timestamp with time zone,
	CONSTRAINT "singleton_cron_lease" CHECK ("cron_lease"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "lastfm_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"initial_status" text DEFAULT 'pending' NOT NULL,
	"initial_imported" integer DEFAULT 0 NOT NULL,
	"window_mode" text,
	"window_from" bigint,
	"window_to" bigint,
	"next_page" integer DEFAULT 1 NOT NULL,
	"restarted" boolean DEFAULT false NOT NULL,
	"successful_through" bigint,
	"last_successful_sync_at" timestamp with time zone,
	"last_attempted_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"retention_gap" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"payload_bytes" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "lastfm_connections_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "connection_username_format" CHECK ("lastfm_connections"."username" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "connection_state" CHECK ("lastfm_connections"."state" in ('idle','pending','running','success','error')),
	CONSTRAINT "connection_initial_state" CHECK ("lastfm_connections"."initial_status" in ('pending','complete','capped') and "lastfm_connections"."initial_imported" between 0 and 2000),
	CONSTRAINT "connection_window" CHECK (
    ("lastfm_connections"."window_mode" is null and "lastfm_connections"."window_from" is null and "lastfm_connections"."window_to" is null)
    or ("lastfm_connections"."window_mode" is not null and "lastfm_connections"."window_mode" in ('initial','incremental') and
        "lastfm_connections"."window_from" is not null and "lastfm_connections"."window_to" is not null and "lastfm_connections"."window_from" < "lastfm_connections"."window_to")
  ),
	CONSTRAINT "connection_progress" CHECK ("lastfm_connections"."next_page" > 0 and "lastfm_connections"."payload_bytes" >= 0),
	CONSTRAINT "connection_lease" CHECK (("lastfm_connections"."lease_token" is null) = ("lastfm_connections"."lease_expires_at" is null))
);
--> statement-breakpoint
CREATE TABLE "provider_gate" (
	"id" integer PRIMARY KEY NOT NULL,
	"next_start_at" timestamp with time zone DEFAULT '-infinity'::timestamptz NOT NULL,
	"backoff_until" timestamp with time zone DEFAULT '-infinity'::timestamptz NOT NULL,
	CONSTRAINT "singleton_provider_gate" CHECK ("provider_gate"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "scrobbles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scrobbles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"connection_id" uuid NOT NULL,
	"played_at" timestamp with time zone NOT NULL,
	"artist" text NOT NULL,
	"track" text NOT NULL,
	"album" text NOT NULL,
	"artist_norm" text NOT NULL,
	"track_norm" text NOT NULL,
	"album_norm" text NOT NULL,
	"source_identity_hash" text NOT NULL,
	CONSTRAINT "scrobble_source_identity" UNIQUE("connection_id","source_identity_hash"),
	CONSTRAINT "scrobble_required_fields" CHECK (length("scrobbles"."artist_norm") > 0 and length("scrobbles"."track_norm") > 0 and "scrobbles"."source_identity_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "storage_budget" (
	"id" integer PRIMARY KEY NOT NULL,
	CONSTRAINT "singleton_budget" CHECK ("storage_budget"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"reduce_motion" boolean DEFAULT false NOT NULL,
	"next_manual_at" timestamp with time zone,
	"next_validation_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "album_art" ADD CONSTRAINT "album_art_connection_id_lastfm_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."lastfm_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lastfm_connections" ADD CONSTRAINT "lastfm_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrobbles" ADD CONSTRAINT "scrobbles_connection_id_lastfm_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."lastfm_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scrobble_history" ON "scrobbles" USING btree ("connection_id","played_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");