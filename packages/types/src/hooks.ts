export type WorkspaceHookTrigger =
  | 'before_worktree_create'
  | 'after_worktree_create'
  | 'before_worktree_remove'
  | 'after_worktree_remove'
  | 'before_worktree_switch'
  | 'after_worktree_switch'
  | 'manual';

export type WorkspaceHookScope = 'worktree' | 'workspace';

export type HookExecutionTarget = 'workspace' | 'trigger_worktree' | 'initiating_worktree';

export type HookExecutionMode = 'terminal_tab';

export type WorkspaceHookShell = 'bash' | 'zsh' | 'pwsh' | 'powershell';

export type WorkspaceHook = {
  id: string;
  name: string;
  scope: WorkspaceHookScope;
  trigger: WorkspaceHookTrigger;
  executionTarget: HookExecutionTarget;
  executionMode: HookExecutionMode;
  shell: WorkspaceHookShell;
  script: string;
  enabled: boolean;
  critical: boolean;
  switchOncePerSession: boolean;
  switchRunOnCreate: boolean;
  switchRunOnDelete: boolean;
  keepOpenOnCompletion: boolean;
  timeoutSeconds: number;
  createdAt: number;
  updatedAt: number;
  dependencyIds: string[];
};

export type HookUpsertInput = {
  name: string;
  scope: WorkspaceHookScope;
  trigger: WorkspaceHookTrigger;
  executionTarget: HookExecutionTarget;
  shell: WorkspaceHookShell;
  script: string;
  enabled: boolean;
  critical: boolean;
  switchOncePerSession: boolean;
  switchRunOnCreate: boolean;
  switchRunOnDelete: boolean;
  keepOpenOnCompletion: boolean;
  timeoutSeconds: number;
  dependencyIds: string[];
};

export type WorktreeSwitchHookSource = 'manual' | 'create' | 'delete' | 'load';

export type HookProgressEvent = {
  trigger: string;
  hookId: string;
  hookName: string;
  keepOpenOnCompletion?: boolean;
  phase: 'start' | 'end' | 'skipped';
  status: string;
  stdoutSnippet: string | null;
  stderrSnippet: string | null;
  errorMessage: string | null;
};

export type HookTerminalLaunchEvent = {
  terminalId: string;
  hookId: string;
  hookName: string;
  cwd: string;
  keepOpenOnCompletion: boolean;
};
