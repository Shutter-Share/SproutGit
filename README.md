<p align="center">
  <img src="logos/logo.svg" width="80" alt="SproutGit logo" />
</p>

<h1 align="center">SproutGit</h1>

<p align="center">
  A fast, open-source, cross-platform Git desktop app with a <strong>worktree-first</strong> workflow.<br/>
  Built with <a href="https://v2.tauri.app">Tauri v2</a> + <a href="https://svelte.dev">SvelteKit</a> + TypeScript + Rust.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#installation">Installation</a> •
  <a href="#development">Development</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

---

> [!WARNING]
> **SproutGit is an early prototype.** It is under active development and not ready for daily use. Expect missing features, rough edges, and breaking changes. Contributions and feedback are welcome!

## Why worktree-first?

Most Git GUIs treat branches as the primary unit of work. SproutGit treats **worktrees** as first-class citizens instead.

A Git worktree is a separate working directory linked to the same repository. Unlike branches, which are just pointers, worktrees give you a real, independent directory for each piece of work — no stashing, no context-switching, no losing your place.

**This matters even more with AI agents.** Modern development increasingly involves multiple AI coding agents working in parallel — reviewing code in one context, building a feature in another, fixing a bug in a third. Traditional branch workflows break down here because agents would fight over the same working directory. With worktrees, each agent gets its own isolated directory while sharing the same repo:

```
my-project/
├── root/                    # Main checkout (protected)
├── worktrees/
│   ├── feature-auth/        # Agent A is building auth
│   ├── bugfix-nav/          # Agent B is fixing navigation
│   └── refactor-api/        # Agent C is refactoring the API
└── .sproutgit/
```

No conflicts, no stash juggling, no waiting. Each agent works independently on its own worktree, and you merge when ready. SproutGit manages this layout so you don't have to think about the underlying `git worktree` commands.

## Features

- **Worktree-first workflow** — Create, switch, and manage Git worktrees in a clean prescribed directory layout
- **Interactive commit graph** — Lane-based SVG graph with search, selection, and context menus
- **Diff viewer** — Single-commit and multi-commit range diffs with file list and unified diff display
- **Branch management** — Checkout, reset (soft/mixed/hard), and create branches from any ref
- **Editor integration** — Open worktrees in your configured editor (respects `GIT_EDITOR`, `core.editor`, `VISUAL`, `EDITOR`)
- **Dark mode** — Automatic light/dark theme via system preferences
- **Cross-platform** — macOS, Windows, and Linux via Tauri v2
- **Lightweight** — Small bundle, native performance, minimal resource usage

## Screenshots

<p align="center">
  <img src="screenshots/nextjs.png" alt="SproutGit workspace view" width="800" />
</p>

## Installation

### Download

Pre-built binaries will be available on the [Releases](../../releases) page once CI is set up.

### Build from source

#### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (recommend [nvm](https://github.com/nvm-sh/nvm))
- [pnpm](https://pnpm.io/) 9+
- [Rust](https://rustup.rs/) stable toolchain
- [Git](https://git-scm.com/) 2.20+
- Platform dependencies for [Tauri v2](https://v2.tauri.app/start/prerequisites/)

#### Steps

```bash
git clone https://github.com/YOUR_USERNAME/sproutgit.git
cd sproutgit
pnpm install
pnpm tauri build
```

The built app will be in `src-tauri/target/release/bundle/`.

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode (hot-reload)
pnpm tauri dev

# Frontend type checking
pnpm run check

# Frontend production build
pnpm run build

# Rust type checking
cd src-tauri && cargo check
```

## Project Structure

```
sproutgit/
├── src/                          # SvelteKit frontend
│   ├── app.css                   # Design tokens (--sg-* CSS vars), animations, themes
│   ├── lib/
│   │   ├── sproutgit.ts          # Typed API layer wrapping Tauri invoke() calls
│   │   ├── toast.svelte.ts       # Toast notification state (Svelte 5 runes)
│   │   ├── validation.ts         # Branch name / ref validation
│   │   └── components/           # Reusable UI components
│   └── routes/
│       ├── +page.svelte          # Project picker (clone, open, recent)
│       └── workspace/
│           └── +page.svelte      # Main workspace (worktrees + graph + diff)
├── src-tauri/
│   ├── src/lib.rs                # Rust backend: Tauri commands, Git ops, DB
│   ├── tauri.conf.json           # App configuration
│   └── Cargo.toml                # Rust dependencies
├── docs/                         # Design docs and requirements
├── logos/                         # App icons (Apple Liquid Glass)
└── tests/                        # Tauri driver smoke tests
```

## Workspace Layout

SproutGit manages repos in a prescribed directory structure:

```
<workspace>/
├── root/                  # Main checkout (protected)
├── worktrees/             # Managed worktrees
│   ├── feature-foo/
│   └── bugfix-bar/
└── .sproutgit/
    ├── project.json
    └── state.db           # Local state (SQLite)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | SvelteKit + Svelte 5 |
| Language | TypeScript + Rust |
| Styling | Tailwind CSS v4 |
| Icons | Lucide |
| State | Svelte 5 runes + SQLite (rusqlite) |
| Git | CLI via `std::process::Command` |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines, coding conventions, and how to submit changes.

## License

[MIT](LICENSE)
