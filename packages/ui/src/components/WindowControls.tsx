import { useEffect, useState } from 'react';
import { Minus, Square, Minimize2, X } from 'lucide-react';

/**
 * Window controls component.
 *
 * - macOS: the OS renders the native traffic-light buttons inside the
 *   `hiddenInset` title bar. This component reserves the inset space so
 *   content doesn't overlap the native controls. It renders nothing interactive.
 *
 * - Windows / Linux: renders custom minimize / maximize / close buttons
 *   via Electron's IPC (window:minimize, window:maximize, window:close).
 */
export function WindowControls() {
  const isMac = typeof navigator !== 'undefined' &&
    navigator.userAgent.toLowerCase().includes('mac');

  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (isMac) return;

    // Sync initial state.
    void window.api.windowIsMaximized().then(setIsMaximized).catch(() => undefined);

    const offMax = window.api.onWindowMaximized(() => setIsMaximized(true));
    const offUnmax = window.api.onWindowUnmaximized(() => setIsMaximized(false));
    return () => { offMax(); offUnmax(); };
  }, [isMac]);

  if (isMac) {
    // Reserve the macOS traffic-light inset area (drag region).
    return (
      <div
        className="shrink-0 h-(--sg-titlebar-height)"
        style={{ width: 'var(--sg-titlebar-inset, 85px)', WebkitAppRegion: 'drag' } as React.CSSProperties}
        aria-hidden
      />
    );
  }

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
