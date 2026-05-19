import { useEffect, useState } from 'react';
import { Minus, Square, Minimize2, X } from 'lucide-react';

/**
 * Window controls component.
 *
 * - macOS: the OS renders the native traffic-light buttons inside the
 *   `hiddenInset` title bar. Use `side="left"` (default) to reserve the inset
 *   space so content doesn't overlap the native controls. `side="right"`
 *   renders nothing on macOS.
 *
 * - Windows / Linux: renders custom minimize / maximize / close buttons
 *   via Electron's IPC (window:minimize, window:maximize, window:close).
 *   Use `side="right"` to place them at the trailing edge of the title bar.
 *   `side="left"` renders nothing on Windows/Linux.
 */
export function WindowControls({ side = 'left' }: { side?: 'left' | 'right' }) {
  const isMac = typeof navigator !== 'undefined' &&
    navigator.userAgent.toLowerCase().includes('mac');

  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Only subscribe on Windows/Linux and only when we're the right-side controls.
    if (isMac || side === 'left') return;

    // Sync initial state.
    void window.api.windowIsMaximized().then(setIsMaximized).catch(() => undefined);

    const offMax = window.api.onWindowMaximized(() => setIsMaximized(true));
    const offUnmax = window.api.onWindowUnmaximized(() => setIsMaximized(false));
    return () => { offMax(); offUnmax(); };
  }, [isMac, side]);

  if (isMac) {
    if (side === 'right') return null;
    // Reserve the macOS traffic-light inset area (drag region).
    return (
      <div
        className="shrink-0 h-(--sg-titlebar-height)"
        style={{ width: 'var(--sg-titlebar-inset, 85px)', WebkitAppRegion: 'drag' } as React.CSSProperties}
        aria-hidden
      />
    );
  }

  // Windows / Linux — left slot renders nothing; buttons go on the right.
  if (side === 'left') return null;

  const winBtn = 'flex items-center justify-center w-11 h-full bg-transparent border-none cursor-pointer text-(--sg-text-dim) transition-colors hover:bg-(--sg-surface-raised) hover:text-(--sg-text)';

  return (
    <div
      className="flex items-stretch h-(--sg-titlebar-height) shrink-0"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      role="toolbar"
      aria-label="Window controls"
    >
      <button className={winBtn} title="Minimize" onClick={() => void window.api.windowMinimize()}>
        <Minus size={14} />
      </button>
      <button className={winBtn} title={isMaximized ? 'Restore' : 'Maximize'} onClick={() => void window.api.windowMaximize()}>
        {isMaximized ? <Minimize2 size={14} /> : <Square size={14} />}
      </button>
      <button
        className={`${winBtn} hover:!bg-(--sg-danger) hover:!text-white`}
        title="Close"
        onClick={() => void window.api.windowClose()}
      >
        <X size={14} />
      </button>
    </div>
  );
}
