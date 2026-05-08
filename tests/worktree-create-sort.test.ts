import { describe, it, expect } from 'vitest';
import type { RefInfo } from '$lib/sproutgit';
import { makeCompareRefsForCreate, preferredSourceRef } from '$lib/ref-utils';

function ref(name: string, kind: RefInfo['kind'] = 'remote'): RefInfo {
  return { name, fullName: name, kind, target: '' };
}

describe('compareRefsForCreate', () => {
  it('ranks default remote branch first when specified', () => {
    const refs = [ref('origin/alpha'), ref('origin/main'), ref('origin/zebra')];
    const sorted = [...refs].sort(makeCompareRefsForCreate('origin/main'));
    expect(sorted[0].name).toBe('origin/main');
  });

  it('ranks upstream/* before origin/* when no default is set', () => {
    const refs = [ref('origin/main'), ref('upstream/main')];
    const sorted = [...refs].sort(makeCompareRefsForCreate());
    expect(sorted[0].name).toBe('upstream/main');
  });

  it('ranks origin/* before other remotes', () => {
    const refs = [ref('fork/feature'), ref('origin/main')];
    const sorted = [...refs].sort(makeCompareRefsForCreate());
    expect(sorted[0].name).toBe('origin/main');
  });

  it('ranks remote branches before local branches', () => {
    const refs = [ref('feature', 'branch'), ref('origin/main')];
    const sorted = [...refs].sort(makeCompareRefsForCreate());
    expect(sorted[0].kind).toBe('remote');
  });

  it('sorts alphabetically within the same rank', () => {
    const refs = [ref('origin/zebra'), ref('origin/alpha'), ref('origin/main')];
    const sorted = [...refs].sort(makeCompareRefsForCreate());
    expect(sorted.map(r => r.name)).toEqual(['origin/alpha', 'origin/main', 'origin/zebra']);
  });
});

describe('preferredSourceRef', () => {
  it('returns defaultRemoteBranch when it is in the list', () => {
    const refs = [ref('origin/alpha'), ref('origin/main'), ref('origin/zebra')];
    expect(preferredSourceRef(refs, 'origin/main')).toBe('origin/main');
  });

  it('falls back to highest-ranked remote when default is not in list', () => {
    const refs = [ref('origin/alpha'), ref('origin/zebra')];
    expect(preferredSourceRef(refs, 'origin/main')).toBe('origin/alpha');
  });

  it('falls back to upstream/* over origin/* when no default', () => {
    const refs = [ref('origin/main'), ref('upstream/main')];
    expect(preferredSourceRef(refs)).toBe('upstream/main');
  });

  it('returns HEAD when ref list is empty', () => {
    expect(preferredSourceRef([])).toBe('HEAD');
  });
});
