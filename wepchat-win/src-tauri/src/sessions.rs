//! Session workspace on disk: `{workspaceRoot}/{sessionId}/session.json`
//! Each session owns its directory (workspace root for future tools).

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::settings::{AppSettings, SettingsStore};

pub fn workspace_root(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = SettingsStore::load(app)?;
    let root = SettingsStore::resolve_workspace_root(app, &settings)?;
    let path = PathBuf::from(root);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

pub fn valid_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
}

pub fn session_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_session_id(id) {
        return Err("会话 ID 无效".into());
    }
    Ok(root.join(id))
}

pub fn session_file(root: &Path, id: &str) -> Result<PathBuf, String> {
    Ok(session_dir(root, id)?.join("session.json"))
}

fn inject_workspace_path(mut session: Value, dir: &Path) -> Value {
    if let Some(obj) = session.as_object_mut() {
        obj.insert(
            "workspacePath".into(),
            Value::String(dir.to_string_lossy().into_owned()),
        );
    }
    session
}

pub fn list_sessions(app: AppHandle) -> Result<Vec<Value>, String> {
    let root = workspace_root(&app)?;
    let mut sessions = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        let path = match session_file(&root, &id) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let raw = match fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };
        if let Ok(mut value) = serde_json::from_str::<Value>(&raw) {
            if let Ok(dir) = session_dir(&root, &id) {
                value = inject_workspace_path(value, &dir);
            }
            sessions.push(value);
        }
    }
    sessions.sort_by(|a, b| {
        let left = a.get("updatedAt").and_then(Value::as_str).unwrap_or("");
        let right = b.get("updatedAt").and_then(Value::as_str).unwrap_or("");
        right.cmp(left)
    });
    Ok(sessions)
}

pub fn load_session(app: AppHandle, id: String) -> Result<Value, String> {
    let root = workspace_root(&app)?;
    let path = session_file(&root, &id)?;
    if !path.exists() {
        return Err("会话不存在".into());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let dir = session_dir(&root, &id)?;
    value = inject_workspace_path(value, &dir);
    Ok(value)
}

pub fn save_session(app: AppHandle, session: Value) -> Result<Value, String> {
    let id = session
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "会话缺少 id".to_string())?
        .to_string();
    let root = workspace_root(&app)?;
    let dir = session_dir(&root, &id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("session.json");
    let value = inject_workspace_path(session, &dir);
    let raw = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    let temp = dir.join("session.json.tmp");
    fs::write(&temp, raw).map_err(|e| e.to_string())?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    fs::rename(&temp, &path).map_err(|e| e.to_string())?;
    Ok(value)
}

pub fn delete_session(app: AppHandle, id: String) -> Result<(), String> {
    let root = workspace_root(&app)?;
    let dir = session_dir(&root, &id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Duplicate a session (messages + meta) into a new id; does not deep-copy workspace files.
pub fn copy_session(app: AppHandle, id: String) -> Result<Value, String> {
    let mut source = load_session(app.clone(), id)?;
    let new_id = format!(
        "session_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    if let Some(obj) = source.as_object_mut() {
        obj.insert("id".into(), Value::String(new_id));
        let title = obj
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let copy_title = if title.trim().is_empty() {
            "会话副本".into()
        } else {
            format!("{title}（副本）")
        };
        obj.insert("title".into(), Value::String(copy_title));
        // Frontend prefers ISO; leave empty and let save/load path fill workspacePath.
        // updatedAt/createdAt are overwritten by the client after copy when possible.
        obj.remove("workspacePath");
    }
    save_session(app, source)
}

pub fn get_session_workspace(app: AppHandle, id: String) -> Result<String, String> {
    let root = workspace_root(&app)?;
    let dir = session_dir(&root, &id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

pub fn get_workspace_info(app: AppHandle) -> Result<Value, String> {
    let settings = SettingsStore::load(&app)?;
    let default_root = SettingsStore::default_workspace_root(&app)?;
    let resolved = SettingsStore::resolve_workspace_root(&app, &settings)?;
    Ok(json!({
        "defaultRoot": default_root,
        "resolvedRoot": resolved,
        "customRoot": settings.workspace_root,
    }))
}

#[allow(dead_code)]
pub fn ensure_settings_workspace(app: &AppHandle, settings: &AppSettings) -> Result<String, String> {
    SettingsStore::resolve_workspace_root(app, settings)
}
