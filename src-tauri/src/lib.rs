use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::json;
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{MenuBuilder, SubmenuBuilder};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitInfo {
    installed: bool,
    version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeInfo {
    path: String,
    head: Option<String>,
    branch: Option<String>,
    detached: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeListResult {
    repo_path: String,
    worktrees: Vec<WorktreeInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceInitResult {
    workspace_path: String,
    root_path: String,
    worktrees_path: String,
    metadata_path: String,
    state_db_path: String,
    cloned: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceStatus {
    workspace_path: String,
    root_path: String,
    worktrees_path: String,
    metadata_path: String,
    state_db_path: String,
    is_sproutgit_project: bool,
    root_exists: bool,
    worktrees_exists: bool,
    metadata_exists: bool,
    state_db_exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RefInfo {
    name: String,
    full_name: String,
    kind: String,
    target: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RefsResult {
    repo_path: String,
    refs: Vec<RefInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitGraphResult {
    repo_path: String,
    commits: Vec<CommitEntry>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CommitEntry {
    hash: String,
    short_hash: String,
    parents: Vec<String>,
    author_name: String,
    author_date: String,
    subject: String,
    refs: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateWorktreeResult {
    worktree_path: String,
    branch: String,
    from_ref: String,
}

#[tauri::command]
async fn git_info() -> GitInfo {
    match Command::new("git").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            GitInfo {
                installed: true,
                version: Some(version),
            }
        }
        _ => GitInfo {
            installed: false,
            version: None,
        },
    }
}

fn normalize_existing_path(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Repository path is required".to_string());
    }

    let path = Path::new(trimmed);
    if !path.exists() {
        return Err("Repository path does not exist".to_string());
    }

    if !path.is_dir() {
        return Err("Repository path must be a directory".to_string());
    }

    path.canonicalize()
        .map_err(|_| "Failed to resolve repository path".to_string())
}

fn normalize_or_create_dir(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Workspace path is required".to_string());
    }

    let path = Path::new(trimmed);
    if path.exists() {
        if !path.is_dir() {
            return Err("Workspace path must be a directory".to_string());
        }
    } else {
        fs::create_dir_all(path).map_err(|e| format!("Failed to create workspace directory: {e}"))?;
    }

    path.canonicalize()
        .map_err(|_| "Failed to resolve workspace path".to_string())
}

fn now_epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn initialize_state_db(state_db_path: &Path) -> Result<(), String> {
    let conn = Connection::open(state_db_path)
        .map_err(|e| format!("Failed to open workspace state database: {e}"))?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recent_repositories (
            repo_path TEXT PRIMARY KEY,
            last_opened_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS worktree_sessions (
            worktree_path TEXT PRIMARY KEY,
            last_branch TEXT,
            last_opened_at INTEGER NOT NULL
        );
        ",
    )
    .map_err(|e| format!("Failed to initialize workspace schema: {e}"))?;

    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES(?1, ?2)",
        params!["schema_version", "1"],
    )
    .map_err(|e| format!("Failed to write schema metadata: {e}"))?;

    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES(?1, ?2)",
        params!["updated_at", now_epoch_seconds().to_string()],
    )
    .map_err(|e| format!("Failed to write update metadata: {e}"))?;

    Ok(())
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    if path.exists() {
        if !path.is_dir() {
            return Err(format!("Expected directory but found file: {}", path.display()));
        }
        return Ok(());
    }

    fs::create_dir_all(path).map_err(|e| format!("Failed to create directory {}: {e}", path.display()))
}

fn run_git(args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git command: {e}"))
}

fn ensure_git_success(output: std::process::Output, fallback_message: &str) -> Result<std::process::Output, String> {
    if output.status.success() {
        return Ok(output);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        return Err(fallback_message.to_string());
    }
    Err(stderr)
}

fn slugify_for_path(name: &str) -> String {
    let mut output = String::with_capacity(name.len());
    let mut previous_dash = false;

    for ch in name.chars() {
        let is_word = ch.is_ascii_alphanumeric() || ch == '_' || ch == '-';
        if is_word {
            output.push(ch.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash {
            output.push('-');
            previous_dash = true;
        }
    }

    output.trim_matches('-').to_string()
}

#[tauri::command]
async fn create_sproutgit_workspace(
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

    initialize_state_db(&state_db_path)?;

    if !project_marker_path.exists() {
        let marker = json!({
            "projectVersion": 1,
            "createdAt": now_epoch_seconds(),
            "workspacePath": workspace.to_string_lossy(),
            "rootPath": root_path.to_string_lossy(),
            "worktreesPath": worktrees_path.to_string_lossy(),
            "stateDbPath": state_db_path.to_string_lossy(),
        });

        let marker_pretty =
            serde_json::to_string_pretty(&marker).map_err(|e| format!("Failed to serialize project marker: {e}"))?;
        fs::write(&project_marker_path, marker_pretty)
            .map_err(|e| format!("Failed to write project marker: {e}"))?;
    }

    let repo_url = repo_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from);

    let mut cloned = false;

    if let Some(url) = repo_url {
        let root_has_content = fs::read_dir(&root_path)
            .map_err(|e| format!("Failed to inspect root directory: {e}"))?
            .next()
            .is_some();

        if root_has_content {
            return Err("Cannot clone into root/: directory is not empty".to_string());
        }

        use tauri::Emitter;

        let _ = app_handle.emit("clone-progress", "Connecting...");

        let mut child = Command::new("git")
            .arg("clone")
            .arg("--progress")
            .arg(&url)
            .arg(&root_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run git clone: {e}"))?;

        // git clone writes progress to stderr using \r for in-place updates
        if let Some(stderr) = child.stderr.take() {
            let reader = BufReader::new(stderr);
            let mut line_buf = String::new();
            for byte in reader.bytes() {
                match byte {
                    Ok(b'\r') | Ok(b'\n') => {
                        let trimmed = line_buf.trim().to_string();
                        if !trimmed.is_empty() {
                            let _ = app_handle.emit("clone-progress", &trimmed);
                        }
                        line_buf.clear();
                    }
                    Ok(b) => line_buf.push(b as char),
                    Err(_) => break,
                }
            }
            // Flush remaining
            let trimmed = line_buf.trim().to_string();
            if !trimmed.is_empty() {
                let _ = app_handle.emit("clone-progress", &trimmed);
            }
        }

        let status = child.wait().map_err(|e| format!("Failed to wait for git clone: {e}"))?;

        if !status.success() {
            let _ = app_handle.emit("clone-progress", "Clone failed");
            return Err("git clone failed".to_string());
        }

        let _ = app_handle.emit("clone-progress", "Done");
        cloned = true;
    } else if !root_path.join(".git").exists() {
        let init_output = Command::new("git")
            .arg("-C")
            .arg(&root_path)
            .arg("init")
            .output()
            .map_err(|e| format!("Failed to initialize git repository: {e}"))?;

        if !init_output.status.success() {
            let stderr = String::from_utf8_lossy(&init_output.stderr).trim().to_string();
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
async fn inspect_sproutgit_workspace(workspace_path: String) -> Result<WorkspaceStatus, String> {
    let workspace = normalize_existing_path(&workspace_path)?;

    let root_path = workspace.join("root");
    let worktrees_path = workspace.join("worktrees");
    let metadata_path = workspace.join(".sproutgit");
    let state_db_path = metadata_path.join("state.db");
    let project_marker_path = metadata_path.join("project.json");

    Ok(WorkspaceStatus {
        workspace_path: workspace.to_string_lossy().to_string(),
        root_path: root_path.to_string_lossy().to_string(),
        worktrees_path: worktrees_path.to_string_lossy().to_string(),
        metadata_path: metadata_path.to_string_lossy().to_string(),
        state_db_path: state_db_path.to_string_lossy().to_string(),
        is_sproutgit_project: project_marker_path.exists(),
        root_exists: root_path.exists(),
        worktrees_exists: worktrees_path.exists(),
        metadata_exists: metadata_path.exists(),
        state_db_exists: state_db_path.exists(),
    })
}

#[tauri::command]
async fn list_worktrees(repo_path: String) -> Result<WorktreeListResult, String> {
    let canonical = normalize_existing_path(&repo_path)?;

    let output = Command::new("git")
        .arg("-C")
        .arg(&canonical)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .output()
        .map_err(|e| format!("Failed to run git worktree list: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("Path is not a Git repository".to_string());
        }
        return Err(stderr);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut worktrees: Vec<WorktreeInfo> = Vec::new();
    let mut current: Option<WorktreeInfo> = None;

    for line in stdout.lines() {
        if line.trim().is_empty() {
            if let Some(item) = current.take() {
                worktrees.push(item);
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("worktree ") {
            if let Some(item) = current.take() {
                worktrees.push(item);
            }
            current = Some(WorktreeInfo {
                path: rest.to_string(),
                head: None,
                branch: None,
                detached: false,
            });
            continue;
        }

        if let Some(item) = current.as_mut() {
            if let Some(rest) = line.strip_prefix("HEAD ") {
                item.head = Some(rest.to_string());
            } else if let Some(rest) = line.strip_prefix("branch ") {
                item.branch = Some(rest.replace("refs/heads/", ""));
            } else if line == "detached" {
                item.detached = true;
            }
        }
    }

    if let Some(item) = current.take() {
        worktrees.push(item);
    }

    Ok(WorktreeListResult {
        repo_path: canonical.to_string_lossy().to_string(),
        worktrees,
    })
}

#[tauri::command]
async fn list_refs(repo_path: String) -> Result<RefsResult, String> {
    let canonical = normalize_existing_path(&repo_path)?;

    let output = run_git(&[
        "-C",
        &canonical.to_string_lossy(),
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname)|%(refname:short)|%(objectname)",
        "refs/heads",
        "refs/tags",
    ])?;

    let output = ensure_git_success(output, "Failed to list refs")?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let refs = stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('|');
            let full_name = parts.next()?.to_string();
            let short_name = parts.next()?.to_string();
            let target = parts.next()?.to_string();

            let kind = if full_name.starts_with("refs/heads/") {
                "branch"
            } else {
                "tag"
            };

            Some(RefInfo {
                name: short_name,
                full_name,
                kind: kind.to_string(),
                target,
            })
        })
        .collect();

    Ok(RefsResult {
        repo_path: canonical.to_string_lossy().to_string(),
        refs,
    })
}

#[tauri::command]
async fn get_commit_graph(repo_path: String, limit: Option<usize>) -> Result<CommitGraphResult, String> {
    let canonical = normalize_existing_path(&repo_path)?;
    let max = limit.unwrap_or(120).clamp(20, 400).to_string();

    // Use a delimiter that won't appear in commit data
    let sep = "\x1e";
    let format_str = ["%H", "%h", "%P", "%an", "%ar", "%s", "%D"].join(sep);

    let output = run_git(&[
        "-C",
        &canonical.to_string_lossy(),
        "log",
        "--all",
        "--topo-order",
        &format!("--format={format_str}"),
        "-n",
        &max,
    ])?;

    let output = ensure_git_success(output, "Failed to read commit history")?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let commits: Vec<CommitEntry> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split(sep).collect();
            if parts.len() < 7 {
                return None;
            }

            let refs_list: Vec<String> = if parts[6].is_empty() {
                vec![]
            } else {
                parts[6]
                    .split(", ")
                    .map(|r| r.trim().to_string())
                    .collect()
            };

            Some(CommitEntry {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                parents: if parts[2].is_empty() {
                    vec![]
                } else {
                    parts[2].split(' ').map(|p| p.to_string()).collect()
                },
                author_name: parts[3].to_string(),
                author_date: parts[4].to_string(),
                subject: parts[5].to_string(),
                refs: refs_list,
            })
        })
        .collect();

    Ok(CommitGraphResult {
        repo_path: canonical.to_string_lossy().to_string(),
        commits,
    })
}

#[tauri::command]
async fn create_managed_worktree(
    root_repo_path: String,
    managed_worktrees_path: String,
    from_ref: String,
    new_branch: String,
) -> Result<CreateWorktreeResult, String> {
    let root_repo = normalize_existing_path(&root_repo_path)?;
    let worktrees_dir = normalize_existing_path(&managed_worktrees_path)?;

    let branch = new_branch.trim();
    if branch.is_empty() {
        return Err("New branch is required".to_string());
    }

    let ref_name = from_ref.trim();
    if ref_name.is_empty() {
        return Err("Source ref is required".to_string());
    }

    let slug = slugify_for_path(branch);
    if slug.is_empty() {
        return Err("Branch name must include letters or numbers".to_string());
    }

    let target_worktree = worktrees_dir.join(slug);
    if target_worktree.exists() {
        return Err(format!(
            "Managed worktree path already exists: {}",
            target_worktree.display()
        ));
    }

    let output = run_git(&[
        "-C",
        &root_repo.to_string_lossy(),
        "worktree",
        "add",
        "-b",
        branch,
        &target_worktree.to_string_lossy(),
        ref_name,
    ])?;

    ensure_git_success(output, "Failed to create managed worktree")?;

    Ok(CreateWorktreeResult {
        worktree_path: target_worktree.to_string_lossy().to_string(),
        branch: branch.to_string(),
        from_ref: ref_name.to_string(),
    })
}

#[tauri::command]
async fn delete_managed_worktree(
    root_repo_path: String,
    worktree_path: String,
    delete_branch: bool,
) -> Result<String, String> {
    let root_repo = normalize_existing_path(&root_repo_path)?;
    let wt_path = normalize_existing_path(&worktree_path)?;

    // Remove the worktree via git
    let output = run_git(&[
        "-C",
        &root_repo.to_string_lossy(),
        "worktree",
        "remove",
        &wt_path.to_string_lossy(),
        "--force",
    ])?;
    ensure_git_success(output, "Failed to remove worktree")?;

    // Optionally delete the branch
    if delete_branch {
        // Determine branch name from the worktree path
        // We try to delete by querying the branch list, but the caller can also pass it
        // For safety, we just prune and let git handle it
        let output = run_git(&[
            "-C",
            &root_repo.to_string_lossy(),
            "worktree",
            "prune",
        ])?;
        let _ = ensure_git_success(output, "Failed to prune worktrees");
    }

    Ok(wt_path.to_string_lossy().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckoutResult {
    worktree_path: String,
    previous_branch: Option<String>,
    new_branch: String,
    stashed: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DiffFileEntry {
    path: String,
    status: String, // "A", "M", "D", "R", "C", "T"
    old_path: Option<String>, // for renames
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiffFilesResult {
    commit: String,
    base: Option<String>,
    files: Vec<DiffFileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiffContentResult {
    commit: String,
    base: Option<String>,
    file_path: Option<String>,
    diff: String,
}

#[tauri::command]
async fn get_diff_files(
    repo_path: String,
    commit: String,
    base: Option<String>,
) -> Result<DiffFilesResult, String> {
    let rp = normalize_existing_path(&repo_path)?;
    let rp_str = rp.to_string_lossy();
    let commit_trimmed = commit.trim();
    if commit_trimmed.is_empty() {
        return Err("Commit hash is required".to_string());
    }

    let output = match &base {
        Some(b) => {
            let range = format!("{}..{}", b.trim(), commit_trimmed);
            run_git(&["-C", &rp_str, "diff", "--name-status", "--no-renames", &range])?
        }
        None => {
            // Single commit: diff against parent(s)
            run_git(&[
                "-C",
                &rp_str,
                "diff-tree",
                "--no-commit-id",
                "-r",
                "--name-status",
                "--no-renames",
                commit_trimmed,
            ])?
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut files: Vec<DiffFileEntry> = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Format: "M\tpath" or "R100\told\tnew"
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() >= 2 {
            let status_raw = parts[0];
            let status = status_raw.chars().next().unwrap_or('M').to_string();
            let path = parts[1].to_string();
            let old_path = if status == "R" || status == "C" {
                Some(path.clone())
            } else {
                None
            };
            let final_path = if (status == "R" || status == "C") && parts.len() >= 3 {
                parts[2].to_string()
            } else {
                path
            };
            files.push(DiffFileEntry {
                path: final_path,
                status,
                old_path,
            });
        }
    }

    Ok(DiffFilesResult {
        commit: commit_trimmed.to_string(),
        base: base.map(|b| b.trim().to_string()),
        files,
    })
}

#[tauri::command]
async fn get_diff_content(
    repo_path: String,
    commit: String,
    base: Option<String>,
    file_path: Option<String>,
) -> Result<DiffContentResult, String> {
    let rp = normalize_existing_path(&repo_path)?;
    let rp_str = rp.to_string_lossy();
    let commit_trimmed = commit.trim();
    if commit_trimmed.is_empty() {
        return Err("Commit hash is required".to_string());
    }

    let mut args: Vec<String> = vec![
        "-C".to_string(),
        rp_str.to_string(),
    ];

    match &base {
        Some(b) => {
            let range = format!("{}..{}", b.trim(), commit_trimmed);
            args.extend_from_slice(&[
                "diff".to_string(),
                range,
            ]);
        }
        None => {
            // Show diff for a single commit against its parent
            args.extend_from_slice(&[
                "diff-tree".to_string(),
                "-p".to_string(),
                commit_trimmed.to_string(),
            ]);
        }
    };

    if let Some(fp) = &file_path {
        args.push("--".to_string());
        args.push(fp.clone());
    }

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_git(&arg_refs)?;

    let diff = String::from_utf8_lossy(&output.stdout).to_string();

    Ok(DiffContentResult {
        commit: commit_trimmed.to_string(),
        base: base.map(|b| b.trim().to_string()),
        file_path,
        diff,
    })
}

#[tauri::command]
async fn checkout_worktree(
    worktree_path: String,
    target_ref: String,
    auto_stash: bool,
) -> Result<CheckoutResult, String> {
    let wt_path = normalize_existing_path(&worktree_path)?;
    let wt_str = wt_path.to_string_lossy();
    let target = target_ref.trim();
    if target.is_empty() {
        return Err("Target ref is required".to_string());
    }

    // Get current branch before checkout
    let current_output = run_git(&["-C", &wt_str, "rev-parse", "--abbrev-ref", "HEAD"])?;
    let previous_branch = if current_output.status.success() {
        let b = String::from_utf8_lossy(&current_output.stdout).trim().to_string();
        if b == "HEAD" { None } else { Some(b) }
    } else {
        None
    };

    // Check for uncommitted changes
    let status_output = run_git(&["-C", &wt_str, "status", "--porcelain"])?;
    let has_changes = if status_output.status.success() {
        !String::from_utf8_lossy(&status_output.stdout).trim().is_empty()
    } else {
        false
    };

    let mut stashed = false;

    if has_changes {
        if !auto_stash {
            return Err("Worktree has uncommitted changes. Enable auto-stash or commit/discard them first.".to_string());
        }
        // Stash changes
        let stash_output = run_git(&["-C", &wt_str, "stash", "push", "-m", "sproutgit-auto-stash"])?;
        ensure_git_success(stash_output, "Failed to stash changes")?;
        stashed = true;
    }

    // Perform checkout
    let checkout_output = run_git(&["-C", &wt_str, "checkout", target])?;
    if !checkout_output.status.success() {
        // If checkout failed and we stashed, pop the stash back
        if stashed {
            let _ = run_git(&["-C", &wt_str, "stash", "pop"]);
        }
        let stderr = String::from_utf8_lossy(&checkout_output.stderr).trim().to_string();
        return Err(if stderr.is_empty() { "Checkout failed".to_string() } else { stderr });
    }

    // If we stashed, pop it back on the new branch
    if stashed {
        let pop_output = run_git(&["-C", &wt_str, "stash", "pop"])?;
        if !pop_output.status.success() {
            // Stash pop conflict — leave stash in place, warn the user
            return Ok(CheckoutResult {
                worktree_path: wt_str.to_string(),
                previous_branch,
                new_branch: target.to_string(),
                stashed: true,
            });
        }
    }

    Ok(CheckoutResult {
        worktree_path: wt_str.to_string(),
        previous_branch,
        new_branch: target.to_string(),
        stashed,
    })
}

#[tauri::command]
async fn reset_worktree_branch(
    worktree_path: String,
    target_ref: String,
    mode: String,
) -> Result<String, String> {
    let wt_path = normalize_existing_path(&worktree_path)?;
    let wt_str = wt_path.to_string_lossy();
    let target = target_ref.trim();
    if target.is_empty() {
        return Err("Target ref is required".to_string());
    }

    let reset_mode = match mode.as_str() {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => return Err(format!("Invalid reset mode: {mode}. Use soft, mixed, or hard.")),
    };

    let output = run_git(&["-C", &wt_str, "reset", reset_mode, target])?;
    ensure_git_success(output, "Failed to reset branch")?;

    Ok(format!("Reset to {target} ({mode})"))
}

#[tauri::command]
async fn open_in_editor(worktree_path: String) -> Result<String, String> {
    let wt_path = normalize_existing_path(&worktree_path)?;
    let wt_str = wt_path.to_string_lossy().to_string();

    // Try GIT_EDITOR, then core.editor config, then VISUAL, then EDITOR, then common defaults
    let editor = std::env::var("GIT_EDITOR")
        .ok()
        .or_else(|| {
            run_git(&["config", "core.editor"])
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .or_else(|| std::env::var("VISUAL").ok())
        .or_else(|| std::env::var("EDITOR").ok())
        .unwrap_or_else(|| {
            // Platform-specific defaults
            if cfg!(target_os = "macos") {
                "open -a TextEdit".to_string()
            } else if cfg!(target_os = "windows") {
                "notepad".to_string()
            } else {
                "xdg-open".to_string()
            }
        });

    // Split the editor command to handle things like "code --wait" or "vim"
    let parts: Vec<&str> = editor.split_whitespace().collect();
    if parts.is_empty() {
        return Err("No editor configured".to_string());
    }

    let mut cmd = Command::new(parts[0]);
    for arg in &parts[1..] {
        // Skip --wait flag since we don't want to block
        if *arg != "--wait" && *arg != "-w" {
            cmd.arg(arg);
        }
    }
    cmd.arg(&wt_str);

    cmd.spawn()
        .map_err(|e| format!("Failed to open editor '{}': {e}", parts[0]))?;

    Ok(editor)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Build a custom menu without Undo/Redo
            let app_submenu = SubmenuBuilder::new(app, "SproutGit")
                .about(None)
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let window_submenu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .item(&window_submenu)
                .build()?;

            app.set_menu(menu)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            git_info,
            list_worktrees,
            list_refs,
            get_commit_graph,
            get_diff_files,
            get_diff_content,
            create_managed_worktree,
            delete_managed_worktree,
            checkout_worktree,
            reset_worktree_branch,
            open_in_editor,
            create_sproutgit_workspace,
            inspect_sproutgit_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
