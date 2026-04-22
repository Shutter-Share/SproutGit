use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::VecDeque;
use std::fs;
use std::io::{BufReader, Read};
use std::process::Stdio;

use crate::db::initialize_workspace_db;
use crate::git::helpers::{
    ensure_directory, git_command, normalize_existing_path, normalize_or_create_dir,
    now_epoch_seconds, validate_repo_url, GitAction,
};
use crate::github::git_clone_auth_context;

fn write_project_marker(
    project_marker_path: &std::path::Path,
    workspace: &std::path::Path,
    root_path: &std::path::Path,
    worktrees_path: &std::path::Path,
    state_db_path: &std::path::Path,
) -> Result<(), String> {
    let marker = json!({
        "projectVersion": 1,
        "createdAt": now_epoch_seconds(),
        "workspacePath": workspace.to_string_lossy(),
        "rootPath": root_path.to_string_lossy(),
        "worktreesPath": worktrees_path.to_string_lossy(),
        "stateDbPath": state_db_path.to_string_lossy(),
    });

    let marker_pretty = serde_json::to_string_pretty(&marker)
        .map_err(|e| format!("Failed to serialize project marker: {e}"))?;
    fs::write(project_marker_path, marker_pretty)
        .map_err(|e| format!("Failed to write project marker: {e}"))
}

fn validate_clean_git_repo(repo_path: &std::path::Path) -> Result<(), String> {
    let repo_str = repo_path.to_string_lossy().to_string();

    let inside_output = git_command(
        GitAction::RevParse,
        &["-C", &repo_str, "rev-parse", "--is-inside-work-tree"],
    )
    .output()
    .map_err(|e| format!("Failed to inspect repository: {e}"))?;

    if !inside_output.status.success() {
        return Err("Selected path is not a Git working tree".to_string());
    }

    let status_output = git_command(
        GitAction::StatusPorcelain,
        &["-C", &repo_str, "status", "--porcelain"],
    )
    .output()
    .map_err(|e| format!("Failed to inspect repository status: {e}"))?;

    if !status_output.status.success() {
        let stderr = String::from_utf8_lossy(&status_output.stderr)
            .trim()
            .to_string();
        return Err(if stderr.is_empty() {
            "Failed to read repository status".to_string()
        } else {
            stderr
        });
    }

    if !String::from_utf8_lossy(&status_output.stdout)
        .trim()
        .is_empty()
    {
        return Err(
            "Repository has uncommitted changes. Commit or reset your working tree before import."
                .to_string(),
        );
    }

    Ok(())
}

fn is_git_error_line(line: &str) -> bool {
    line.get(..6).is_some_and(|prefix| {
        prefix.eq_ignore_ascii_case("fatal:") || prefix.eq_ignore_ascii_case("error:")
    })
}

// ── Structs ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInitResult {
    pub workspace_path: String,
    pub root_path: String,
    pub worktrees_path: String,
    pub metadata_path: String,
    pub state_db_path: String,
    pub cloned: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatus {
    pub workspace_path: String,
    pub root_path: String,
    pub worktrees_path: String,
    pub metadata_path: String,
    pub state_db_path: String,
    pub is_sproutgit_project: bool,
    pub root_exists: bool,
    pub worktrees_exists: bool,
    pub metadata_exists: bool,
    pub state_db_exists: bool,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportRepoMode {
    InPlace,
    Move,
    Copy,
}

fn finalize_workspace(
    workspace: &std::path::Path,
    root_path: &std::path::Path,
    worktrees_path: &std::path::Path,
    metadata_path: &std::path::Path,
    state_db_path: &std::path::Path,
    cloned: bool,
) -> Result<WorkspaceInitResult, String> {
    let project_marker_path = metadata_path.join("project.json");

    if !project_marker_path.exists() {
        write_project_marker(
            &project_marker_path,
            workspace,
            root_path,
            worktrees_path,
            state_db_path,
        )?;
    }

    Ok(WorkspaceInitResult {
        workspace_path: workspace.to_string_lossy().to_string(),
        root_path: root_path.to_string_lossy().to_string(),
        worktrees_path: worktrees_path.to_string_lossy().to_string(),
        metadata_path: metadata_path.to_string_lossy().to_string(),
        state_db_path: state_db_path.to_string_lossy().to_string(),
        cloned,
    })
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    ensure_directory(dst)?;

    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read source directory: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read source entry: {e}"))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let ft = entry
            .file_type()
            .map_err(|e| format!("Failed to read file type: {e}"))?;

        if ft.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if ft.is_file() {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy file '{}': {e}", src_path.display()))?;
        } else if ft.is_symlink() {
            return Err(format!(
                "Import does not support symbolic links: {}",
                src_path.display()
            ));
        }
    }

    Ok(())
}

fn import_repo_with_mode(
    workspace: &std::path::Path,
    source_repo: &std::path::Path,
    mode: ImportRepoMode,
) -> Result<(), String> {
    let root_path = workspace.join("root");
    let worktrees_path = workspace.join("worktrees");
    let metadata_path = workspace.join(".sproutgit");

    ensure_directory(&root_path)?;
    ensure_directory(&worktrees_path)?;
    ensure_directory(&metadata_path)?;

    let root_has_content = fs::read_dir(&root_path)
        .map_err(|e| format!("Failed to inspect root directory: {e}"))?
        .next()
        .is_some();

    if root_has_content {
        return Err("Cannot import into root/: directory is not empty".to_string());
    }

    match mode {
        ImportRepoMode::Copy => {
            let source_repo_string = source_repo.to_string_lossy().to_string();
            let root_path_string = root_path.to_string_lossy().to_string();
            let clone_output = git_command(
                GitAction::Clone,
                &[
                    "clone",
                    "--no-hardlinks",
                    "--",
                    &source_repo_string,
                    &root_path_string,
                ],
            )
            .output()
            .map_err(|e| format!("Failed to import repository: {e}"))?;

            if !clone_output.status.success() {
                let stderr = String::from_utf8_lossy(&clone_output.stderr)
                    .trim()
                    .to_string();
                return Err(if stderr.is_empty() {
                    "Failed to import repository".to_string()
                } else {
                    stderr
                });
            }
        },
        ImportRepoMode::Move => {
            fs::remove_dir(&root_path)
                .map_err(|e| format!("Failed to prepare root directory for move import: {e}"))?;

            match fs::rename(source_repo, &root_path) {
                Ok(_) => {},
                Err(_) => {
                    copy_dir_recursive(source_repo, &root_path)?;
                    fs::remove_dir_all(source_repo).map_err(|e| {
                        format!("Failed to remove source repository after copy fallback: {e}")
                    })?;
                },
            }
        },
        ImportRepoMode::InPlace => {
            let reserved = ["root", "worktrees", ".sproutgit"];
            let entries = fs::read_dir(workspace)
                .map_err(|e| format!("Failed to inspect repository directory: {e}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to inspect repository entry: {e}"))?;

            let collisions = entries
                .iter()
                .filter_map(|entry| {
                    let name = entry.file_name();
                    let name_str = name.to_string_lossy();
                    reserved
                        .iter()
                        .any(|reserved_name| *reserved_name == name_str)
                        .then(|| name_str.into_owned())
                })
                .collect::<Vec<_>>();

            if !collisions.is_empty() {
                return Err(format!(
                    "Cannot import repository in place: repository contains reserved workspace path(s): {}",
                    collisions.join(", ")
                ));
            }

            for entry in entries {
                let name = entry.file_name();

                let from = entry.path();
                let to = root_path.join(name);
                fs::rename(&from, &to).map_err(|e| {
                    format!(
                        "Failed to move '{}' into workspace root: {e}",
                        from.display()
                    )
                })?;
            }
        },
    }

    Ok(())
}

// ── Commands ──

#[tauri::command]
pub async fn create_sproutgit_workspace(
    app_handle: tauri::AppHandle,
    workspace_path: String,
    repo_url: Option<String>,
) -> Result<WorkspaceInitResult, String> {
    let workspace = normalize_or_create_dir(&workspace_path)?;
    let root_path = workspace.join("root");
    let worktrees_path = workspace.join("worktrees");
    let metadata_path = workspace.join(".sproutgit");
    let state_db_path = metadata_path.join("state.db");
    let project_marker_path = metadata_path.join("project.json");

    ensure_directory(&root_path)?;
    ensure_directory(&worktrees_path)?;
    ensure_directory(&metadata_path)?;

    initialize_workspace_db(&workspace).await?;

    if !project_marker_path.exists() {
        write_project_marker(
            &project_marker_path,
            &workspace,
            &root_path,
            &worktrees_path,
            &state_db_path,
        )?;
    }

    let repo_url = repo_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from);

    let mut cloned = false;

    if let Some(url) = repo_url {
        let url = validate_repo_url(&url)?;
        let root_has_content = fs::read_dir(&root_path)
            .map_err(|e| format!("Failed to inspect root directory: {e}"))?
            .next()
            .is_some();

        if root_has_content {
            return Err("Cannot clone into root/: directory is not empty".to_string());
        }

        use tauri::Emitter;

        let _ = app_handle.emit("clone-progress", "Connecting...");

        let root_path_string = root_path.to_string_lossy().to_string();
        let clone_auth = git_clone_auth_context()?;

        let mut clone_command = git_command(
            GitAction::Clone,
            &["clone", "--progress", &url, &root_path_string],
        );
        clone_command.stdout(Stdio::piped());
        clone_command.stderr(Stdio::piped());

        if let Some(auth) = clone_auth.as_ref() {
            clone_command.envs(auth.envs.iter().map(|(key, value)| (key, value)));
        }

        let mut child = clone_command
            .spawn()
            .map_err(|e| format!("Failed to run git clone: {e}"))?;

        const MAX_STDERR_LINES: usize = 100;
        let mut stderr_lines: VecDeque<String> = VecDeque::with_capacity(MAX_STDERR_LINES);
        let mut latest_error_line: Option<String> = None;
        if let Some(stderr) = child.stderr.take() {
            let reader = BufReader::new(stderr);
            let mut line_buf = String::new();
            for byte in reader.bytes() {
                match byte {
                    Ok(b'\r') | Ok(b'\n') => {
                        let trimmed = line_buf.trim().to_string();
                        if !trimmed.is_empty() {
                            let _ = app_handle.emit("clone-progress", &trimmed);
                            if is_git_error_line(&trimmed) {
                                latest_error_line = Some(trimmed.clone());
                            }
                            if stderr_lines.len() == MAX_STDERR_LINES {
                                stderr_lines.pop_front();
                            }
                            stderr_lines.push_back(trimmed);
                        }
                        line_buf.clear();
                    },
                    Ok(b) => line_buf.push(b as char),
                    Err(_) => break,
                }
            }
            let trimmed = line_buf.trim().to_string();
            if !trimmed.is_empty() {
                let _ = app_handle.emit("clone-progress", &trimmed);
                if is_git_error_line(&trimmed) {
                    latest_error_line = Some(trimmed.clone());
                }
                if stderr_lines.len() == MAX_STDERR_LINES {
                    stderr_lines.pop_front();
                }
                stderr_lines.push_back(trimmed);
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for git clone: {e}"))?;

        if !status.success() {
            let _ = app_handle.emit("clone-progress", "Clone failed");
            // Find the most relevant error line from git's stderr output.
            // Git prefixes errors with "fatal:" or "error:"; prefer those.
            let error_detail = latest_error_line.or_else(|| stderr_lines.back().cloned());
            let msg = match error_detail {
                Some(detail) => {
                    // Provide a friendlier hint for authentication failures.
                    if detail.to_lowercase().contains("authentication")
                        || detail.to_lowercase().contains("could not read username")
                        || detail.to_lowercase().contains("repository not found")
                    {
                        format!(
                            "Authentication failed — check your credentials or repo URL. ({})",
                            detail
                        )
                    } else {
                        format!("git clone failed: {}", detail)
                    }
                },
                None => "git clone failed".to_string(),
            };
            return Err(msg);
        }

        let _ = app_handle.emit("clone-progress", "Done");
        cloned = true;
    } else if !root_path.join(".git").exists() {
        let root_path_string = root_path.to_string_lossy().to_string();
        let init_output = git_command(GitAction::Init, &["-C", &root_path_string, "init"])
            .output()
            .map_err(|e| format!("Failed to initialize git repository: {e}"))?;

        if !init_output.status.success() {
            let stderr = String::from_utf8_lossy(&init_output.stderr)
                .trim()
                .to_string();
            if stderr.is_empty() {
                return Err("git init failed".to_string());
            }
            return Err(stderr);
        }
    }

    Ok(WorkspaceInitResult {
        workspace_path: workspace.to_string_lossy().to_string(),
        root_path: root_path.to_string_lossy().to_string(),
        worktrees_path: worktrees_path.to_string_lossy().to_string(),
        metadata_path: metadata_path.to_string_lossy().to_string(),
        state_db_path: state_db_path.to_string_lossy().to_string(),
        cloned,
    })
}

#[tauri::command]
pub async fn import_git_repo_workspace(
    workspace_path: String,
    source_repo_path: String,
) -> Result<WorkspaceInitResult, String> {
    import_git_repo_workspace_with_mode(
        Some(workspace_path),
        source_repo_path,
        ImportRepoMode::Copy,
    )
    .await
}

#[tauri::command]
pub async fn import_git_repo_workspace_with_mode(
    workspace_path: Option<String>,
    source_repo_path: String,
    mode: ImportRepoMode,
) -> Result<WorkspaceInitResult, String> {
    let source_repo = normalize_existing_path(&source_repo_path)?;
    validate_clean_git_repo(&source_repo)?;

    let workspace = match mode {
        ImportRepoMode::InPlace => source_repo.clone(),
        ImportRepoMode::Move | ImportRepoMode::Copy => {
            let Some(path) = workspace_path
                .as_deref()
                .map(str::trim)
                .filter(|p| !p.is_empty())
            else {
                return Err("Workspace path is required for move/copy import modes".to_string());
            };
            normalize_or_create_dir(path)?
        },
    };

    if matches!(mode, ImportRepoMode::Move | ImportRepoMode::Copy) && workspace == source_repo {
        return Err(
            "Workspace path must differ from repository path for move/copy modes".to_string(),
        );
    }

    let root_path = workspace.join("root");
    let worktrees_path = workspace.join("worktrees");
    let metadata_path = workspace.join(".sproutgit");
    let state_db_path = metadata_path.join("state.db");

    import_repo_with_mode(&workspace, &source_repo, mode)?;

    initialize_workspace_db(&workspace).await?;

    finalize_workspace(
        &workspace,
        &root_path,
        &worktrees_path,
        &metadata_path,
        &state_db_path,
        matches!(mode, ImportRepoMode::Copy),
    )
}

#[tauri::command]
pub async fn inspect_sproutgit_workspace(
    workspace_path: String,
) -> Result<WorkspaceStatus, String> {
    let workspace = normalize_existing_path(&workspace_path)?;

    let root_path = workspace.join("root");
    let worktrees_path = workspace.join("worktrees");
    let metadata_path = workspace.join(".sproutgit");
    let state_db_path = metadata_path.join("state.db");
    let project_marker_path = metadata_path.join("project.json");

    let root_exists = root_path.exists();
    let worktrees_exists = worktrees_path.exists();
    let metadata_exists = metadata_path.exists();
    let project_marker_exists = project_marker_path.exists();
    let layout_exists = root_exists && worktrees_exists && metadata_exists;

    if layout_exists {
        // Backfill state DB for projects created before workspace DB became required.
        if !state_db_path.exists() {
            initialize_workspace_db(&workspace).await?;
        }

        // Backfill marker for legacy projects while preserving existing paths.
        if !project_marker_exists {
            write_project_marker(
                &project_marker_path,
                &workspace,
                &root_path,
                &worktrees_path,
                &state_db_path,
            )?;
        }
    }

    Ok(WorkspaceStatus {
        workspace_path: workspace.to_string_lossy().to_string(),
        root_path: root_path.to_string_lossy().to_string(),
        worktrees_path: worktrees_path.to_string_lossy().to_string(),
        metadata_path: metadata_path.to_string_lossy().to_string(),
        state_db_path: state_db_path.to_string_lossy().to_string(),
        is_sproutgit_project: project_marker_path.exists() || layout_exists,
        root_exists,
        worktrees_exists,
        metadata_exists,
        state_db_exists: state_db_path.exists(),
    })
}
