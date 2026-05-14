/**
 * Workspace initialisation, import and inspection handlers.
 *
 * A SproutGit workspace lives at `workspacePath` and contains:
 *   .sproutgit/
 *     root/       ← the bare git repo (or a clone)
 *     worktrees/  ← managed worktrees
 *     state.db    ← per-workspace sqlite state
 */
import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '@sproutgit/types';
import type { WorkspaceInitResult, WorkspaceStatus, ImportRepoMode } from '@sproutgit/types';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { dirname } from 'path';
import { cp, mkdir, rename, rm } from 'fs/promises';
import { initBareRepo, cloneBareRepo } from '@sproutgit/git';
import { openWorkspaceDb } from '@sproutgit/database';

function sproutDir(workspacePath: string) {
  return join(workspacePath, '.sproutgit');
}
function rootPath(workspacePath: string) {
  return join(sproutDir(workspacePath), 'root');
}
function worktreesPath(workspacePath: string) {
  return join(sproutDir(workspacePath), 'worktrees');
}
function stateDbPath(workspacePath: string) {
  return join(sproutDir(workspacePath), 'state.db');
}
function metadataPath(workspacePath: string) {
  return join(sproutDir(workspacePath), 'metadata');
}

/** Create the directory structure (and optionally clone a repo). */
async function initWorkspace(
  workspacePath: string,
  repoUrl?: string | null,
  onProgress?: (message: string) => void,
): Promise<WorkspaceInitResult> {
  const root = rootPath(workspacePath);
  const wt = worktreesPath(workspacePath);
  const meta = metadataPath(workspacePath);

  mkdirSync(root, { recursive: true });
  mkdirSync(wt, { recursive: true });
  mkdirSync(meta, { recursive: true });

  let cloned = false;
  if (repoUrl?.trim()) {
    await cloneBareRepo(repoUrl.trim(), root, onProgress);
    cloned = true;
  } else if (!existsSync(join(root, 'HEAD'))) {
    await initBareRepo(root);
  }

  // Run migrations to ensure state.db is ready, then release the connection.
  // workspace.ts will open its own cached connection on first IPC access.
  openWorkspaceDb(stateDbPath(workspacePath)).close();

  return {
    workspacePath,
    rootPath: root,
    worktreesPath: wt,
    metadataPath: meta,
    stateDbPath: stateDbPath(workspacePath),
    cloned,
  };
}

/** Import an existing non-bare repo in place (no file moves). */
async function importInPlace(sourceRepoPath: string): Promise<WorkspaceInitResult> {
  // Treat the source repo directory as the workspace. We convert it so that
  // .sproutgit/root is a symlink or reference pointing to the source's .git,
  // but the simplest approach: init the workspace at the same path, and let
  // the user's existing .git stay as the "root".
  //
  // For now we create the .sproutgit structure next to the .git folder.
  const root = join(sourceRepoPath, '.git');
  const wt = worktreesPath(sourceRepoPath);
  const meta = metadataPath(sourceRepoPath);

  mkdirSync(wt, { recursive: true });
  mkdirSync(meta, { recursive: true });

  // Run migrations to ensure state.db is ready, then release the connection.
  // workspace.ts will open its own cached connection on first IPC access.
  openWorkspaceDb(stateDbPath(sourceRepoPath)).close();

  return {
    workspacePath: sourceRepoPath,
    rootPath: root,
    worktreesPath: wt,
    metadataPath: meta,
    stateDbPath: stateDbPath(sourceRepoPath),
    cloned: false,
  };
}

function emitGitOpProgress(win: BrowserWindow | null, message: string, phase: string): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC.EVENT_GIT_OP_PROGRESS, { message, phase });
}

function isCrossDeviceRenameError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'EXDEV';
}

async function importByMode(
  sourceRepoPath: string,
  mode: ImportRepoMode,
  workspacePath?: string | null,
  win?: BrowserWindow | null,
): Promise<WorkspaceInitResult> {
  const trimmedWorkspacePath = workspacePath?.trim() ?? '';

  if (mode === 'inPlace' || trimmedWorkspacePath === '' || trimmedWorkspacePath === sourceRepoPath) {
    emitGitOpProgress(win ?? null, 'Importing repository in place…', 'import');
    return importInPlace(sourceRepoPath);
  }

  await mkdir(dirname(trimmedWorkspacePath), { recursive: true });

  if (existsSync(trimmedWorkspacePath)) {
    throw new Error(`Workspace already exists: ${trimmedWorkspacePath}`);
  }

  if (mode === 'move') {
    emitGitOpProgress(win ?? null, 'Moving repository into workspace…', 'import');
    try {
      await rename(sourceRepoPath, trimmedWorkspacePath);
    } catch (error) {
      if (!isCrossDeviceRenameError(error)) throw error;
      emitGitOpProgress(win ?? null, 'Moving repository across devices…', 'import');
      await cp(sourceRepoPath, trimmedWorkspacePath, { recursive: true, preserveTimestamps: true });
      await rm(sourceRepoPath, { recursive: true, force: true });
    }
  } else if (mode === 'copy') {
    emitGitOpProgress(win ?? null, 'Copying repository into workspace…', 'import');
    await cp(sourceRepoPath, trimmedWorkspacePath, { recursive: true, preserveTimestamps: true });
  } else {
    throw new Error(`Unsupported import mode: ${mode}`);
  }

  emitGitOpProgress(win ?? null, 'Preparing SproutGit metadata…', 'import');
  return importInPlace(trimmedWorkspacePath);
}

function inspectWorkspace(workspacePath: string): WorkspaceStatus {
  const sprout = sproutDir(workspacePath);

  // ── Layout detection ─────────────────────────────────────────────────────
  // New Electron layout:  workspacePath/.sproutgit/root  (bare repo)
  //                       workspacePath/.sproutgit/worktrees
  // Legacy Rust layout:   workspacePath/root              (main worktree, has .git/)
  //                       workspacePath/worktrees
  // Imported in-place:    workspacePath/.git

  const newRoot = rootPath(workspacePath);          // .sproutgit/root
  const newWt   = worktreesPath(workspacePath);     // .sproutgit/worktrees
  const legacyRoot = join(workspacePath, 'root');   // root/
  const legacyWt   = join(workspacePath, 'worktrees'); // worktrees/

  let resolvedRoot: string;
  let resolvedWt: string;
  let gitRepoPath: string;

  if (existsSync(newRoot)) {
    // New Electron layout — bare repo at .sproutgit/root
    resolvedRoot = newRoot;
    resolvedWt   = newWt;
    gitRepoPath  = newRoot;
  } else if (existsSync(join(legacyRoot, '.git'))) {
    // Legacy Rust layout — main worktree at workspacePath/root
    resolvedRoot = legacyRoot;
    resolvedWt   = legacyWt;
    gitRepoPath  = legacyRoot;
  } else if (existsSync(join(workspacePath, '.git'))) {
    // Imported in-place — workspace IS the git repo.
    // If .sproutgit exists (created by importInPlace), use its worktrees dir.
    resolvedRoot = join(workspacePath, '.git');
    resolvedWt   = existsSync(join(sproutDir(workspacePath), 'worktrees')) ? newWt : legacyWt;
    gitRepoPath  = workspacePath;
  } else {
    // No recognisable git repo — return empty so queries stay disabled
    resolvedRoot = newRoot;
    resolvedWt   = newWt;
    gitRepoPath  = '';
  }

  const meta = metadataPath(workspacePath);
  const db   = stateDbPath(workspacePath);

  return {
    workspacePath,
    gitRepoPath,
    rootPath: resolvedRoot,
    worktreesPath: resolvedWt,
    metadataPath: meta,
    stateDbPath: db,
    isSproutgitProject: existsSync(sprout),
    rootExists: existsSync(resolvedRoot),
    worktreesExists: existsSync(resolvedWt),
    metadataExists: existsSync(meta),
    stateDbExists: existsSync(db),
  };
}

export function registerWorkspaceInitHandlers(): void {
  ipcMain.handle(IPC.WORKSPACE_CREATE, async (_e, args: {
    workspacePath: string;
    repoUrl?: string | null;
  }) => {
    const win = BrowserWindow.fromWebContents(_e.sender);
    const onProgress = win ? (msg: string) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.EVENT_GIT_OP_PROGRESS, { message: msg, phase: 'clone' });
      }
    } : undefined;
    return initWorkspace(args.workspacePath, args.repoUrl, onProgress);
  });

  ipcMain.handle(IPC.WORKSPACE_IMPORT, async (_e, args: {
    sourceRepoPath: string;
    mode: ImportRepoMode;
    workspacePath?: string | null;
  }) => importByMode(args.sourceRepoPath, args.mode, args.workspacePath, BrowserWindow.fromWebContents(_e.sender)));

  ipcMain.handle(IPC.WORKSPACE_INSPECT, (_e, workspacePath: string) =>
    inspectWorkspace(workspacePath),
  );
}
