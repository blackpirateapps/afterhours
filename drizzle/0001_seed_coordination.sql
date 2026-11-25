INSERT INTO storage_budget (id) VALUES (1);
--> statement-breakpoint
INSERT INTO provider_gate (id) VALUES (1);
--> statement-breakpoint
INSERT INTO cron_lease (id) VALUES (1);
--> statement-breakpoint
CREATE UNIQUE INDEX account_provider_identity_idx ON account (provider_id, account_id);
--> statement-breakpoint
CREATE UNIQUE INDEX account_user_provider_idx ON account (user_id, provider_id);
