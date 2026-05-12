use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};

use crate::git::helpers::{
    command_exists, shell_candidates_for_current_os, validate_no_control_chars,
};

// ── Shell detection ──────────────────────────────────────────────────────────

pub fn detect_available_shells() -> Vec<String> {
    let detected: Vec<String> = shell_candidates_for_current_os()
        .iter()
        .filter(|c| command_exists(c))
        .map(|c| c.to_string())
        .collect();

    if detected.is_empty() {
        shell_candidates_for_current_os()
            .first()
            .map(|c| vec![c.to_string()])
            .unwrap_or_else(|| vec!["bash".to_string()])
    } else {
        detected
    }
}

// ── PTY session state ────────────────────────────────────────────────────────

struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    /// The spawned shell process. Stored so `close_terminal` can call `kill()`
    /// immediately rather than relying on the shell to respond to the ConPTY
    /// CTRL_CLOSE_EVENT.  On Windows, PowerShell can take several seconds to
    /// handle that event; an explicit kill is unconditional and instant.
    child: Mutex<Box<dyn Child + Send + Sync>>,
    /// The initial working directory the shell was spawned in.  On Windows,
    /// live shell processes hold a CWD directory handle that blocks `rmdir`.
    /// Stored here so `close_terminals_for_path` can target just the sessions
    /// whose initial CWD is inside the worktree being deleted.
    initial_cwd: PathBuf,
}

pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, Arc<PtySession>>>>,
    /// Set of pty_ids for non-interactive hook terminals. These are spawned
    /// via std::process::Command (not PTY). The child processes are owned by
    /// wait-threads and removed from this set when those threads complete.
    non_interactive_pids: Arc<Mutex<std::collections::HashSet<String>>>,
    /// Map of hook_id → epoch milliseconds at which that hook's terminal
    /// session exited.  Populated by the non-interactive PTY wait-thread when a
    /// session was spawned with a `hook_id` argument.  Read by the
    /// `is_hook_terminal_closed` command so that E2E tests (and any future UI
    /// surfaces) can synchronise on real backend process state instead of the
    /// long IPC chain (PTY exit → wait-thread → emit → frontend listener →
    /// reactive update → DOM removal) that drives terminal-tab disappearance.
    closed_hook_terminals: Arc<Mutex<HashMap<String, i64>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            non_interactive_pids: Arc::new(Mutex::new(std::collections::HashSet::new())),
            closed_hook_terminals: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn generate_pty_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("pty-{millis}")
}

fn validate_pty_id(pty_id: &str) -> Result<String, String> {
    let id = pty_id.trim().to_string();
    if id.is_empty() {
        return Err("PTY ID is required".to_string());
    }
    validate_no_control_chars(&id, "PTY ID")?;
    Ok(id)
}

fn validate_shell_for_terminal(shell: &str) -> Result<String, String> {
    let s = shell.trim().to_string();
    if s.is_empty() {
        return Err("Shell is required".to_string());
    }
    // Prevent option-injection: reject values that start with '-'
    if s.starts_with('-') {
        return Err("Invalid shell name".to_string());
    }
    validate_no_control_chars(&s, "Shell")?;
    let available = detect_available_shells();
    if !available.contains(&s) {
        return Err(format!(
            "Shell '{}' is not available on this system. Available: {}",
            s,
            available.join(", ")
        ));
    }
    Ok(s)
}

fn validate_spawn_env_vars(
    env_vars: Option<HashMap<String, String>>,
) -> Result<HashMap<String, String>, String> {
    let mut validated = HashMap::new();

    for (key, value) in env_vars.unwrap_or_default() {
        let trimmed_key = key.trim().to_string();
        if trimmed_key.is_empty() {
            return Err("Environment variable name is required".to_string());
        }
        if trimmed_key.contains('=') {
            return Err(format!("Invalid environment variable name: {trimmed_key}"));
        }
        validate_no_control_chars(&trimmed_key, "Environment variable name")?;
        validate_no_control_chars(&value, "Environment variable value")?;
        validated.insert(trimmed_key, value);
    }

    Ok(validated)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_available_shells() -> Vec<String> {
    tokio::task::spawn_blocking(detect_available_shells)
        .await
        .unwrap_or_default()
}

/// Spawn a new PTY session running the given shell in the given directory.
/// Returns the PTY ID which must be used for subsequent input/resize/close calls.
/// Emits `terminal-output-{pty_id}` events with `String` payloads (UTF-8).
/// Emits `terminal-closed-{pty_id}` when the shell process exits.
///
/// When `command` is `Some`, the shell is spawned in non-interactive mode:
/// PowerShell uses `-NonInteractive -Command <cmd>`; POSIX shells use `-c <cmd>`.
/// The process exits automatically when the script completes, giving reliable
/// `terminal-closed` delivery without PTY-input race conditions on Windows ConPTY.
///
/// When `hook_id` is `Some` AND `command` is `Some` (auto-close hook session),
/// the wait-thread also records the exit timestamp (epoch ms) into
/// `TerminalManager::closed_hook_terminals` so that
/// [`is_hook_terminal_closed`] can report deterministic completion to callers
/// (notably E2E tests) without polling the DOM.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn spawn_terminal(
    app_handle: AppHandle,
    state: tauri::State<'_, TerminalManager>,
    shell: String,
    cwd: String,
    cols: u16,
    rows: u16,
    command: Option<String>,
    hook_id: Option<String>,
    env_vars: Option<HashMap<String, String>>,
) -> Result<String, String> {
    let shell = validate_shell_for_terminal(&shell)?;
    let spawn_env_vars = validate_spawn_env_vars(env_vars)?;

    let validated_hook_id = match hook_id {
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                None
            } else {
                validate_no_control_chars(trimmed, "Hook ID")?;
                Some(trimmed.to_string())
            }
        },
        None => None,
    };

    let cwd_path = PathBuf::from(cwd.trim());
    if !cwd_path.is_dir() {
        return Err(format!(
            "Working directory does not exist: {}",
            cwd_path.display()
        ));
    }

    let pty_id = generate_pty_id();

    // Non-interactive mode: skip the PTY entirely and run the script via a
    // regular piped process.  On Windows ConPTY, the PTY master reader can
    // block indefinitely after the child exits (the pseudo-console output pipe
    // does not signal EOF until the ConPTY handle is explicitly closed), which
    // would prevent `terminal-closed` from ever being emitted.  A plain
    // `std::process::Command` with piped stdout/stderr exits cleanly and emits
    // the event as soon as the process terminates.
    if let Some(ref script) = command {
        let mut proc_cmd = std::process::Command::new(&shell);
        proc_cmd.current_dir(&cwd_path);
        proc_cmd.env("GIT_TERMINAL_PROMPT", "0");
        proc_cmd.envs(spawn_env_vars.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        proc_cmd.stdout(Stdio::piped());
        proc_cmd.stderr(Stdio::piped());

        if matches!(shell.as_str(), "pwsh" | "powershell") {
            proc_cmd.arg("-NonInteractive");
            proc_cmd.arg("-Command");
            proc_cmd.arg(script.as_str());
        } else {
            proc_cmd.arg("-c");
            proc_cmd.arg(script.as_str());
        }

        // Suppress the console window on Windows so no extra window flashes.
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            proc_cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = proc_cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn shell '{shell}': {e}"))?;

        // Register this non-interactive terminal's pty_id for tracking.
        let pty_id_clone = pty_id.clone();
        {
            let mut non_interactive = state
                .non_interactive_pids
                .lock()
                .map_err(|_| "Failed to lock non-interactive terminals".to_string())?;
            non_interactive.insert(pty_id_clone.clone());
        }

        let app_stdout = app_handle.clone();
        let app_stderr = app_handle.clone();
        let app_closed = app_handle.clone();

        // Stream stdout
        if let Some(stdout) = child.stdout.take() {
            let id = pty_id_clone.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    match line {
                        Ok(l) => {
                            let _ = app_stdout
                                .emit(&format!("terminal-output-{id}"), format!("{l}\r\n"));
                        },
                        Err(_) => break,
                    }
                }
            });
        }

        // Stream stderr
        if let Some(stderr) = child.stderr.take() {
            let id = pty_id_clone.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    match line {
                        Ok(l) => {
                            let _ = app_stderr
                                .emit(&format!("terminal-output-{id}"), format!("{l}\r\n"));
                        },
                        Err(_) => break,
                    }
                }
            });
        }

        // Wait for exit, then fire terminal-closed and (if this session was
        // associated with a hook via the `hook_id` argument) record the exit
        // timestamp so that callers polling `is_hook_terminal_closed` see a
        // deterministic completion signal.
        let closed_map = Arc::clone(&state.closed_hook_terminals);
        let hook_id_for_thread = validated_hook_id.clone();
        let non_interactive_pids = Arc::clone(&state.non_interactive_pids);
        let pty_id_for_cleanup = pty_id_clone.clone();
        std::thread::spawn(move || {
            let _ = child.wait();
            // Remove this terminal from tracking since it's done
            if let Ok(mut set) = non_interactive_pids.lock() {
                set.remove(&pty_id_for_cleanup);
            }
            if let Some(hook_id) = hook_id_for_thread {
                let now_ms = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                if let Ok(mut map) = closed_map.lock() {
                    map.insert(hook_id, now_ms);
                }
            }
            let _ = app_closed.emit(&format!("terminal-closed-{pty_id_clone}"), ());
        });

        return Ok(pty_id);
    }

    // Interactive PTY mode (command == None) ──────────────────────────────────

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd_path);

    // Set GIT_TERMINAL_PROMPT=0 so git doesn't hang waiting for interactive input
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    for (key, value) in &spawn_env_vars {
        cmd.env(key, value);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell '{shell}': {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {e}"))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {e}"))?;

    let session = Arc::new(PtySession {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
        initial_cwd: cwd_path.clone(),
    });

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Failed to lock terminal sessions".to_string())?;
        sessions.insert(pty_id.clone(), Arc::clone(&session));
    }

    // Clone the Arc so the background task can clean up when done
    let sessions_arc = Arc::clone(&state.sessions);
    let pty_id_clone = pty_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // Convert bytes to a UTF-8 string (lossy) for the frontend
                    let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app_handle.emit(&format!("terminal-output-{}", pty_id_clone), &text);
                },
            }
        }

        // Remove session from the map when the shell exits
        if let Ok(mut sessions) = sessions_arc.lock() {
            sessions.remove(&pty_id_clone);
        }

        // Notify frontend that the session is gone
        let _ = app_handle.emit(&format!("terminal-closed-{}", pty_id_clone), ());
    });

    Ok(pty_id)
}

/// Send keyboard input to a running PTY session.
#[tauri::command]
pub async fn terminal_input(
    state: tauri::State<'_, TerminalManager>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    let pty_id = validate_pty_id(&pty_id)?;

    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to lock terminal sessions".to_string())?;

    let session = sessions
        .get(&pty_id)
        .ok_or_else(|| format!("No terminal session: {pty_id}"))?;

    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "Failed to lock PTY writer".to_string())?;

    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to PTY: {e}"))?;

    Ok(())
}

/// Notify the PTY of a terminal resize.
#[tauri::command]
pub async fn terminal_resize(
    state: tauri::State<'_, TerminalManager>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty_id = validate_pty_id(&pty_id)?;

    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to lock terminal sessions".to_string())?;

    let session = sessions
        .get(&pty_id)
        .ok_or_else(|| format!("No terminal session: {pty_id}"))?;

    session
        .master
        .lock()
        .map_err(|_| "Failed to lock PTY master".to_string())?
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize PTY: {e}"))?;

    Ok(())
}

/// Close and clean up a PTY session, killing the shell process.
#[tauri::command]
pub async fn close_terminal(
    state: tauri::State<'_, TerminalManager>,
    pty_id: String,
) -> Result<(), String> {
    let pty_id = validate_pty_id(&pty_id)?;

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to lock terminal sessions".to_string())?;

    if let Some(session) = sessions.remove(&pty_id) {
        // Explicitly kill the child process before dropping the master PTY.
        // On Windows, closing the ConPTY master sends CTRL_CLOSE_EVENT to the
        // shell, but PowerShell can take several seconds to honour it while
        // running exit handlers.  TerminateProcess (via kill()) is unconditional
        // and immediate, ensuring the CWD handle is released right away — which
        // is critical for E2E tests that delete the worktree directory next.
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
        }
        // `session` Arc drops here (refcount → 0): master PTY and writer are closed.
    }

    Ok(())
}

/// Kill every active PTY session and clear the session map.
///
/// Called from the workspace page's `onDestroy` before navigating to the home
/// screen.  On Windows, each live shell process (PowerShell / pwsh) holds a
/// directory handle on its CWD.  Killing them here — before the E2E test
/// helper calls `resetTestDirs()` — ensures those handles are released before
/// the filesystem cleanup attempts `rmdir` on the worktree directories.
#[tauri::command]
pub async fn close_all_terminals(state: tauri::State<'_, TerminalManager>) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to lock terminal sessions".to_string())?;

    for session in sessions.values() {
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
        }
    }
    sessions.clear();

    // Non-interactive terminals are tracked in non_interactive_pids for
    // monitoring, but their child processes are owned by wait-threads and
    // cannot be directly killed from here. The E2E fixture cleanup grace
    // period (500ms) allows those threads to naturally exit and release handles.

    Ok(())
}

/// Kill all PTY sessions whose initial working directory is inside `path`.
///
/// Called before deleting a worktree on Windows: live shell processes hold a
/// CWD directory handle that prevents `git worktree remove` (and any fallback
/// `fs::remove_dir_all`) from deleting the worktree directory.  Killing only
/// the sessions rooted in the target path avoids disrupting terminals that are
/// open in other worktrees.
#[tauri::command]
pub async fn close_terminals_for_path(
    state: tauri::State<'_, TerminalManager>,
    path: String,
) -> Result<(), String> {
    use crate::git::helpers::normalize_existing_path;

    let target = match normalize_existing_path(&path) {
        Ok(p) => p,
        // If the path doesn't exist yet (already partially deleted), match
        // canonically-normalised prefix instead.
        Err(_) => std::path::PathBuf::from(path.trim()),
    };

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to lock terminal sessions".to_string())?;

    let to_kill: Vec<String> = sessions
        .iter()
        .filter(|(_, s)| s.initial_cwd.starts_with(&target))
        .map(|(id, _)| id.clone())
        .collect();

    for id in &to_kill {
        if let Some(session) = sessions.remove(id) {
            if let Ok(mut child) = session.child.lock() {
                let _ = child.kill();
            }
        }
    }

    Ok(())
}

/// Return the epoch millisecond timestamp at which the auto-close terminal
/// session associated with `hook_id` exited, or `None` if no such session has
/// completed (or if the session was not spawned with a `hook_id`).
///
/// Provides a deterministic, IPC-free synchronisation point for callers that
/// need to know when a hook's terminal session finished.  Without this,
/// observers must watch the long async chain
///     (PTY child exit → wait-thread → Tauri event → frontend listener →
///      Svelte reactive update → DOM removal)
/// which is fast in practice but can exceed a multi-second budget on loaded
/// CI runners.  E2E tests use this command to remove that flake source from
/// the auto-close hook assertion.
#[tauri::command]
pub async fn is_hook_terminal_closed(
    state: tauri::State<'_, TerminalManager>,
    hook_id: String,
) -> Result<Option<i64>, String> {
    let trimmed = hook_id.trim();
    if trimmed.is_empty() {
        return Err("Hook ID is required".to_string());
    }
    validate_no_control_chars(trimmed, "Hook ID")?;

    let map = state
        .closed_hook_terminals
        .lock()
        .map_err(|_| "Failed to lock closed_hook_terminals".to_string())?;
    Ok(map.get(trimmed).copied())
}
