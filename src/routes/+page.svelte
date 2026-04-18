<script lang="ts">
  import { goto } from "$app/navigation";
  import { open } from "@tauri-apps/plugin-dialog";
  import Spinner from "$lib/components/Spinner.svelte";
  import {
    createWorkspace,
    getGitInfo,
    inspectWorkspace,
    onCloneProgress,
    type GitInfo,
    type WorkspaceInitResult,
    type WorkspaceStatus,
  } from "$lib/sproutgit";
  import { toast } from "$lib/toast.svelte";

  type KnownProject = {
    workspacePath: string;
    rootPath: string;
    lastOpenedAt: number;
  };

  const KNOWN_PROJECTS_KEY = "sproutgit.knownProjects";

  let git = $state<GitInfo>({ installed: false, version: null });
  let workspacePath = $state("");
  let cloneUrl = $state("");
  let openWorkspacePath = $state("");
  let creating = $state(false);
  let opening = $state(false);
  let error = $state("");
  let knownProjects = $state<KnownProject[]>([]);
  let createdWorkspace = $state<WorkspaceInitResult | null>(null);
  let cloneProgress = $state<string[]>([]);
  let clonePercent = $state<number | null>(null);
  let clonePhase = $state("");
  let progressEl = $state<HTMLDivElement | null>(null);

  function loadKnownProjects() {
    const raw = localStorage.getItem(KNOWN_PROJECTS_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as KnownProject[];
      knownProjects = parsed.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    } catch {
      knownProjects = [];
    }
  }

  function saveKnownProject(workspace: WorkspaceStatus | WorkspaceInitResult) {
    const updated = [
      {
        workspacePath: workspace.workspacePath,
        rootPath: workspace.rootPath,
        lastOpenedAt: Date.now(),
      },
      ...knownProjects.filter((item) => item.workspacePath !== workspace.workspacePath),
    ].slice(0, 20);

    knownProjects = updated;
    localStorage.setItem(KNOWN_PROJECTS_KEY, JSON.stringify(updated));
  }

  async function startNewProject(event: Event) {
    event.preventDefault();
    error = "";
    cloneProgress = [];
    clonePercent = null;
    clonePhase = "";
    creating = true;

    const unlisten = await onCloneProgress((msg) => {
      cloneProgress = [...cloneProgress, msg];
      // Parse percentage from git progress (e.g. "Receiving objects:  45% (5000/12345)")
      const pctMatch = msg.match(/(\d+)%/);
      if (pctMatch) {
        clonePercent = parseInt(pctMatch[1], 10);
      }
      // Parse phase name
      const phaseMatch = msg.match(/^(\w[\w\s]+?):\s/);
      if (phaseMatch) {
        clonePhase = phaseMatch[1];
      }
      // Auto-scroll to bottom
      requestAnimationFrame(() => {
        if (progressEl) progressEl.scrollTop = progressEl.scrollHeight;
      });
    });

    try {
      const created = await createWorkspace(workspacePath, cloneUrl);
      createdWorkspace = created;
      saveKnownProject(created);
      toast.success(`Workspace created: ${created.workspacePath.split('/').pop()}`);
      await goto(`/workspace?workspace=${encodeURIComponent(created.workspacePath)}`);
    } catch (err) {
      error = String(err);
      toast.error(String(err));
    } finally {
      unlisten();
      creating = false;
    }
  }

  async function openKnownWorkspace(path: string) {
    error = "";
    opening = true;

    try {
      const status = await inspectWorkspace(path);
      if (!status.isSproutgitProject) {
        throw new Error("Selected path is not a SproutGit project");
      }
      saveKnownProject(status);
      await goto(`/workspace?workspace=${encodeURIComponent(status.workspacePath)}`);
    } catch (err) {
      error = String(err);
    } finally {
      opening = false;
    }
  }

  async function openByPath(event: Event) {
    event.preventDefault();
    if (!openWorkspacePath.trim()) {
      error = "Workspace path is required";
      return;
    }
    await openKnownWorkspace(openWorkspacePath);
  }

  getGitInfo().then((info) => (git = info));
  loadKnownProjects();
</script>

<main class="flex h-screen flex-col">
  <!-- Title bar area -->
  <header class="flex shrink-0 items-center justify-between border-b border-[var(--sg-border)] bg-[var(--sg-surface)] px-4 py-2">
    <span class="text-sm font-semibold text-[var(--sg-text)]">SproutGit</span>
    <span class="rounded px-2 py-0.5 text-xs text-[var(--sg-text-faint)]">
      git {git.version ?? "not found"}
    </span>
  </header>

  <div class="flex min-h-0 flex-1">
    <!-- Left: New project form -->
    <section class="flex w-[380px] shrink-0 flex-col border-r border-[var(--sg-border)] bg-[var(--sg-surface)]">
      <div class="border-b border-[var(--sg-border-subtle)] px-4 py-3">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-[var(--sg-text-dim)]">New project</h2>
      </div>

      <form onsubmit={startNewProject} class="flex flex-col gap-3 overflow-auto p-4">
        <div>
          <label for="workspace-path" class="mb-1 block text-xs text-[var(--sg-text-dim)]">Workspace folder</label>
          <div class="flex gap-1.5">
            <input
              id="workspace-path"
              bind:value={workspacePath}
              class="min-w-0 flex-1 rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
              placeholder="~/Projects/my-product"
            />
            <button
              type="button"
              onclick={async () => { const dir = await open({ directory: true, title: "Choose workspace folder" }); if (dir) workspacePath = dir; }}
              class="shrink-0 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-2.5 py-1.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-border)] hover:text-[var(--sg-text)]"
            >Browse</button>
          </div>
        </div>

        <div>
          <label for="repo-url" class="mb-1 block text-xs text-[var(--sg-text-dim)]">Repository URL</label>
          <input
            id="repo-url"
            bind:value={cloneUrl}
            class="w-full rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
            placeholder="https://github.com/org/repo.git"
          />
        </div>

        <button
          type="submit"
          disabled={creating || !git.installed}
          class="mt-1 rounded bg-[var(--sg-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--sg-bg)] hover:bg-[var(--sg-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {#if creating}<Spinner size="sm" />&nbsp;Cloning…{:else}Clone + create workspace{/if}
        </button>

        {#if creating && cloneProgress.length > 0}
          <div class="flex flex-col gap-1.5">
            {#if clonePercent !== null}
              <div class="flex items-center gap-2">
                <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--sg-border-subtle)]">
                  <div
                    class="h-full rounded-full bg-[var(--sg-primary)] transition-all duration-300"
                    style="width: {clonePercent}%"
                  ></div>
                </div>
                <span class="shrink-0 text-[10px] font-medium text-[var(--sg-text-dim)]">{clonePercent}%</span>
              </div>
            {/if}
            <div
              bind:this={progressEl}
              class="max-h-20 overflow-auto rounded border border-[var(--sg-border-subtle)] bg-[var(--sg-input-bg)] px-2.5 py-1.5"
            >
              {#each cloneProgress as line}
                <p class="font-mono text-[10px] text-[var(--sg-text-dim)]">{line}</p>
              {/each}
            </div>
          </div>
        {/if}
      </form>

      {#if createdWorkspace}
        <div class="mx-4 mb-3 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-2.5 py-1.5 text-xs text-[var(--sg-primary)]">
          Created: {createdWorkspace.workspacePath}
        </div>
      {/if}

      {#if error}
        <div class="mx-4 mb-3 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-2.5 py-1.5 text-xs text-[var(--sg-danger)]">
          {error}
        </div>
      {/if}

      <!-- Open existing -->
      <div class="mt-auto border-t border-[var(--sg-border-subtle)] p-4">
        <form onsubmit={openByPath}>
          <label for="open-workspace-path" class="mb-1 block text-xs text-[var(--sg-text-dim)]">Open existing workspace</label>
          <div class="flex gap-1.5">
            <input
              id="open-workspace-path"
              bind:value={openWorkspacePath}
              class="min-w-0 flex-1 rounded border border-[var(--sg-input-border)] bg-[var(--sg-input-bg)] px-2.5 py-1.5 text-xs text-[var(--sg-text)] placeholder-[var(--sg-text-faint)] outline-none focus:border-[var(--sg-input-focus)]"
              placeholder="~/Projects/existing-project"
            />
            <button
              type="button"
              onclick={async () => { const dir = await open({ directory: true, title: "Open existing workspace" }); if (dir) openWorkspacePath = dir; }}
              class="shrink-0 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-2.5 py-1.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-border)] hover:text-[var(--sg-text)]"
            >Browse</button>
            <button
              type="submit"
              class="shrink-0 rounded border border-[var(--sg-border)] bg-[var(--sg-surface-raised)] px-2.5 py-1.5 text-xs text-[var(--sg-text-dim)] hover:bg-[var(--sg-border)] hover:text-[var(--sg-text)]"
            >Open</button>
          </div>
        </form>
      </div>
    </section>

    <!-- Right: Known projects list -->
    <section class="flex min-w-0 flex-1 flex-col">
      <div class="border-b border-[var(--sg-border-subtle)] bg-[var(--sg-surface)] px-4 py-3">
        <h2 class="text-xs font-semibold uppercase tracking-wider text-[var(--sg-text-dim)]">Recent projects</h2>
      </div>

      <div class="flex-1 overflow-auto p-4">
        {#if knownProjects.length === 0}
          <div class="flex h-full items-center justify-center">
            <p class="text-sm text-[var(--sg-text-faint)]">No projects yet. Clone a repo to get started.</p>
          </div>
        {:else}
          <div class="space-y-1">
            {#each knownProjects as project}
              <button
                class="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-[var(--sg-surface-raised)]"
                onclick={() => openKnownWorkspace(project.workspacePath)}
                disabled={opening}
              >
                <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[var(--sg-surface-raised)] text-sm text-[var(--sg-primary)]">
                  {project.workspacePath.split("/").pop()?.charAt(0).toUpperCase() ?? "?"}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-[var(--sg-text)]">{project.workspacePath.split("/").pop()}</p>
                  <p class="truncate text-xs text-[var(--sg-text-faint)]">{project.workspacePath}</p>
                </div>
                <span class="shrink-0 text-xs text-[var(--sg-text-faint)]">&rarr;</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  </div>
</main>
