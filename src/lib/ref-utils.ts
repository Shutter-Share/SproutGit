import type { RefInfo } from '$lib/sproutgit';

/**
 * Comparator for sorting refs in the "create worktree" source-ref list.
 * The detected default remote branch (e.g. `origin/main`) sorts first,
 * followed by upstream/*, origin/*, other remotes, local branches, tags.
 */
export function makeCompareRefsForCreate(
  defaultRemoteBranch?: string
): (a: RefInfo, b: RefInfo) => number {
  return function compareRefsForCreate(a: RefInfo, b: RefInfo): number {
    const rank = (ref: RefInfo): number => {
      if (defaultRemoteBranch && ref.name === defaultRemoteBranch) return 0;
      if (ref.kind === 'remote' && ref.name.startsWith('upstream/')) return 1;
      if (ref.kind === 'remote' && ref.name.startsWith('origin/')) return 2;
      if (ref.kind === 'remote') return 3;
      if (ref.kind === 'branch') return 4;
      return 5;
    };
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name);
  };
}

/**
 * Pick the best default source ref from a list of refs.
 * Returns the default remote branch if present, otherwise the highest-ranked
 * remote ref, otherwise the first ref, otherwise `'HEAD'`.
 */
export function preferredSourceRef(refList: RefInfo[], defaultRemoteBranch?: string): string {
  if (defaultRemoteBranch) {
    const defaultRef = refList.find(r => r.name === defaultRemoteBranch);
    if (defaultRef) return defaultRef.name;
  }
  const sorted = [...refList].sort(makeCompareRefsForCreate(defaultRemoteBranch));
  const preferred = sorted.find(ref => ref.kind === 'remote') ?? sorted[0];
  return preferred?.name ?? 'HEAD';
}
