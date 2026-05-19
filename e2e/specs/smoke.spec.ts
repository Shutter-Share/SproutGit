import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors } from '../helpers.js';

/**
 * Smoke test: the app opens, shows the home screen, and displays a git repo
 * after the user "opens" one.
 */
describe('smoke', () => {
  it('shows home screen on launch', async () => {
    const assertNoErrors = monitorErrors();
    // The home route shows the app name in the titlebar and an "Open Folder" button.
    // Use //body// prefix to avoid matching the non-visible <title> element in <head>.
    await expect($('//body//*[contains(text(),"SproutGit")]')).toBeDisplayed();
    await expect($('[data-testid="btn-open"]')).toBeDisplayed();
    await assertNoErrors();
  });

  it('can navigate to workspace and see commit graph', async () => {
    const assertNoErrors = monitorErrors();
    const testRepo = createTestRepo('smoke');
    try {
      // Simulate opening the testRepo by navigating directly to the workspace URL.
      await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);

      // Wait for the graph tab to appear.
      await expect($('//*[contains(@class,"sg-tab") and contains(.,"Graph")]')).toBeDisplayed();

      // The initial commit should be visible in the commit graph.
      await expect($('[data-testid^="commit-row-"]')).toBeDisplayed();
      await assertNoErrors();
    } finally {
      await closeAndCleanup(testRepo);
    }
  });
});
