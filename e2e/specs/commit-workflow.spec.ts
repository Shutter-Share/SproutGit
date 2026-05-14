import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors, waitForToast } from '../helpers.js';
import { writeFileSync } from 'fs';
import { join } from 'path';

describe('commit workflow', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo('commit');
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('stages a file and creates a commit', async () => {
    const assertNoErrors = monitorErrors();

    // Create an unstaged file.
    writeFileSync(join(testRepo, 'hello.txt'), 'hello world\n');

    // Open the workspace.
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($('//*[contains(@class,"sg-tab") and contains(.,"Graph")]')).toBeDisplayed();

    // Switch to the staging tab.
    await $('//*[contains(@class,"sg-tab") and contains(.,"Changes")]').click();

    // The new file should appear in unstaged.
    await expect($('//*[contains(@class,"sg-file-row") and contains(.,"hello.txt")]')).toBeDisplayed();

    // Stage it.
    await $('//*[contains(@class,"sg-file-row") and contains(.,"hello.txt")]')
      .$('button[title="Stage file"]')
      .click();

    // It should move to staged.
    await expect($('//*[contains(@class,"sg-file-status--staged") and contains(.,"A")]')).toBeDisplayed();

    // Write a commit message.
    await $('.sg-commit-input').setValue('Add hello.txt');

    // Click commit.
    await $('//*[contains(@class,"sg-btn--primary") and contains(.,"Commit")]').click();

    // Commit input should be cleared and a success toast should appear.
    await expect($('.sg-commit-input')).toHaveValue('');
    await waitForToast('success');

    await assertNoErrors();
  });
});
