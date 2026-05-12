import { pathKey } from '$lib/path-utils';

type CachedSession = {
  id: string;
  shell: string;
  label: string;
  initialCommand?: string;
  envVars?: Record<string, string>;
  autoCloseOnExit?: boolean;
  hookId?: string;
  ptyId?: string;
};

type CachedContainerState = {
  sessions: CachedSession[];
  activeId: string | null;
  layout: 'tabs' | 'split' | 'grid';
};

const EMPTY_STATE: CachedContainerState = {
  sessions: [],
  activeId: null,
  layout: 'tabs',
};

// Plain Map — no reactivity needed; this is "remember between mounts" storage only.
// DO NOT use $state here: setTerminalContainerCache both reads and writes this value,
// and any $effect that calls it would create an infinite reactive loop.
const cacheByCwd = new Map<string, CachedContainerState>();

function cloneState(state: CachedContainerState): CachedContainerState {
  return {
    sessions: state.sessions.map(session => ({
      ...session,
      envVars: session.envVars ? { ...session.envVars } : undefined,
    })),
    activeId: state.activeId,
    layout: state.layout,
  };
}

export function getTerminalContainerCache(cwd: string): CachedContainerState {
  return cloneState(cacheByCwd.get(pathKey(cwd)) ?? EMPTY_STATE);
}

export function setTerminalContainerCache(cwd: string, nextState: CachedContainerState) {
  cacheByCwd.set(pathKey(cwd), cloneState(nextState));
}

export function clearTerminalContainerCache(cwd: string) {
  cacheByCwd.delete(pathKey(cwd));
}
