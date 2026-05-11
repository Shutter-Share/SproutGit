import { test as base } from '@playwright/test';
import {
  PluginClient,
  TauriPage,
  TauriProcessManager,
  tauriExpect as expect,
} from '@srsholmes/tauri-playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetConfigDb, resetTestDirs } from './helpers/fixtures';

const MCP_SOCKET =
  process.env.SPROUTGIT_PLAYWRIGHT_SOCKET_PATH ?? join(tmpdir(), 'sproutgit-playwright.sock');
const TCP_PORT = Number.parseInt(process.env.SPROUTGIT_PLAYWRIGHT_TCP_PORT ?? '6274', 10) || 6274;
const TAURI_COMMAND = process.env.SPROUTGIT_E2E_TAURI_COMMAND;
const TAURI_CWD = process.env.SPROUTGIT_E2E_TAURI_CWD;
const IS_WINDOWS = process.platform === 'win32';

function parseCommandSpec(spec: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  const tokenPattern = /[^\s"']+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;

  for (const match of spec.matchAll(tokenPattern)) {
    const raw = match[0];
    if (!raw) continue;

    const isDoubleQuoted = raw.startsWith('"') && raw.endsWith('"');
    const isSingleQuoted = raw.startsWith("'") && raw.endsWith("'");
    const unwrapped = isDoubleQuoted || isSingleQuoted ? raw.slice(1, -1) : raw;
    const value = unwrapped.replace(/\\([\\"'])/g, '$1');
    tokens.push(value);
  }

  if (tokens.length === 0) {
    throw new Error('SPROUTGIT_E2E_TAURI_COMMAND is set but could not be parsed.');
  }

  return {
    command: tokens[0],
    args: tokens.slice(1),
  };
}

type Fixtures = {
  mode: 'tauri';
  _resetE2EState: void;
  tauriPage: TauriPage;
};

export const test = base.extend<Fixtures>({
  mode: ['tauri', { option: true }],
  _resetE2EState: [
    async ({}, use) => {
      // Reset disk state before the app launches so startup code never races
      // the config DB deletion or workspace directory cleanup.
      resetConfigDb();
      resetTestDirs();
      await use();
    },
    { auto: true },
  ],
  tauriPage: async ({ mode, _resetE2EState }, use) => {
    if (mode !== 'tauri') {
      throw new Error(`Unsupported E2E mode: ${mode}`);
    }

    void _resetE2EState;

    let processManager: TauriProcessManager | null = null;
    let client: PluginClient | null = null;
    let tauriPage: TauriPage | null = null;

    try {
      if (TAURI_COMMAND) {
        const { command, args } = parseCommandSpec(TAURI_COMMAND);
        processManager = new TauriProcessManager({
          command,
          args,
          cwd: TAURI_CWD,
          socketPath: IS_WINDOWS ? undefined : MCP_SOCKET,
          tcpPort: TCP_PORT,
          startTimeout: 120,
        });

        const connection = await processManager.start();
        client = connection.tcpPort
          ? new PluginClient(undefined, connection.tcpPort)
          : new PluginClient(connection.socketPath ?? MCP_SOCKET, undefined);
      } else {
        if (!IS_WINDOWS) {
          const waitManager = new TauriProcessManager({ socketPath: MCP_SOCKET });
          await waitManager.waitForSocket(30_000);
        }

        client = IS_WINDOWS
          ? new PluginClient(undefined, TCP_PORT)
          : new PluginClient(MCP_SOCKET, undefined);
      }

      await client.connect();
      const ping = await client.send({ type: 'ping' });
      if (!ping.ok) {
        throw new Error('Plugin ping failed');
      }

      tauriPage = new TauriPage(client);
      await use(tauriPage);
    } finally {
      // Kill all PTY terminal sessions and stop the file watcher before
      // disconnecting. On Windows, PowerShell processes hold directory handles
      // on their CWD (worktree paths). If these processes are still alive when
      // the next test's resetTestDirs() runs, rmSync will fail with EBUSY.
      //
      // This must happen regardless of whether processManager is set (i.e. it
      // applies to both the spawned-process mode and the shared pre-built app
      // mode used in CI). In shared-app mode processManager is null so the
      // taskkill block below is skipped, making this the only cleanup path.
      if (tauriPage) {
        try {
          await tauriPage.evaluate(`
            (async () => {
              const invoke = window.__TAURI_INTERNALS__?.invoke;
              if (typeof invoke !== 'function') {
                return;
              }

              try {
                await invoke('close_all_terminals');
              } catch {
                // Ignore teardown errors for best-effort cleanup.
              }
            })()
          `);
          await tauriPage.evaluate(`
            (async () => {
              const invoke = window.__TAURI_INTERNALS__?.invoke;
              if (typeof invoke !== 'function') {
                return;
              }

              try {
                await invoke('stop_watching_worktrees');
              } catch {
                // Ignore teardown errors for best-effort cleanup.
              }
            })()
          `);
          // Give the OS a moment to release file handles after PTY termination.
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch {
          // Ignore teardown errors — the app may already be in a bad state.
        }
      }

      client?.disconnect();

      // On Windows, processManager.stop() calls TerminateProcess() on the Tauri
      // parent process only. Child processes spawned by the Tauri app (e.g.
      // PowerShell hook terminals) are NOT in the same Windows Job Object and
      // are NOT killed — they become orphaned with their CWD still pointing at
      // worktree directories, causing EBUSY on rmSync in the next test's reset.
      //
      // Fix: use `taskkill /F /T /PID` to kill the entire process tree before
      // calling stop(), so all child processes release their directory handles.
      if (IS_WINDOWS && processManager) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pid = (processManager as any).process?.pid as number | undefined;
        if (pid) {
          try {
            const { execSync } = await import('node:child_process');
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
          } catch {
            // Process may already have exited — ignore
          }
        }
      }

      processManager?.stop();
      // Short grace period for the OS to fully release file handles after the
      // process tree is terminated. taskkill /F /T is synchronous so 500ms is
      // sufficient; the previous 2s was compensating for orphaned children that
      // are now killed above.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  },
});

export { expect };
