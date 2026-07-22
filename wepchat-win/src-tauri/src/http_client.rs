//! Provider HTTP client (Rust-side).
//! WebView cannot call third-party APIs directly (CORS); all model traffic goes here.

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const STREAM_CONNECT_TIMEOUT_MS: u64 = 45_000;
/// Soft upper bound for a full stream; idle/first-byte timeouts live on the JS side.
const STREAM_TOTAL_TIMEOUT_MS: u64 = 600_000;

pub type AbortRegistry = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

pub fn new_abort_registry() -> AbortRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestArgs {
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpStreamArgs {
    pub request_id: String,
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamEvent {
    request_id: String,
    event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chunk: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn parse_method(raw: &str) -> Result<Method, String> {
    Method::from_bytes(raw.trim().as_bytes()).map_err(|e| format!("无效 HTTP 方法: {e}"))
}

fn build_headers(map: &Option<HashMap<String, String>>) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    if let Some(map) = map {
        for (k, v) in map {
            let name = HeaderName::from_bytes(k.as_bytes())
                .map_err(|e| format!("无效请求头名 {k}: {e}"))?;
            let value = HeaderValue::from_str(v)
                .map_err(|e| format!("无效请求头值 {k}: {e}"))?;
            headers.insert(name, value);
        }
    }
    Ok(headers)
}

fn shared_client() -> Result<&'static Client, String> {
    use std::sync::OnceLock;
    static CLIENT: OnceLock<Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let client = Client::builder()
        .user_agent(concat!("WePChat/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_millis(STREAM_CONNECT_TIMEOUT_MS))
        .pool_max_idle_per_host(4)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let _ = CLIENT.set(client);
    CLIENT
        .get()
        .ok_or_else(|| "HTTP 客户端初始化失败".to_string())
}

fn header_map_to_json(map: &HeaderMap) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (k, v) in map.iter() {
        if let Ok(val) = v.to_str() {
            out.insert(k.as_str().to_string(), val.to_string());
        }
    }
    out
}

fn map_reqwest_error(err: reqwest::Error, url: &str) -> String {
    if err.is_timeout() {
        format!("请求超时: {url}")
    } else if err.is_connect() {
        format!("无法连接: {url}")
    } else {
        format!("网络请求失败: {err}")
    }
}

#[tauri::command]
pub async fn http_request(args: HttpRequestArgs) -> Result<HttpResponse, String> {
    let method = parse_method(&args.method)?;
    let headers = build_headers(&args.headers)?;
    let timeout = Duration::from_millis(args.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).max(1));
    let client = shared_client()?;

    let mut builder = client
        .request(method, &args.url)
        .headers(headers)
        .timeout(timeout);

    if let Some(body) = args.body.as_ref() {
        builder = builder.body(body.clone());
    }

    let response = builder
        .send()
        .await
        .map_err(|e| map_reqwest_error(e, &args.url))?;

    let status = response.status().as_u16();
    let resp_headers = header_map_to_json(response.headers());
    let body = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;

    Ok(HttpResponse {
        status,
        headers: resp_headers,
        body,
    })
}

#[tauri::command]
pub async fn http_stream(
    app: AppHandle,
    registry: State<'_, AbortRegistry>,
    args: HttpStreamArgs,
) -> Result<(), String> {
    let request_id = args.request_id.trim().to_string();
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("requestId 无效".into());
    }

    let method = parse_method(&args.method)?;
    let headers = build_headers(&args.headers)?;
    let client = shared_client()?;
    let aborted = Arc::new(AtomicBool::new(false));

    {
        let mut guard = registry
            .lock()
            .map_err(|_| "中断注册表锁定失败".to_string())?;
        guard.insert(request_id.clone(), Arc::clone(&aborted));
    }

    let cleanup = |registry: &AbortRegistry, id: &str| {
        if let Ok(mut guard) = registry.lock() {
            guard.remove(id);
        }
    };

    let emit = |event: StreamEvent| {
        let _ = app.emit("http-stream", event);
    };

    if aborted.load(Ordering::SeqCst) {
        cleanup(&registry, &request_id);
        emit(StreamEvent {
            request_id: request_id.clone(),
            event: "error".into(),
            status: None,
            chunk: None,
            message: Some("请求已取消".into()),
        });
        return Ok(());
    }

    // Connect timeout is configured on the shared Client.
    let mut builder = client
        .request(method, &args.url)
        .headers(headers)
        .timeout(Duration::from_millis(STREAM_TOTAL_TIMEOUT_MS));

    if let Some(body) = args.body.as_ref() {
        builder = builder.body(body.clone());
    }

    let response = match builder.send().await {
        Ok(r) => r,
        Err(e) => {
            let message = if aborted.load(Ordering::SeqCst) {
                "请求已取消".to_string()
            } else {
                map_reqwest_error(e, &args.url)
            };
            emit(StreamEvent {
                request_id: request_id.clone(),
                event: "error".into(),
                status: None,
                chunk: None,
                message: Some(message),
            });
            cleanup(&registry, &request_id);
            return Ok(());
        }
    };

    let status = response.status();
    let status_code = status.as_u16();
    emit(StreamEvent {
        request_id: request_id.clone(),
        event: "start".into(),
        status: Some(status_code),
        chunk: None,
        message: None,
    });

    if aborted.load(Ordering::SeqCst) {
        emit(StreamEvent {
            request_id: request_id.clone(),
            event: "error".into(),
            status: Some(status_code),
            chunk: None,
            message: Some("请求已取消".into()),
        });
        cleanup(&registry, &request_id);
        return Ok(());
    }

    // Non-success: drain body once and surface as error (JS still gets body for extractError).
    if !status.is_success() && status != StatusCode::OK {
        let body = response.text().await.unwrap_or_default();
        emit(StreamEvent {
            request_id: request_id.clone(),
            event: "error".into(),
            status: Some(status_code),
            chunk: if body.is_empty() { None } else { Some(body) },
            message: Some(format!("HTTP {status_code}")),
        });
        cleanup(&registry, &request_id);
        return Ok(());
    }

    let mut stream = response.bytes_stream();
    while let Some(item) = stream.next().await {
        if aborted.load(Ordering::SeqCst) {
            emit(StreamEvent {
                request_id: request_id.clone(),
                event: "error".into(),
                status: Some(status_code),
                chunk: None,
                message: Some("请求已取消".into()),
            });
            cleanup(&registry, &request_id);
            return Ok(());
        }
        match item {
            Ok(bytes) => {
                if bytes.is_empty() {
                    continue;
                }
                // Provider SSE is UTF-8 text; lossy decode avoids hard-fail on rare partials.
                let chunk = String::from_utf8_lossy(&bytes).into_owned();
                emit(StreamEvent {
                    request_id: request_id.clone(),
                    event: "chunk".into(),
                    status: Some(status_code),
                    chunk: Some(chunk),
                    message: None,
                });
            }
            Err(e) => {
                let message = if aborted.load(Ordering::SeqCst) {
                    "请求已取消".to_string()
                } else {
                    format!("读取流失败: {e}")
                };
                emit(StreamEvent {
                    request_id: request_id.clone(),
                    event: "error".into(),
                    status: Some(status_code),
                    chunk: None,
                    message: Some(message),
                });
                cleanup(&registry, &request_id);
                return Ok(());
            }
        }
    }

    emit(StreamEvent {
        request_id: request_id.clone(),
        event: "done".into(),
        status: Some(status_code),
        chunk: None,
        message: None,
    });
    cleanup(&registry, &request_id);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpStreamAbortArgs {
    pub request_id: String,
}

#[tauri::command]
pub fn http_stream_abort(
    registry: State<'_, AbortRegistry>,
    args: HttpStreamAbortArgs,
) -> Result<(), String> {
    let id = args.request_id.trim();
    if id.is_empty() {
        return Err("requestId 无效".into());
    }
    let guard = registry
        .lock()
        .map_err(|_| "中断注册表锁定失败".to_string())?;
    if let Some(flag) = guard.get(id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}
