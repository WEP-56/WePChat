//! SQLite storage engine for sessions (`{workspaceRoot}/wepchat.db`).
//!
//! 设计要点（docs/sqlite-storage-plan.md）：
//! - 库跟随工作区根目录：换 root 即换数据集；连接按 root 缓存，切 root 时重开。
//! - WAL + 单写连接（`Mutex` 串行）足够覆盖桌面单用户场景。
//! - 打开时 `quick_check`；失败则把坏库改名 `wepchat.db.corrupt-{ts}` 后重建。
//! - schema 演进走 `PRAGMA user_version` 顺序迁移，禁止启动时 DROP。

use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const DB_FILE: &str = "wepchat.db";

const SCHEMA_V1: &str = "
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  mode        TEXT NOT NULL DEFAULT 'chat',
  title       TEXT NOT NULL DEFAULT '',
  pinned      INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT NOT NULL DEFAULT '',
  model       TEXT NOT NULL DEFAULT '',
  meta_json   TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  role         TEXT NOT NULL DEFAULT 'user',
  content      TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq);
";

struct DbHandle {
    root: PathBuf,
    conn: Connection,
}

static DB: OnceLock<Mutex<Option<DbHandle>>> = OnceLock::new();

fn cell() -> &'static Mutex<Option<DbHandle>> {
    DB.get_or_init(|| Mutex::new(None))
}

/// 以给定工作区根目录的连接运行 `f`。连接按 root 缓存；root 变化时关旧开新。
pub fn with_conn<T>(
    root: &Path,
    f: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = cell().lock().map_err(|e| e.to_string())?;
    let reopen = match guard.as_ref() {
        Some(handle) => handle.root != root,
        None => true,
    };
    if reopen {
        *guard = None; // 先释放旧连接（关闭文件句柄），再打开新库
        let conn = open_or_recover(root)?;
        *guard = Some(DbHandle {
            root: root.to_path_buf(),
            conn,
        });
    }
    let handle = guard.as_mut().expect("db handle present");
    f(&mut handle.conn)
}

fn open_or_recover(root: &Path) -> Result<Connection, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let path = root.join(DB_FILE);
    match open_and_migrate(&path) {
        Ok(conn) => Ok(conn),
        Err(first_err) => {
            // 坏库：改名保留现场（含 wal/shm），重建空库
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            for suffix in ["", "-wal", "-shm"] {
                let src = root.join(format!("{DB_FILE}{suffix}"));
                if src.exists() {
                    let dst = root.join(format!("{DB_FILE}.corrupt-{stamp}{suffix}"));
                    let _ = fs::rename(&src, &dst);
                }
            }
            eprintln!("wepchat.db 无法打开（{first_err}），已改名保留并重建空库");
            open_and_migrate(&path)
        }
    }
}

fn open_and_migrate(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    // journal_mode 会返回结果行，需用查询而不是 pragma_update
    let _mode: String = conn
        .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;")
        .map_err(|e| e.to_string())?;
    let check: String = conn
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err(format!("完整性检查失败：{check}"));
    }
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if version < 1 {
        conn.execute_batch(SCHEMA_V1).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "user_version", 1)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
