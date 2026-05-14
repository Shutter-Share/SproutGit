import { gotoHash, createTestRepo, closeAndCleanup, monitorErrors } from '../helpers.js';

describe('worktree workflow', () => {
  let testRepo: string;

  beforeEach(() => {
    testRepo = createTestRepo('worktree');
  });

  afterEach(async () => {
    await closeAndCleanup(testRepo);
  });

  it('shows existing worktrees in the sidebar', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    await expect($('.sg-worktree-btn')).toBeDisplayed();
    await assertNoErrors();
  });

  it('sidebar shows worktree branch name', async () => {
    const assertNoErrors = monitorErrors();
    await gotoHash(`/workspace?path=${encodeURIComponent(testRepo)}`);
    // The main worktree has a branch (master or main).
    const label = await $('.sg-worktree-label').getText();
    expect(label.length).toBeGreaterThan(0);
    await assertNoErrors();
  });
});
