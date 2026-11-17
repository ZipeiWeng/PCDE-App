CREATE TABLE `auth_test_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `token_hash` text NOT NULL,
  `ip_hash` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_test_sessions_token_unique` ON `auth_test_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `auth_test_sessions_expiry_idx` ON `auth_test_sessions` (`expires_at`);
