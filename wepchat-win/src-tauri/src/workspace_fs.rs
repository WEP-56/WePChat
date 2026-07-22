//! Session workspace filesystem tools.
//! All paths from the model are relative to `{workspaceRoot}/{sessionId}/`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Emitter};

use crate::sessions;

const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_OUTPUT_CHARS: usize = 16 * 1024;
const MAX_LIST_ENTRIES: usize = 500;
const MAX_LIST_DEPTH: usize = 16;
const MAX_PATH_LEN: usize = 180;
const MAX_DELETE_PATHS: usize = 50;
const DIFF_MAX_LINES: usize = 180;

const HIDDEN_NAMES: &[&str] = &["session.json", "session.json.tmp"];
const DEVICE_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/* ---------- Shared args / results ---------- */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsSessionArgs {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsPathArgs {
    pub session_id: String,
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsListArgs {
    pub session_id: String,
    #[serde(default)]
    pub path: String,
    #[serde(default = "default_true")]
    pub recursive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsReadArgs {
    pub session_id: String,
    pub path: String,
    #[serde(default)]
    pub lines: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsWriteArgs {
    pub session_id: String,
    pub path: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub mime: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsEditArgs {
    pub session_id: String,
    pub path: String,
    pub find: String,
    #[serde(default)]
    pub replace: String,
    #[serde(default)]
    pub all: bool,
    #[serde(default)]
    pub use_regex: bool,
    #[serde(default)]
    pub regex_flags: Option<String>,
    #[serde(default)]
    pub ignore_whitespace: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsDeleteArgs {
    pub session_id: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub paths: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsMoveArgs {
    pub session_id: String,
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub overwrite: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsTextResult {
    pub ok: bool,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changes: Option<Vec<Value>>,
}

fn default_true() -> bool {
    true
}

fn ok_text(content: impl Into<String>) -> WsTextResult {
    WsTextResult {
        ok: true,
        content: content.into(),
        changes: None,
    }
}

fn ok_with_changes(content: impl Into<String>, changes: Vec<Value>) -> WsTextResult {
    WsTextResult {
        ok: true,
        content: content.into(),
        changes: Some(changes),
    }
}

fn err_text(msg: impl Into<String>) -> Result<WsTextResult, String> {
    Ok(WsTextResult {
        ok: false,
        content: format!("错误：{}", msg.into()),
        changes: None,
    })
}

/* ---------- Path safety ---------- */

fn workspace_dir(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    let root = sessions::workspace_root(app)?;
    let dir = sessions::session_dir(&root, session_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn is_device_name(part: &str) -> bool {
    let upper = part.to_ascii_uppercase();
    let base = upper.split('.').next().unwrap_or(&upper);
    DEVICE_NAMES.iter().any(|d| *d == base)
}

/// Normalize a workspace-relative path. Returns empty string when allow_empty and path is root.
fn normalize_rel(raw: &str, allow_empty: bool) -> Result<String, String> {
    let mut p = raw.trim().replace('\\', "/");
    while p.starts_with('/') {
        p = p[1..].to_string();
    }
    if let Some(stripped) = p.strip_prefix("./") {
        p = stripped.to_string();
    }
    if p.ends_with('/') {
        p = p.trim_end_matches('/').to_string();
    }

    // Absolute / drive / UNC
    if raw.trim().starts_with('/')
        || raw.trim().starts_with('\\')
        || Path::new(raw.trim()).is_absolute()
        || raw.contains(':')
        || raw.starts_with("//")
        || raw.starts_with("\\\\")
    {
        return Err(format!("非法路径（禁止绝对路径/盘符/UNC）: {raw}"));
    }

    let parts: Vec<&str> = p
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect();
    if parts.is_empty() {
        if allow_empty {
            return Ok(String::new());
        }
        return Err(format!("非法路径: {raw}"));
    }
    for part in &parts {
        if *part == ".." {
            return Err(format!("非法路径（禁止 ..）: {raw}"));
        }
        if part.chars().any(|c| c.is_control() || c == '\0') {
            return Err(format!("非法路径: {raw}"));
        }
        if part.contains(':') || part.contains('*') || part.contains('?') || part.contains('|') {
            return Err(format!("非法路径: {raw}"));
        }
        if is_device_name(part) {
            return Err(format!("非法路径（设备名）: {raw}"));
        }
        // NTFS ADS
        if part.contains(':') {
            return Err(format!("非法路径: {raw}"));
        }
    }
    let out = parts.join("/");
    if out.len() > MAX_PATH_LEN {
        return Err(format!("路径过长: {out}"));
    }
    Ok(out)
}

fn resolve_in_workspace(workspace: &Path, rel: &str) -> Result<PathBuf, String> {
    let abs = if rel.is_empty() {
        workspace.to_path_buf()
    } else {
        let mut cur = workspace.to_path_buf();
        for part in rel.split('/') {
            cur.push(part);
        }
        cur
    };

    // Ensure no component escapes (extra belt)
    let mut check = PathBuf::new();
    for c in abs.components() {
        match c {
            Component::ParentDir => {
                return Err(format!("路径越界: {rel}"));
            }
            Component::Normal(s) => check.push(s),
            Component::RootDir | Component::Prefix(_) => check.push(c.as_os_str()),
            Component::CurDir => {}
        }
    }

    // Canonicalize when exists; otherwise check parent chain
    if abs.exists() {
        let canon = abs.canonicalize().map_err(|e| e.to_string())?;
        let ws_canon = workspace
            .canonicalize()
            .map_err(|e| format!("工作区不可用: {e}"))?;
        if !canon.starts_with(&ws_canon) {
            return Err(format!("路径越界: {rel}"));
        }
        return Ok(abs);
    }

    // Walk parents for non-existing path
    let mut parent = abs.parent();
    while let Some(p) = parent {
        if p == workspace || p.starts_with(workspace) {
            if p.exists() {
                let p_canon = p.canonicalize().map_err(|e| e.to_string())?;
                let ws_canon = workspace
                    .canonicalize()
                    .map_err(|e| format!("工作区不可用: {e}"))?;
                if !p_canon.starts_with(&ws_canon) {
                    return Err(format!("路径越界: {rel}"));
                }
                break;
            }
            parent = p.parent();
        } else {
            return Err(format!("路径越界: {rel}"));
        }
    }
    Ok(abs)
}

fn is_hidden_entry(name: &str) -> bool {
    HIDDEN_NAMES.iter().any(|h| *h == name)
}

fn text_mime(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".html") || lower.ends_with(".htm") {
        "text/html"
    } else if lower.ends_with(".css") {
        "text/css"
    } else if lower.ends_with(".js") || lower.ends_with(".mjs") {
        "text/javascript"
    } else if lower.ends_with(".json") {
        "application/json"
    } else if lower.ends_with(".md") {
        "text/markdown"
    } else if lower.ends_with(".csv") {
        "text/csv"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "text/plain"
    }
}

fn fmt_size(n: u64) -> String {
    if n < 1024 {
        format!("{n} B")
    } else if n < 1024 * 1024 {
        format!("{:.1} KB", n as f64 / 1024.0)
    } else {
        format!("{:.1} MB", n as f64 / (1024.0 * 1024.0))
    }
}

fn truncate_output(s: &str) -> String {
    if s.chars().count() <= MAX_OUTPUT_CHARS {
        return s.to_string();
    }
    let clipped: String = s.chars().take(MAX_OUTPUT_CHARS).collect();
    format!("{clipped}\n…[内容已截断]")
}

fn look_binary(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    let sample = &bytes[..bytes.len().min(4096)];
    sample.iter().filter(|&&b| b == 0).count() > 0
        || sample.iter().filter(|&&b| b < 9 && b != 9 && b != 10 && b != 13).count() > sample.len() / 10
}

fn read_text_file(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "文件超过 {} 上限",
            fmt_size(MAX_FILE_BYTES)
        ));
    }
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    if look_binary(&buf) {
        return Err("该文件是二进制文件，无法以文本读取".into());
    }
    String::from_utf8(buf).map_err(|_| "文件不是有效 UTF-8 文本".to_string())
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(format!("内容超过 {} 上限", fmt_size(MAX_FILE_BYTES)));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Unique temp name next to target
    let tmp = path.parent().unwrap_or(Path::new(".")).join(format!(
        ".{}.wepchat.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(content.as_bytes())
            .map_err(|e| e.to_string())?;
        f.sync_all().ok();
    }
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(())
}

fn emit_changed(app: &AppHandle, session_id: &str, changes: &[Value]) {
    let _ = app.emit(
        "workspace-changed",
        json!({
            "sessionId": session_id,
            "changes": changes,
        }),
    );
}

fn parse_line_range(spec: &str, total: usize) -> Result<Option<(usize, usize)>, String> {
    let s = spec.trim();
    if s.is_empty() {
        return Ok(None);
    }
    if let Ok(n) = s.parse::<usize>() {
        if n == 0 {
            return Err("行号从 1 开始".into());
        }
        return Ok(Some((n, n)));
    }
    if let Some((a, b)) = s.split_once('-') {
        if a.is_empty() && b.is_empty() {
            return Err("lines 参数格式错误，示例：1-20、1-、-30".into());
        }
        if a.is_empty() {
            let count: usize = b
                .parse()
                .map_err(|_| "lines 参数格式错误".to_string())?;
            let start = total.saturating_sub(count).saturating_add(1).max(1);
            return Ok(Some((start, total.max(1))));
        }
        let start: usize = a
            .parse()
            .map_err(|_| "lines 参数格式错误".to_string())?;
        let end = if b.is_empty() {
            total.max(1)
        } else {
            b.parse()
                .map_err(|_| "lines 参数格式错误".to_string())?
        };
        if start == 0 {
            return Err("行号从 1 开始".into());
        }
        return Ok(Some((start, end.max(start))));
    }
    Err("lines 参数格式错误，示例：1-20、1-、-30".into())
}

fn apply_lines(content: &str, lines: Option<&str>) -> Result<String, String> {
    let all: Vec<&str> = content.split('\n').collect();
    // strip trailing empty from final newline for count parity
    let total = if content.is_empty() {
        0
    } else if content.ends_with('\n') {
        all.len().saturating_sub(1).max(1)
    } else {
        all.len()
    };
    let Some(spec) = lines.filter(|s| !s.trim().is_empty()) else {
        return Ok(content.to_string());
    };
    let Some((start, end)) = parse_line_range(spec, total.max(1))? else {
        return Ok(content.to_string());
    };
    if total == 0 {
        return Ok(String::new());
    }
    let start_i = start.saturating_sub(1).min(total);
    let end_i = end.min(total);
    if start_i >= end_i && start > total {
        return Ok(String::new());
    }
    let slice = &all[start_i..end_i.min(all.len())];
    Ok(slice.join("\n"))
}

fn diff_text(path: &str, before: &str, after: &str) -> String {
    if before == after {
        return String::new();
    }
    let a: Vec<&str> = before.split('\n').collect();
    let b: Vec<&str> = after.split('\n').collect();
    let max = a.len().max(b.len());
    let mut lines = vec![
        format!("--- {path}"),
        format!("+++ {path}"),
        "@@".into(),
    ];
    for i in 0..max {
        let left = a.get(i).copied();
        let right = b.get(i).copied();
        if left == right {
            if let Some(v) = left {
                if lines.len() < DIFF_MAX_LINES {
                    lines.push(format!(" {v}"));
                }
            }
        } else {
            if let Some(v) = left {
                lines.push(format!("-{v}"));
            }
            if let Some(v) = right {
                lines.push(format!("+{v}"));
            }
        }
        if lines.len() >= DIFF_MAX_LINES {
            lines.push("... diff 已截断".into());
            break;
        }
    }
    lines.join("\n")
}

fn file_head(content: &str) -> String {
    let head: String = content.chars().take(200).collect();
    if head.is_empty() {
        "(空文件)".into()
    } else {
        head
    }
}

/* ---------- Commands ---------- */

#[tauri::command]
pub fn ws_list(app: AppHandle, args: WsListArgs) -> Result<WsTextResult, String> {
    let workspace = workspace_dir(&app, &args.session_id)?;
    let rel = match normalize_rel(&args.path, true) {
        Ok(r) => r,
        Err(e) => return err_text(e),
    };
    let root = match resolve_in_workspace(&workspace, &rel) {
        Ok(p) => p,
        Err(e) => return err_text(e),
    };

    if root.is_file() {
        let name = rel.clone();
        let size = fs::metadata(&root).map(|m| m.len()).unwrap_or(0);
        return Ok(ok_text(format!(
            "[file] {name}\t{}\t{}",
            fmt_size(size),
            text_mime(&name)
        )));
    }
    if !rel.is_empty() && !root.exists() {
        return err_text(format!("目录不存在: {rel}"));
    }
    if !root.exists() {
        return Ok(ok_text("(工作区为空)"));
    }

    let mut lines = Vec::new();
    let mut file_count = 0usize;
    let mut dir_count = 0usize;
    let mut entry_count = 0usize;

    fn walk(
        dir: &Path,
        rel_prefix: &str,
        depth: usize,
        recursive: bool,
        lines: &mut Vec<String>,
        file_count: &mut usize,
        dir_count: &mut usize,
        entry_count: &mut usize,
    ) -> Result<(), String> {
        if depth > MAX_LIST_DEPTH || *entry_count >= MAX_LIST_ENTRIES {
            return Ok(());
        }
        let mut entries: Vec<_> = fs::read_dir(dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .collect();
        entries.sort_by(|a, b| {
            let a_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let b_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
            match (a_dir, b_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.file_name().cmp(&b.file_name()),
            }
        });
        for entry in entries {
            if *entry_count >= MAX_LIST_ENTRIES {
                lines.push("…[条目数已截断]".into());
                break;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_hidden_entry(&name) {
                continue;
            }
            let child_rel = if rel_prefix.is_empty() {
                name.clone()
            } else {
                format!("{rel_prefix}/{name}")
            };
            let ft = entry.file_type().map_err(|e| e.to_string())?;
            let indent = "  ".repeat(depth);
            if ft.is_dir() {
                *dir_count += 1;
                *entry_count += 1;
                lines.push(format!("{indent}- [dir] {child_rel}/"));
                if recursive {
                    walk(
                        &entry.path(),
                        &child_rel,
                        depth + 1,
                        recursive,
                        lines,
                        file_count,
                        dir_count,
                        entry_count,
                    )?;
                }
            } else if ft.is_file() {
                *file_count += 1;
                *entry_count += 1;
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                lines.push(format!(
                    "{indent}- [file] {child_rel}\t{}\t{}",
                    fmt_size(size),
                    text_mime(&child_rel)
                ));
            }
        }
        Ok(())
    }

    // Count first for header by walking once into lines buffer
    let mut body = Vec::new();
    if let Err(e) = walk(
        &root,
        &rel,
        0,
        args.recursive,
        &mut body,
        &mut file_count,
        &mut dir_count,
        &mut entry_count,
    ) {
        return err_text(e);
    }

    if body.is_empty() && rel.is_empty() {
        return Ok(ok_text("(工作区为空)"));
    }

    lines.push(format!("root: {}", if rel.is_empty() { "/" } else { &rel }));
    lines.push(format!("folders: {dir_count}, files: {file_count}"));
    lines.extend(body);
    Ok(ok_text(truncate_output(&lines.join("\n"))))
}

#[tauri::command]
pub fn ws_read(app: AppHandle, args: WsReadArgs) -> Result<WsTextResult, String> {
    let workspace = workspace_dir(&app, &args.session_id)?;
    let rel = match normalize_rel(&args.path, false) {
        Ok(r) => r,
        Err(e) => return err_text(e),
    };
    let path = match resolve_in_workspace(&workspace, &rel) {
        Ok(p) => p,
        Err(e) => return err_text(e),
    };
    if !path.exists() {
        return err_text(format!("文件不存在: {rel}。请先 list_files 或 write_file。"));
    }
    if path.is_dir() {
        return err_text(format!("路径是目录，不是文件: {rel}"));
    }
    let content = match read_text_file(&path) {
        Ok(c) => c,
        Err(e) => return err_text(e),
    };
    let sliced = match apply_lines(&content, args.lines.as_deref()) {
        Ok(s) => s,
        Err(e) => return err_text(e),
    };
    Ok(ok_text(truncate_output(&sliced)))
}

#[tauri::command]
pub fn ws_write(app: AppHandle, args: WsWriteArgs) -> Result<WsTextResult, String> {
    let workspace = workspace_dir(&app, &args.session_id)?;
    let rel = match normalize_rel(&args.path, false) {
        Ok(r) => r,
        Err(e) => return err_text(e),
    };
    if is_hidden_entry(Path::new(&rel).file_name().and_then(|n| n.to_str()).unwrap_or("")) {
        return err_text("不能写入系统保留文件");
    }
    let path = match resolve_in_workspace(&workspace, &rel) {
        Ok(p) => p,
        Err(e) => return err_text(e),
    };
    if path.exists() && path.is_dir() {
        return err_text(format!("目标是目录: {rel}"));
    }
    let before = if path.is_file() {
        read_text_file(&path).unwrap_or_default()
    } else {
        String::new()
    };
    let existed = path.is_file();
    let content = args.content;
    if let Err(e) = atomic_write(&path, &content) {
        return err_text(e);
    }
    let d = diff_text(&rel, &before, &content);
    let msg = format!(
        "{} {rel}（{}）{}",
        if existed { "已更新" } else { "已创建" },
        fmt_size(content.len() as u64),
        if d.is_empty() {
            "\n\n内容未变化。".to_string()
        } else {
            format!("\n\n{d}")
        }
    );
    let changes = vec![json!({ "path": rel, "operation": if existed { "updated" } else { "created" } })];
    emit_changed(&app, &args.session_id, &changes);
    let _ = args.mime; // reserved
    Ok(ok_with_changes(truncate_output(&msg), changes))
}

fn regex_replace(before: &str, find: &str, replace: &str, all: bool, flags: &str) -> Result<String, String> {
    let mut flag_chars: String = flags
        .chars()
        .filter(|c| matches!(c, 'i' | 'm' | 's' | 'u' | 'x'))
        .collect();
    // strip g; handled by all
    flag_chars = flag_chars.replace('g', "");
    let mut builder = regex::RegexBuilder::new(find);
    if flag_chars.contains('i') {
        builder.case_insensitive(true);
    }
    if flag_chars.contains('m') {
        builder.multi_line(true);
    }
    if flag_chars.contains('s') {
        builder.dot_matches_new_line(true);
    }
    if flag_chars.contains('u') {
        builder.unicode(true);
    }
    if flag_chars.contains('x') {
        builder.ignore_whitespace(true);
    }
    let re = builder.build().map_err(|e| format!("正则表达式无效: {e}"))?;
    if !re.is_match(before) {
        return Err(format!(
            "未找到匹配内容，当前文件前 200 字符为：\n{}",
            file_head(before)
        ));
    }
    if all {
        Ok(re.replace_all(before, replace).into_owned())
    } else {
        Ok(re.replace(before, replace).into_owned())
    }
}

fn replace_ignoring_whitespace(before: &str, find: &str, replace: &str, all: bool) -> Result<String, String> {
    let needle: String = find.chars().filter(|c| !c.is_whitespace()).collect();
    if needle.is_empty() {
        return Err("ignoreWhitespace 模式下 find 不能只包含空白字符".into());
    }
    let mut chars = Vec::new();
    let mut map = Vec::new();
    for (i, ch) in before.char_indices() {
        if !ch.is_whitespace() {
            chars.push(ch);
            map.push(i);
        }
    }
    let hay: String = chars.iter().collect();
    let mut spans: Vec<(usize, usize)> = Vec::new();
    let mut pos = 0usize;
    while pos <= hay.len() {
        if let Some(idx) = hay[pos..].find(&needle) {
            let start = pos + idx;
            let end = start + needle.len();
            // map char indices in hay to byte indices in before
            let b_start = map[start];
            let b_end = if end == 0 {
                b_start
            } else {
                let last_char_start = map[end - 1];
                let last_ch = before[last_char_start..].chars().next().unwrap();
                last_char_start + last_ch.len_utf8()
            };
            spans.push((b_start, b_end));
            if !all {
                break;
            }
            pos = end.max(start + 1);
        } else {
            break;
        }
    }
    if spans.is_empty() {
        return Err(format!(
            "未找到匹配内容，当前文件前 200 字符为：\n{}",
            file_head(before)
        ));
    }
    let mut out = String::new();
    let mut last = 0usize;
    for (s, e) in spans {
        out.push_str(&before[last..s]);
        out.push_str(replace);
        last = e;
    }
    out.push_str(&before[last..]);
    Ok(out)
}

#[tauri::command]
pub fn ws_edit(app: AppHandle, args: WsEditArgs) -> Result<WsTextResult, String> {
    let workspace = workspace_dir(&app, &args.session_id)?;
    let rel = match normalize_rel(&args.path, false) {
        Ok(r) => r,
        Err(e) => return err_text(e),
    };
    let path = match resolve_in_workspace(&workspace, &rel) {
        Ok(p) => p,
        Err(e) => return err_text(e),
    };
    if !path.is_file() {
        return err_text(format!("文件不存在: {rel}。请先 list_files 或 write_file。"));
    }
    if args.find.is_empty() {
        return err_text("缺少 find 参数");
    }
    if args.use_regex && args.ignore_whitespace {
        return err_text("useRegex 和 ignoreWhitespace 不能同时使用，请二选一");
    }
    let before = match read_text_file(&path) {
        Ok(c) => c,
        Err(e) => return err_text(e),
    };
    let after = if args.use_regex {
        match regex_replace(
            &before,
            &args.find,
            &args.replace,
            args.all,
            args.regex_flags.as_deref().unwrap_or(""),
        ) {
            Ok(s) => s,
            Err(e) => return err_text(e),
        }
    } else if args.ignore_whitespace {
        match replace_ignoring_whitespace(&before, &args.find, &args.replace, args.all) {
            Ok(s) => s,
            Err(e) => return err_text(e),
        }
    } else {
        if !before.contains(&args.find) {
            return err_text(format!(
                "未找到匹配内容，当前文件前 200 字符为：\n{}",
                file_head(&before)
            ));
        }
        if args.all {
            before.replace(&args.find, &args.replace)
        } else {
            before.replacen(&args.find, &args.replace, 1)
        }
    };
    if after.len() as u64 > MAX_FILE_BYTES {
        return err_text(format!("内容超过 {} 上限", fmt_size(MAX_FILE_BYTES)));
    }
    if let Err(e) = atomic_write(&path, &after) {
        return err_text(e);
    }
    let mode = if args.use_regex {
        "正则"
    } else if args.ignore_whitespace {
        "忽略空白"
    } else {
        "精确"
    };
    let scope = if args.all { "全部匹配" } else { "首个匹配" };
    let d = diff_text(&rel, &before, &after);
    let msg = format!("已修改 {rel}（{mode}，{scope}）\n\n{d}");
    let changes = vec![json!({ "path": rel, "operation": "updated" })];
    emit_changed(&app, &args.session_id, &changes);
    Ok(ok_with_changes(truncate_output(&msg), changes))
}

#[tauri::command]
pub fn ws_delete(app: AppHandle, args: WsDeleteArgs) -> Result<WsTextResult, String> {
    let workspace = workspace_dir(&app, &args.session_id)?;
    let mut input: Vec<String> = Vec::new();
    if let Some(paths) = args.paths {
        input.extend(paths);
    }
    if let Some(p) = args.path {
        if !p.trim().is_empty() {
            input.push(p);
        }
    }
    let paths: Vec<String> = input
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if paths.is_empty() {
        return err_text("缺少 path 或 paths 参数");
    }
    if paths.len() > MAX_DELETE_PATHS {
        return err_text(format!("单次最多删除 {MAX_DELETE_PATHS} 个路径"));
    }

    let mut deleted_files = Vec::new();
    let mut deleted_folders = Vec::new();
    let mut missing = Vec::new();
    let mut changes = Vec::new();

    for raw in &paths {
        let rel = match normalize_rel(raw, false) {
            Ok(r) => r,
            Err(e) => return err_text(e),
        };
        let path = match resolve_in_workspace(&workspace, &rel) {
            Ok(p) => p,
            Err(e) => return err_text(e),
        };
        if !path.exists() {
            missing.push(rel);
            continue;
        }
        if path.is_dir() {
            fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
            deleted_folders.push(rel.clone());
            changes.push(json!({ "path": rel, "operation": "deleted" }));
        } else {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
            deleted_files.push(rel.clone());
            changes.push(json!({ "path": rel, "operation": "deleted" }));
        }
    }

    if deleted_files.is_empty() && deleted_folders.is_empty() {
        return err_text(format!("未找到可删除路径: {}", missing.join(", ")));
    }
    let mut lines = vec![format!(
        "已删除 {} 个文件、{} 个文件夹。",
        deleted_files.len(),
        deleted_folders.len()
    )];
    if !deleted_folders.is_empty() {
        lines.push(format!("文件夹：{}", deleted_folders.join(", ")));
    }
    if !deleted_files.is_empty() {
        lines.push(format!("文件：{}", deleted_files.join(", ")));
    }
    if !missing.is_empty() {
        lines.push(format!("未找到：{}", missing.join(", ")));
    }
    emit_changed(&app, &args.session_id, &changes);
    Ok(ok_with_changes(lines.join("\n"), changes))
}

#[tauri::command]
pub fn ws_mkdir(app: AppHandle, args: WsPathArgs) -> Result<WsTextResult, String> {
    let workspace = workspace_dir(&app, &args.session_id)?;
    let rel = match normalize_rel(&args.path, false) {
        Ok(r) => r,
        Err(e) => return err_text(e),
    };
    let path = match resolve_in_workspace(&workspace, &rel) {
        Ok(p) => p,
        Err(e) => return err_text(e),
    };
    if path.exists() {
        if path.is_dir() {
            return Ok(ok_text(format!("已创建文件夹 {rel}")));
        }
        return err_text(format!("同名文件已存在，不能创建文件夹: {rel}"));
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let changes = vec![json!({ "path": rel, "operation": "created" })];
    emit_changed(&app, &args.session_id, &changes);
    Ok(ok_with_changes(format!("已创建文件夹 {rel}"), changes))
}

#[tauri::command]
pub fn ws_move(app: AppHandle, args: WsMoveArgs) -> Result<WsTextResult, String> {
    let workspace = workspace_dir(&app, &args.session_id)?;
    let from = match normalize_rel(&args.from, false) {
        Ok(r) => r,
        Err(e) => return err_text(e),
    };
    let mut to = match normalize_rel(&args.to, false) {
        Ok(r) => r,
        Err(e) => return err_text(e),
    };
    if from == to {
        return Ok(ok_text(format!("路径未变化：{from}")));
    }
    if to.starts_with(&(from.clone() + "/")) {
        return err_text("不能把文件夹移动到它自己的子目录中");
    }
    let from_path = match resolve_in_workspace(&workspace, &from) {
        Ok(p) => p,
        Err(e) => return err_text(e),
    };
    if !from_path.exists() {
        return err_text(format!("源路径不存在: {from}"));
    }

    let mut to_path = match resolve_in_workspace(&workspace, &to) {
        Ok(p) => p,
        Err(e) => return err_text(e),
    };

    // If moving file into existing folder, nest basename
    if from_path.is_file() && to_path.is_dir() {
        let base = from_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file");
        to = format!("{to}/{base}");
        to_path = match resolve_in_workspace(&workspace, &to) {
            Ok(p) => p,
            Err(e) => return err_text(e),
        };
    }

    if to_path.exists() && !args.overwrite {
        return err_text(format!(
            "目标已存在: {to}。如需覆盖，请传 overwrite: true"
        ));
    }
    if to_path.exists() && args.overwrite {
        if to_path.is_dir() {
            fs::remove_dir_all(&to_path).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(&to_path).map_err(|e| e.to_string())?;
        }
    }
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&from_path, &to_path).map_err(|e| e.to_string())?;
    let kind = if to_path.is_dir() { "文件夹" } else { "文件" };
    let msg = format!("已移动{kind} {from} -> {to}");
    let changes = vec![
        json!({ "path": from, "operation": "deleted" }),
        json!({ "path": to, "operation": "created" }),
    ];
    emit_changed(&app, &args.session_id, &changes);
    Ok(ok_with_changes(msg, changes))
}

#[tauri::command]
pub fn ws_exists(app: AppHandle, args: WsPathArgs) -> Result<WsTextResult, String> {
    let workspace = workspace_dir(&app, &args.session_id)?;
    let rel = match normalize_rel(&args.path, false) {
        Ok(r) => r,
        Err(e) => return err_text(e),
    };
    let path = match resolve_in_workspace(&workspace, &rel) {
        Ok(p) => p,
        Err(e) => return err_text(e),
    };
    let value = if path.is_file() {
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        json!({
            "path": rel,
            "exists": true,
            "type": "file",
            "size": size,
            "mime": text_mime(&rel),
        })
    } else if path.is_dir() {
        json!({
            "path": rel,
            "exists": true,
            "type": "folder",
        })
    } else {
        json!({
            "path": rel,
            "exists": false,
            "type": "missing",
        })
    };
    Ok(ok_text(
        serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
    ))
}

#[tauri::command]
pub fn ws_stat_tree(app: AppHandle, args: WsSessionArgs) -> Result<Value, String> {
    let workspace = workspace_dir(&app, &args.session_id)?;
    fn build_node(path: &Path, rel: &str, depth: usize) -> Result<Value, String> {
        if depth > MAX_LIST_DEPTH {
            return Ok(json!({ "name": rel, "type": "folder", "children": [] }));
        }
        let mut children = Vec::new();
        let mut entries: Vec<_> = fs::read_dir(path)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .collect();
        entries.sort_by(|a, b| {
            let a_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let b_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
            match (a_dir, b_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.file_name().cmp(&b.file_name()),
            }
        });
        for entry in entries {
            if children.len() >= MAX_LIST_ENTRIES {
                break;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_hidden_entry(&name) {
                continue;
            }
            let child_rel = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            let ft = entry.file_type().map_err(|e| e.to_string())?;
            if ft.is_dir() {
                children.push(build_node(&entry.path(), &child_rel, depth + 1)?);
            } else if ft.is_file() {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                children.push(json!({
                    "name": name,
                    "path": child_rel,
                    "type": "file",
                    "size": size,
                    "mime": text_mime(&child_rel),
                }));
            }
        }
        let name = if rel.is_empty() {
            "/".into()
        } else {
            Path::new(rel)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(rel)
                .to_string()
        };
        Ok(json!({
            "name": name,
            "path": rel,
            "type": "folder",
            "children": children,
        }))
    }

    let root = if workspace.exists() {
        build_node(&workspace, "", 0)?
    } else {
        json!({ "name": "/", "path": "", "type": "folder", "children": [] })
    };
    Ok(json!({
        "workspacePath": workspace.to_string_lossy(),
        "tree": root,
    }))
}
