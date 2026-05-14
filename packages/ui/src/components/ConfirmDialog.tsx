import { type ReactNode } from 'react';
import { Spinner } from './Spinner.js';

type Props = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

/** Modal confirmation dialog. Rendered by the caller — wrap in a portal if needed. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  loading = false,
  danger = false,
  onConfirm,
  onCancel,
  children,
}: Props) {
  const primaryBtn = 'inline-flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] border-none cursor-pointer text-xs font-medium transition-colors whitespace-nowrap bg-(--sg-primary) text-white hover:bg-(--sg-primary-hover) disabled:opacity-50 disabled:cursor-not-allowed';
  const dangerBtn = 'inline-flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] border-none cursor-pointer text-xs font-medium transition-colors whitespace-nowrap bg-(--sg-danger) text-white hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed';
  const secondaryBtn = 'inline-flex items-center gap-[5px] px-3 py-[5px] rounded-[6px] cursor-pointer text-xs font-medium transition-colors whitespace-nowrap bg-transparent border border-(--sg-border) text-(--sg-text-dim) hover:bg-(--sg-surface-raised) disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="fixed inset-0 z-200 bg-black/45 flex items-center justify-center" onClick={onCancel}>
      <div
        className="bg-(--sg-surface) border border-(--sg-border) rounded-[12px] p-6 min-w-[320px] max-w-[480px] shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-labelledby="sg-dialog-title"
      >
        <h2 id="sg-dialog-title" className="text-[15px] font-semibold m-0 mb-[10px] text-(--sg-text)">{title}</h2>
        {message && <p className="text-[13px] text-(--sg-text-dim) m-0 mb-4">{message}</p>}
        {children}
        <div className="flex gap-2 justify-end mt-5">
          <button className={secondaryBtn} onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            className={danger ? dangerBtn : primaryBtn}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? <Spinner size="sm" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
