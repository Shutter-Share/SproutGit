import { simpleGit } from 'simple-git';

/** Initialise a bare git repository at the given path. */
export async function initBareRepo(targetPath: string): Promise<void> {
  const git = simpleGit(targetPath);
  await git.init(true);
}

/** Clone a remote repository (as bare) into targetPath. */
export async function cloneBareRepo(
  remoteUrl: string,
  targetPath: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  const git = simpleGit(onProgress
    ? { progress({ method, stage, progress }: { method: string; stage: string; progress: number }) {
        onProgress(`${method}: ${stage} ${progress}%`);
      } }
    : {},
  );
  await git.clone(remoteUrl, targetPath, ['--bare', '--progress']);
}
