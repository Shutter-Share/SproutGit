import { api } from '../api.js';
import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { ToastContainer, type ToastData } from '@sproutgit/ui';
import { useState, useEffect } from 'react';
import { ToastContext, setGlobalToast } from '../toast-context.js';

// ── Root layout ───────────────────────────────────────────────────────────────

function RootLayout() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const navigate = useNavigate();

  function addToast(message: string, variant: ToastData['variant'] = 'info') {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, variant }]);
  }

  // Wire up the module-level escape hatch so QueryCache.onError can fire toasts.
  useEffect(() => {
    setGlobalToast(addToast);
    return () => setGlobalToast(() => undefined);
  // addToast is stable (defined inline in render) — the ref pattern is intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  // Open workspaces requested by the OS (macOS "Open Recent" dock menu,
  // Windows taskbar jump list, double-clicking a workspace folder, etc.).
  useEffect(() => {
    const offOpenWorkspace = api.onOpenWorkspace((workspacePath: string) => {
      void navigate({ to: '/workspace', search: { path: workspacePath } });
    });
    return () => {
      offOpenWorkspace();
    };
  }, [navigate]);

  return (
    <ToastContext.Provider value={addToast}>
      <Outlet />
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export const rootRoute = createRootRoute({ component: RootLayout });
