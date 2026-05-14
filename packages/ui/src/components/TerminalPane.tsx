import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

type Theme = {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
};

type Props = {
  /** Session ID managed by the main process TerminalManager. */
  sessionId: string;
  /** Called when the user types — forwards raw data to the PTY. */
  onData: (sessionId: string, data: string) => void;
  /** Called when the terminal is resized so the PTY can be updated. */
  onResize: (sessionId: string, cols: number, rows: number) => void;
  /** Incoming data from the PTY to render. */
  incomingData?: string;
  theme?: Partial<Theme>;
  className?: string;
};

const DEFAULT_THEME: Theme = {
  background: 'var(--sg-bg, #1e1e2e)',
  foreground: 'var(--sg-text, #cdd6f4)',
  cursor: 'var(--sg-primary, #19ac5c)',
  selectionBackground: 'rgba(100,199,76,0.3)',
};

/**
 * A headless xterm.js terminal that delegates PTY I/O to the Electron main
 * process via the `onData` / `onResize` callbacks. The parent is responsible
 * for piping incoming data via the `incomingData` prop.
 */
export function TerminalPane({ sessionId, onData, onResize, incomingData, theme, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  /** Tracks how many bytes of `incomingData` have already been written. */
  const writtenLenRef = useRef<number>(0);

  // Mount terminal once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: 'var(--sg-font-code, "Fira Code", monospace)',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      theme: { ...DEFAULT_THEME, ...theme },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    fitAddon.fit();

    term.onData(data => onData(sessionId, data));
    term.onResize(({ cols, rows }) => onResize(sessionId, cols, rows));

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    (container as HTMLDivElement & { __xterm?: Terminal }).__xterm = term;

    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(container);

    return () => {
      observer.disconnect();
      delete (container as HTMLDivElement & { __xterm?: Terminal }).__xterm;
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Reset the written-length counter whenever the session changes.
  useEffect(() => {
    writtenLenRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Write incoming PTY data — only the new delta since the last write.
  useEffect(() => {
    if (incomingData && termRef.current) {
      const delta = incomingData.slice(writtenLenRef.current);
      if (delta) {
        termRef.current.write(delta);
        writtenLenRef.current = incomingData.length;
      }
    }
  }, [incomingData]);

  return (
    <div
      ref={containerRef}
      className={className}
      data-testid="terminal-container"
      data-sg-terminal="true"
      data-pty-id={sessionId}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
