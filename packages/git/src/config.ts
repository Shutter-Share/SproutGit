import { simpleGit } from 'simple-git';

/** Read a git config value globally (falls back to empty string if not set). */
export async function getGitConfig(key: string): Promise<string> {
  try {
    const git = simpleGit();
    const value = await git.raw(['config', '--global', '--get', key]);
    return value.trim();
  } catch {
    return '';
  }
}

/** Write a git config value globally. Pass null/empty to unset. */
export async function setGitConfig(key: string, value: string | null | undefined): Promise<void> {
  const git = simpleGit();
  if (!value?.trim()) {
    try {
      await git.raw(['config', '--global', '--unset', key]);
    } catch {
      // ignore "not set" errors
    }
  } else {
    await git.raw(['config', '--global', key, value.trim()]);
  }
}
