import type { WorkspaceHookShell } from './hooks.js';

export type TerminalSession = {
  id: string;
  /** Absolute path used as the PTY working directory. */
  cwd: string;
  /** Label shown in the terminal tab. */
  label: string;
  shell: WorkspaceHookShell;
  /** Optional one-shot command injected on spawn. */
  command: string | null;
  keepOpenOnCompletion: boolean;
};

/** Lightweight summary of a running terminal returned by terminal:list. */
export type TerminalInfo = {
  id: string;
  cwd: string;
  label: string | null;
};
