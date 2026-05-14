import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ─── settings ────────────────────────────────────────────────────────────────

/** App-wide key/value settings (e.g. preferred editor, projects folder). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ─── recent_workspaces ───────────────────────────────────────────────────────

/** Most-recently-opened workspaces shown on the home screen. */
export const recentWorkspaces = sqliteTable('recent_workspaces', {
  workspacePath: text('workspace_path').primaryKey(),
  lastOpenedAt: int('last_opened_at', { mode: 'timestamp_ms' }).notNull(),
});
