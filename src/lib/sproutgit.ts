import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type GitInfo = {
  installed: boolean;
  version?: string | null;
};

export type WorktreeInfo = {
  path: string;
  head?: string | null;
  branch?: string | null;
  detached: boolean;
};

export type WorktreeListResult = {
  repoPath: string;
  worktrees: WorktreeInfo[];
};

export type WorkspaceInitResult = {
  workspacePath: string;
  rootPath: string;
  worktreesPath: string;
  metadataPath: string;
  stateDbPath: string;
  cloned: boolean;
};

export type WorkspaceStatus = {
  workspacePath: string;
  rootPath: string;
  worktreesPath: string;
  metadataPath: string;
  stateDbPath: string;
  isSproutgitProject: boolean;
  rootExists: boolean;
  worktreesExists: boolean;
  metadataExists: boolean;
  stateDbExists: boolean;
};

export type RefInfo = {
  name: string;
  fullName: string;
  kind: "branch" | "tag";
  target: string;
};

export type RefsResult = {
  repoPath: string;
  refs: RefInfo[];
};

export type CommitEntry = {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorDate: string;
  subject: string;
  refs: string[];
};

export type CommitGraphResult = {
  repoPath: string;
  commits: CommitEntry[];
};

export type CreateWorktreeResult = {
  worktreePath: string;
  branch: string;
  fromRef: string;
};

export const getGitInfo = () => invoke<GitInfo>("git_info");

export const createWorkspace = (workspacePath: string, repoUrl?: string | null) =>
  invoke<WorkspaceInitResult>("create_sproutgit_workspace", {
    workspacePath,
    repoUrl: repoUrl?.trim() ? repoUrl : null,
  });

export const inspectWorkspace = (workspacePath: string) =>
  invoke<WorkspaceStatus>("inspect_sproutgit_workspace", { workspacePath });

export const listWorktrees = (repoPath: string) =>
  invoke<WorktreeListResult>("list_worktrees", { repoPath });

export const listRefs = (repoPath: string) => invoke<RefsResult>("list_refs", { repoPath });

export const getCommitGraph = (repoPath: string, limit = 120) =>
  invoke<CommitGraphResult>("get_commit_graph", { repoPath, limit });

export const createManagedWorktree = (
  rootRepoPath: string,
  managedWorktreesPath: string,
  fromRef: string,
  newBranch: string,
) =>
  invoke<CreateWorktreeResult>("create_managed_worktree", {
    rootRepoPath,
    managedWorktreesPath,
    fromRef,
    newBranch,
  });

export const deleteManagedWorktree = (
  rootRepoPath: string,
  worktreePath: string,
  deleteBranch = true,
) =>
  invoke<string>("delete_managed_worktree", {
    rootRepoPath,
    worktreePath,
    deleteBranch,
  });

export type CheckoutResult = {
  worktreePath: string;
  previousBranch: string | null;
  newBranch: string;
  stashed: boolean;
};

export type DiffFileEntry = {
  path: string;
  status: string;
  oldPath: string | null;
};

export type DiffFilesResult = {
  commit: string;
  base: string | null;
  files: DiffFileEntry[];
};

export type DiffContentResult = {
  commit: string;
  base: string | null;
  filePath: string | null;
  diff: string;
};

export const checkoutWorktree = (
  worktreePath: string,
  targetRef: string,
  autoStash = true,
) =>
  invoke<CheckoutResult>("checkout_worktree", {
    worktreePath,
    targetRef,
    autoStash,
  });

export const resetWorktreeBranch = (
  worktreePath: string,
  targetRef: string,
  mode: "soft" | "mixed" | "hard",
) =>
  invoke<string>("reset_worktree_branch", {
    worktreePath,
    targetRef,
    mode,
  });

export const openInEditor = (worktreePath: string) =>
  invoke<string>("open_in_editor", { worktreePath });

export const getDiffFiles = (repoPath: string, commit: string, base?: string | null) =>
  invoke<DiffFilesResult>("get_diff_files", {
    repoPath,
    commit,
    base: base ?? null,
  });

export const getDiffContent = (
  repoPath: string,
  commit: string,
  base?: string | null,
  filePath?: string | null,
) =>
  invoke<DiffContentResult>("get_diff_content", {
    repoPath,
    commit,
    base: base ?? null,
    filePath: filePath ?? null,
  });

export const onCloneProgress = (callback: (message: string) => void): Promise<UnlistenFn> =>
  listen<string>("clone-progress", (event) => callback(event.payload));
