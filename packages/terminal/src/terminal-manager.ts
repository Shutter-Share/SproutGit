import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync } from 'node:fs';
import { type WorkspaceHookShell } from '@sproutgit/types';

export type TerminalDataCallback = (sessionId: string, data: string) => void;
export type TerminalExitCallback = (sessionId: string, exitCode: number) => void;

export type SpawnOptions = {
  cwd: string;
  shell: WorkspaceHookShell | string;
  /** Optional one-shot command injected after spawn (e.g. a hook script). */
  command?: string | null;
  /** Environment variable overrides merged on top of `process.env`. */
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
};

type Session = {
  id: string;
  pty: pty.IPty;
};

/**
 * Manages all active PTY sessions for the lifetime of the Electron main process.
 *
 * Usage:
 *   const manager = new TerminalManager(onData, onExit);
 *   const id = manager.spawn({ cwd, shell: 'zsh' });
 *   manager.write(id, 'ls\r');
 *   manager.resize(id, 120, 40);
 *   manager.close(id);
 */
export class TerminalManager {
  private sessions = new Map<string, Session>();
  protected readonly onData: TerminalDataCallback;
  protected readonly onExit: TerminalExitCallback;

  constructor(onData: TerminalDataCallback, onExit: TerminalExitCallback) {
    this.onData = onData;
    this.onExit = onExit;
  }

  /**
   * Spawns a new PTY session and returns its unique session ID.
   */
  spawn(options: SpawnOptions): string {
    const id = randomUUID();
    const { cwd, shell, command, env, cols = 80, rows = 24 } = options;

    const shellBin = resolveShellBin(shell);
    const safeCwd = existsSync(cwd) ? cwd : process.cwd();

    const proc = pty.spawn(shellBin, [], {
      name: 'xterm-256color',
      cwd: safeCwd,
      env: { ...process.env, ...env } as Record<string, string>,
      cols,
      rows,
    });

    proc.onData(data => this.onData(id, data));

    proc.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.onExit(id, exitCode);
    });

    // Inject a one-shot command (e.g. from a hook launch event).
    if (command) {
      proc.write(`${command}\r`);
    }

    this.sessions.set(id, { id, pty: proc });
    return id;
  }

  /**
   * Sends raw input to a PTY session (keyboard data from the renderer).
   */
  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.pty.write(data);
  }

  /**
   * Resizes a PTY session to match the terminal UI dimensions.
   */
  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.pty.resize(cols, rows);
  }

  /**
   * Terminates a PTY session.
   */
  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pty.kill();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Closes all PTY sessions whose `cwd` starts with `pathPrefix`.
   * Used when a worktree is removed so stale terminals don't linger.
   */
  closeForPath(_pathPrefix: string): void {
    // cwd is not tracked in the base class — override in TerminalManagerWithMeta.
  }

  /** Returns the number of currently active sessions. */
  get size(): number {
    return this.sessions.size;
  }
}

/**
 * Extended terminal manager that also tracks session metadata (cwd, label)
 * so `closeForPath` can work correctly and the renderer can rebuild labels.
 */
export class TerminalManagerWithMeta extends TerminalManager {
  protected meta = new Map<string, { cwd: string; label: string }>();

  override spawn(options: SpawnOptions & { label?: string }): string {
    const id = super.spawn(options);
    this.meta.set(id, { cwd: options.cwd, label: options.label ?? options.cwd });
    return id;
  }

  override close(sessionId: string): void {
    super.close(sessionId);
    this.meta.delete(sessionId);
  }

  override closeForPath(pathPrefix: string): void {
    for (const [id, m] of this.meta) {
      if (m.cwd.startsWith(pathPrefix)) {
        this.close(id);
      }
    }
  }

  closeAll(): void {
    for (const id of [...this.meta.keys()]) {
      this.close(id);
    }
  }

  getLabel(sessionId: string): string | undefined {
    return this.meta.get(sessionId)?.label;
  }

  listSessions(): { id: string; cwd: string; label: string }[] {
    return Array.from(this.meta.entries()).map(([id, m]) => ({ id, cwd: m.cwd, label: m.label }));
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function resolveShellBin(shell: string): string {
  const value = shell.trim();
  if (!value) return '/bin/zsh';

  // Some persisted settings accidentally include args (e.g. "zsh -l").
  const executable = value.split(/\s+/)[0] ?? value;

  switch (executable) {
    case 'zsh':
      return '/bin/zsh';
    case 'bash':
      return '/bin/bash';
    case 'pwsh':
      return 'pwsh';
    case 'powershell':
      return 'powershell.exe';
    default:
      // Full path passed directly (e.g. '/bin/zsh' from settings)
      if (executable.startsWith('/')) {
        try {
          accessSync(executable, constants.X_OK);
          return executable;
        } catch {
          return '/bin/zsh';
        }
      }
      return executable;
  }
}
