import { execSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { closeAndCleanup, monitorErrors } from '../helpers.js';

/**
 * Import workflow: open the import dialog, type a repo path, submit, and verify
 * the workspace opens and the repo appears in recent projects.
 */
describe('import workflow', () => {
  it('imports a local repo via the dialog and shows it in recent projects', async () => {
    const assertNoErrors = monitorErrors();
    // Create a throwaway git repo to import.
    const repoDir = mkdtempSync(join(tmpdir(), 'sg-import-src-'));
    try {
      execSync('git init', { cwd: repoDir });
      execSync('git config user.email "test@example.com"', { cwd: repoDir });
      execSync('git config user.name "Test User"', { cwd: repoDir });
      execSync('echo "hello" > README.md', { cwd: repoDir });
      execSync('git add .', { cwd: repoDir });
      execSync('git commit -m "init"', { cwd: repoDir });

      // Open the import dialog.
      await $('[data-testid="btn-import"]').click();
      await expect($('[data-testid="import-dialog"]')).toBeDisplayed();

      // Fill in the repo path. Use browser.execute to set the React controlled
      // input value directly — WDIO keyboard simulation drops hyphens on macOS.
      await browser.execute((path: string) => {
        const input = document.querySelector(
          '[data-testid="import-dialog"] input'
        ) as HTMLInputElement;
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )!.set!;
        nativeSetter.call(input, path);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, repoDir);

      // Submit — use chained $() to avoid mixing WDIO text-selector with CSS.
      await $('[data-testid="import-dialog"]').$('button=Import').click();

      // The workspace view should open (Graph tab becomes visible).
      await expect($('//*[contains(@class,"sg-tab") and contains(.,"Graph")]')).toBeDisplayed();

      // Go back home to verify recent projects.
      await $('[data-testid="btn-back-projects"]').click();
      await expect($('[data-testid="btn-open"]')).toBeDisplayed();

      // The imported repo name should appear in the recent list.
      const repoName = basename(repoDir);
      await expect(
        $(`//*[@data-testid="recent-project" and contains(.,'${repoName}')]`)
      ).toBeDisplayed();
      await assertNoErrors();
    } finally {
      await closeAndCleanup(repoDir);
    }
  });
});
