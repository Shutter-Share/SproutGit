import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

type MenuItem = {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
} | 'separator';

type ContextMenuState = {
  items: MenuItem[];
  x: number;
  y: number;
};

const ContextMenuCtx = createContext<{
  show: (items: MenuItem[], x: number, y: number) => void;
  hide: () => void;
} | null>(null);

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const show = (items: MenuItem[], x: number, y: number) => {
    setMenu({ items, x, y });
    setPosition({ x, y });
  };

  const hide = () => {
    setMenu(null);
    setPosition(null);
  };

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let nextX = menu.x;
    let nextY = menu.y;
    if (nextX + rect.width > window.innerWidth - 8) nextX = window.innerWidth - rect.width - 8;
    if (nextY + rect.height > window.innerHeight - 8) nextY = window.innerHeight - rect.height - 8;
    if (nextX < 8) nextX = 8;
    if (nextY < 8) nextY = 8;
    if (!position || position.x !== nextX || position.y !== nextY) {
      setPosition({ x: nextX, y: nextY });
    }
  }, [menu, position]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', hide);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', hide);
    };
  }, [menu]);

  return (
    <ContextMenuCtx.Provider value={{ show, hide }}>
      {children}
      {menu && createPortal(
        <div
          ref={menuRef}
          data-testid="context-menu"
          className="fixed z-9999 min-w-[180px] rounded-lg border border-(--sg-border) bg-(--sg-surface) py-1 shadow-xl backdrop-blur-[6px]"
          style={{ left: position?.x ?? menu.x, top: position?.y ?? menu.y, animation: 'sg-slide-up 0.1s ease-out' }}
          onMouseDown={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
        >
          {menu.items.map((item, i) =>
            item === 'separator'
              ? <div key={i} className="my-1 border-t border-(--sg-border-subtle)" />
              : (
                <button
                  key={i}
                  className={[
                    'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors rounded-md border-none bg-transparent',
                    !item.disabled ? 'hover:bg-(--sg-surface-raised)' : '',
                    item.danger ? 'text-(--sg-danger)' : 'text-(--sg-text)',
                    item.disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
                  ].filter(Boolean).join(' ')}
                  style={{ columnGap: '0.625rem' }}
                  disabled={item.disabled}
                  onClick={() => { item.onClick(); hide(); }}
                >
                  {item.icon
                    ? (
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-(--sg-text-faint) [&>svg]:h-3.5 [&>svg]:w-3.5">
                        {item.icon}
                      </span>
                    )
                    : null}
                  <span>{item.label}</span>
                </button>
              )
          )}
        </div>,
        document.body,
      )}
    </ContextMenuCtx.Provider>
  );
}

/** Hook to open a context menu from a right-click event. */
export function useContextMenu() {
  const ctx = useContext(ContextMenuCtx);
  if (!ctx) throw new Error('useContextMenu must be used inside ContextMenuProvider');

  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    ctx.show(items, e.clientX, e.clientY);
  };

  return { open };
}
