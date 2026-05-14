import { create } from 'zustand';
import type { WorktreeInfo } from '@sproutgit/types';

export type Tab = 'graph' | 'staging' | 'terminal';
export type TerminalLayout = 'tabs' | 'split' | 'grid';
export type HookStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'timed_out';
export type OpHookEntry = { hookId: string; hookName: string; status: HookStatus };
export type TerminalSession = { id: string; label: string; pendingData: string; cwd: string };

interface WorkspaceUiState {
  workspacePath: string;
  /** Active worktree selected in the sidebar. */
  activeWorktree: WorktreeInfo | null;
  // Tab bar
  activeTab: Tab;
  // Remote op loading flags
  fetching: boolean;
  pulling: boolean;
  pushing: boolean;
  // Shell preference (loaded from settings)
  defaultShell: string;
  // Terminals
  terminalSessions: TerminalSession[];
  activeTerminalId: string | null;
  terminalLayout: TerminalLayout;
  // Hook progress overlay
  opTitle: string | null;
  opHooks: OpHookEntry[];
  opLogs: string[];
  opCompleted: boolean;
  // Pending worktree creation
  pendingCreationBranch: string | null;
  creatingWorktree: boolean;
}

function readInitialTab(): Tab {
  const s = sessionStorage.getItem('sg_active_tab');
  return s === 'staging' || s === 'terminal' ? s : 'graph';
}

function readInitialTerminalLayout(): TerminalLayout {
  const s = sessionStorage.getItem('sg_terminal_layout');
  return s === 'split' || s === 'grid' ? s : 'tabs';
}

const baseUiState: Omit<WorkspaceUiState, 'workspacePath'> = {
  activeWorktree: null,
  activeTab: readInitialTab(),
  fetching: false,
  pulling: false,
  pushing: false,
  defaultShell: '',
  terminalSessions: [],
  activeTerminalId: null,
  terminalLayout: readInitialTerminalLayout(),
  opTitle: null,
  opHooks: [],
  opLogs: [],
  opCompleted: false,
  pendingCreationBranch: null,
  creatingWorktree: false,
};

export const useWorkspaceStore = create<WorkspaceUiState>()(() => ({
  workspacePath: '',
  ...baseUiState,
}));

/** Reset UI state when switching to a new workspace. */
export function resetWorkspaceStore(workspacePath: string) {
  useWorkspaceStore.setState({ workspacePath, ...baseUiState, activeTab: readInitialTab() });
}

