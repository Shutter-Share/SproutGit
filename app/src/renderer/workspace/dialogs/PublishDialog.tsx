import { api } from '../../api.js';
import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@sproutgit/ui';
import type { WorktreeInfo, WorktreePushStatus } from '@sproutgit/types';

type Props = {
  open: boolean;
  activeWorktree: WorktreeInfo | null;
  pushStatus: WorktreePushStatus | null;
  onClose: () => void;
  onToast: (msg: string, variant: 'success' | 'error') => void;
  onPublished: () => void;
};

const primaryBtn = 'inline-flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] border-none cursor-pointer text-xs font-medium transition-colors whitespace-nowrap bg-(--sg-primary) text-white hover:bg-(--sg-primary-hover) disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryBtn = 'inline-flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] cursor-pointer text-xs font-medium transition-colors whitespace-nowrap bg-transparent border border-(--sg-border) text-(--sg-text-dim) hover:bg-(--sg-surface-raised) disabled:opacity-50 disabled:cursor-not-allowed';
const fieldLabel = 'text-[11px] font-semibold text-(--sg-text-dim) uppercase tracking-[0.04em]';
const fieldInput = 'w-full px-[10px] py-[6px] bg-(--sg-input-bg) border border-(--sg-input-border) rounded-[6px] text-xs text-(--sg-text) outline-none focus:border-(--sg-input-focus)';

export function PublishDialog({ open, activeWorktree, pushStatus, onClose, onToast, onPublished }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const initialRemotes = pushStatus?.remotes && pushStatus.remotes.length > 0 ? pushStatus.remotes : ['origin'];
  const initialRemote = pushStatus?.suggestedRemote ?? initialRemotes[0] ?? 'origin';

  const [remote, setRemote] = useState(initialRemote);
  const [publishing, setPublishing] = useState(false);
  const remotes = pushStatus?.remotes && pushStatus.remotes.length > 0 ? pushStatus.remotes : ['origin'];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
      setRemote(pushStatus?.suggestedRemote ?? remotes[0] ?? 'origin');
    } else {
      dialog.close();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handlePublish() {
    if (!activeWorktree) return;
    setPublishing(true);
    try {
      await api.push(activeWorktree.path, remote);
      onToast(`Published to ${remote}`, 'success');
      onClose();
      onPublished();
    } catch (err) {
      onToast(`Publish failed: ${String(err)}`, 'error');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} className="rounded-xl shadow-xl">
      <div className="bg-(--sg-surface) border border-(--sg-border) rounded-xl p-6 min-w-80 flex flex-col gap-4">
        <h2 className="text-[15px] font-semibold m-0 text-(--sg-text)">Publish Branch</h2>
        <p className="text-xs text-(--sg-text-dim) m-0">
          Choose a remote to publish <strong>{activeWorktree?.branch}</strong> to.
        </p>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Remote</span>
          {remotes.length > 1 ? (
            <select
              className={fieldInput}
              value={remote}
              onChange={e => setRemote(e.target.value)}
              disabled={publishing}
            >
              {remotes.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          ) : (
            <input
              className={fieldInput}
              value={remote}
              onChange={e => setRemote(e.target.value)}
              placeholder="origin"
              disabled={publishing}
              spellCheck={false}
            />
          )}
        </label>
        <div className="flex gap-2 justify-end">
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={publishing}>Cancel</button>
          <button
            type="button"
            className={primaryBtn}
            disabled={publishing || !remote.trim()}
            onClick={() => void handlePublish()}
          >
            {publishing ? <Spinner size="sm" /> : 'Publish'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
