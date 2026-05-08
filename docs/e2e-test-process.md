# E2E Test Process

This document defines the default E2E workflow for SproutGit.

## Defaults

- Playwright runs in headless mode by default via `e2e/playwright.config.ts`.
- E2E uses `@srsholmes/tauri-playwright` in `tauri` mode.
- Test workers are pinned to `1` for deterministic stateful desktop flows.
- `pnpm run test:e2e` runs Playwright directly against the built app.
- Playwright global setup performs one prebuild (`pnpm run test:e2e:build`) before tests unless explicitly skipped.
- `test:e2e:build` uses `tauri build --config src-tauri/tauri.e2e.conf.json --no-bundle --features e2e-testing` so tests use a release app binary without slow packaging/signing steps and only opt into Playwright permissions during E2E builds.

To skip the one-time prebuild for faster local iteration:

- `SPROUTGIT_E2E_SKIP_BUILD=1 pnpm run test:e2e`

## Per-Test Isolation

The `tauriPage` fixture owns per-test reset before the app launches:

1. Reset isolated config DB path for the run.
2. Reset workspace test directories.
3. Start a fresh Tauri app process for the test.

This ordering is required on Windows. Resetting the config DB or workspace directories after the app is already running can race startup reads, file watchers, and terminal child processes, producing `database is locked`, `EBUSY`, and `beforeEach` timeout flakes.

Specs should assume a fresh app on first interaction and should not perform their own reset in `beforeEach` unless a test explicitly needs an in-app navigation step within the same process.

## Browser Dependency Setup

Playwright browser dependencies are installed via:

- `pnpm run setup:playwright`

This command is run automatically from `prepare`:

- `pnpm run prepare` => `husky && pnpm run setup:playwright`

Platform behavior:

- Linux: installs Chromium with system deps (`playwright install --with-deps chromium`).
- macOS/Windows: installs Chromium (`playwright install chromium`).

To skip local auto-setup:

- Set `SPROUTGIT_SKIP_PLAYWRIGHT_SETUP=1`.

## Pre-Commit Gate

`.husky/pre-commit` includes these checks in order:

1. `pnpm run cleanup:rust-targets:delete`
2. Rust unit tests
3. `pnpm run test`
4. lint
5. type check
6. full E2E run

## Common Commands

```bash
# Standard e2e run (isolated process per test)
pnpm run test:e2e

# Tauri headed mode
pnpm run test:e2e --headed

# Build + e2e
pnpm run test:e2e:full

# Canary suites
pnpm run test:e2e:canary

# Screenshot suite
pnpm run test:e2e:screenshots
```
