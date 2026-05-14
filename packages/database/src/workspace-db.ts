import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openNodeSqlite } from './node-sqlite-compat.js';
import * as workspaceSchema from './schema/workspace.js';

export type WorkspaceDb = ReturnType<typeof openWorkspaceDb>;

/**
 * Opens (or creates) a workspace-scoped database.
 *
 * The database file lives at `<workspace>/.sproutgit/state.db`.
 * All migrations in `migrations/workspace` are applied on every open.
 */
export function openWorkspaceDb(dbPath: string) {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = openNodeSqlite(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = drizzle(sqlite as any, { schema: workspaceSchema });

  // Use fileURLToPath so the path is valid on Windows.
  migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations/workspace', import.meta.url)) });

  // Expose close() so callers (e.g. tests) can release the file lock.
  return Object.assign(db, { close: () => sqlite.close() });
}
