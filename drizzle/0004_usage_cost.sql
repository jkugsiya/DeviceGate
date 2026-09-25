ALTER TABLE `usage_events` ADD `cache_creation_1h_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `cost_usd` real;--> statement-breakpoint
CREATE INDEX `usage_events_model_ts_idx` ON `usage_events` (`model`,`ts`);