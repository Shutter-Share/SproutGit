CREATE TABLE IF NOT EXISTS worktree_provenance (
    worktree_path             TEXT PRIMARY KEY,
    branch                    TEXT NOT NULL,
    source_ref                TEXT NOT NULL,
    initiating_worktree_path  TEXT,
    root_repo_path            TEXT NOT NULL,
    created_at                INTEGER NOT NULL,
    updated_at                INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worktree_provenance_source_ref
    ON worktree_provenance (source_ref);

CREATE INDEX IF NOT EXISTS idx_worktree_provenance_created_at
    ON worktree_provenance (created_at);

CREATE TABLE IF NOT EXISTS nested_repo_sync_rules (
    repo_relative_path TEXT PRIMARY KEY,
    enabled            INTEGER NOT NULL DEFAULT 1,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nested_repo_sync_rules_enabled
    ON nested_repo_sync_rules (enabled, repo_relative_path);
