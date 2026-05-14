import { type WorktreePushStatus, type PushBranchResult } from '@sproutgit/types';
import { gitForPath } from './client.js';

/**
 * Fetches latest refs from all remotes for a worktree.
 */
export async function fetchWorktree(worktreePath: string): Promise<void> {
  const git = gitForPath(worktreePath);
  await git.fetch(['--all', '--prune']);
}

/**
 * Pulls (fast-forward only) from the tracking upstream.
 */
export async function pullWorktree(worktreePath: string): Promise<void> {
  const git = gitForPath(worktreePath);
  await git.pull(['--ff-only']);
}

/**
 * Pushes the current branch to its upstream (or publishes to `publishRemote`).
 */
export async function pushWorktreeBranch(
  worktreePath: string,
  publishRemote?: string | null
): Promise<PushBranchResult> {
  const git = gitForPath(worktreePath);
  const status = await git.status();
  const branch = status.current ?? '';

  let upstream = status.tracking;
  let published = false;

  if (!upstream && publishRemote) {
    // First push — set upstream automatically.
    await git.raw(['push', '--set-upstream', publishRemote, branch]);
    upstream = `${publishRemote}/${branch}`;
    published = true;
  } else {
    await git.push();
  }

  return { worktreePath, branch, upstream: upstream ?? null, published };
}

/**
 * Returns a summary of the push state for the current branch:
 * whether it has an upstream, which remotes are available, etc.
 */
export async function getWorktreePushStatus(worktreePath: string): Promise<WorktreePushStatus> {
  const git = gitForPath(worktreePath);
  const status = await git.status();

  const remoteRaw = await git.getRemotes(false);
  const remotes = remoteRaw.map(r => r.name);

  // Heuristic: prefer "origin" if it exists, otherwise the first remote.
  const suggestedRemote = remotes.includes('origin') ? 'origin' : (remotes[0] ?? null);

  return {
    worktreePath,
    branch: status.current ?? null,
    upstream: status.tracking ?? null,
    remotes,
    suggestedRemote,
    detached: status.detached,
  };
}
