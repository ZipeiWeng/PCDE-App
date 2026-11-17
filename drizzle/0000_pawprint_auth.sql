CREATE TABLE `auth_accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `username` text NOT NULL,
  `username_norm` text NOT NULL,
  `email` text NOT NULL,
  `email_norm` text NOT NULL,
  `pet_name` text NOT NULL,
  `pet_name_norm` text NOT NULL,
  `pet_birthday` text NOT NULL,
  `pet_sex` text NOT NULL,
  `password_hash` text NOT NULL,
  `password_salt` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_accounts_username_unique` ON `auth_accounts` (`username_norm`);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_accounts_email_unique` ON `auth_accounts` (`email_norm`);
--> statement-breakpoint
CREATE INDEX `auth_accounts_pet_name_idx` ON `auth_accounts` (`pet_name_norm`);
--> statement-breakpoint
CREATE TABLE `auth_challenges` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `email_norm` text NOT NULL,
  `account_id` text REFERENCES `auth_accounts` (`id`) ON DELETE CASCADE,
  `payload_json` text,
  `code_hash` text NOT NULL,
  `expires_at` integer NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `resend_at` integer NOT NULL,
  `consumed_at` integer
);
--> statement-breakpoint
CREATE INDEX `auth_challenges_email_idx` ON `auth_challenges` (`email_norm`, `kind`);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL REFERENCES `auth_accounts` (`id`) ON DELETE CASCADE,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_account_idx` ON `auth_sessions` (`account_id`);
--> statement-breakpoint
CREATE TABLE `auth_limits` (
  `bucket_key` text PRIMARY KEY NOT NULL,
  `count` integer NOT NULL,
  `expires_at` integer NOT NULL
);
