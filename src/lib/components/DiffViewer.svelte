<script lang="ts">
  import type { DiffFileEntry } from "$lib/sproutgit";
  import Spinner from "./Spinner.svelte";

  type Props = {
    files: DiffFileEntry[];
    selectedFile: string | null;
    diff: string;
    loading: boolean;
    commitLabel: string;
    onselectfile: (path: string) => void;
    onclose: () => void;
  };

  let {
    files,
    selectedFile,
    diff,
    loading,
    commitLabel,
    onselectfile,
    onclose,
  }: Props = $props();

  function statusIcon(status: string): string {
    switch (status) {
      case "A":
        return "+";
      case "D":
        return "−";
      case "M":
        return "●";
      case "R":
        return "→";
      default:
        return "?";
    }
  }

  function statusColor(status: string): string {
    switch (status) {
      case "A":
        return "text-green-400";
      case "D":
        return "text-red-400";
      case "M":
        return "text-yellow-400";
      case "R":
        return "text-blue-400";
      default:
        return "text-[var(--sg-text-faint)]";
    }
  }

  // Parse unified diff into structured lines
  type DiffLine = {
    type: "header" | "hunk" | "add" | "del" | "context" | "empty";
    content: string;
    oldNum: number | null;
    newNum: number | null;
  };

  const parsedDiff = $derived.by((): DiffLine[] => {
    if (!diff) return [];
    const lines = diff.split("\n");
    const result: DiffLine[] = [];
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
      if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
        result.push({ type: "header", content: line, oldNum: null, newNum: null });
      } else if (line.startsWith("@@")) {
        // Parse hunk header: @@ -old,count +new,count @@
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLine = parseInt(match[1], 10);
          newLine = parseInt(match[2], 10);
        }
        result.push({ type: "hunk", content: line, oldNum: null, newNum: null });
      } else if (line.startsWith("+")) {
        result.push({ type: "add", content: line.slice(1), oldNum: null, newNum: newLine });
        newLine++;
      } else if (line.startsWith("-")) {
        result.push({ type: "del", content: line.slice(1), oldNum: oldLine, newNum: null });
        oldLine++;
      } else if (line === "") {
        result.push({ type: "empty", content: "", oldNum: null, newNum: null });
      } else {
        // Context line (starts with space or is plain text)
        const content = line.startsWith(" ") ? line.slice(1) : line;
        result.push({ type: "context", content, oldNum: oldLine, newNum: newLine });
        oldLine++;
        newLine++;
      }
    }
    return result;
  });

  function fileName(path: string): string {
    return path.split("/").pop() ?? path;
  }

  function dirName(path: string): string {
    const parts = path.split("/");
    if (parts.length <= 1) return "";
    return parts.slice(0, -1).join("/") + "/";
  }
</script>

<div class="flex h-full flex-col">
  <!-- Header -->
  <div class="flex shrink-0 items-center gap-2 border-b border-[var(--sg-border)] bg-[var(--sg-surface)] px-3 py-1.5">
    <p class="min-w-0 flex-1 truncate text-xs text-[var(--sg-text)]">
      <span class="text-[var(--sg-text-faint)]">Changes in</span>
      <span class="font-mono font-medium">{commitLabel}</span>
      <span class="text-[var(--sg-text-faint)]">· {files.length} file{files.length !== 1 ? "s" : ""}</span>
    </p>
    <button
      onclick={onclose}
      class="rounded p-0.5 text-[var(--sg-text-faint)] hover:bg-[var(--sg-surface-raised)] hover:text-[var(--sg-text)]"
      title="Close diff view"
    >
      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" stroke-width="2" stroke-linecap="round" /></svg>
    </button>
  </div>

  <div class="flex min-h-0 flex-1">
    <!-- File list -->
    <div class="flex w-[220px] shrink-0 flex-col border-r border-[var(--sg-border)] bg-[var(--sg-surface)]">
      <div class="flex-1 overflow-auto">
        {#each files as file}
          <button
            class="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-[var(--sg-surface-raised)] {selectedFile === file.path ? 'bg-[var(--sg-surface-raised)] text-[var(--sg-text)]' : 'text-[var(--sg-text-dim)]'}"
            onclick={() => onselectfile(file.path)}
          >
            <span class="shrink-0 font-mono text-[10px] font-bold {statusColor(file.status)}" title={file.status}>{statusIcon(file.status)}</span>
            <span class="min-w-0 truncate">
              <span class="text-[var(--sg-text-faint)]">{dirName(file.path)}</span>{fileName(file.path)}
            </span>
          </button>
        {/each}
      </div>
    </div>

    <!-- Diff content -->
    <div class="min-w-0 flex-1 overflow-auto bg-[var(--sg-bg)]">
      {#if loading}
        <div class="flex h-full items-center justify-center">
          <Spinner size="md" label="Loading diff…" />
        </div>
      {:else if !selectedFile}
        <div class="flex h-full items-center justify-center text-xs text-[var(--sg-text-faint)]">
          Select a file to view its diff
        </div>
      {:else if parsedDiff.length === 0}
        <div class="flex h-full items-center justify-center text-xs text-[var(--sg-text-faint)]">
          No diff content
        </div>
      {:else}
        <table class="w-full border-collapse font-mono text-[11px] leading-[18px]">
          <tbody>
            {#each parsedDiff as line}
              {#if line.type === "header"}
                <tr class="bg-[var(--sg-surface)]">
                  <td class="select-none px-1 text-right text-[var(--sg-text-faint)]" colspan="2"></td>
                  <td class="px-2 text-[var(--sg-text-faint)]">{line.content}</td>
                </tr>
              {:else if line.type === "hunk"}
                <tr class="bg-[var(--sg-primary)]/5">
                  <td class="select-none px-1 text-right text-[var(--sg-primary)]" colspan="2">···</td>
                  <td class="px-2 text-[var(--sg-primary)]">{line.content}</td>
                </tr>
              {:else if line.type === "add"}
                <tr class="bg-green-500/10">
                  <td class="w-[1px] select-none whitespace-nowrap border-r border-[var(--sg-border-subtle)] px-1 text-right text-[var(--sg-text-faint)]"></td>
                  <td class="w-[1px] select-none whitespace-nowrap border-r border-[var(--sg-border-subtle)] px-1 text-right text-[var(--sg-text-faint)]">{line.newNum}</td>
                  <td class="whitespace-pre-wrap break-all px-2 text-green-400">+{line.content}</td>
                </tr>
              {:else if line.type === "del"}
                <tr class="bg-red-500/10">
                  <td class="w-[1px] select-none whitespace-nowrap border-r border-[var(--sg-border-subtle)] px-1 text-right text-[var(--sg-text-faint)]">{line.oldNum}</td>
                  <td class="w-[1px] select-none whitespace-nowrap border-r border-[var(--sg-border-subtle)] px-1 text-right text-[var(--sg-text-faint)]"></td>
                  <td class="whitespace-pre-wrap break-all px-2 text-red-400">-{line.content}</td>
                </tr>
              {:else if line.type === "context"}
                <tr>
                  <td class="w-[1px] select-none whitespace-nowrap border-r border-[var(--sg-border-subtle)] px-1 text-right text-[var(--sg-text-faint)]">{line.oldNum}</td>
                  <td class="w-[1px] select-none whitespace-nowrap border-r border-[var(--sg-border-subtle)] px-1 text-right text-[var(--sg-text-faint)]">{line.newNum}</td>
                  <td class="whitespace-pre-wrap break-all px-2 text-[var(--sg-text-dim)]"> {line.content}</td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
</div>
