import { api } from '../api.js';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { rootRoute } from './__root.js';
import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CommitGraph,
  StagingPanel,
  TerminalPane,
  Spinner,
  ContextMenuProvider,
  useContextMenu,
  WorkspaceHooksModal,
  WindowControls,
  UpdateBadge,
} from '@sproutgit/ui';
import { GitBranch, Terminal, GitMerge, X, ChevronRight, Settings, Plus, Columns2, Rows3, LayoutGrid, Pencil, PanelTop, SquareSplitHorizontal, ChevronsRight, Trash2 } from 'lucide-react';
import type { CommitEntry, DiffFileEntry, HookProgressEvent, WorktreeInfo } from '@sproutgit/types';
import { useToast } from '../toast-context.js';
import { useUpdateStore } from '../stores/update-store.js';
import { useWorkspaceStore, resetWorkspaceStore } from '../stores/workspace-store.js';
import type { HookStatus } from '../stores/workspace-store.js';
import { WorktreeSidebar } from '../workspace/WorktreeSidebar.js';
import { HookProgressOverlay } from '../workspace/HookProgressOverlay.js';
import { CommitDiffPanel } from '../workspace/CommitDiffPanel.js';
import { NewWorktreeDialog } from '../workspace/dialogs/NewWorktreeDialog.js';
import { DeleteWorktreeDialog } from '../workspace/dialogs/DeleteWorktreeDialog.js';
import { PublishDialog } from '../workspace/dialogs/PublishDialog.js';
import { RunHookDialog } from '../workspace/dialogs/RunHookDialog.js';
import {
  qk,
  useWorkspaceStatus,
  useWorktrees,
  useCommits,
  useCommitCount,
  useRefs,
  usePushStatus,
  useFetch,
  usePull,
  usePush,
  useDeleteWorktree,
} from '../queries.js';

// ── Search params ─────────────────────────────────────────────────────────────

type WorkspaceSearch = { path: string };

// ── Workspace view ────────────────────────────────────────────────────────────

function WorkspaceView() {
  return (
    <ContextMenuProvider>
      <WorkspaceInner />
    </ContextMenuProvider>
  );
}

function WorkspaceInner() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const contextMenu = useContextMenu();
  const { path: workspacePath } = useSearch({ from: workspaceRoute.id });

  // ── Zustand UI state ──────────────────────────────────────────────────
  const activeWorktree = useWorkspaceStore(s => s.activeWorktree);
  const activeTab = useWorkspaceStore(s => s.activeTab);
  const defaultShell = useWorkspaceStore(s => s.defaultShell);
  const fetching = useWorkspaceStore(s => s.fetching);
  const pulling = useWorkspaceStore(s => s.pulling);
  const pushing = useWorkspaceStore(s => s.pushing);
  const terminalSessions = useWorkspaceStore(s => s.terminalSessions);
  const activeTerminalId = useWorkspaceStore(s => s.activeTerminalId);
  const terminalLayout = useWorkspaceStore(s => s.terminalLayout);
  const creatingWorktree = useWorkspaceStore(s => s.creatingWorktree);
  const pendingCreationBranch = useWorkspaceStore(s => s.pendingCreationBranch);
  const { updateState, setUpdateState } = useUpdateStore();

  // ── Server state via TanStack Query ──────────────────────────────────
  const { data: workspaceStatus } = useWorkspaceStatus(workspacePath);
  // Use '' (falsy) until workspaceStatus resolves so dependent queries stay
  // disabled — workspacePath itself is not a git repo in the .sproutgit layout.
  const gitRepoPath = workspaceStatus?.gitRepoPath ?? '';

  const {
    data: worktrees = [],
    isLoading: worktreesLoading,
  } = useWorktrees(gitRepoPath);

  const {
    data: commits = [],
    isLoading: commitsLoading,
    isFetching: commitsFetching,
  } = useCommits(gitRepoPath);

  const { data: commitTotal = 0 } = useCommitCount(gitRepoPath);
  const { data: refs = [] } = useRefs(gitRepoPath);
  const { data: pushStatus } = usePushStatus(activeWorktree?.path);

  const loading = worktreesLoading || commitsLoading;
  const terminalScopePath = activeWorktree?.path ?? workspacePath;
  const scopedTerminalSessions = terminalSessions.filter(s => s.cwd === terminalScopePath);
  const scopedActiveTerminalId = scopedTerminalSessions.some(s => s.id === activeTerminalId)
    ? activeTerminalId
    : (scopedTerminalSessions[scopedTerminalSessions.length - 1]?.id ?? null);

  // ── Worktree change counts (sidebar badges) ───────────────────────────
  const worktreeChangeCounts: Record<string, number> = {};
  const rootP = workspaceStatus?.rootPath;
  for (const wt of worktrees.filter(w => w.path !== rootP)) {
    const cached = qc.getQueryData<{ files: unknown[] }>(qk.worktreeStatus(wt.path));
    worktreeChangeCounts[wt.path] = cached?.files.length ?? 0;
  }

  // ── Pick initial active worktree once worktrees load ─────────────────
  useEffect(() => {
    // Filter out root worktree — it should never be active
    const selectableWorktrees = worktrees.filter(w => w.path !== rootP);
    if (selectableWorktrees.length === 0) {
      useWorkspaceStore.setState({ activeWorktree: null });
      return;
    }

    const workspaceChanged = lastWorktreeWorkspaceRef.current !== workspacePath;
    lastWorktreeWorkspaceRef.current = workspacePath;

    // If the workspace hasn't changed, preserve an already-valid selection
    // (e.g. a new worktree was added/removed — don't reset the active one).
    if (!workspaceChanged) {
      const current = useWorkspaceStore.getState().activeWorktree;
      if (current && selectableWorktrees.some(w => w.path === current.path)) return;
    }

    // On workspace open: restore the last-selected worktree from the DB, fall
    // back to first non-detached, then first overall.
    void api.getWorkspaceState(workspacePath, 'activeWorktreePath').then(saved => {
      const restored = saved ? (selectableWorktrees.find(w => w.path === saved) ?? null) : null;
      const initial = restored ?? selectableWorktrees.find(w => !w.detached) ?? selectableWorktrees[0] ?? null;
      useWorkspaceStore.setState({ activeWorktree: initial });
    }).catch(() => {
      const initial = selectableWorktrees.find(w => !w.detached) ?? selectableWorktrees[0] ?? null;
      useWorkspaceStore.setState({ activeWorktree: initial });
    });
  }, [worktrees, rootP, workspacePath]);

  // ── Local UI state ────────────────────────────────────────────────────
  const [hooksModalOpen, setHooksModalOpen] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [runHookTarget, setRunHookTarget] = useState<WorktreeInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorktreeInfo | null>(null);
  const [showNewWorktree, setShowNewWorktree] = useState(false);

  // Commit diff state
  const [selectedCommits, setSelectedCommits] = useState<CommitEntry[]>([]);
  const [commitDiffRange, setCommitDiffRange] = useState<string | null>(null);
  const [commitDiffFiles, setCommitDiffFiles] = useState<DiffFileEntry[]>([]);
  const [commitDiffContent, setCommitDiffContent] = useState('');
  const [commitDiffFile, setCommitDiffFile] = useState<DiffFileEntry | null>(null);
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);
  const [commitDiffFileLoading, setCommitDiffFileLoading] = useState(false);
  const [renamingTerminalId, setRenamingTerminalId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Temporary shim — StagingPanel still uses this until it is refactored to useQuery
  const [stagingRefresh, setStagingRefresh] = useState(0);

  // Non-reactive terminal data buffer
  const terminalDataRef = useRef<Map<string, string>>(new Map());
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const lastWorktreeWorkspaceRef = useRef('');

  const selectedCommit = selectedCommits[0] ?? null;

  // ── Mutations ─────────────────────────────────────────────────────────
  const fetchMutation = useFetch(activeWorktree?.path ?? '', gitRepoPath);
  const pullMutation = usePull(activeWorktree?.path ?? '', gitRepoPath);
  const pushMutation = usePush(activeWorktree?.path ?? '');
  const deleteWorktreeMutation = useDeleteWorktree(gitRepoPath);

  // ── Reset UI state when workspace path changes ────────────────────────

  useEffect(() => {
    resetWorkspaceStore(workspacePath);
  }, [workspacePath]);

  // ── Default shell preference ──────────────────────────────────────────
  useEffect(() => {
    void api.getSetting('default_shell')
      .then((v: string | null) => useWorkspaceStore.setState({ defaultShell: v ?? '' }))
      .catch(() => undefined);
  }, [workspacePath]);

  // ── Run switch hooks on initial load ─────────────────────────────────
  useEffect(() => {
    if (!workspaceStatus || worktrees.length === 0) return;
    const initTarget = worktrees.find(w => !w.detached) ?? worktrees[0];
    if (!initTarget) return;
    void api.runSwitchHooks({
      workspacePath,
      targetWorktreePath: initTarget.path,
      initiatingWorktreePath: null,
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath, workspaceStatus != null]);

  // ── File watcher → invalidate queries ────────────────────────────────

  useEffect(() => {
    void api.startWatching(workspacePath);
    const offWorktree = api.onWorktreeChanged(() => {
      void qc.invalidateQueries({ queryKey: qk.worktrees(gitRepoPath) });
    });
    const offRefs = api.onGitRefsChanged(() => {
      void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
      void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
    });
    return () => {
      void api.stopWatching(workspacePath);
      offWorktree();
      offRefs();
      void api.closeTerminalsForPath(workspacePath);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath, gitRepoPath]);

  // ── Session persistence ───────────────────────────────────────────────

  useEffect(() => {
    if (activeWorktree) sessionStorage.setItem('sg_active_wt', activeWorktree.path);
  }, [activeWorktree]);

  // ── Auto-switch tab if activeTab becomes disabled ─────────────────────
  useEffect(() => {
    if (!activeWorktree && (activeTab === 'staging' || activeTab === 'terminal')) {
      useWorkspaceStore.setState({ activeTab: 'graph' });
    }
  }, [activeWorktree, activeTab]);

  useEffect(() => {
    sessionStorage.setItem('sg_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    sessionStorage.setItem('sg_terminal_layout', terminalLayout);
  }, [terminalLayout]);

  useEffect(() => {
    if (activeTerminalId !== scopedActiveTerminalId) {
      useWorkspaceStore.setState({ activeTerminalId: scopedActiveTerminalId });
    }
    if (renamingTerminalId && !scopedTerminalSessions.some(s => s.id === renamingTerminalId)) {
      setRenamingTerminalId(null);
      setRenameValue('');
    }
  }, [activeTerminalId, scopedActiveTerminalId, renamingTerminalId, scopedTerminalSessions]);

  useEffect(() => {
    if (!renamingTerminalId || !renameInputRef.current) return;
    renameInputRef.current.focus();
    renameInputRef.current.select();
  }, [renamingTerminalId]);

  // ── Terminal IPC ──────────────────────────────────────────────────────

  useEffect(() => {
    const offData = api.onTerminalData((id: string, data: string) => {
      const prev = terminalDataRef.current.get(id) ?? '';
      terminalDataRef.current.set(id, prev + data);
      useWorkspaceStore.setState(s => ({
        terminalSessions: s.terminalSessions.map(sess =>
          sess.id === id ? { ...sess, pendingData: terminalDataRef.current.get(id) ?? '' } : sess
        ),
      }));
    });

    const offExit = api.onTerminalExit((id: string) => {
      useWorkspaceStore.setState(s => {
        const remaining = s.terminalSessions.filter(sess => sess.id !== id);
        return {
          terminalSessions: remaining,
          activeTerminalId: s.activeTerminalId === id
            ? (remaining[remaining.length - 1]?.id ?? null)
            : s.activeTerminalId,
        };
      });
    });

    return () => { offData(); offExit(); };
  }, []);

  // ── Hook progress overlay ─────────────────────────────────────────────

  useEffect(() => {
    const offHookProgress = api.onHookProgress((event: HookProgressEvent) => {
      if (event.phase === 'start') {
        useWorkspaceStore.setState(s => ({
          opTitle: s.opTitle ?? `Running ${event.trigger.replace(/_/g, ' ')} hooks…`,
          opCompleted: false,
          opHooks: [
            ...s.opHooks.filter(h => h.hookId !== event.hookId),
            { hookId: event.hookId, hookName: event.hookName, status: 'running' as HookStatus },
          ],
          opLogs: [...s.opLogs, `▶ ${event.hookName} (${event.trigger})`],
        }));
      } else if (event.phase === 'skipped') {
        useWorkspaceStore.setState(s => ({
          opHooks: s.opHooks.map(h => h.hookId === event.hookId ? { ...h, status: 'skipped' as HookStatus } : h),
          opLogs: event.errorMessage?.trim()
            ? [...s.opLogs, `⏭ ${event.hookName} skipped`, `  error: ${event.errorMessage}`]
            : [...s.opLogs, `⏭ ${event.hookName} skipped`],
        }));
      } else {
        const status = (event.status === 'success' ? 'success' : event.status === 'timed_out' ? 'timed_out' : 'error') as HookStatus;
        useWorkspaceStore.setState(s => {
          const logLines = [`${status === 'success' ? '✓' : '✗'} ${event.hookName} (${event.status})`];
          if (event.stdoutSnippet?.trim()) logLines.push(`  stdout:\n${event.stdoutSnippet}`);
          if (event.stderrSnippet?.trim()) logLines.push(`  stderr:\n${event.stderrSnippet}`);
          if (event.errorMessage?.trim()) logLines.push(`  error: ${event.errorMessage}`);
          const nextHooks = s.opHooks.map(h => h.hookId === event.hookId ? { ...h, status } : h);
          const allDone = nextHooks.length > 0 && nextHooks.every(h => h.status !== 'running' && h.status !== 'pending');
          const allOk = allDone && nextHooks.every(h => h.status === 'success' || h.status === 'skipped');
          if (allDone) {
            setTimeout(() => {
              useWorkspaceStore.setState({ opCompleted: true });
              const shouldKeepOpen = Boolean(event.keepOpenOnCompletion) || useWorkspaceStore.getState().activeTab === 'terminal';
              if (allOk && !shouldKeepOpen) {
                setTimeout(() => useWorkspaceStore.setState({ opTitle: null, opLogs: [], opHooks: [] }), 1500);
              }
            }, 0);
          }
          return { opHooks: nextHooks, opLogs: [...s.opLogs, ...logLines] };
        });
      }
    });

    const offHookTerminal = api.onHookTerminalLaunch(() => {
      useWorkspaceStore.setState({ activeTab: 'terminal' });
    });

    return () => { offHookProgress(); offHookTerminal(); };
  }, []);

  // ── Auto-update listeners ─────────────────────────────────────────────

  useEffect(() => {
    const offChecking = api.onUpdateChecking(() => setUpdateState({ status: 'checking' }));
    const offAvailable = api.onUpdateAvailable((version: string) => setUpdateState({ status: 'available', version }));
    const offNotAvailable = api.onUpdateNotAvailable(() => setUpdateState({ status: 'up-to-date' }));
    const offDownloading = api.onUpdateDownloading((progress: number) => setUpdateState({ status: 'downloading', progress }));
    const offReady = api.onUpdateReady(() => setUpdateState({ status: 'ready' }));
    const offError = api.onUpdateError(() => setUpdateState({ status: 'idle' }));
    return () => { offChecking(); offAvailable(); offNotAvailable(); offDownloading(); offReady(); offError(); };
  }, [setUpdateState]);

  // ── Actions ───────────────────────────────────────────────────────────

  async function doFetch() {
    if (!activeWorktree) return;
    useWorkspaceStore.setState({ fetching: true });
    try {
      await fetchMutation.mutateAsync();
      toast('Fetched', 'success');
    } catch (err) {
      toast(`Fetch failed: ${String(err)}`, 'error');
    } finally {
      useWorkspaceStore.setState({ fetching: false });
    }
  }

  async function doPull() {
    if (!activeWorktree) return;
    useWorkspaceStore.setState({ pulling: true });
    try {
      await pullMutation.mutateAsync();
      toast('Pulled', 'success');
    } catch (err) {
      toast(`Pull failed: ${String(err)}`, 'error');
    } finally {
      useWorkspaceStore.setState({ pulling: false });
    }
  }

  async function doPush() {
    if (!activeWorktree) return;
    if (!pushStatus?.upstream) {
      setShowPublishModal(true);
      return;
    }
    useWorkspaceStore.setState({ pushing: true });
    try {
      await pushMutation.mutateAsync();
      toast('Pushed', 'success');
    } catch (err) {
      toast(`Push failed: ${String(err)}`, 'error');
    } finally {
      useWorkspaceStore.setState({ pushing: false });
    }
  }

  async function handleWorktreeSwitch(wt: WorktreeInfo) {
    if (activeWorktree?.path === wt.path) return;
    const prevPath = activeWorktree?.path ?? null;
    useWorkspaceStore.setState({ activeWorktree: wt });
    void api.setWorkspaceState(workspacePath, 'activeWorktreePath', wt.path).catch(() => undefined);
    void api.runSwitchHooks({
      workspacePath,
      targetWorktreePath: wt.path,
      initiatingWorktreePath: prevPath,
    }).catch((err: unknown) => toast(`Switch hooks failed: ${String(err)}`, 'error'));
  }

  async function doDeleteWorktree(wt: WorktreeInfo) {
    const isDeletingActive = activeWorktree?.path === wt.path;
    const nextWt = isDeletingActive
      ? worktrees.find(w => w.path !== wt.path && w.path !== workspaceStatus?.rootPath)
      ?? null
      : null;

    if (isDeletingActive && nextWt) {
      try {
        await api.runSwitchHooks({
          workspacePath,
          targetWorktreePath: nextWt.path,
          initiatingWorktreePath: wt.path,
        });
      } catch { /* non-critical */ }
    }

    await api.closeTerminalsForPath(wt.path);
    // Switch the active worktree away *before* the mutation so that no git
    // queries fire on the deleted path while or after the deletion runs.
    if (isDeletingActive) useWorkspaceStore.setState({ activeWorktree: nextWt });
    await deleteWorktreeMutation.mutateAsync({
      rootRepoPath: workspacePath,
      worktreePath: wt.path,
      deleteBranch: false,
    });
    toast('Worktree removed', 'success');
    setDeleteTarget(null);
  }

  async function loadCommitDiff(commit: CommitEntry) {
    setSelectedCommits([commit]);
    setCommitDiffFile(null);
    setCommitDiffContent('');
    setCommitDiffLoading(true);
    try {
      const range = commit.parents.length > 0
        ? `${commit.parents[0]}..${commit.hash}`
        : commit.hash;
      setCommitDiffRange(range);
      const files = await api.getDiffFiles(gitRepoPath, range);
      setCommitDiffFiles(files as DiffFileEntry[]);
    } catch (err) {
      toast(`Failed to load commit diff: ${String(err)}`, 'error');
      setCommitDiffFiles([]);
    } finally {
      setCommitDiffLoading(false);
    }
  }

  async function loadCommitRangeDiff(from: CommitEntry, to: CommitEntry) {
    setSelectedCommits([from, to]);
    setCommitDiffFile(null);
    setCommitDiffContent('');
    setCommitDiffLoading(true);
    try {
      const range = `${from.hash}..${to.hash}`;
      setCommitDiffRange(range);
      const files = await api.getDiffFiles(gitRepoPath, range);
      setCommitDiffFiles(files as DiffFileEntry[]);
    } catch (err) {
      toast(`Failed to load range diff: ${String(err)}`, 'error');
      setCommitDiffFiles([]);
    } finally {
      setCommitDiffLoading(false);
    }
  }

  async function loadCommitDiffFile(file: DiffFileEntry) {
    if (!selectedCommit) return;
    setCommitDiffFile(file);
    setCommitDiffFileLoading(true);
    try {
      const range = commitDiffRange ?? (
        selectedCommit.parents.length > 0
          ? `${selectedCommit.parents[0]}..${selectedCommit.hash}`
          : selectedCommit.hash
      );
      const content = await api.getDiffContent(gitRepoPath, range, file.path);
      setCommitDiffContent(content as string);
    } catch (err) {
      toast(`Failed to load diff: ${String(err)}`, 'error');
      setCommitDiffContent('');
    } finally {
      setCommitDiffFileLoading(false);
    }
  }

  async function openTerminal(cwd: string, label?: string) {
    try {
      const terminalArgs: {
        cwd: string;
        label?: string;
        shell?: string;
      } = { cwd };
      if (label) terminalArgs.label = label;
      if (defaultShell) terminalArgs.shell = defaultShell;
      const id = await api.createTerminal(terminalArgs);
      useWorkspaceStore.setState(s => ({
        terminalSessions: [...s.terminalSessions, {
          id,
          cwd,
          label: makeTerminalLabel(s.terminalSessions.filter(sess => sess.cwd === cwd), label ?? cwd.split('/').pop() ?? cwd),
          pendingData: '',
        }],
        activeTerminalId: id,
        activeTab: 'terminal',
      }));
    } catch (err) {
      toast(`Failed to open terminal: ${String(err)}`, 'error');
    }
  }

  function makeTerminalLabel(sessions: typeof terminalSessions, baseLabel: string) {
    const trimmed = baseLabel.trim() || 'terminal';
    const existing = sessions.filter(s => s.label === trimmed).length;
    return existing === 0 ? trimmed : `${trimmed} (${existing + 1})`;
  }

  function terminalPanelStyle(id: string): React.CSSProperties {
    if (terminalLayout === 'tabs') {
      return {
        display: id === activeTerminalId ? 'block' : 'none',
        minHeight: 0,
        flex: 1,
      };
    }
    return {
      display: 'block',
      minHeight: 0,
      minWidth: 0,
      flex: 1,
    };
  }

  function terminalWrapperClass() {
    if (terminalLayout === 'split') return 'flex flex-1 min-h-0';
    if (terminalLayout === 'grid') return 'grid flex-1 min-h-0 grid-cols-2 auto-rows-fr';
    return 'flex flex-1 min-h-0 flex-col';
  }

  async function closeTerminal(id: string) {
    await api.closeTerminal(id).catch(() => undefined);
    useWorkspaceStore.setState(s => {
      const remaining = s.terminalSessions.filter(sess => sess.id !== id);
      return {
        terminalSessions: remaining,
        activeTerminalId: s.activeTerminalId === id
          ? (remaining[remaining.length - 1]?.id ?? null)
          : s.activeTerminalId,
      };
    });
    if (renamingTerminalId === id) {
      setRenamingTerminalId(null);
      setRenameValue('');
    }
  }

  async function closeTerminals(ids: string[]) {
    if (ids.length === 0) return;
    await Promise.all(ids.map(id => api.closeTerminal(id).catch(() => undefined)));
    useWorkspaceStore.setState(s => {
      const idSet = new Set(ids);
      const remaining = s.terminalSessions.filter(sess => !idSet.has(sess.id));
      return {
        terminalSessions: remaining,
        activeTerminalId: idSet.has(s.activeTerminalId ?? '')
          ? (remaining[remaining.length - 1]?.id ?? null)
          : s.activeTerminalId,
      };
    });
    if (renamingTerminalId && ids.includes(renamingTerminalId)) {
      setRenamingTerminalId(null);
      setRenameValue('');
    }
  }

  function startTerminalRename(id: string) {
    const session = terminalSessions.find(s => s.id === id);
    if (!session) return;
    useWorkspaceStore.setState({ activeTerminalId: id, activeTab: 'terminal' });
    setRenamingTerminalId(id);
    setRenameValue(session.label);
  }

  function commitTerminalRename() {
    if (!renamingTerminalId) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      useWorkspaceStore.setState(s => ({
        terminalSessions: s.terminalSessions.map(sess =>
          sess.id === renamingTerminalId ? { ...sess, label: trimmed } : sess,
        ),
      }));
    }
    setRenamingTerminalId(null);
    setRenameValue('');
  }

  function cancelTerminalRename() {
    setRenamingTerminalId(null);
    setRenameValue('');
  }

  function openTerminalTabMenu(e: React.MouseEvent, sessionId: string) {
    const index = scopedTerminalSessions.findIndex(s => s.id === sessionId);
    if (index === -1) return;
    const idsToRight = scopedTerminalSessions.slice(index + 1).map(s => s.id);
    const otherIds = scopedTerminalSessions.filter(s => s.id !== sessionId).map(s => s.id);
    contextMenu.open(e, [
      {
        label: 'Rename',
        icon: <Pencil size={14} />,
        onClick: () => startTerminalRename(sessionId),
      },
      {
        label: 'New Terminal',
        icon: <Plus size={14} />,
        onClick: () => {
          void openTerminal(activeWorktree?.path ?? workspacePath, activeWorktree?.branch ?? undefined);
        },
      },
      'separator',
      {
        label: 'Tabbed Layout',
        icon: <PanelTop size={14} />,
        onClick: () => useWorkspaceStore.setState({ terminalLayout: 'tabs', activeTerminalId: sessionId, activeTab: 'terminal' }),
      },
      {
        label: 'Split Layout',
        icon: <SquareSplitHorizontal size={14} />,
        onClick: () => useWorkspaceStore.setState({ terminalLayout: 'split', activeTerminalId: sessionId, activeTab: 'terminal' }),
      },
      {
        label: 'Grid Layout',
        icon: <LayoutGrid size={14} />,
        onClick: () => useWorkspaceStore.setState({ terminalLayout: 'grid', activeTerminalId: sessionId, activeTab: 'terminal' }),
      },
      'separator',
      {
        label: 'Close',
        icon: <X size={14} />,
        danger: true,
        onClick: () => { void closeTerminal(sessionId); },
      },
      {
        label: 'Close Others',
        icon: <Trash2 size={14} />,
        disabled: otherIds.length === 0,
        danger: true,
        onClick: () => { void closeTerminals(otherIds); },
      },
      {
        label: 'Close To Right',
        icon: <ChevronsRight size={14} />,
        disabled: idsToRight.length === 0,
        danger: true,
        onClick: () => { void closeTerminals(idsToRight); },
      },
    ]);
  }

  // ── Style helpers ─────────────────────────────────────────────────────

  function tabCls(active: boolean, disabled: boolean = false) {
    return `sg-tab flex items-center gap-1.5 px-3 h-full text-xs cursor-pointer bg-transparent border-t-0 border-x-0 border-b-2 transition-colors whitespace-nowrap ${disabled
        ? 'text-(--sg-text-dim) border-transparent cursor-not-allowed opacity-50'
        : active
          ? 'text-(--sg-text) border-(--sg-primary) font-medium cursor-pointer'
          : 'text-(--sg-text-faint) border-transparent hover:text-(--sg-text) cursor-pointer'
      }`;
  }

  const iconBtn = 'inline-flex items-center justify-center p-[3px] bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-[4px] transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised) disabled:opacity-40 disabled:cursor-not-allowed';

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        {/* ── Full-width top header (matches home page style) ── */}
        <header
          className="flex items-center h-(--sg-titlebar-height) shrink-0 border-b border-(--sg-border) bg-(--sg-surface)"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          data-testid="workspace-header"
        >
          <WindowControls />
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button
              className="group flex items-center gap-1 rounded-md px-2 py-1 text-xs text-(--sg-text-dim) transition-colors hover:bg-(--sg-surface-raised) hover:text-(--sg-text) border-none bg-transparent cursor-pointer"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={() => void navigate({ to: '/' })}
              data-testid="btn-back-projects"
            >
              <span className="transition-transform group-hover:-translate-x-0.5">←</span>
              <span>Projects</span>
            </button>
            <div className="h-3 w-px bg-(--sg-border)" />
            <span className="text-xs font-medium text-(--sg-text) truncate max-w-40">
              {workspacePath.split('/').pop()}
            </span>
            <ChevronRight size={12} className="text-(--sg-text-faint) shrink-0" />
            <span className="flex items-center gap-1 font-mono text-xs text-(--sg-primary) truncate max-w-50">
              <GitBranch size={12} className="shrink-0" />
              {activeWorktree?.branch ?? (activeWorktree?.detached ? 'detached' : '—')}
            </span>
          </div>
          <div className="flex items-center h-full pr-1 gap-0.5 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <UpdateBadge state={updateState} onInstall={() => void api.installUpdate()} />
            <button className={iconBtn} title="Settings" onClick={() => void navigate({ to: '/settings', search: { workspace: workspacePath } })}>
              <Settings size={15} />
            </button>
          </div>
          <WindowControls side="right" />
        </header>

        {/* ── Body: sidebar + main content ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Worktree sidebar */}
          <WorktreeSidebar
            workspacePath={workspacePath}
            worktrees={worktrees}
            activeWorktree={activeWorktree}
            workspaceStatus={workspaceStatus ?? null}
            worktreeChangeCounts={worktreeChangeCounts}
            fetching={fetching}
            pulling={pulling}
            pushing={pushing}
            pushStatus={pushStatus ?? null}
            creatingWorktree={creatingWorktree}
            pendingCreationBranch={pendingCreationBranch}
            updateState={updateState}
            onWorktreeSwitch={wt => void handleWorktreeSwitch(wt)}
            onFetch={() => void doFetch()}
            onPull={() => void doPull()}
            onPush={() => void doPush()}
            onRefresh={() => {
              void qc.invalidateQueries({ queryKey: qk.worktrees(gitRepoPath) });
              void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
              void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
              if (activeWorktree) void qc.invalidateQueries({ queryKey: qk.pushStatus(activeWorktree.path) });
            }}
            onNewWorktree={() => setShowNewWorktree(true)}
            onOpenTerminal={(cwd, label) => void openTerminal(cwd, label)}
            onOpenHooksModal={() => setHooksModalOpen(true)}
            onOpenRunHookModal={wt => setRunHookTarget(wt)}
            onDeleteWorktree={wt => setDeleteTarget(wt)}
          />

          {/* Main content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Tab bar */}
            <div className="flex items-center border-b border-(--sg-border) bg-(--sg-surface) shrink-0 h-9">
              <button
                className={tabCls(activeTab === 'graph')}
                onClick={() => useWorkspaceStore.setState({ activeTab: 'graph' })}
              >
                <GitBranch size={12} /> Graph
              </button>
              <button
                className={tabCls(activeTab === 'staging', !activeWorktree)}
                onClick={() => {
                  if (!activeWorktree) return;
                  useWorkspaceStore.setState({ activeTab: 'staging' });
                  // Force a fresh git status whenever the user clicks Changes,
                  // so newly-written files are always visible without a watcher event.
                  setStagingRefresh(n => n + 1);
                }}
                disabled={!activeWorktree}
              >
                <GitMerge size={12} /> Changes
              </button>
              <button
                className={tabCls(activeTab === 'terminal', !activeWorktree)}
                onClick={() => {
                  if (!activeWorktree) return;
                  if (scopedTerminalSessions.length === 0) {
                    void openTerminal(activeWorktree.path, activeWorktree.branch ?? undefined);
                  } else {
                    useWorkspaceStore.setState({ activeTab: 'terminal' });
                  }
                }}
                disabled={!activeWorktree}
              >
                <Terminal size={12} /> Terminal{scopedTerminalSessions.length > 1 ? ` (${scopedTerminalSessions.length})` : ''}
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden relative">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Spinner size="lg" />
                </div>
              ) : (
                <>
                  {/* Graph tab */}
                  {activeTab === 'graph' && (
                    <div className="flex flex-col h-full">
                      <div className={selectedCommit ? 'h-1/2 min-h-0 overflow-hidden flex flex-col' : 'flex-1 min-h-0 overflow-hidden flex flex-col'}>
                        <CommitGraph
                          commits={commits}
                          worktrees={worktrees}
                          activeWorktree={activeWorktree}
                          hasMore={commits.length < commitTotal}
                          loadingMore={commitsFetching && commits.length > 0}
                          onLoadMore={async () => {
                            const more = await api.getCommitGraph({
                              repoPath: gitRepoPath,
                              limit: 500,
                              skip: commits.length,
                            }) as CommitEntry[];
                            qc.setQueryData<CommitEntry[]>(qk.commits(gitRepoPath), prev => [
                              ...(prev ?? []),
                              ...more,
                            ]);
                          }}
                          onSelect={selected => {
                            const nextSelectionKey = selected.map(c => c.hash).join(',');
                            const currentSelectionKey = selectedCommits.map(c => c.hash).join(',');
                            if (nextSelectionKey === currentSelectionKey) {
                              return;
                            }
                            if (selected.length === 1 && selected[0]) {
                              void loadCommitDiff(selected[0]);
                            } else if (selected.length === 2 && selected[0] && selected[1]) {
                              void loadCommitRangeDiff(selected[0], selected[1]);
                            } else {
                              setSelectedCommits([]);
                              setCommitDiffFiles([]);
                              setCommitDiffContent('');
                              setCommitDiffFile(null);
                            }
                          }}
                          onCreateWorktree={() => {
                            setShowNewWorktree(true);
                          }}
                          onCheckout={ref => {
                            if (activeWorktree) {
                              void api.checkout(activeWorktree.path, ref)
                                .then(() => {
                                  toast('Checked out', 'success');
                                  void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
                                  void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
                                })
                                .catch((err: unknown) => toast(String(err), 'error'));
                            }
                          }}
                          onReset={(ref, mode) => {
                            if (activeWorktree) {
                              void api.reset(activeWorktree.path, ref, mode)
                                .then(() => {
                                  toast(`Reset (${mode}) complete`, 'success');
                                  void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
                                  void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
                                })
                                .catch((err: unknown) => toast(String(err), 'error'));
                            }
                          }}
                        />
                      </div>
                      {selectedCommit && (
                        <CommitDiffPanel
                          commit={selectedCommit}
                          files={commitDiffFiles}
                          loading={commitDiffLoading}
                          selectedFile={commitDiffFile}
                          diffContent={commitDiffContent}
                          diffLoading={commitDiffFileLoading}
                          onSelectFile={f => void loadCommitDiffFile(f)}
                          onClose={() => {
                            setSelectedCommits([]);
                            setCommitDiffFiles([]);
                            setCommitDiffContent('');
                            setCommitDiffFile(null);
                          }}
                        />
                      )}
                    </div>
                  )}

                  {/* Staging tab */}
                  {activeTab === 'staging' && activeWorktree && (
                    <StagingPanel
                      worktreePath={activeWorktree.path}
                      branch={activeWorktree.branch ?? null}
                      refreshSignal={stagingRefresh}
                      getStatus={p => api.getStatus(p)}
                      stageFiles={(p, paths) => api.stageFiles(p, paths)}
                      unstageFiles={(p, paths) => api.unstageFiles(p, paths)}
                      createCommit={(p, msg) => api.createCommit(p, msg)}
                      getDiff={(p, staged, file) =>
                        staged
                          ? api.getDiffContent(p, 'HEAD', file)
                          : api.getWorkingDiff(p, file)
                      }
                      onCommit={() => {
                        toast('Committed', 'success');
                        setStagingRefresh(n => n + 1);
                        void qc.invalidateQueries({ queryKey: qk.commits(gitRepoPath) });
                        void qc.invalidateQueries({ queryKey: qk.commitCount(gitRepoPath) });
                        void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
                      }}
                      onClose={() => useWorkspaceStore.setState({ activeTab: 'graph' })}
                      onToast={(msg, v) => toast(msg, v)}
                    />
                  )}

                  {/* Terminal tab */}
                  {activeTab === 'terminal' && activeWorktree && (
                    <div className="flex flex-col h-full">
                      <div className="flex min-h-8 shrink-0 items-center gap-1 border-b border-(--sg-border) bg-(--sg-bg) px-1.5">
                        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-0.5" role="tablist" aria-label="Terminal sessions">
                          {scopedTerminalSessions.map(s => {
                            const isActive = s.id === scopedActiveTerminalId;
                            const isRenaming = s.id === renamingTerminalId;
                            return (
                              <div
                                key={s.id}
                                className={`group relative flex shrink-0 items-center overflow-hidden rounded ${isActive ? 'bg-(--sg-surface-raised)' : 'hover:bg-(--sg-surface)'}`}
                                onContextMenu={e => openTerminalTabMenu(e, s.id)}
                              >
                                {isActive && <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-t-full bg-(--sg-primary) shadow-[0_0_6px_var(--sg-primary)]" />}
                                {isRenaming ? (
                                  <input
                                    ref={renameInputRef}
                                    data-testid="input-rename-terminal"
                                    type="text"
                                    value={renameValue}
                                    onChange={e => setRenameValue(e.target.value)}
                                    onBlur={commitTerminalRename}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') commitTerminalRename();
                                      if (e.key === 'Escape') cancelTerminalRename();
                                      e.stopPropagation();
                                    }}
                                    onClick={e => e.stopPropagation()}
                                    className="min-w-0 w-25 rounded bg-(--sg-input-bg) px-2 py-1 text-[11px] font-medium text-(--sg-text) outline-(--sg-primary)"
                                  />
                                ) : (
                                  <button
                                    data-testid="terminal-session-tab"
                                    data-session-label={s.label}
                                    role="tab"
                                    aria-selected={isActive}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium ${isActive ? 'text-(--sg-primary)' : 'text-(--sg-text)'}`}
                                    onClick={() => useWorkspaceStore.setState({ activeTerminalId: s.id, activeTab: 'terminal' })}
                                  >
                                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? 'bg-(--sg-primary)' : 'bg-(--sg-text-faint)'}`} />
                                    <span className="max-w-35 truncate">{s.label}</span>
                                  </button>
                                )}
                                <button
                                  className="flex items-center px-1.5 text-(--sg-text-dim) transition-colors hover:text-(--sg-danger)"
                                  title={`Close ${s.label}`}
                                  onClick={e => {
                                    e.stopPropagation();
                                    void closeTerminal(s.id);
                                  }}
                                >
                                  <X size={10} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <div className="relative inline-flex shrink-0 items-stretch rounded bg-(--sg-bg)">
                          <button
                            data-testid="btn-add-terminal"
                            title="New terminal"
                            className="flex items-center rounded px-2 py-1 text-(--sg-text-faint) transition-colors hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)"
                            onClick={() => void openTerminal(activeWorktree?.path ?? workspacePath, activeWorktree?.branch ?? undefined)}
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                        <div className="mx-0.5 h-3.5 w-px bg-(--sg-border)" />
                        <div className="flex shrink-0 items-center gap-0.5 py-0.5">
                          <button
                            title="Tabbed"
                            className={`rounded p-1 transition-colors ${terminalLayout === 'tabs' ? 'bg-(--sg-surface-raised) text-(--sg-primary)' : 'text-(--sg-text-faint) hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)'}`}
                            onClick={() => useWorkspaceStore.setState({ terminalLayout: 'tabs' })}
                          >
                            <Rows3 size={14} />
                          </button>
                          <button
                            title="Split"
                            className={`rounded p-1 transition-colors ${terminalLayout === 'split' ? 'bg-(--sg-surface-raised) text-(--sg-primary)' : 'text-(--sg-text-faint) hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)'}`}
                            onClick={() => useWorkspaceStore.setState({ terminalLayout: 'split' })}
                          >
                            <Columns2 size={14} />
                          </button>
                          <button
                            title="Grid"
                            className={`rounded p-1 transition-colors ${terminalLayout === 'grid' ? 'bg-(--sg-surface-raised) text-(--sg-primary)' : 'text-(--sg-text-faint) hover:bg-(--sg-surface-raised) hover:text-(--sg-text-dim)'}`}
                            onClick={() => useWorkspaceStore.setState({ terminalLayout: 'grid' })}
                          >
                            <LayoutGrid size={14} />
                          </button>
                        </div>
                      </div>
                      <div className={terminalWrapperClass()}>
                        {scopedTerminalSessions.map(s => (
                          <div
                            key={s.id}
                            className={`h-full min-h-0 min-w-0 ${terminalLayout !== 'tabs' ? 'border-r border-(--sg-border) last:border-r-0 nth-[2n]:border-r-0 nth-[n+3]:border-t nth-[n+3]:border-(--sg-border)' : ''}`}
                            style={terminalPanelStyle(s.id)}
                          >
                            <TerminalPane
                              sessionId={s.id}
                              incomingData={s.pendingData}
                              className="h-full w-full"
                              onData={(id, data) => { void api.writeTerminal(id, data); }}
                              onResize={(id, cols, rows) => { void api.resizeTerminal(id, cols, rows); }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>{/* end body */}
      </div>

      {/* Hooks settings modal */}
      <WorkspaceHooksModal
        open={hooksModalOpen}
        workspacePath={workspacePath}
        onClose={() => setHooksModalOpen(false)}
        api={{
          listHooks: p => api.listHooks(p),
          createHook: args => api.createHook(args),
          updateHook: args => api.updateHook(args),
          deleteHook: (p, id) => api.deleteHook(p, id),
          toggleHook: (p, id, enabled) => api.toggleHook(p, id, enabled),
        }}
      />

      {/* New worktree dialog */}
      <NewWorktreeDialog
        open={showNewWorktree}
        workspacePath={workspacePath}
        managedWorktreesPath={workspaceStatus?.worktreesPath ?? ''}
        refs={refs}
        onClose={() => setShowNewWorktree(false)}
        onCreated={() => {
          void qc.invalidateQueries({ queryKey: qk.worktrees(gitRepoPath) });
          void qc.invalidateQueries({ queryKey: qk.refs(gitRepoPath) });
        }}
        onToast={(msg, v) => toast(msg, v)}
      />

      {/* Publish branch dialog */}
      <PublishDialog
        open={showPublishModal}
        activeWorktree={activeWorktree}
        pushStatus={pushStatus ?? null}
        onClose={() => setShowPublishModal(false)}
        onToast={(msg, v) => toast(msg, v)}
        onPublished={() => activeWorktree && void qc.invalidateQueries({ queryKey: qk.pushStatus(activeWorktree.path) })}
      />

      {/* Run hook dialog */}
      <RunHookDialog
        target={runHookTarget}
        workspacePath={workspacePath}
        activeWorktreePath={activeWorktree?.path ?? null}
        onClose={() => setRunHookTarget(null)}
        onToast={(msg, v) => toast(msg, v)}
      />

      {/* Delete worktree dialog */}
      <DeleteWorktreeDialog
        target={deleteTarget}
        loading={deleteWorktreeMutation.isPending}
        onConfirm={wt => void doDeleteWorktree(wt)}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Hook progress overlay */}
      <HookProgressOverlay />
    </>
  );
}

export const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspace',
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => ({
    path: typeof search['path'] === 'string' ? search['path'] : '',
  }),
  component: WorkspaceView,
});
