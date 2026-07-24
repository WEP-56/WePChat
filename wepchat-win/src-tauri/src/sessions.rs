//! Session storage on SQLite: `{workspaceRoot}/wepchat.db`（见 docs/sqlite-storage-plan.md）。
//! 每个会话仍拥有自己的工作区目录 `{workspaceRoot}/{sessionId}/`（工具文件、生成图片），
//! 但会话数据（消息、variants、usage 等）进库，不再读写 session.json。
//!
//! JSON 契约与旧实现兼容：list/load/save/copy 的输入输出形状不变；
//! list_sessions 额外返回 `summary`（首条用户消息首行）与 `messageCount`，
//! 且 `messages` 恒为空数组（侧栏不再需要全量消息）。

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::db;
use crate::settings::{AppSettings, SettingsStore};

/// 存进 sessions 表独立列的字段；其余（contextModel、imageCanvas 等）进 meta_json。
const SESSION_COLUMN_KEYS: [&str; 8] = [
    "id",
    "mode",
    "title",
    "pinned",
    "providerId",
    "model",
    "createdAt",
    "updatedAt",
];
/// 派生字段：由存储层生成或剥离，绝不入库。
const DERIVED_KEYS: [&str; 4] = ["messages", "workspacePath", "summary", "messageCount"];
/// 存进 messages 表独立列的字段；其余（reasoning、toolCalls、variants 等）进 payload_json。
const MESSAGE_COLUMN_KEYS: [&str; 4] = ["id", "role", "content", "createdAt"];

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

fn str_field(obj: &Map<String, Value>, key: &str) -> String {
    obj.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn parse_object(raw: &str) -> Map<String, Value> {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn first_line_summary(content: &str, limit: usize) -> String {
    let line = content
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    line.chars().take(limit).collect()
}

/// 把消息对象拆为独立列 + payload_json。
fn split_message(
    index: usize,
    m: &Map<String, Value>,
) -> Result<(String, String, String, String, String), String> {
    let mut mid = str_field(m, "id");
    if mid.is_empty() {
        mid = format!("msg_auto_{index}");
    }
    let role = {
        let v = str_field(m, "role");
        if v.is_empty() {
            "user".to_string()
        } else {
            v
        }
    };
    let content = str_field(m, "content");
    let created = str_field(m, "createdAt");
    let mut payload = Map::new();
    for (key, value) in m {
        if !MESSAGE_COLUMN_KEYS.contains(&key.as_str()) {
            payload.insert(key.clone(), value.clone());
        }
    }
    let payload_json = serde_json::to_string(&Value::Object(payload)).map_err(|e| e.to_string())?;
    Ok((mid, role, content, payload_json, created))
}

/// 由列值 + meta_json 组装会话对象（不含 messages）。
#[allow(clippy::too_many_arguments)]
fn assemble_session_base(
    id: &str,
    mode: &str,
    title: &str,
    pinned: bool,
    provider_id: &str,
    model: &str,
    meta_json: &str,
    created_at: &str,
    updated_at: &str,
    dir: &Path,
) -> Map<String, Value> {
    let mut obj = parse_object(meta_json);
    obj.insert("id".into(), json!(id));
    obj.insert("mode".into(), json!(mode));
    obj.insert("title".into(), json!(title));
    obj.insert("pinned".into(), json!(pinned));
    obj.insert("providerId".into(), json!(provider_id));
    obj.insert("model".into(), json!(model));
    obj.insert("createdAt".into(), json!(created_at));
    obj.insert("updatedAt".into(), json!(updated_at));
    obj.insert(
        "workspacePath".into(),
        json!(dir.to_string_lossy().into_owned()),
    );
    obj
}

/* ---------- 核心实现（以 root 为参数，便于单测） ---------- */

pub fn list_sessions_at(root: &Path) -> Result<Vec<Value>, String> {
    db::with_conn(root, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT s.id, s.mode, s.title, s.pinned, s.provider_id, s.model,
                        s.meta_json, s.created_at, s.updated_at,
                        (SELECT m.content FROM messages m
                          WHERE m.session_id = s.id AND m.role = 'user'
                          ORDER BY m.seq LIMIT 1),
                        (SELECT COUNT(*) FROM messages m2 WHERE m2.session_id = s.id)
                 FROM sessions s
                 ORDER BY s.updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, i64>(10)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut sessions = Vec::new();
        for row in rows {
            let (
                id,
                mode,
                title,
                pinned,
                provider_id,
                model,
                meta_json,
                created,
                updated,
                first_user,
                count,
            ) = row.map_err(|e| e.to_string())?;
            let dir = root.join(&id);
            let mut obj = assemble_session_base(
                &id,
                &mode,
                &title,
                pinned != 0,
                &provider_id,
                &model,
                &meta_json,
                &created,
                &updated,
                &dir,
            );
            obj.insert("messages".into(), json!([]));
            obj.insert(
                "summary".into(),
                json!(first_line_summary(first_user.as_deref().unwrap_or(""), 64)),
            );
            obj.insert("messageCount".into(), json!(count));
            sessions.push(Value::Object(obj));
        }
        Ok(sessions)
    })
}

fn load_session_with(conn: &Connection, root: &Path, id: &str) -> Result<Value, String> {
    if !valid_session_id(id) {
        return Err("会话 ID 无效".into());
    }
    let row = conn
        .query_row(
            "SELECT mode, title, pinned, provider_id, model, meta_json, created_at, updated_at
             FROM sessions WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (mode, title, pinned, provider_id, model, meta_json, created, updated) =
        row.ok_or_else(|| "会话不存在".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, role, content, payload_json, created_at
             FROM messages WHERE session_id = ?1 ORDER BY seq",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    for row in rows {
        let (mid, role, content, payload_json, m_created) = row.map_err(|e| e.to_string())?;
        let mut m = parse_object(&payload_json);
        m.insert("id".into(), json!(mid));
        m.insert("role".into(), json!(role));
        m.insert("content".into(), json!(content));
        if !m_created.is_empty() {
            m.insert("createdAt".into(), json!(m_created));
        }
        messages.push(Value::Object(m));
    }

    let dir = root.join(id);
    let mut obj = assemble_session_base(
        id,
        &mode,
        &title,
        pinned != 0,
        &provider_id,
        &model,
        &meta_json,
        &created,
        &updated,
        &dir,
    );
    obj.insert("messages".into(), Value::Array(messages));
    Ok(Value::Object(obj))
}

pub fn load_session_at(root: &Path, id: &str) -> Result<Value, String> {
    db::with_conn(root, |conn| load_session_with(conn, root, id))
}

fn assemble_message(
    mid: String,
    role: String,
    content: String,
    payload_json: String,
    created_at: String,
) -> Value {
    let mut m = parse_object(&payload_json);
    m.insert("id".into(), json!(mid));
    m.insert("role".into(), json!(role));
    m.insert("content".into(), json!(content));
    if !created_at.is_empty() {
        m.insert("createdAt".into(), json!(created_at));
    }
    Value::Object(m)
}

pub fn messages_page_at(
    root: &Path,
    session_id: &str,
    before_seq: Option<i64>,
    limit: Option<i64>,
) -> Result<Value, String> {
    if !valid_session_id(session_id) {
        return Err("会话 ID 无效".into());
    }
    let limit = limit.unwrap_or(50).clamp(1, 200);
    db::with_conn(root, |conn| {
        let exists = conn
            .query_row(
                "SELECT 1 FROM sessions WHERE id = ?1",
                params![session_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .is_some();
        if !exists {
            return Err("会话不存在".into());
        }

        let mut stmt = conn
            .prepare(
                "SELECT seq, id, role, content, payload_json, created_at
                 FROM messages
                 WHERE session_id = ?1 AND (?2 IS NULL OR seq < ?2)
                 ORDER BY seq DESC
                 LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id, before_seq, limit + 1], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut fetched = Vec::new();
        for row in rows {
            fetched.push(row.map_err(|e| e.to_string())?);
        }
        let has_more = fetched.len() as i64 > limit;
        fetched.truncate(limit as usize);
        fetched.reverse();

        let next_before_seq = fetched.first().map(|row| row.0);
        let messages: Vec<Value> = fetched
            .into_iter()
            .map(|(_, mid, role, content, payload_json, created_at)| {
                assemble_message(mid, role, content, payload_json, created_at)
            })
            .collect();

        Ok(json!({
            "sessionId": session_id,
            "messages": messages,
            "nextBeforeSeq": next_before_seq,
            "hasMore": has_more,
        }))
    })
}

pub fn save_session_at(root: &Path, mut session: Value) -> Result<Value, String> {
    let obj = session
        .as_object()
        .ok_or_else(|| "会话格式无效".to_string())?
        .clone();
    let id = str_field(&obj, "id");
    if !valid_session_id(&id) {
        return Err("会话 ID 无效".into());
    }
    let dir = root.join(&id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mode = {
        let v = str_field(&obj, "mode");
        if v.is_empty() {
            "chat".to_string()
        } else {
            v
        }
    };
    let title = str_field(&obj, "title");
    let pinned = obj.get("pinned").and_then(Value::as_bool).unwrap_or(false);
    let provider_id = str_field(&obj, "providerId");
    let model = str_field(&obj, "model");
    let created_at = str_field(&obj, "createdAt");
    let updated_at = str_field(&obj, "updatedAt");

    let mut meta = Map::new();
    for (key, value) in &obj {
        if !SESSION_COLUMN_KEYS.contains(&key.as_str()) && !DERIVED_KEYS.contains(&key.as_str()) {
            meta.insert(key.clone(), value.clone());
        }
    }
    let meta_json = serde_json::to_string(&Value::Object(meta)).map_err(|e| e.to_string())?;

    let empty = Vec::new();
    let messages = obj
        .get("messages")
        .and_then(Value::as_array)
        .unwrap_or(&empty);

    db::with_conn(root, |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO sessions (id, mode, title, pinned, provider_id, model, meta_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               mode = excluded.mode,
               title = excluded.title,
               pinned = excluded.pinned,
               provider_id = excluded.provider_id,
               model = excluded.model,
               meta_json = excluded.meta_json,
               created_at = excluded.created_at,
               updated_at = excluded.updated_at",
            params![id, mode, title, pinned as i64, provider_id, model, meta_json, created_at, updated_at],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM messages WHERE session_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO messages (session_id, id, seq, role, content, payload_json, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )
                .map_err(|e| e.to_string())?;
            let mut seen_ids: HashSet<String> = HashSet::new();
            for (index, raw) in messages.iter().enumerate() {
                let m = match raw.as_object() {
                    Some(m) => m,
                    None => continue,
                };
                let (mut mid, role, content, payload_json, m_created) = split_message(index, m)?;
                // 防御：消息 id 会话内必须唯一（复合主键），重复时追加序号而不是让整次保存失败
                if !seen_ids.insert(mid.clone()) {
                    mid = format!("{mid}__dup{index}");
                    seen_ids.insert(mid.clone());
                }
                stmt.execute(params![
                    id,
                    mid,
                    index as i64,
                    role,
                    content,
                    payload_json,
                    m_created
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })?;

    if let Some(out) = session.as_object_mut() {
        out.insert(
            "workspacePath".into(),
            json!(dir.to_string_lossy().into_owned()),
        );
    }
    Ok(session)
}

/// 流式热路径：只更新一条消息 + 会话 updated_at（S2 增量保存）。
/// 若 seq 与其他消息行冲突（会话结构已变化），返回错误，由前端回退全量保存。
pub fn upsert_message_at(
    root: &Path,
    session_id: &str,
    seq: i64,
    updated_at: &str,
    message: &Value,
) -> Result<(), String> {
    if !valid_session_id(session_id) {
        return Err("会话 ID 无效".into());
    }
    if seq < 0 {
        return Err("消息序号无效".into());
    }
    let m = message
        .as_object()
        .ok_or_else(|| "消息格式无效".to_string())?;
    let (mid, role, content, payload_json, m_created) = split_message(seq as usize, m)?;
    db::with_conn(root, |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let touched = tx
            .execute(
                "UPDATE sessions SET updated_at = ?2 WHERE id = ?1",
                params![session_id, updated_at],
            )
            .map_err(|e| e.to_string())?;
        if touched == 0 {
            return Err("会话不存在".into());
        }
        tx.execute(
            "INSERT INTO messages (session_id, id, seq, role, content, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(session_id, id) DO UPDATE SET
               seq = excluded.seq,
               role = excluded.role,
               content = excluded.content,
               payload_json = excluded.payload_json,
               created_at = excluded.created_at",
            params![session_id, mid, seq, role, content, payload_json, m_created],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub fn delete_session_at(root: &Path, id: &str) -> Result<(), String> {
    let dir = session_dir(root, id)?;
    db::with_conn(root, |conn| {
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 库内复制会话（消息一并复制；不深拷贝工作区文件，与旧行为一致）。
pub fn copy_session_at(root: &Path, id: &str) -> Result<Value, String> {
    if !valid_session_id(id) {
        return Err("会话 ID 无效".into());
    }
    let new_id = format!(
        "session_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    db::with_conn(root, |conn| {
        let title: Option<String> = conn
            .query_row(
                "SELECT title FROM sessions WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let title = title.ok_or_else(|| "会话不存在".to_string())?;
        let copy_title = if title.trim().is_empty() {
            "会话副本".to_string()
        } else {
            format!("{title}（副本）")
        };
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO sessions (id, mode, title, pinned, provider_id, model, meta_json, created_at, updated_at)
             SELECT ?2, mode, ?3, pinned, provider_id, model, meta_json, created_at, updated_at
             FROM sessions WHERE id = ?1",
            params![id, new_id, copy_title],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO messages (session_id, id, seq, role, content, payload_json, created_at)
             SELECT ?2, id, seq, role, content, payload_json, created_at
             FROM messages WHERE session_id = ?1",
            params![id, new_id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })?;
    let dir = root.join(&new_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    load_session_at(root, &new_id)
}

/* ---------- Tauri 命令包装 ---------- */

pub fn list_sessions(app: AppHandle) -> Result<Vec<Value>, String> {
    let root = workspace_root(&app)?;
    list_sessions_at(&root)
}

pub fn load_session(app: AppHandle, id: String) -> Result<Value, String> {
    let root = workspace_root(&app)?;
    load_session_at(&root, &id)
}

pub fn save_session(app: AppHandle, session: Value) -> Result<Value, String> {
    let root = workspace_root(&app)?;
    save_session_at(&root, session)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertMessageArgs {
    pub session_id: String,
    pub seq: i64,
    #[serde(default)]
    pub updated_at: String,
    pub message: Value,
}

pub fn upsert_message(app: AppHandle, args: UpsertMessageArgs) -> Result<(), String> {
    let root = workspace_root(&app)?;
    upsert_message_at(
        &root,
        &args.session_id,
        args.seq,
        &args.updated_at,
        &args.message,
    )
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagesPageArgs {
    pub session_id: String,
    #[serde(default)]
    pub before_seq: Option<i64>,
    #[serde(default)]
    pub limit: Option<i64>,
}

pub fn messages_page(app: AppHandle, args: MessagesPageArgs) -> Result<Value, String> {
    let root = workspace_root(&app)?;
    messages_page_at(&root, &args.session_id, args.before_seq, args.limit)
}

pub fn delete_session(app: AppHandle, id: String) -> Result<(), String> {
    let root = workspace_root(&app)?;
    delete_session_at(&root, &id)
}

pub fn copy_session(app: AppHandle, id: String) -> Result<Value, String> {
    let root = workspace_root(&app)?;
    copy_session_at(&root, &id)
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
pub fn ensure_settings_workspace(
    app: &AppHandle,
    settings: &AppSettings,
) -> Result<String, String> {
    SettingsStore::resolve_workspace_root(app, settings)
}

/* ---------- 单元测试：save → load → list → copy → delete 往返 ---------- */

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "wepchat-db-test-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&dir).expect("create temp root");
        dir
    }

    fn sample_session(id: &str) -> Value {
        json!({
            "id": id,
            "mode": "chat",
            "title": "测试会话",
            "pinned": false,
            "providerId": "prov_1",
            "model": "test-model",
            "createdAt": "2026-07-23T10:00:00.000Z",
            "updatedAt": "2026-07-23T10:05:00.000Z",
            "contextModel": "test-model",
            "contextWindow": 128000,
            "imageCanvas": { "zoom": 1.5 },
            "messages": [
                {
                    "id": "m1", "role": "user", "content": "你好\n第二行",
                    "createdAt": "2026-07-23T10:00:01.000Z",
                    "attachments": []
                },
                {
                    "id": "m2", "role": "assistant", "content": "回答内容",
                    "createdAt": "2026-07-23T10:00:02.000Z",
                    "reasoning": "思考……", "status": "done", "model": "test-model",
                    "durationMs": 1234,
                    "usage": { "inputTokens": 10, "outputTokens": 20, "totalTokens": 30 },
                    "toolCalls": [{ "id": "c1", "name": "write_file", "arguments": "{}", "status": "done", "result": "ok" }],
                    "variants": [{ "id": "m2:v1", "content": "回答内容", "status": "done" }]
                }
            ]
        })
    }

    #[test]
    fn roundtrip_save_load_list_copy_delete() {
        let root = temp_root("roundtrip");

        let saved = save_session_at(&root, sample_session("session_a")).expect("save");
        assert!(saved
            .get("workspacePath")
            .and_then(Value::as_str)
            .unwrap()
            .contains("session_a"));

        let loaded = load_session_at(&root, "session_a").expect("load");
        assert_eq!(loaded["title"], "测试会话");
        assert_eq!(loaded["contextWindow"], 128000);
        assert_eq!(loaded["imageCanvas"]["zoom"], 1.5);
        let msgs = loaded["messages"].as_array().expect("messages");
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0]["content"], "你好\n第二行");
        assert_eq!(msgs[1]["reasoning"], "思考……");
        assert_eq!(msgs[1]["usage"]["outputTokens"], 20);
        assert_eq!(msgs[1]["toolCalls"][0]["name"], "write_file");
        assert_eq!(msgs[1]["durationMs"], 1234);

        let list = list_sessions_at(&root).expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["id"], "session_a");
        assert_eq!(list[0]["summary"], "你好");
        assert_eq!(list[0]["messageCount"], 2);
        assert_eq!(list[0]["messages"].as_array().unwrap().len(), 0);

        let copied = copy_session_at(&root, "session_a").expect("copy");
        let copy_id = copied["id"].as_str().unwrap().to_string();
        assert_ne!(copy_id, "session_a");
        assert_eq!(copied["title"], "测试会话（副本）");
        assert_eq!(copied["messages"].as_array().unwrap().len(), 2);

        // 覆盖保存：消息数变化后 load 反映最新
        let mut updated = sample_session("session_a");
        updated["messages"].as_array_mut().unwrap().pop();
        updated["title"] = json!("改名了");
        save_session_at(&root, updated).expect("resave");
        let reloaded = load_session_at(&root, "session_a").expect("reload");
        assert_eq!(reloaded["title"], "改名了");
        assert_eq!(reloaded["messages"].as_array().unwrap().len(), 1);

        delete_session_at(&root, "session_a").expect("delete");
        assert!(load_session_at(&root, "session_a").is_err());
        let after = list_sessions_at(&root).expect("list after delete");
        assert_eq!(after.len(), 1);
        assert_eq!(after[0]["id"], Value::String(copy_id));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn incremental_upsert_updates_and_appends() {
        let root = temp_root("upsert");
        save_session_at(&root, sample_session("session_b")).expect("save");

        // 更新已有消息（流式内容增长）
        let grown = json!({
            "id": "m2", "role": "assistant", "content": "更长的回答内容……",
            "createdAt": "2026-07-23T10:00:02.000Z", "status": "streaming", "reasoning": "想"
        });
        upsert_message_at(&root, "session_b", 1, "2026-07-23T10:06:00.000Z", &grown)
            .expect("upsert existing");
        let loaded = load_session_at(&root, "session_b").unwrap();
        assert_eq!(loaded["messages"][1]["content"], "更长的回答内容……");
        assert_eq!(loaded["messages"][1]["reasoning"], "想");
        assert_eq!(loaded["updatedAt"], "2026-07-23T10:06:00.000Z");

        // 追加新消息行
        let m3 = json!({ "id": "m3", "role": "user", "content": "追问", "createdAt": "2026-07-23T10:07:00.000Z" });
        upsert_message_at(&root, "session_b", 2, "2026-07-23T10:07:00.000Z", &m3).expect("append");
        let loaded = load_session_at(&root, "session_b").unwrap();
        assert_eq!(loaded["messages"].as_array().unwrap().len(), 3);
        assert_eq!(loaded["messages"][2]["content"], "追问");

        // seq 与其他消息冲突（结构变化）→ 必须报错，触发前端回退全量
        let bad = json!({ "id": "m3", "role": "user", "content": "x" });
        assert!(upsert_message_at(&root, "session_b", 0, "t", &bad).is_err());

        // 不存在的会话 → 报错
        assert!(upsert_message_at(&root, "no_such", 0, "t", &m3).is_err());
        assert!(upsert_message_at(&root, "session_b", -1, "t", &m3).is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn incremental_upsert_write_count_is_constant_for_long_session() {
        let root = temp_root("upsert_constant");
        let mut session = sample_session("session_long");
        let messages = session["messages"].as_array_mut().unwrap();
        for index in 2..250 {
            messages.push(json!({
                "id": format!("m{index}"),
                "role": if index % 2 == 0 { "user" } else { "assistant" },
                "content": format!("message {index}"),
                "createdAt": "2026-07-23T10:00:00.000Z"
            }));
        }
        save_session_at(&root, session).expect("save long session");
        let before = db::with_conn(&root, |conn| Ok(conn.total_changes())).unwrap();

        let changed = json!({
            "id": "m249", "role": "assistant", "content": "changed",
            "createdAt": "2026-07-23T10:00:00.000Z", "status": "streaming"
        });
        upsert_message_at(
            &root,
            "session_long",
            249,
            "2026-07-23T10:08:00.000Z",
            &changed,
        )
        .expect("incremental update");
        let after = db::with_conn(&root, |conn| Ok(conn.total_changes())).unwrap();

        // One sessions UPDATE + one messages UPSERT, independent of the 250-row history.
        assert_eq!(after - before, 2);
        let loaded = load_session_at(&root, "session_long").unwrap();
        assert_eq!(loaded["messages"].as_array().unwrap().len(), 250);
        assert_eq!(loaded["messages"][249]["content"], "changed");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn messages_page_returns_latest_then_older_chunks() {
        let root = temp_root("page");
        let mut session = sample_session("session_page");
        let messages = session["messages"].as_array_mut().unwrap();
        for index in 2..7 {
            messages.push(json!({
                "id": format!("m{index}"),
                "role": if index % 2 == 0 { "user" } else { "assistant" },
                "content": format!("message {index}"),
                "createdAt": "2026-07-23T10:00:00.000Z"
            }));
        }
        save_session_at(&root, session).expect("save page session");

        let latest = messages_page_at(&root, "session_page", None, Some(3)).expect("latest page");
        let latest_messages = latest["messages"].as_array().unwrap();
        assert_eq!(latest_messages.len(), 3);
        assert_eq!(latest_messages[0]["content"], "message 4");
        assert_eq!(latest_messages[2]["content"], "message 6");
        assert_eq!(latest["nextBeforeSeq"], 4);
        assert_eq!(latest["hasMore"], true);

        let older = messages_page_at(
            &root,
            "session_page",
            latest["nextBeforeSeq"].as_i64(),
            Some(4),
        )
        .expect("older page");
        let older_messages = older["messages"].as_array().unwrap();
        assert_eq!(older_messages.len(), 4);
        assert_eq!(older_messages[0]["content"], "你好\n第二行");
        assert_eq!(older_messages[3]["content"], "message 3");
        assert_eq!(older["hasMore"], false);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_invalid_ids_and_missing_sessions() {
        let root = temp_root("invalid");
        assert!(save_session_at(&root, json!({ "id": "../evil" })).is_err());
        assert!(load_session_at(&root, "no_such_session").is_err());
        assert!(copy_session_at(&root, "no_such_session").is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
