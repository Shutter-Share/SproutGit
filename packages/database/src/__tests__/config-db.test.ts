import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openConfigDb } from '../config-db.js';
import { eq } from 'drizzle-orm';
import { settings, recentWorkspaces } from '../schema/config.js';

describe('config-db', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: ReturnType<typeof openConfigDb>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sg-test-config-'));
    dbPath = join(tmpDir, 'config.db');
    db = openConfigDb(dbPath);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('opens and migrates without error', () => {
    // If we got here the migrations ran successfully.
    expect(db).toBeDefined();
  });

  it('stores and retrieves a setting', () => {
    db.insert(settings).values({ key: 'projectsFolder', value: '/home/user/projects' }).run();

    const row = db.select().from(settings).where(eq(settings.key, 'projectsFolder')).get();
    expect(row?.value).toBe('/home/user/projects');
  });

  it('upserts a setting', () => {
    db.insert(settings).values({ key: 'editor', value: 'code' }).run();
    db
      .insert(settings)
      .values({ key: 'editor', value: 'cursor' })
      .onConflictDoUpdate({ target: settings.key, set: { value: 'cursor' } })
      .run();

    const row = db.select().from(settings).where(eq(settings.key, 'editor')).get();
    expect(row?.value).toBe('cursor');
  });

  it('stores and retrieves recent workspaces', () => {
    const now = Date.now();
    db
      .insert(recentWorkspaces)
      .values({ workspacePath: '/home/user/my-repo', lastOpenedAt: new Date(now) })
      .run();

    const rows = db.select().from(recentWorkspaces).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workspacePath).toBe('/home/user/my-repo');
  });
});
