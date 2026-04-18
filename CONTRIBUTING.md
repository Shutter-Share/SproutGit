# Contributing to SproutGit

Thanks for your interest in contributing!

> **Note:** SproutGit is an early prototype under active development. Many features are incomplete or missing. This is a great time to shape the direction of the project.

This guide covers development setup, coding conventions, and the pull request process.

## Getting Started

1. Fork the repository and clone your fork
2. Install prerequisites (see [README](README.md#prerequisites))
3. Install dependencies: `pnpm install`
4. Run the app: `pnpm tauri dev`

## Development Workflow

```bash
# Start dev mode with hot-reload
pnpm tauri dev

# Before committing, verify everything compiles
pnpm run check          # Svelte/TS type checking
pnpm run build          # Frontend production build
cd src-tauri && cargo check  # Rust type checking
```

## Coding Conventions

### Frontend (Svelte + TypeScript)

- **Svelte 5 runes only** — Use `$state`, `$derived`, `$derived.by`, `$props`, `$effect`. No legacy `let` reactivity or Svelte stores.
- **Component props** — Use `type Props = { ... }; let { ... }: Props = $props();`
- **Styling** — Tailwind utility classes inline. Use `var(--sg-*)` design tokens from `app.css` for theme colors. Never hardcode colors outside `app.css`.
- **Icons** — Use [Lucide](https://lucide.dev/) via `lucide-svelte`. No inline SVGs for icons.
- **Imports** — API types from `$lib/sproutgit`, components from `$lib/components/`.
- **No stores** — Page state uses `$state` directly in `<script>` blocks.

### Backend (Rust)

- **Serde naming** — All structs use `#[serde(rename_all = "camelCase")]` for JS interop.
- **Error handling** — Tauri commands return `Result<T, String>`. Avoid `.unwrap()` in command handlers.
- **Git CLI** — Use `run_git()` / `ensure_git_success()` helpers. Target repos with `git -C <path>`.
- **New commands** — Add the `#[tauri::command]` function, register it in the `invoke_handler!` macro in `run()`, add a matching TypeScript wrapper in `src/lib/sproutgit.ts`.

### General

- Keep PRs focused — one feature or fix per PR.
- No unnecessary refactors, comments, or abstractions beyond what's needed.
- Test that the app compiles on your platform before submitting.

## Project Architecture

- **Frontend** → `src/` — SvelteKit SPA (SSR disabled, `adapter-static`)
- **Backend** → `src-tauri/src/lib.rs` — All Rust code lives in one file for now
- **API layer** → `src/lib/sproutgit.ts` — Typed wrappers around `invoke()` calls
- **Theming** → `src/app.css` — CSS custom properties with `--sg-*` prefix

## Adding a New Feature

1. **Rust command** — Add the `#[tauri::command]` function and any supporting structs to `lib.rs`. Register in `run()`.
2. **TypeScript types + wrapper** — Mirror the Rust struct as a TS type and add an `invoke()` wrapper in `sproutgit.ts`.
3. **UI** — Build the component/page changes using existing design tokens and component patterns.
4. **Verify** — `pnpm run check && pnpm run build && cd src-tauri && cargo check`

## Submitting Changes

1. Create a branch from `main`
2. Make your changes with clear, descriptive commits
3. Verify the app compiles (see above)
4. Open a pull request against `main`
5. Describe what changed and why in the PR description

## Reporting Issues

- Use GitHub Issues
- Include your OS, Git version, and steps to reproduce
- Attach relevant error messages or screenshots
