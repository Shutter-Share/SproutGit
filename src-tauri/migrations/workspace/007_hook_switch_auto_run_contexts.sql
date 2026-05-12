ALTER TABLE hook_definitions
ADD COLUMN switch_run_on_create INTEGER NOT NULL DEFAULT 1;

ALTER TABLE hook_definitions
ADD COLUMN switch_run_on_delete INTEGER NOT NULL DEFAULT 0;
