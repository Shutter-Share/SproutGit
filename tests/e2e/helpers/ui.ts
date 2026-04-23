import { basename, dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  BrowserPageAdapter,
  type TauriPage,
} from '@srsholmes/tauri-playwright';

type AdapterPage = TauriPage | BrowserPageAdapter;

export const DEFAULT_UI_TIMEOUT = 3_000;
const STARTUP_UI_TIMEOUT = 30_000;
const IMPORT_COMPLETION_TIMEOUT = 3_000;

async function captureResetArtifact(
  tauriPage: AdapterPage,
  label: string,
  state: Awaited<ReturnType<typeof getUiSnapshot>>,
) {
  try {
    const artifactDir = resolve(process.cwd(), 'test-results', 'playwright-output', 'reset-debug');
    await mkdir(artifactDir, { recursive: true });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const screenshotPath = `${artifactDir}/${label}-${stamp}.png`;
    const statePath = `${artifactDir}/${label}-${stamp}.json`;

    await tauriPage.screenshot({ path: screenshotPath });
    await writeFile(
      statePath,
      JSON.stringify(
        {
          capturedAtIso: new Date().toISOString(),
          state,
        },
        null,
        2,
      ),
      'utf8',
    );

    console.warn(`[reset-debug] screenshot=${screenshotPath}`);
    console.warn(`[reset-debug] state=${statePath}`);
  } catch (error) {
    console.warn('[reset-debug] failed to capture artifact', error);
  }
}

async function getUiSnapshot(tauriPage: AdapterPage) {
  return tauriPage.evaluate(`(() => {
    const importBtn = document.querySelector('[data-testid="btn-import"]');
    const backBtn = document.querySelector('[data-testid="btn-back-projects"]');
    const commitRow = document.querySelector('[data-testid="commit-row"]');
    const worktreeList = document.querySelector('[data-testid="worktree-list"]');
    const workspaceHistoryTab = document.querySelector('[data-testid="tab-history"]');
    const workspaceBranchInput = document.querySelector('[data-testid="input-new-branch"]');
    const mainText = document.querySelector('main')?.textContent ?? '';

    return {
      path: window.location.pathname,
      importVisible: importBtn instanceof HTMLElement,
      backVisible: backBtn instanceof HTMLElement,
      commitGraphVisible: commitRow instanceof HTMLElement,
      workspaceMarkersVisible:
        worktreeList instanceof HTMLElement ||
        workspaceHistoryTab instanceof HTMLElement ||
        workspaceBranchInput instanceof HTMLElement,
      checkingGit: mainText.includes('Checking git'),
    };
  })()`) as Promise<{
    path: string;
    importVisible: boolean;
    backVisible: boolean;
    commitGraphVisible: boolean;
    workspaceMarkersVisible: boolean;
    checkingGit: boolean;
  }>;
}

async function waitForHomeReady(tauriPage: AdapterPage, timeout: number) {
  const startedAt = Date.now();
  const deadline = Date.now() + timeout;
  let nextProgressLog = startedAt;

  console.warn(`[reloadToHome] waitForHomeReady start timeout=${timeout}ms`);

  while (Date.now() < deadline) {
    const state = await tauriPage.evaluate(`(() => {
      const importButton = document.querySelector('[data-testid="btn-import"]');
      const main = document.querySelector('main');
      const mainText = main?.textContent ?? '';

      return {
        pathname: window.location.pathname,
        importVisible: importButton instanceof HTMLElement,
        checkingGit: mainText.includes('Checking git'),
      };
    })()`);

    const now = Date.now();
    if (now >= nextProgressLog) {
      console.warn(
        `[reloadToHome] home-state t+${now - startedAt}ms ` +
          JSON.stringify(state),
      );
      nextProgressLog = now + 1_000;
    }

    if (
      state &&
      typeof state === 'object' &&
      'pathname' in state &&
      'importVisible' in state &&
      (state as { pathname: string }).pathname === '/' &&
      (state as { importVisible: boolean }).importVisible
    ) {
      console.warn(`[reloadToHome] waitForHomeReady success t+${Date.now() - startedAt}ms`);
      return;
    }

    await new Promise(resolveDelay => setTimeout(resolveDelay, 200));
  }

  console.warn('[reloadToHome] waitForHomeReady timeout');
  throw new Error('Home screen did not finish bootstrapping after reload');
}

async function performVerifiedReload(tauriPage: AdapterPage, label: string) {
  console.warn(`[reloadToHome] ${label} forcing window.location.reload()`);
  await tauriPage.evaluate('window.location.reload()');
  await tauriPage.waitForFunction('document.readyState === "complete"', 5_000);
}

export async function reloadToHome(tauriPage: AdapterPage) {
  console.warn('[reloadToHome] start');
  console.warn('[reloadToHome] beginning reload-first reset attempts');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const beforeReloadState = await getUiSnapshot(tauriPage);
    console.warn(`[reloadToHome] attempt=${attempt} pre-reload state ${JSON.stringify(beforeReloadState)}`);
    await captureResetArtifact(tauriPage, `reloadToHome-attempt-${attempt}-pre-reload`, beforeReloadState);

    if (
      beforeReloadState.path.startsWith('/workspace') ||
      beforeReloadState.backVisible ||
      beforeReloadState.workspaceMarkersVisible ||
      beforeReloadState.commitGraphVisible
    ) {
      console.warn('[reloadToHome] workspace UI detected before reload; navigating back to home first');
      if (beforeReloadState.backVisible) {
        await tauriPage.getByTestId('btn-back-projects').click();
      } else {
        await tauriPage.goBack();
      }

      await tauriPage.waitForFunction(`(() => {
        const importBtn = document.querySelector('[data-testid="btn-import"]');
        return window.location.pathname === '/' && importBtn instanceof HTMLElement;
      })()`, 3_000);
    }

    await performVerifiedReload(tauriPage, `attempt=${attempt}`);
    const afterReloadState = await getUiSnapshot(tauriPage);
    console.warn(
      `[reloadToHome] attempt=${attempt} document.readyState complete state ${JSON.stringify(afterReloadState)}`,
    );
    await captureResetArtifact(tauriPage, `reloadToHome-attempt-${attempt}-post-reload`, afterReloadState);

    if (afterReloadState.commitGraphVisible && !afterReloadState.backVisible) {
      console.warn('[reloadToHome] commit graph still visible after tauri reload; forcing window.location.reload() fallback');
      await tauriPage.evaluate('window.location.reload()');
      await tauriPage.waitForFunction('document.readyState === "complete"', 5_000);
    }

    try {
      await ensureHome(tauriPage);
      console.warn(`[reloadToHome] attempt=${attempt} ensureHome complete`);
      await waitForHomeReady(tauriPage, STARTUP_UI_TIMEOUT);
      console.warn(`[reloadToHome] attempt=${attempt} complete`);
      return;
    } catch (error) {
      console.warn(`[reloadToHome] attempt=${attempt} failed`, error);
      if (attempt === 1) {
        throw error;
      }
    }
  }
}

export async function ensureHome(tauriPage: AdapterPage) {
  const startedAt = Date.now();
  const deadline = startedAt + STARTUP_UI_TIMEOUT;

  while (Date.now() < deadline) {
    if (await tauriPage.isVisible('[data-testid="btn-import"]')) {
      console.warn('[ensureHome] ready (btn-import visible)');
      return;
    }

    if (await tauriPage.isVisible('[data-testid="btn-back-projects"]')) {
      console.warn('[ensureHome] clicking back button');
      await tauriPage.getByTestId('btn-back-projects').click();
      await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
      continue;
    }

    await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
  }

  const timeoutState = await getUiSnapshot(tauriPage);
  await captureResetArtifact(tauriPage, 'ensureHome-timeout', timeoutState);
  throw new Error('ensureHome timeout: home screen never became visibly ready');
}

export async function importRepoViaUi(tauriPage: AdapterPage, repoPath: string) {
  const workspaceParent = dirname(dirname(repoPath));
  const workspaceName = `${basename(repoPath)}-workspace`;
  const expectedWorkspacePath = `${workspaceParent}/${workspaceName}`;
  const recentProjectSelector = `[data-testid="recent-project"][data-workspace="${expectedWorkspacePath}"]`;
  const recentProjectOpenSelector = `${recentProjectSelector} [data-testid="recent-project-open"]`;
  const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
  const startTs = Date.now();
  const mark = (stage: string) => {
    console.warn(`[importRepoViaUi] t+${Date.now() - startTs}ms ${stage}`);
  };
  const waitForWorkspaceHeader = async (timeout: number) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const headerText = (await tauriPage.textContent('header')) ?? '';
      if (headerText.includes(workspaceName)) {
        return true;
      }
      await delay(120);
    }
    return false;
  };

  mark('ensureHome:start');
  await ensureHome(tauriPage);
  mark('ensureHome:done');

  await tauriPage.getByTestId('btn-import').click();
  mark('openImportDialog:clicked');
  await tauriPage.getByTestId('import-dialog').waitFor(DEFAULT_UI_TIMEOUT);
  mark('openImportDialog:visible');
  await tauriPage.getByTestId('import-mode-move').click();
  mark('mode:move');
  await tauriPage.getByTestId('import-repo-path').fill(repoPath);
  await tauriPage.getByTestId('import-folder-name').fill(workspaceName);
  await tauriPage.getByTestId('import-projects-folder').fill(workspaceParent);
  mark('form:filled');
  const submitButton = tauriPage.getByTestId('import-submit');
  await submitButton.waitFor(DEFAULT_UI_TIMEOUT);

  const enableDeadline = Date.now() + DEFAULT_UI_TIMEOUT;
  while (Date.now() < enableDeadline) {
    const disabled = await submitButton.getAttribute('disabled');
    if (!disabled) {
      break;
    }
    await delay(200);
  }

  if (await submitButton.getAttribute('disabled')) {
    throw new Error('Import submit remained disabled after filling import form');
  }

  mark('submit:request');
  await tauriPage.evaluate(`(() => {
    const button = document.querySelector('[data-testid="import-submit"]');
    const form = button?.closest('form');
    if (form && 'requestSubmit' in form) {
      form.requestSubmit();
      return;
    }
    button?.click();
  })()`);
  mark('submit:sent');

  // Fast-path: most successful imports reach workspace view quickly.
  try {
    await tauriPage.getByTestId('btn-back-projects').waitFor(1_200);
    if (await waitForWorkspaceHeader(DEFAULT_UI_TIMEOUT)) {
      mark('workspace:fast-path');
      return;
    }
    mark('workspace:back-visible-without-header');
  } catch {
    // Continue with bounded state polling below.
  }

  // Avoid long-blocking adapter wait primitives after submit; enforce strict 3s cap.
  await delay(IMPORT_COMPLETION_TIMEOUT - 1_200);

  let importErrorText = '';
  try {
    importErrorText =
      (await tauriPage.textContent('[data-testid="import-error"]'))?.trim() ?? '';
  } catch {
    // Ignore bridge read failure; we still fail fast below within the 3s budget.
  }

  mark('timeout');
  if (importErrorText) {
    throw new Error(`Import failed: ${importErrorText}`);
  }
  throw new Error('Import did not complete within 3s (workspace header did not appear)');
}

export async function createWorktreeViaUi(tauriPage: AdapterPage, branchName: string) {
  await tauriPage.getByTestId('input-new-branch').fill(branchName);
  const createButton = tauriPage.getByTestId('btn-create-worktree');
  const isDisabled = async () => (await createButton.getAttribute('disabled')) !== null;

  if (await isDisabled()) {
    await tauriPage.getByTestId('input-source-ref').fill('HEAD');
  }

  const enableDeadline = Date.now() + DEFAULT_UI_TIMEOUT;
  while (Date.now() < enableDeadline) {
    if (!(await isDisabled())) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 120));
  }

  if (await isDisabled()) {
    throw new Error('Create worktree button remained disabled after filling branch and source ref');
  }

  await createButton.click();
  await tauriPage.locator(`[data-testid="worktree-item"][data-branch="${branchName}"]`).waitFor(DEFAULT_UI_TIMEOUT);
}

export async function openChangesTab(tauriPage: AdapterPage) {
  const tab = tauriPage.getByTestId('tab-changes');
  await tab.waitFor(DEFAULT_UI_TIMEOUT);
  await tab.click();
}

export async function openHistoryTab(tauriPage: AdapterPage) {
  const tab = tauriPage.getByTestId('tab-history');
  await tab.waitFor(DEFAULT_UI_TIMEOUT);
  await tab.click();
}