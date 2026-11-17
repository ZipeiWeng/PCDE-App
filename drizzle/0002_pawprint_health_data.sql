CREATE TABLE `health_pets` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL UNIQUE,
  `profile_json` text NOT NULL,
  `goals_json` text NOT NULL,
  `allergies` text NOT NULL DEFAULT '',
  `conditions` text NOT NULL DEFAULT '',
  `owner_name` text NOT NULL DEFAULT '',
  `doctor_name` text NOT NULL DEFAULT '',
  `clinic_name` text NOT NULL DEFAULT '',
  `revision` integer NOT NULL DEFAULT 0 CHECK (`revision` >= 0),
  `initialized` integer NOT NULL DEFAULT 0 CHECK (`initialized` IN (0, 1)),
  `write_id` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  UNIQUE (`id`, `owner_id`)
);
--> statement-breakpoint
CREATE TABLE `health_care_records` (
  `pet_id` text NOT NULL,
  `owner_id` text NOT NULL,
  `id` text NOT NULL,
  `sort_order` integer NOT NULL,
  `payload_json` text NOT NULL,
  PRIMARY KEY (`pet_id`, `id`),
  FOREIGN KEY (`pet_id`, `owner_id`) REFERENCES `health_pets` (`id`, `owner_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `health_devices` (
  `id` text PRIMARY KEY NOT NULL,
  `pet_id` text NOT NULL,
  `owner_id` text NOT NULL,
  `label` text NOT NULL,
  `source` text NOT NULL CHECK (`source` IN ('device', 'test')),
  `token_hash` text UNIQUE,
  `token_expires_at` integer NOT NULL,
  `revoked_at` integer,
  `last_seen_at` integer,
  `created_at` integer NOT NULL,
  UNIQUE (`id`, `pet_id`, `owner_id`),
  FOREIGN KEY (`pet_id`, `owner_id`) REFERENCES `health_pets` (`id`, `owner_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `health_devices_owner_idx` ON `health_devices` (`owner_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `health_readings` (
  `id` text PRIMARY KEY NOT NULL,
  `device_id` text NOT NULL,
  `pet_id` text NOT NULL,
  `owner_id` text NOT NULL,
  `sample_id` text NOT NULL,
  `payload_hash` text NOT NULL,
  `recorded_at` integer NOT NULL,
  `received_at` integer NOT NULL,
  `heart_bpm` real CHECK (`heart_bpm` IS NULL OR `heart_bpm` BETWEEN 0 AND 400),
  `skin_temperature_c` real CHECK (`skin_temperature_c` IS NULL OR `skin_temperature_c` BETWEEN -20 AND 60),
  `steps_today` integer CHECK (`steps_today` IS NULL OR `steps_today` BETWEEN 0 AND 1000000),
  `sleep_hours_today` real CHECK (`sleep_hours_today` IS NULL OR `sleep_hours_today` BETWEEN 0 AND 24),
  `source` text NOT NULL CHECK (`source` IN ('device', 'test')),
  UNIQUE (`device_id`, `sample_id`),
  FOREIGN KEY (`device_id`, `pet_id`, `owner_id`) REFERENCES `health_devices` (`id`, `pet_id`, `owner_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `health_readings_pet_time_idx` ON `health_readings` (`pet_id`, `owner_id`, `recorded_at` DESC, `received_at` DESC);
--> statement-breakpoint
CREATE TABLE `health_rate_limits` (
  `bucket_key` text PRIMARY KEY NOT NULL,
  `count` integer NOT NULL,
  `expires_at` integer NOT NULL
);
