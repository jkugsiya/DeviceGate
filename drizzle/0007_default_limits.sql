CREATE TABLE `default_limits` (
	`id` integer PRIMARY KEY NOT NULL,
	`daily_requests` integer,
	`weekly_requests` integer,
	`daily_tokens` integer,
	`weekly_tokens` integer,
	`daily_cost_usd` real,
	`weekly_cost_usd` real,
	`requests_per_minute` integer,
	`max_concurrent` integer
);
