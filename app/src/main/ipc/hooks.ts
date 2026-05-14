/**
 * Hook execution IPC handlers.
 *
 * Hooks are shell scripts that run at lifecycle points (worktree create/delete/switch).
 * They execute in a child process and emit progress events to the renderer.
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '@sproutgit/types';
import type { WorkspaceHookTrigger, WorkspaceHookShell, HookProgressEvent } from '@sproutgit/types';
import { openWorkspaceDb, eq } from '@sproutgit/database';
import { hookDefinitions, worktreeMetadata } from '@sproutgit/database/schema/workspace';
import { spawn } from 'child_process';
import { basename, join } from 'path';

function getWorkspaceDb(workspacePath: string) {
  const dbPath = join(workspacePath, '.sproutgit', 'state.db');
  return openWorkspaceDb(dbPath);
}

function shellCommand(shell: WorkspaceHookShell): { cmd: string; args: string[] } {
  switch (shell) {
    case 'zsh': return { cmd: 'zsh', args: ['-c'] };
    case 'bash': return { cmd: 'bash', args: ['-c'] };
    case 'pwsh': return { cmd: 'pwsh', args: ['-Command'] };
    case 'powershell': return { cmd: 'powershell', args: ['-Command'] };
  }
}

interface RunHookArgs {
  workspacePath: string;
  hookId: string;
  worktreePath: string;
  trigger: WorkspaceHookTrigger;
  initiatingWorktreePath?: string | null;
}

async function runHook(args: RunHookArgs, win: BrowserWindow): Promise<void> {
  const db = getWorkspaceDb(args.workspacePath);
  const hook = db
    .select()
    .from(hookDefinitions)
    .where(eq(hookDefinitions.id, args.hookId))
    .get();

  if (!hook || !hook.enabled) { db.close(); return; }

  const { cmd, args: shellArgs } = shellCommand(hook.shell as WorkspaceHookShell);

  // Look up worktree metadata for branch / source ref
  const wtMeta = db
    .select()
    .from(worktreeMetadata)
    .where(eq(worktreeMetadata.worktreePath, args.worktreePath))
    .get();
  db.close(); // release file handle; hook runs in a child process, DB not needed after this

  const osName = process.platform === 'darwin' ? 'macos'
    : process.platform === 'win32' ? 'windows'
    : 'linux';

  const env = {
    ...process.env,
    // Workspace
    SPROUTGIT_WORKSPACE: args.workspacePath,
    SPROUTGIT_WORKSPACE_NAME: basename(args.workspacePath),
    SPROUTGIT_ROOT_PATH: join(args.workspacePath, '.sproutgit', 'root'),
    SPROUTGIT_WORKTREES_PATH: join(args.workspacePath, '.sproutgit', 'worktrees'),
    // Worktree
    SPROUTGIT_WORKTREE: args.worktreePath,
    SPROUTGIT_WORKTREE_NAME: basename(args.worktreePath),
    SPROUTGIT_WORKTREE_BRANCH: wtMeta?.branch ?? '',
    SPROUTGIT_SOURCE_REF: wtMeta?.sourceRef ?? '',
    // Trigger
    SPROUTGIT_TRIGGER: args.trigger,
    SPROUTGIT_INITIATING_WORKTREE: args.initiatingWorktreePath ?? '',
    // Hook
    SPROUTGIT_HOOK_ID: hook.id,
    SPROUTGIT_HOOK_NAME: hook.name,
    SPROUTGIT_HOOK_SCOPE: hook.scope,
    SPROUTGIT_HOOK_SHELL: hook.shell,
    SPROUTGIT_HOOK_CRITICAL: String(hook.critical),
    SPROUTGIT_HOOK_TIMEOUT_SECONDS: String(hook.timeoutSeconds),
    // System
    SPROUTGIT_OS: osName,
  };

  const startEvent: HookProgressEvent = {
    trigger: args.trigger,
    hookId: hook.id,
    hookName: hook.name,
    keepOpenOnCompletion: hook.keepOpenOnCompletion ?? false,
    phase: 'start',
    status: 'running',
    stdoutSnippet: null,
    stderrSnippet: null,
    errorMessage: null,
  };
  win.webContents.send(IPC.EVENT_HOOK_PROGRESS, startEvent);

  return new Promise<void>(resolve => {
    const cwd = args.worktreePath;
    const proc = spawn(cmd, [...shellArgs, hook.script], { env, cwd, shell: false });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    let timedOut = false;
    const timeout = hook.timeoutSeconds
      ? setTimeout(() => {
          timedOut = true;
          proc.kill('SIGTERM');
        }, hook.timeoutSeconds * 1000)
      : null;

    proc.on('close', code => {
      if (timeout) clearTimeout(timeout);
      const success = !timedOut && code === 0;
      const endEvent: HookProgressEvent = {
        trigger: args.trigger,
        hookId: hook.id,
        hookName: hook.name,
        keepOpenOnCompletion: hook.keepOpenOnCompletion ?? false,
        phase: 'end',
        status: timedOut ? 'timed_out' : success ? 'success' : 'error',
        stdoutSnippet: stdout.slice(-2000) || null,
        stderrSnippet: stderr.slice(-2000) || null,
        errorMessage: timedOut ? 'Hook timed out' : code !== 0 ? `Exited with code ${String(code)}` : null,
      };
      win.webContents.send(IPC.EVENT_HOOK_PROGRESS, endEvent);
      resolve();
    });
  });
}

export function registerHookHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.HOOK_RUN, async (_e, args: RunHookArgs) => {
    const win = getWindow();
    if (!win) return;
    await runHook(args, win);
  });

  ipcMain.handle(IPC.HOOK_TOGGLE, (_e, args: {
    workspacePath: string;
    id: string;
    enabled: boolean;
  }) => {
    const db = getWorkspaceDb(args.workspacePath);
    try {
      db.update(hookDefinitions)
        .set({ enabled: args.enabled, updatedAt: new Date() })
        .where(eq(hookDefinitions.id, args.id))
        .run();
    } finally {
      db.close();
    }
  });

  ipcMain.handle(IPC.HOOK_RUN_SWITCH, async (_e, args: {
    workspacePath: string;
    targetWorktreePath: string;
    initiatingWorktreePath?: string | null;
  }) => {
    const win = getWindow();
    if (!win) return;

    const db = getWorkspaceDb(args.workspacePath);
    const hooks = db
      .select()
      .from(hookDefinitions)
      .where(eq(hookDefinitions.trigger, 'before_worktree_switch'))
      .all();
    db.close(); // release before running hooks asynchronously

    for (const hook of hooks) {
      await runHook({
        workspacePath: args.workspacePath,
        hookId: hook.id,
        worktreePath: args.targetWorktreePath,
        trigger: 'before_worktree_switch',
        initiatingWorktreePath: args.initiatingWorktreePath ?? null,
      }, win);
    }
  });
}
