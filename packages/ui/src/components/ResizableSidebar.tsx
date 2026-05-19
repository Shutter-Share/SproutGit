import { useRef, useState } from 'react';

type Props = {
  /** Starting width in pixels. */
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  side?: 'left' | 'right';
  children: React.ReactNode;
  className?: string;
};

/**
 * A panel with a drag handle that lets the user resize it horizontally.
 * Works for both left and right sidebars.
 */
export function ResizableSidebar({
  initialWidth = 240,
  minWidth = 160,
  maxWidth = 600,
  side = 'left',
  children,
  className,
}: Props) {
  const [width, setWidth] = useState(initialWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = side === 'left' ? ev.clientX - startX.current : startX.current - ev.clientX;
      const next = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta));
      setWidth(next);
    };

    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div
      className={['relative flex shrink-0', className].filter(Boolean).join(' ')}
      style={{ width, minWidth: 0 }}
    >
      {side === 'right' && (
        <div
          className="absolute top-0 bottom-0 left-0 w-1 cursor-col-resize hover:bg-(--sg-primary) active:bg-(--sg-primary) z-10 transition-colors"
          onMouseDown={onMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        />
      )}
      <div className="flex-1 overflow-hidden">{children}</div>
      {side === 'left' && (
        <div
          className="absolute top-0 bottom-0 right-0 w-1 cursor-col-resize hover:bg-(--sg-primary) active:bg-(--sg-primary) z-10 transition-colors"
          onMouseDown={onMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        />
      )}
    </div>
  );
}
