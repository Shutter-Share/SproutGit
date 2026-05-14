import { useWorkspaceStore } from '../stores/workspace-store.js';
import { useState } from 'react';
import { CheckCircle, AlertCircle, Clock, Loader2, X, PanelBottomOpen, PanelBottomClose } from 'lucide-react';

const iconBtn = 'inline-flex items-center justify-center p-[3px] bg-transparent border-none cursor-pointer text-(--sg-text-faint) rounded-[4px] transition-colors hover:text-(--sg-text) hover:bg-(--sg-surface-raised) disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * Fixed-bottom overlay that shows hook execution progress.
 * Reads entirely from the workspace Zustand store.
 */
export function HookProgressOverlay() {
  const opTitle = useWorkspaceStore(s => s.opTitle);
  const opHooks = useWorkspaceStore(s => s.opHooks);
  const opLogs = useWorkspaceStore(s => s.opLogs);
  const opCompleted = useWorkspaceStore(s => s.opCompleted);
  const activeTab = useWorkspaceStore(s => s.activeTab);
  const [showLogs, setShowLogs] = useState(false);

  if (opTitle === null) return null;

  const runningCount = opHooks.filter(h => h.status === 'running').length;
  const successCount = opHooks.filter(h => h.status === 'success').length;
  const errorCount = opHooks.filter(h => h.status === 'error' || h.status === 'timed_out').length;

  const panelClass = activeTab === 'terminal'
    ? 'fixed right-4 bottom-4 z-[300] w-[min(520px,calc(100vw-2rem))] rounded-lg border border-(--sg-border) bg-(--sg-surface) shadow-[0_16px_32px_rgba(0,0,0,0.24)]'
    : 'fixed inset-x-0 bottom-0 z-[300] border-t border-(--sg-border) bg-(--sg-surface) shadow-lg';

  return (
    <div className={panelClass}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="text-sm font-medium text-(--sg-text)">{opTitle}</div>
            <div className="mt-1 text-[11px] text-(--sg-text-faint)">
              {runningCount > 0 ? `${runningCount} running` : opCompleted ? 'Completed' : 'In progress'}
              {' • '}
              {successCount} succeeded
              {' • '}
              {errorCount} failed
            </div>
          </div>
          <div className="flex items-center gap-1">
            {activeTab !== 'terminal' && (
              <button
                className={iconBtn}
                onClick={() => useWorkspaceStore.setState({ activeTab: 'terminal' })}
                title="Open terminal tab"
              >
                <PanelBottomOpen size={14} />
              </button>
            )}
            {opLogs.length > 0 && (
              <button
                className={iconBtn}
                onClick={() => setShowLogs(open => !open)}
                title={showLogs ? 'Hide logs' : 'Show logs'}
              >
                {showLogs ? <PanelBottomClose size={14} /> : <PanelBottomOpen size={14} />}
              </button>
            )}
            {opCompleted && (
              <button
                className={iconBtn}
                onClick={() => useWorkspaceStore.setState({ opTitle: null, opLogs: [], opHooks: [] })}
                title="Dismiss"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          {opHooks.map(h => (
            <div key={h.hookId} className="flex items-center gap-2 text-xs text-(--sg-text-dim)">
              {h.status === 'running' && <Loader2 size={12} className="animate-spin text-(--sg-primary)" />}
              {h.status === 'success' && <CheckCircle size={12} className="text-green-500" />}
              {h.status === 'error' && <AlertCircle size={12} className="text-red-500" />}
              {h.status === 'timed_out' && <Clock size={12} className="text-yellow-500" />}
              {(h.status === 'pending' || h.status === 'skipped') && (
                <span className="w-3 h-3 rounded-full border border-(--sg-border)" />
              )}
              <span>{h.hookName}</span>
            </div>
          ))}
        </div>

        {showLogs && opLogs.length > 0 && (
          <div className="mt-2 text-[11px] font-(family-name:--sg-font-code) text-(--sg-text-faint) max-h-40 overflow-y-auto rounded border border-(--sg-border-subtle) bg-(--sg-surface-subtle) p-2">
            {opLogs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </div>
      {!opCompleted && activeTab === 'terminal' && (
        <div className="px-4 pb-3 text-[10px] text-(--sg-text-faint)">
          Hook progress is pinned while terminal hooks are active.
        </div>
      )}
    </div>
  );
}
