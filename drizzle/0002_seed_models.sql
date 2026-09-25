-- Model families, matched by provider model-id prefix (longest prefix wins).
INSERT OR IGNORE INTO `models` (`id`, `display_name`, `match_prefix`, `enabled`) VALUES
  ('fable', 'Fable', 'claude-fable-', 1),
  ('opus', 'Opus', 'claude-opus-', 1),
  ('sonnet', 'Sonnet', 'claude-sonnet-', 1),
  ('haiku', 'Haiku', 'claude-haiku-', 1);
--> statement-breakpoint
-- Devices created before policies existed keep full access: every model, no limits.
INSERT OR IGNORE INTO `device_models` (`device_id`, `model_id`)
  SELECT d.`id`, m.`id` FROM `devices` d CROSS JOIN `models` m;
--> statement-breakpoint
INSERT OR IGNORE INTO `device_policies` (`device_id`) SELECT `id` FROM `devices`;
