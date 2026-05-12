<script lang="ts">
  import { page } from '$app/stores';
  import TerminalContainer from './TerminalContainer.svelte';
  import {
    getActiveWorkspacePath,
    getTerminalShellOptions,
    getWorkspaceTerminalSnapshots,
  } from '$lib/workspace-terminals.svelte';
  import { pathsEqual } from '$lib/path-utils';

  const terminalRouteActive = $derived($page.url.pathname.startsWith('/workspace'));
  const activeWorkspacePath = $derived(getActiveWorkspacePath());
  const shellOptions = $derived(getTerminalShellOptions());
  const workspaceSnapshots = $derived(getWorkspaceTerminalSnapshots());
  const activeTerminalSnapshot = $derived(
    terminalRouteActive
      ? workspaceSnapshots.find(
          snapshot =>
            pathsEqual(snapshot.workspacePath, activeWorkspacePath) &&
            snapshot.activeTab === 'terminal' &&
            snapshot.initializedPaths.length > 0
        ) ?? null
      : null
  );

  function getSnapshotStyles(workspacePath: string, activeWorkspacePath: string | null) {
    return activeTerminalSnapshot && pathsEqual(activeWorkspacePath, workspacePath) ? 'flex' : 'none';
  }
</script>

<div
  class="fixed inset-0 z-40 flex min-h-0 flex-col overflow-hidden bg-[var(--sg-bg)]"
  style:display={activeTerminalSnapshot ? 'flex' : 'none'}
>
  {#each workspaceSnapshots as workspaceState (workspaceState.workspacePath)}
    <div
      class="flex min-h-0 flex-1 flex-col overflow-hidden"
      style:display={getSnapshotStyles(workspaceState.workspacePath, activeWorkspacePath)}
    >
      {#each workspaceState.initializedPaths as wtPath (wtPath)}
        <div
          class="flex min-h-0 flex-1 flex-col overflow-hidden"
          style:display={pathsEqual(workspaceState.activeTerminalPath, wtPath) ? 'flex' : 'none'}
        >
          <TerminalContainer
            defaultShell={shellOptions.defaultShell}
            availableShells={shellOptions.availableShells}
            cwd={wtPath}
            launchRequests={workspaceState.launchRequests}
          />
        </div>
      {/each}
    </div>
  {/each}
</div>
