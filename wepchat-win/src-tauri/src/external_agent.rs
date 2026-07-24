use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::AppHandle;

use crate::settings::SettingsStore;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportedAgent {
    pub kind: String,
    pub name: String,
    pub command: String,
    pub protocol: String,
    pub default_args: Vec<String>,
    pub icon: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetection {
    pub kind: String,
    pub name: String,
    pub command: String,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

fn supported_agents() -> Vec<SupportedAgent> {
    vec![
        SupportedAgent {
            kind: "codex".into(),
            name: "Codex".into(),
            command: "codex".into(),
            protocol: "json-rpc".into(),
            default_args: Vec::new(),
            icon: "codex".into(),
        },
        SupportedAgent {
            kind: "claude".into(),
            name: "Claude Code".into(),
            command: "claude".into(),
            protocol: "cli".into(),
            default_args: Vec::new(),
            icon: "claude".into(),
        },
        SupportedAgent {
            kind: "pi".into(),
            name: "Pi".into(),
            command: "pi".into(),
            protocol: "json-rpc".into(),
            default_args: Vec::new(),
            icon: "pi".into(),
        },
    ]
}

#[tauri::command]
pub fn external_agent_supported() -> Result<Vec<SupportedAgent>, String> {
    Ok(supported_agents())
}

fn windows_existing_command_candidate(raw: &str) -> Option<PathBuf> {
    let path = PathBuf::from(raw.trim());
    if !cfg!(windows) {
        return path.exists().then_some(path);
    }
    if path.extension().is_none() {
        for ext in ["cmd", "exe", "bat", "com", "ps1"] {
            let mut candidate = path.clone();
            candidate.set_extension(ext);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    path.exists().then_some(path)
}

fn has_path_separator(value: &str) -> bool {
    value.contains('\\') || value.contains('/')
}

fn where_command(command: &str) -> Result<Option<String>, String> {
    let output = if cfg!(windows) {
        Command::new("where")
            .arg(command)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
    } else {
        Command::new("which")
            .arg(command)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
    }
    .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(None);
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let lines = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    if cfg!(windows) {
        for line in &lines {
            if let Some(candidate) = windows_existing_command_candidate(line) {
                return Ok(Some(candidate.to_string_lossy().into_owned()));
            }
        }
    }
    Ok(lines.first().map(|line| (*line).to_string()))
}

fn resolve_command_path(path_or_command: &str) -> Result<Option<String>, String> {
    let value = path_or_command.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let path = Path::new(value);
    if path.is_absolute() || has_path_separator(value) {
        return Ok(windows_existing_command_candidate(value).map(|path| path.to_string_lossy().into_owned()));
    }
    where_command(value)
}

fn version_of(path_or_command: &str) -> Option<String> {
    Command::new(path_or_command)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()
        .and_then(|out| {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let text = if !stdout.is_empty() { stdout } else { stderr };
            if text.is_empty() {
                None
            } else {
                Some(text.lines().next().unwrap_or("").trim().to_string())
            }
        })
}

#[tauri::command]
pub fn external_agent_detect_all(app: AppHandle) -> Result<Vec<AgentDetection>, String> {
    let settings = SettingsStore::load(&app).unwrap_or_default();
    let mut out = Vec::new();

    for agent in supported_agents() {
        let manual = settings
            .external_connections
            .agents
            .get(&agent.kind)
            .and_then(|v| v.get("commandPath"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string);
        let detected = if let Some(path_or_command) = manual {
            resolve_command_path(&path_or_command)?
        } else {
            where_command(&agent.command)?
        };

        out.push(AgentDetection {
            kind: agent.kind,
            name: agent.name,
            command: agent.command,
            installed: detected.is_some(),
            version: detected.as_deref().and_then(version_of),
            path: detected,
            error: None,
        });
    }

    Ok(out)
}
