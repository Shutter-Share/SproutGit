import { normalizePathSeparators, pathsEqual } from '$lib/path-utils';

export type WorkspaceTab = 'history' | 'changes' | 'terminal';

export type HookTerminalLaunchRequest = {
  id: string;
  cwd: string;
  shell: string;
  label: string;
  command: string;
  envVars?: Record<string, string>;
  keepOpenOnCompletion: boolean;
  hookId: string;
};

export type WorkspaceTerminalSnapshot = {
  activeTab: WorkspaceTab;
  activeTerminalPath: string | null;
  initializedPaths: string[];
  launchRequests: HookTerminalLaunchRequest[];
};

const DEFAULT_SNAPSHOT: WorkspaceTerminalSnapshot = {
  activeTab: 'history',
  activeTerminalPath: null,
  initializedPaths: [],
  launchRequests: [],
};

let availableShells = $state<string[]>([]);
let defaultShell = $state('');
let activeWorkspacePath = $state<string | null>(null);
let snapshots = $state<Record<string, WorkspaceTerminalSnapshot>>({});

function normalizeWorkspacePath(path: string): string {
  return normalizePathSeparators(path);
}

function cloneSnapshot(snapshot: WorkspaceTerminalSnapshot): WorkspaceTerminalSnapshot {
  return {
    activeTab: snapshot.activeTab,
    activeTerminalPath: snapshot.activeTerminalPath,
    initializedPaths: [...snapshot.initializedPaths],
    launchRequests: snapshot.launchRequests.map(request => ({
      ...request,
      envVars: { ...(request.envVars ?? {}) },
    })),
  };
}

function getOrCreateSnapshot(workspacePath: string): WorkspaceTerminalSnapshot {
  const key = normalizeWorkspacePath(workspacePath);
  const existing = snapshots[key];
  if (existing) return existing;

  const next = cloneSnapshot(DEFAULT_SNAPSHOT);
  snapshots = { ...snapshots, [key]: next };
  return next;
}

function updateSnapshot(
  workspacePath: string,
  updater: (current: WorkspaceTerminalSnapshot) => WorkspaceTerminalSnapshot
) {
  const key = normalizeWorkspacePath(workspacePath);
  const current = getOrCreateSnapshot(key);
  const next = cloneSnapshot(updater(cloneSnapshot(current)));
  snapshots = { ...snapshots, [key]: next };
}

export function setTerminalShellOptions(shells: string[], shell: string) {
  availableShells = [...shells];
  defaultShell = shell;
}

export function getTerminalShellOptions() {
  return {
    availableShells,
    defaultShell,
  };
}

export function setActiveWorkspacePath(workspacePath: string | null) {
  activeWorkspacePath = workspacePath ? normalizeWorkspacePath(workspacePath) : null;
}

export function getActiveWorkspacePath() {
  return activeWorkspacePath;
}

export function getWorkspaceTerminalSnapshot(
  workspacePath: string
): WorkspaceTerminalSnapshot {
  return cloneSnapshot(getOrCreateSnapshot(workspacePath));
}

export function getWorkspaceTerminalSnapshots(): Array<
  WorkspaceTerminalSnapshot & { workspacePath: string }
> {
  return Object.entries(snapshots).map(([workspacePath, snapshot]) => ({
    workspacePath,
    ...cloneSnapshot(snapshot),
  }));
}

export function setWorkspaceTerminalSnapshot(
  workspacePath: string,
  snapshot: WorkspaceTerminalSnapshot
) {
  const key = normalizeWorkspacePath(workspacePath);
  snapshots = {
    ...snapshots,
    [key]: cloneSnapshot(snapshot),
  };
}

export function pruneWorkspaceTerminalSnapshot(
  workspacePath: string,
  validPaths: string[]
) {
  const normalizedValidPaths = validPaths.map(path => normalizePathSeparators(path));
  updateSnapshot(workspacePath, current => {
    const initializedPaths = current.initializedPaths.filter(path =>
      normalizedValidPaths.some(validPath => pathsEqual(path, validPath))
    );
    const launchRequests = current.launchRequests.filter(request =>
      normalizedValidPaths.some(validPath => pathsEqual(request.cwd, validPath))
    );
    const activeTerminalPath =
      current.activeTerminalPath &&
      normalizedValidPaths.some(validPath => pathsEqual(current.activeTerminalPath, validPath))
        ? current.activeTerminalPath
        : initializedPaths[0] ?? normalizedValidPaths[0] ?? null;

    return {
      activeTab: current.activeTab,
      activeTerminalPath,
      initializedPaths,
      launchRequests,
    };
  });
}

export function clearWorkspaceTerminalStateForPath(workspacePath: string, path: string) {
  const normalizedPath = normalizePathSeparators(path);
  updateSnapshot(workspacePath, current => {
    const initializedPaths = current.initializedPaths.filter(
      existing => !pathsEqual(existing, normalizedPath)
    );
    const launchRequests = current.launchRequests.filter(
      request => !pathsEqual(request.cwd, normalizedPath)
    );
    const activeTerminalPath =
      current.activeTerminalPath && pathsEqual(current.activeTerminalPath, normalizedPath)
        ? initializedPaths[0] ?? null
        : current.activeTerminalPath;

    return {
      activeTab: current.activeTab,
      activeTerminalPath,
      initializedPaths,
      launchRequests,
    };
  });
}