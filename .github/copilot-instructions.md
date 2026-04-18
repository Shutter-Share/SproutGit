# SproutGit — Copilot Instructions

## What is SproutGit?

Open-source, cross-platform Git desktop app with a **worktree-first** workflow. The MVP lets users clone/init repos, manage Git worktrees in a prescribed directory layout, view a commit graph, and create branches paired with worktrees.

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Desktop shell | **Tauri v2** | Rust backend, webview frontend |
| Frontend framework | **SvelteKit + Svelte 5** | SSR disabled (`ssr = false`), `adapter-static` for SPA |
| Language | **TypeScript** (frontend), **Rust** (backend) | |
| Styling | **Tailwind CSS v4** | via `@tailwindcss/vite` plugin |
| State (frontend) | Svelte 5 runes | `$state`, `$derived`, `$derived.by`, `$props`, `$effect` |
| State (persistent) | **SQLite** via `rusqlite` (bundled) | `<workspace>/.sproutgit/state.db` |
| Package manager | **pnpm** | Tauri hooks use `pnpm run dev` / `pnpm run build` |
| Git integration | CLI-based | Rust backend shells out to `git` via `std::process::Command` |

## Project Structure

```
sproutgit/
├── src/                          # SvelteKit frontend
│   ├── app.css                   # Global design tokens (--sg-* CSS vars), animations, light/dark theme
│   ├── lib/
│   │   ├── sproutgit.ts          # Typed API layer wrapping Tauri invoke() calls
│   │   ├── toast.svelte.ts       # Toast notification state (Svelte 5 rune module, no stores)
│   │   └── components/
│   │       ├── CommitGraph.svelte # SVG commit graph with lane algorithm, search, context menu, worktree markers
│   │       ├── Autocomplete.svelte # Filterable dropdown with keyboard nav, aria attributes
│   │       ├── ContextMenu.svelte  # Right-click context menu, auto-positions within viewport
│   │       ├── Spinner.svelte      # Animated loading spinner (sm/md/lg)
│   │       └── ToastContainer.svelte # Fixed-position toast renderer (auto-dismiss, slide animations)
│   └── routes/
│       ├── +layout.svelte        # Minimal: imports app.css, renders <slot />
│       ├── +layout.ts            # export const ssr = false
│       ├── +page.svelte          # Screen 1: Project picker (clone, open, recent projects)
│       └── workspace/
│           └── +page.svelte      # Screen 2: Workspace (worktree mgmt + commit graph)
├── src-tauri/
│   ├── src/lib.rs                # ALL Rust backend: Tauri commands, Git ops, DB, helpers
│   ├── tauri.conf.json           # App config: window 1200x800, min 900x600, resizable
│   ├── Cargo.toml                # Rust deps: tauri, rusqlite, serde, tauri-plugin-dialog
│   └── capabilities/default.json # Permissions: core, opener, dialog
├── docs/
│   ├── requirements.md           # Full MVP requirements with P0/P1 features
│   └── design-review-and-screen-plan.md  # Screen architecture (8 screens planned)
└── package.json                  # pnpm scripts: dev, build, check, tauri
```

## Workspace Layout (User Projects)

SproutGit manages user repos in a prescribed directory layout:

```
<workspace>/
├── root/                  # Main bare-ish checkout (protected, don't work directly here)
├── worktrees/             # Managed worktrees created by SproutGit
│   ├── feature-foo/
│   └── bugfix-bar/
└── .sproutgit/            # SproutGit metadata
    ├── project.json
    └── state.db           # SQLite: app-local state, sessions, recent repos
```

## Rust Backend (`src-tauri/src/lib.rs`)

### Structs (all `#[serde(rename_all = "camelCase")]`)

- `GitInfo` — installed, version
- `WorktreeInfo` — path, head, branch, detached
- `WorktreeListResult` — repo_path, worktrees
- `WorkspaceInitResult` — workspace_path, root_path, worktrees_path, metadata_path, state_db_path, cloned
- `WorkspaceStatus` — workspace_path, root_path, worktrees_path, metadata_path, state_db_path, is_sproutgit_project, root_exists, worktrees_exists, metadata_exists, state_db_exists
- `RefInfo` — name, full_name, kind, target
- `RefsResult` — repo_path, refs
- `CommitEntry` — hash, short_hash, parents, author_name, author_date, subject, refs
- `CommitGraphResult` — repo_path, commits
- `CreateWorktreeResult` — worktree_path, branch, from_ref

### Tauri Commands

| Command | Purpose |
|---------|---------|
| `git_info` | Check Git installation and version |
| `create_sproutgit_workspace` | Create managed workspace, optionally clone a repo URL |
| `inspect_sproutgit_workspace` | Validate an existing SproutGit project directory |
| `list_worktrees` | Enumerate Git worktrees with branch/HEAD info |
| `list_refs` | Fetch branches & tags sorted by commit date |
| `get_commit_graph` | Structured commit log with parents, refs (limit 20-400) |
| `create_managed_worktree` | Create a new worktree under `worktrees/` dir |

### Helper Functions

- `run_git(args)` — Execute `git` with args, capture stdout
- `ensure_git_success(args)` — Run git, return error on non-zero exit
- `normalize_existing_path` / `normalize_or_create_dir` — Path canonicalization
- `initialize_state_db(path)` — Create SQLite schema
- `slugify_for_path(name)` — Branch name → filesystem-safe slug
- `now_epoch_seconds()` — Current Unix timestamp

### Important Patterns

- Clone uses `--progress` flag with piped stderr, emitting `clone-progress` Tauri events via `tauri::Emitter` for real-time UI feedback
- `create_sproutgit_workspace` takes `app_handle: tauri::AppHandle` for event emission
- Commit graph uses `\x1e` (record separator) as field delimiter in git log format
- All git operations use `git -C <path>` to target specific repos

## Frontend API (`src/lib/sproutgit.ts`)

Typed wrappers around `invoke()` from `@tauri-apps/api/core`. Every Rust struct has a matching TypeScript type. Key exports:

- `getGitInfo()`, `createWorkspace()`, `inspectWorkspace()`
- `listWorktrees()`, `listRefs()`, `getCommitGraph()`
- `createManagedWorktree()`
- `onCloneProgress(callback)` — Event listener helper using `@tauri-apps/api/event`

## Theme System

CSS custom properties with auto dark mode:

- Light mode: `:root { --sg-bg: #f5f5f5; --sg-primary: #1a8a5c; ... }`
- Dark mode: `@media (prefers-color-scheme: dark) { :root { --sg-bg: #1e1e2e; --sg-primary: #74c7a4; ... } }`
- All tokens prefixed `--sg-*`: bg, surface, surface-raised, border, border-subtle, text, text-dim, text-faint, primary, primary-hover, danger, warning, accent, input-bg, input-border, input-focus

Always use `var(--sg-*)` tokens in components. Never hardcode colors outside of `app.css`.

## Commit Graph Component

`CommitGraph.svelte` implements a hand-rolled lane assignment algorithm:

- **Algorithm**: Two-pass column allocation. First pass assigns lanes (first parent continues lane, others allocate new). Second pass resolves parent positions for line drawing.
- **Rendering**: SVG for lane lines (straight + bezier curves) alongside a commit list with subject, ref badges, short hash, author, date.
- **Search**: CMD/CTRL+F opens inline search bar. Matches by subject, short hash, or full hash. Enter/Shift+Enter navigates matches. Non-matching rows dim to 30% opacity.
- **Context Menu**: Right-click on commits, branches, or tags shows copy actions (hash, message, branch, worktree path). Uses `ContextMenu.svelte`.
- **Worktree Integration**: Accepts `worktrees` prop. Commits on worktree branches get a diamond node shape (vs circle), a "WT" badge, and a distinct accent-colored ref badge with ⌥ prefix. Worktree branches are highlighted in `--sg-accent` color.
- **Constants**: ROW_H=28, COL_W=16, NODE_R=4, 10 cycling lane colors.

## UI Components

### Toast System (`toast.svelte.ts` + `ToastContainer.svelte`)
- **State module**: `toast.svelte.ts` exports `toast.info()`, `toast.success()`, `toast.error()`, `toast.warning()`. Uses `$state` (no Svelte stores). Auto-dismiss after 4s by default.
- **Renderer**: `ToastContainer.svelte` mounted in `+layout.svelte`. Fixed top-right, slide-in/out animations, close button.

### Autocomplete (`Autocomplete.svelte`)
- Filterable dropdown with `items: {label, value, detail?}[]`. Supports keyboard nav (up/down/enter/escape), click outside to close.
- Two-way binding via `bind:value`. `onselect` callback. ARIA combobox role.
- Used for source branch selection in the workspace sidebar.

### Context Menu (`ContextMenu.svelte`)
- `items: MenuItem[]` with `{label, action, icon?, danger?}` or `{separator: true}`.
- Auto-adjusts position to stay within viewport bounds. Closes on click outside or Escape.

### Spinner (`Spinner.svelte`)
- Sizes: `sm`, `md`, `lg`. Optional `label` text. Uses `--sg-primary` color.

## Animations

Global keyframes defined in `app.css`:
- `sg-fade-in` — content entrance (opacity + translateY)
- `sg-slide-up` / `sg-slide-down` — directional slide entrances
- `sg-toast-in` / `sg-toast-out` — toast slide from right
- `sg-spin` — loading spinner rotation
- `sg-pulse` — skeleton loading pulse

## Development Commands

```bash
# Prerequisites: source cargo and nvm
source "$HOME/.cargo/env"
source ~/.nvm/nvm.sh

# Install deps
pnpm install

# Validate everything compiles
pnpm run check          # svelte-check
pnpm run build          # vite build
cd src-tauri && cargo check  # Rust check

# Run in development
pnpm run tauri dev

# VS Code task (with nvm support)
# Defined as: zsh -lc 'source ~/.nvm/nvm.sh && npm run tauri dev'
```

## Coding Conventions

- **Svelte 5 runes only** — Use `$state`, `$derived`, `$props`. No legacy `let` reactivity or stores.
- **Component props** — Use `type Props = { ... }; let { ... }: Props = $props();`
- **Tailwind utility classes** — Inline in templates. Use `var(--sg-*)` for theme-aware colors.
- **Rust serde** — All structs use `#[serde(rename_all = "camelCase")]` for JS interop.
- **Error handling** — Rust commands return `Result<T, String>`. Frontend uses try/catch on `invoke()`.
- **No stores** — All page state uses `$state` directly in `<script>` blocks.
- **Imports** — Frontend API types come from `$lib/sproutgit`. Components from `$lib/components/`.

## Known Issues & Gotchas

- `cargo` must be in PATH — always `source "$HOME/.cargo/env"` before running `tauri dev`
- `git clone --progress` writes to **stderr**, not stdout
- Tauri event emission requires `tauri::Emitter` trait in scope
- `format!()` in Rust: don't mix string concatenation with format placeholders — use `.join()` for building git format strings
- Svelte 5 `class:` directive with Tailwind arbitrary values (e.g., `class:bg-[var(--x)]/10={cond}`) works but looks odd
- Window overflow: parent containers must be `flex flex-col overflow-hidden` for child `flex-1 overflow-auto` to scroll properly