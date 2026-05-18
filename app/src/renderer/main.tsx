import { api } from './api.js';

import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter, createHashHistory } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
import { globalToast } from './toast-context.js';
import { routeTree } from './routes/routeTree.js';
import '@sproutgit/ui/styles';
import './tailwind.css';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      const msg = String(error);
      // Suppress transient errors from deleted worktrees — these self-heal
      // as queries get disabled once the path is removed from state.
      if (msg.includes('does not exist') || msg.includes('no such file or directory') || msg.includes('not a git repository')) return;
      globalToast(msg, 'error');
    },
  }),
  defaultOptions: {
    queries: {
      // IPC calls are fast and local — no need for long stale times
      staleTime: 5_000,
      // Don't retry on error; IPC failures are usually deterministic
      retry: 1,
      // Don't refetch on window focus (Electron app, not a browser tab)
      refetchOnWindowFocus: false,
    },
  },
});

// ── Platform class on <body> for macOS titlebar inset ─────────────────────────
if (typeof navigator !== 'undefined') {
  if (navigator.userAgent.toLowerCase().includes('mac')) {
    document.body.classList.add('platform-macos');
  }
}

// ── Router ────────────────────────────────────────────────────────────────────
const router = createRouter({ routeTree, history: createHashHistory() });

// ── App root ──────────────────────────────────────────────────────────────────
function App() {
  // Listen for native full-screen events from the main process to adjust the
  // macOS titlebar inset (green-button / Cmd+Ctrl+F).  The DOM fullscreenchange
  // event only fires for HTML5 fullscreen, not Electron's native variant.
  useEffect(() => {
    const enter = () => document.body.classList.add('window-fullscreen');
    const leave = () => document.body.classList.remove('window-fullscreen');
    const offEnter = api.onWindowEnterFullscreen(enter);
    const offLeave = api.onWindowLeaveFullscreen(leave);
    return () => { offEnter(); offLeave(); };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
