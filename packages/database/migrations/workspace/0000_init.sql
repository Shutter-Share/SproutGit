CREATE TABLE IF NOT EXISTS `worktree_metadata` (
  `worktree_path` text PRIMARY KEY NOT NULL,
  `branch` text NOT NULL,
  `source_ref` text NOT NULL,
  `initiating_worktree_path` text,
  `root_repo_path` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `hook_definitions` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `scope` text NOT NULL,
  `trigger` text NOT NULL,
  `execution_target` text NOT NULL,
  `execution_mode` text NOT NULL DEFAULT 'terminal_tab',
  `shell` text NOT NULL,
  `script` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `critical` integer NOT NULL DEFAULT 0,
  `switch_once_per_session` integer NOT NULL DEFAULT 0,
  `switch_run_on_create` integer NOT NULL DEFAULT 1,
  `switch_run_on_delete` integer NOT NULL DEFAULT 0,
  `keep_open_on_completion` integer NOT NULL DEFAULT 0,
  `timeout_seconds` integer NOT NULL DEFAULT 300,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `hook_dependencies` (
  `hook_id` text NOT NULL REFERENCES `hook_definitions`(`id`) ON DELETE CASCADE,
  `depends_on_id` text NOT NULL REFERENCES `hook_definitions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `hook_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `hook_id` text NOT NULL,
  `hook_name` text NOT NULL,
  `trigger` text NOT NULL,
  `worktree_path` text NOT NULL,
  `status` text NOT NULL,
  `stdout_snippet` text,
  `stderr_snippet` text,
  `error_message` text,
  `ran_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `nested_repo_sync_rules` (
  `repo_relative_path` text PRIMARY KEY NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
