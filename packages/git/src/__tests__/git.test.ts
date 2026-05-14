import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listWorktrees, getCommitGraph, getWorktreeStatus, stageFiles, createCommit } from '../index.js';

/**
 * Creates a bare git repo for testing with an initial commit.
 * Returns the repo path (also the main worktree path).
 * Uses `realpathSync` to resolve macOS /var → /private/var symlinks.
 */
function initTestRepo(): string {
  // Use realpathSync.native to resolve both symlinks (macOS /var→/private/var)
  // and Windows 8.3 short names (RUNNER~1 → runneradmin).
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sg-git-test-')));

  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@sproutgit.test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "SproutGit Test"', { cwd: dir, stdio: 'ignore' });

  writeFileSync(join(dir, 'README.md'), '# Test Repo\n');
  execSync('git add .', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: 'ignore' });

  return dir;
}

describe('worktrees', () => {
  let repoPath: string;

  beforeAll(() => {
    repoPath = initTestRepo();
    return () => rmSync(repoPath, { recursive: true, force: true });
  });

  it('lists the main worktree', async () => {
    const result = await listWorktrees(repoPath);
    expect(result.worktrees).toHaveLength(1);
    expect(result.worktrees[0]?.path).toBe(repoPath);
  });
});

describe('commits', () => {
  let repoPath: string;

  beforeAll(() => {
    repoPath = initTestRepo();
    return () => rmSync(repoPath, { recursive: true, force: true });
  });

  it('returns commit graph with at least one commit', async () => {
    const result = await getCommitGraph(repoPath);
    expect(result.commits.length).toBeGreaterThanOrEqual(1);
    expect(result.commits[0]).toMatchObject({
      hash: expect.any(String),
      subject: 'initial commit',
    });
  });
});

describe('staging', () => {
  let repoPath: string;

  beforeAll(() => {
    repoPath = initTestRepo();
    return () => rmSync(repoPath, { recursive: true, force: true });
  });

  it('reports clean status on a clean repo', async () => {
    const result = await getWorktreeStatus(repoPath);
    expect(result.files).toHaveLength(0);
  });

  it('stages a new file and creates a commit', async () => {
    writeFileSync(join(repoPath, 'hello.txt'), 'hello\n');
    const before = await getWorktreeStatus(repoPath);
    expect(before.files.some(f => f.path === 'hello.txt')).toBe(true);

    await stageFiles(repoPath, ['hello.txt']);
    const after = await getWorktreeStatus(repoPath);
    expect(after.files.some(f => f.staged && f.path === 'hello.txt')).toBe(true);

    const hash = await createCommit(repoPath, 'add hello.txt');
    expect(hash).toBeTruthy();
  });
});
