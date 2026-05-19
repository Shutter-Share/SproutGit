import { Spinner } from './Spinner.js';

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; progress: number }
  | { status: 'ready' }
  | { status: 'up-to-date' };

type Props = {
  state: UpdateState;
  /** Called when the user clicks "Install & Restart" */
  onInstall?: () => void;
};

/** Displays a floating badge for available app updates. */
export function UpdateBadge({ state, onInstall }: Props) {
  if (state.status === 'idle' || state.status === 'up-to-date') return null;

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-(--sg-surface-raised) border border-(--sg-border) rounded-[8px] text-xs text-(--sg-text-dim)">
      {state.status === 'checking' && (
        <>
          <Spinner size="sm" />
          <span>Checking for updates…</span>
        </>
      )}
      {state.status === 'available' && (
        <span>Update {state.version} available</span>
      )}
      {state.status === 'downloading' && (
        <>
          <Spinner size="sm" />
          <span>Downloading… {Math.round(state.progress)}%</span>
        </>
      )}
      {state.status === 'ready' && (
        <button
          className="inline-flex items-center gap-[5px] px-2.5 py-[4px] rounded-[6px] border-none cursor-pointer text-[11px] font-medium bg-(--sg-primary) text-white hover:bg-(--sg-primary-hover)"
          onClick={onInstall}
        >
          Install &amp; Restart
        </button>
      )}
    </div>
  );
}
