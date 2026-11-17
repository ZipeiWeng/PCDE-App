CREATE TABLE `billing_accounts` (
  `account_id` text NOT NULL REFERENCES `auth_accounts` (`id`) ON DELETE CASCADE,
  `mode` text NOT NULL CHECK (`mode` IN ('test','live')),
  `customer_id` text,
  `subscription_id` text,
  `status` text DEFAULT 'none' NOT NULL,
  `paid_until` integer,
  `current_period_end` integer,
  `cancel_at_period_end` integer DEFAULT 0 NOT NULL,
  `latest_invoice_id` text,
  `risk_invoice_id` text,
  `risk_status` text,
  `verified_at` integer,
  `lock_token` text,
  `lock_until` integer DEFAULT 0 NOT NULL,
  `checkout_attempt` text,
  `checkout_started_at` integer,
  `checkout_session_id` text,
  `checkout_expires_at` integer,
  PRIMARY KEY (`account_id`,`mode`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_customer_unique` ON `billing_accounts` (`customer_id`,`mode`);
--> statement-breakpoint
CREATE TABLE `billing_events` (
  `event_id` text NOT NULL,
  `mode` text NOT NULL,
  `processed_at` integer NOT NULL,
  PRIMARY KEY (`event_id`,`mode`)
);
