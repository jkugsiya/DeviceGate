CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`admin_user_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`before` text,
	`after` text,
	`ip` text,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `audit_events_ts_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_target_idx` ON `audit_events` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `device_models` (
	`device_id` text NOT NULL,
	`model_id` text NOT NULL,
	PRIMARY KEY(`device_id`, `model_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `device_policies` (
	`device_id` text PRIMARY KEY NOT NULL,
	`default_model_id` text,
	`daily_requests` integer,
	`weekly_requests` integer,
	`daily_tokens` integer,
	`weekly_tokens` integer,
	`requests_per_minute` integer,
	`max_concurrent` integer,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `device_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_tokens_hash_idx` ON `device_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `device_tokens_device_idx` ON `device_tokens` (`device_id`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'enabled' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`last_seen_at` integer,
	`last_ip` text
);
--> statement-breakpoint
CREATE TABLE `enrollment_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`match_prefix` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `models_match_prefix_unique` ON `models` (`match_prefix`);--> statement-breakpoint
CREATE TABLE `upstream_quota` (
	`id` integer PRIMARY KEY NOT NULL,
	`five_hour_util` real,
	`five_hour_reset` integer,
	`weekly_util` real,
	`weekly_reset` integer,
	`status` text,
	`raw` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` text NOT NULL,
	`device_id` text NOT NULL,
	`ts` integer NOT NULL,
	`endpoint` text NOT NULL,
	`model` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`status_code` integer NOT NULL,
	`error_type` text,
	`aborted` integer DEFAULT false NOT NULL,
	`latency_ms` integer NOT NULL,
	`client_ip` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `usage_events_device_ts_idx` ON `usage_events` (`device_id`,`ts`);