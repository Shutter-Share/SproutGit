import { test, expect } from '../fixtures';
import { createTestRepo, resetConfigDb, resetTestDirs } from '../helpers/fixtures';
import { createWorktreeViaUi, DEFAULT_UI_TIMEOUT, importRepoViaUi, reloadToHome } from '../helpers/ui';

test.describe('Worktree workflow', () => {
  test.beforeEach(async ({ tauriPage }) => {
    resetTestDirs();
    resetConfigDb();
    await reloadToHome(tauriPage);
  });

  test('creates, switches, and deletes managed worktrees', async ({ tauriPage }) => {
    const repoPath = createTestRepo('worktree-test', {
      extraCommits: 2,
      branches: ['develop'],
    });

    await importRepoViaUi(tauriPage, repoPath);
    await createWorktreeViaUi(tauriPage, 'feature/e2e-alpha');
    await createWorktreeViaUi(tauriPage, 'feature/e2e-beta');

    const alphaItem = tauriPage.locator('[data-testid="worktree-item"][data-branch="feature/e2e-alpha"]');
    const betaItem = tauriPage.locator('[data-testid="worktree-item"][data-branch="feature/e2e-beta"]');

    await expect(alphaItem).toBeVisible();
    await expect(betaItem).toBeVisible();

    await alphaItem.click();
    await expect(alphaItem).toBeVisible();

    await betaItem.click();
    await expect(betaItem).toBeVisible();

    await tauriPage.evaluate(`(() => {
      const button = document.querySelector('[data-testid="worktree-item"][data-branch="feature/e2e-alpha"] [data-testid="btn-delete-worktree"]');
      if (!(button instanceof HTMLElement)) {
        throw new Error('delete worktree button not found for feature/e2e-alpha');
      }
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    })()`);

    await tauriPage.getByTestId('confirm-dialog').waitFor(DEFAULT_UI_TIMEOUT);
    await tauriPage.getByTestId('confirm-dialog-confirm').click();

    await tauriPage.waitForFunction(
      `!document.querySelector('[data-testid="worktree-item"][data-branch="feature/e2e-alpha"]')`,
      DEFAULT_UI_TIMEOUT,
    );
    await expect(betaItem).toBeVisible();
  });
});