//! Session-scoped static preview HTTP server (127.0.0.1 only).
//! Serves workspace files + in-memory streaming overlay so multi-file HTML/CSS/JS works.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::sessions;

const MAX_STAGE_BYTES: usize = 512 * 1024;
const MAX_STAGE_FILES: usize = 64;

#[derive(Clone)]
struct SessionPreview {
    root: PathBuf,
    token: String,
    port: u16,
    staging: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    stop: Arc<AtomicBool>,
}

struct PreviewRegistry {
    sessions: Mutex<HashMap<String, SessionPreview>>,
}

fn registry() -> &'static PreviewRegistry {
    static REG: OnceLock<PreviewRegistry> = OnceLock::new();
    REG.get_or_init(|| PreviewRegistry {
        sessions: Mutex::new(HashMap::new()),
    })
}

fn random_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}{:x}", nanos, std::process::id())
}

fn normalize_rel(raw: &str) -> Result<String, String> {
    let mut p = raw.trim().replace('\\', "/");
    while p.starts_with('/') {
        p = p[1..].to_string();
    }
    if p.starts_with("./") {
        p = p[2..].to_string();
    }
    if raw.contains("..")
        || raw.contains(':')
        || raw.starts_with('/')
        || raw.starts_with('\\')
        || Path::new(raw.trim()).is_absolute()
    {
        // Allow only clean relative segments; reject `..` components explicitly.
    }
    let parts: Vec<&str> = p
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect();
    for part in &parts {
        if *part == ".." {
            return Err("非法路径".into());
        }
        if part.contains(':') || part.contains('\\') {
            return Err("非法路径".into());
        }
    }
    if parts.is_empty() {
        return Err("路径为空".into());
    }
    Ok(parts.join("/"))
}

fn mime_for(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".html") || lower.ends_with(".htm") {
        "text/html; charset=utf-8"
    } else if lower.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if lower.ends_with(".js") || lower.ends_with(".mjs") {
        "text/javascript; charset=utf-8"
    } else if lower.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else if lower.ends_with(".woff") {
        "font/woff"
    } else if lower.ends_with(".ttf") {
        "font/ttf"
    } else if lower.ends_with(".txt") || lower.ends_with(".md") {
        "text/plain; charset=utf-8"
    } else {
        "application/octet-stream"
    }
}

fn write_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn handle_client(mut stream: TcpStream, session: SessionPreview) {
    let mut buf = [0u8; 8192];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return,
    };
    let req = String::from_utf8_lossy(&buf[..n]);
    let first = req.lines().next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("/");
    if method != "GET" && method != "HEAD" {
        write_response(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain; charset=utf-8",
            b"Method Not Allowed",
        );
        return;
    }

    // /{token}/{path...}  or  /{token}
    let path_only = target.split('?').next().unwrap_or(target);
    let segs: Vec<&str> = path_only.split('/').filter(|s| !s.is_empty()).collect();
    if segs.is_empty() || segs[0] != session.token {
        write_response(
            &mut stream,
            "403 Forbidden",
            "text/plain; charset=utf-8",
            b"Forbidden",
        );
        return;
    }
    let rel = if segs.len() == 1 {
        "index.html".to_string()
    } else {
        match normalize_rel(&segs[1..].join("/")) {
            Ok(r) => r,
            Err(_) => {
                write_response(
                    &mut stream,
                    "400 Bad Request",
                    "text/plain; charset=utf-8",
                    b"Bad path",
                );
                return;
            }
        }
    };

    // Staging overlay first, then workspace disk
    let staged = session
        .staging
        .lock()
        .ok()
        .and_then(|map| map.get(&rel).cloned());
    let body = if let Some(bytes) = staged {
        bytes
    } else {
        let file_path = session.root.join(&rel);
        // Ensure still under root
        let root_canon = session.root.canonicalize().unwrap_or(session.root.clone());
        let file_canon = match file_path.canonicalize() {
            Ok(p) => p,
            Err(_) => {
                write_response(
                    &mut stream,
                    "404 Not Found",
                    "text/plain; charset=utf-8",
                    format!("Not Found: {rel}").as_bytes(),
                );
                return;
            }
        };
        if !file_canon.starts_with(&root_canon) {
            write_response(
                &mut stream,
                "403 Forbidden",
                "text/plain; charset=utf-8",
                b"Forbidden",
            );
            return;
        }
        match fs::read(&file_canon) {
            Ok(b) => b,
            Err(_) => {
                write_response(
                    &mut stream,
                    "404 Not Found",
                    "text/plain; charset=utf-8",
                    format!("Not Found: {rel}").as_bytes(),
                );
                return;
            }
        }
    };

    let mime = mime_for(&rel);
    if method == "HEAD" {
        write_response(&mut stream, "200 OK", mime, &[]);
    } else {
        write_response(&mut stream, "200 OK", mime, &body);
    }
}

fn spawn_server(session: SessionPreview) {
    let stop = session.stop.clone();
    let listener = match TcpListener::bind(("127.0.0.1", session.port)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("preview server bind failed: {e}");
            return;
        }
    };
    let _ = listener.set_nonblocking(true);
    thread::spawn(move || {
        while !stop.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let s = session.clone();
                    thread::spawn(move || handle_client(stream, s));
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(std::time::Duration::from_millis(20));
                }
                Err(_) => break,
            }
        }
    });
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSessionArgs {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStageArgs {
    pub session_id: String,
    pub path: String,
    #[serde(default)]
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewInfo {
    pub base_url: String,
    pub port: u16,
    pub token: String,
    pub session_id: String,
}

#[tauri::command]
pub fn preview_ensure(app: AppHandle, args: PreviewSessionArgs) -> Result<PreviewInfo, String> {
    if !sessions::valid_session_id(&args.session_id) {
        return Err("会话 ID 无效".into());
    }
    let root = sessions::workspace_root(&app)?;
    let dir = sessions::session_dir(&root, &args.session_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut map = registry().sessions.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = map.get(&args.session_id) {
        if existing.root == dir && !existing.stop.load(Ordering::SeqCst) {
            return Ok(PreviewInfo {
                base_url: format!(
                    "http://127.0.0.1:{}/{}/",
                    existing.port, existing.token
                ),
                port: existing.port,
                token: existing.token.clone(),
                session_id: args.session_id,
            });
        }
        existing.stop.store(true, Ordering::SeqCst);
        map.remove(&args.session_id);
    }

    // Bind port 0 to pick free port
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);

    let token = random_token();
    let session = SessionPreview {
        root: dir,
        token: token.clone(),
        port,
        staging: Arc::new(Mutex::new(HashMap::new())),
        stop: Arc::new(AtomicBool::new(false)),
    };
    spawn_server(session.clone());
    map.insert(args.session_id.clone(), session);

    Ok(PreviewInfo {
        base_url: format!("http://127.0.0.1:{port}/{token}/"),
        port,
        token,
        session_id: args.session_id,
    })
}

#[tauri::command]
pub fn preview_stage(app: AppHandle, args: PreviewStageArgs) -> Result<(), String> {
    let _ = app;
    let rel = normalize_rel(&args.path)?;
    let bytes = args.content.into_bytes();
    if bytes.len() > MAX_STAGE_BYTES {
        return Err("预览 staging 文件过大".into());
    }
    let mut map = registry().sessions.lock().map_err(|e| e.to_string())?;
    let session = map
        .get_mut(&args.session_id)
        .ok_or_else(|| "预览服务未启动".to_string())?;
    let mut staging = session.staging.lock().map_err(|e| e.to_string())?;
    if !staging.contains_key(&rel) && staging.len() >= MAX_STAGE_FILES {
        return Err("预览 staging 文件数超限".into());
    }
    staging.insert(rel, bytes);
    Ok(())
}

#[tauri::command]
pub fn preview_unstage(_app: AppHandle, args: PreviewStageArgs) -> Result<(), String> {
    let rel = match normalize_rel(&args.path) {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };
    let mut map = registry().sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = map.get_mut(&args.session_id) {
        if let Ok(mut staging) = session.staging.lock() {
            staging.remove(&rel);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn preview_stop(_app: AppHandle, args: PreviewSessionArgs) -> Result<(), String> {
    let mut map = registry().sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = map.remove(&args.session_id) {
        session.stop.store(true, Ordering::SeqCst);
    }
    Ok(())
}
