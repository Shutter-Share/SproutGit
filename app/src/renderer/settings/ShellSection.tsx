import { Terminal } from 'lucide-react';
import { api } from '../api.js';
import { useState, useEffect } from 'react';
import { Spinner, type ToastData } from '@sproutgit/ui';

interface Props {
  onToast: (msg: string, variant?: ToastData['variant']) => void;
}

export function ShellSection({ onToast }: Props) {
  const [availableShells, setAvailableShells] = useState<{ name: string; path: string }[]>([]);
  const [currentShell, setCurrentShell] = useState('');
  const [shellsLoading, setShellsLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      api.listShells(),
      api.getSetting('default_shell'),
    ]).then(([shells, savedShell]) => {
      setAvailableShells(shells);
      setCurrentShell(savedShell ?? shells[0]?.path ?? '');
    }).finally(() => setShellsLoading(false));
  }, []);

  async function selectShell(shellPath: string) {
    setCurrentShell(shellPath);
    try {
      await api.setSetting('default_shell', shellPath);
      const shellName = availableShells.find(s => s.path === shellPath)?.name ?? shellPath;
      onToast(`Default shell set to ${shellName}`, 'success');
    } catch (err) {
      onToast(String(err), 'error');
    }
  }

  return (
    <section className="rounded-lg border border-(--sg-border) bg-(--sg-surface) p-5">
      <h2 className="sg-heading mb-3 text-sm font-semibold text-(--sg-primary) flex items-center gap-1.5">
        <Terminal size={15} /> Default Shell
      </h2>
      {shellsLoading ? (
        <div className="flex items-center gap-2 text-xs text-(--sg-text-dim)">
          <Spinner size="sm" /> Detecting shells...
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {availableShells.map(shell => (
            <button
              key={shell.path}
              className={`rounded border px-3 py-2 text-left text-xs ${currentShell === shell.path ? 'border-(--sg-primary) bg-(--sg-primary)/6 text-(--sg-primary)' : 'border-(--sg-border) text-(--sg-text-dim) hover:bg-(--sg-surface-raised)'}`}
              onClick={() => void selectShell(shell.path)}
            >
              <span className="font-medium">{shell.name}</span>
              <span className="ml-2 font-mono opacity-60">{shell.path}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
