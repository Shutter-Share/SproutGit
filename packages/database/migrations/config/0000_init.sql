CREATE TABLE IF NOT EXISTS `settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `recent_workspaces` (
  `workspace_path` text PRIMARY KEY NOT NULL,
  `last_opened_at` integer NOT NULL
);
