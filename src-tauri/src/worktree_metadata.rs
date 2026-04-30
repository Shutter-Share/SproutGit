use sea_orm::{ConnectionTrait, DbBackend, FromQueryResult, Statement};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::db::connect_workspace_db;
use crate::git::helpers::{
    normalize_existing_path, now_epoch_seconds, path_to_frontend, validate_no_control_chars,
};

#[derive(Serialize, FromQueryResult)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeProvenance {
    pub worktree_path: String,
    pub branch: String,
    pub source_ref: String,
    pub initiating_worktree_path: Option<String>,
    pub root_repo_path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, FromQueryResult)]
#[serde(rename_all = "camelCase")]
pub struct NestedRepoSyncRule {
    pub repo_relative_path: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NestedRepoSyncRuleInput {
    pub repo_relative_path: String,
    pub enabled: bool,
}

fn validate_relative_repo_path(path: &str) -> Result<String, String> {
    use std::path::Component;

    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Nested repo relative path is required".to_string());
    }

    validate_no_control_chars(trimmed, "Nested repo relative path")?;

    let normalized = trimmed.replace('\\', "/");
    let p = Path::new(&normalized);

    if p.is_absolute() {
        return Err("Nested repo path must be relative to a worktree".to_string());
    }

    for component in p.components() {
        match component {
            Component::CurDir
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => {
                return Err(
                    "Nested repo path must be a clean relative path inside the worktree"
                        .to_string(),
                )
            },
            Component::Normal(_) => {},
        }
    }

    if normalized.split('/').any(|segment| segment.is_empty()) {
        return Err("Nested repo path must not contain empty path segments".to_string());
    }

    Ok(normalized)
}

fn normalize_ref_value(value: &str, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} is required"));
    }

    validate_no_control_chars(trimmed, field_name)?;
    Ok(trimmed.to_string())
}

fn normalize_optional_existing_workspace_path(path: &str) -> Result<PathBuf, String> {
    normalize_existing_path(path)
}

pub async fn record_worktree_creation_provenance(
    workspace_path: &Path,
    root_repo_path: &Path,
    worktree_path: &Path,
    branch: &str,
    source_ref: &str,
    initiating_worktree_path: Option<&Path>,
) -> Result<(), String> {
    let conn = connect_workspace_db(&workspace_path.to_string_lossy()).await?;
    let normalized_branch = normalize_ref_value(branch, "Worktree branch")?;
    let normalized_source_ref = normalize_ref_value(source_ref, "Worktree source ref")?;
    let now = now_epoch_seconds() as i64;

    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "
        INSERT INTO worktree_provenance(
            worktree_path,
            branch,
            source_ref,
            initiating_worktree_path,
            root_repo_path,
            created_at,
            updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(worktree_path)
        DO UPDATE SET
            branch = excluded.branch,
            source_ref = excluded.source_ref,
            initiating_worktree_path = excluded.initiating_worktree_path,
            root_repo_path = excluded.root_repo_path,
            updated_at = excluded.updated_at
        ",
        vec![
            path_to_frontend(worktree_path).into(),
            normalized_branch.into(),
            normalized_source_ref.into(),
            initiating_worktree_path.map(path_to_frontend).into(),
            path_to_frontend(root_repo_path).into(),
            now.into(),
            now.into(),
        ],
    );

    conn.execute(statement)
        .await
        .map_err(|e| format!("Failed to persist worktree provenance: {e}"))?;

    Ok(())
}

pub async fn delete_worktree_provenance(
    workspace_path: &Path,
    worktree_path: &Path,
) -> Result<(), String> {
    let conn = connect_workspace_db(&workspace_path.to_string_lossy()).await?;
    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "DELETE FROM worktree_provenance WHERE worktree_path = ?",
        vec![path_to_frontend(worktree_path).into()],
    );

    conn.execute(statement)
        .await
        .map_err(|e| format!("Failed to delete worktree provenance: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn list_worktree_provenance(
    workspace_path: String,
) -> Result<Vec<WorktreeProvenance>, String> {
    let workspace = normalize_optional_existing_workspace_path(&workspace_path)?;
    let conn = connect_workspace_db(&workspace.to_string_lossy()).await?;

    let statement = Statement::from_string(
        DbBackend::Sqlite,
        "
        SELECT worktree_path, branch, source_ref, initiating_worktree_path, root_repo_path, created_at, updated_at
        FROM worktree_provenance
        ORDER BY updated_at DESC, worktree_path ASC
        "
        .to_string(),
    );

    conn.query_all(statement)
        .await
        .map_err(|e| format!("Failed to list worktree provenance: {e}"))?
        .iter()
        .map(|row| WorktreeProvenance::from_query_result(row, ""))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to parse worktree provenance: {e}"))
}

#[tauri::command]
pub async fn get_worktree_provenance(
    workspace_path: String,
    worktree_path: String,
) -> Result<Option<WorktreeProvenance>, String> {
    let workspace = normalize_optional_existing_workspace_path(&workspace_path)?;
    let worktree = normalize_existing_path(&worktree_path)?;
    let conn = connect_workspace_db(&workspace.to_string_lossy()).await?;

    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "
        SELECT worktree_path, branch, source_ref, initiating_worktree_path, root_repo_path, created_at, updated_at
        FROM worktree_provenance
        WHERE worktree_path = ?
        LIMIT 1
        ",
        vec![path_to_frontend(&worktree).into()],
    );

    let row = conn
        .query_one(statement)
        .await
        .map_err(|e| format!("Failed to get worktree provenance: {e}"))?;

    row.map(|value| WorktreeProvenance::from_query_result(&value, ""))
        .transpose()
        .map_err(|e| format!("Failed to parse worktree provenance: {e}"))
}

#[tauri::command]
pub async fn list_nested_repo_sync_rules(
    workspace_path: String,
) -> Result<Vec<NestedRepoSyncRule>, String> {
    let workspace = normalize_optional_existing_workspace_path(&workspace_path)?;
    let conn = connect_workspace_db(&workspace.to_string_lossy()).await?;

    let statement = Statement::from_string(
        DbBackend::Sqlite,
        "
        SELECT repo_relative_path, enabled, created_at, updated_at
        FROM nested_repo_sync_rules
        ORDER BY repo_relative_path ASC
        "
        .to_string(),
    );

    conn.query_all(statement)
        .await
        .map_err(|e| format!("Failed to list nested repo sync rules: {e}"))?
        .iter()
        .map(|row| NestedRepoSyncRule::from_query_result(row, ""))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to parse nested repo sync rules: {e}"))
}

#[tauri::command]
pub async fn upsert_nested_repo_sync_rule(
    workspace_path: String,
    input: NestedRepoSyncRuleInput,
) -> Result<NestedRepoSyncRule, String> {
    let workspace = normalize_optional_existing_workspace_path(&workspace_path)?;
    let conn = connect_workspace_db(&workspace.to_string_lossy()).await?;
    let path = validate_relative_repo_path(&input.repo_relative_path)?;
    let now = now_epoch_seconds() as i64;

    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "
        INSERT INTO nested_repo_sync_rules(repo_relative_path, enabled, created_at, updated_at)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(repo_relative_path)
        DO UPDATE SET
            enabled = excluded.enabled,
            updated_at = excluded.updated_at
        ",
        vec![
            path.clone().into(),
            (input.enabled as i64).into(),
            now.into(),
            now.into(),
        ],
    );

    conn.execute(statement)
        .await
        .map_err(|e| format!("Failed to upsert nested repo sync rule: {e}"))?;

    let select_statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "
        SELECT repo_relative_path, enabled, created_at, updated_at
        FROM nested_repo_sync_rules
        WHERE repo_relative_path = ?
        LIMIT 1
        ",
        vec![path.into()],
    );

    let row = conn
        .query_one(select_statement)
        .await
        .map_err(|e| format!("Failed to read nested repo sync rule: {e}"))?
        .ok_or_else(|| "Nested repo sync rule was not found after upsert".to_string())?;

    NestedRepoSyncRule::from_query_result(&row, "")
        .map_err(|e| format!("Failed to parse nested repo sync rule: {e}"))
}

#[tauri::command]
pub async fn delete_nested_repo_sync_rule(
    workspace_path: String,
    repo_relative_path: String,
) -> Result<(), String> {
    let workspace = normalize_optional_existing_workspace_path(&workspace_path)?;
    let conn = connect_workspace_db(&workspace.to_string_lossy()).await?;
    let path = validate_relative_repo_path(&repo_relative_path)?;

    let statement = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "DELETE FROM nested_repo_sync_rules WHERE repo_relative_path = ?",
        vec![path.into()],
    );

    conn.execute(statement)
        .await
        .map_err(|e| format!("Failed to delete nested repo sync rule: {e}"))?;

    Ok(())
}
