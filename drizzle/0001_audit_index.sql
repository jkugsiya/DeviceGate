DROP INDEX `audit_events_ts_idx`;--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);