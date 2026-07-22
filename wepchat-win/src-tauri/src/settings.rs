use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// User-facing app settings. Stored as JSON under the app data directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Custom root for session workspaces. `None` / empty → use platform default.
    #[serde(default)]
    pub workspace_root: Option<String>,
    /// UI theme: "light" | "dark" | "system"
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Provider definitions. API keys are currently stored with the app settings.
    #[serde(default)]
    pub providers: Vec<serde_json::Value>,
    #[serde(default)]
    pub active_provider_id: String,
    #[serde(default)]
    pub active_model: String,
    /// Default system prompt for chat (global; per-session overrides later).
    #[serde(default)]
    pub system_prompt: String,
    /// Optional sampling temperature. `None` → omit from request body.
    #[serde(default)]
    pub temperature: Option<f64>,
    /// Optional max output tokens. `None` → provider / adapter default.
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// Whether to expose agent tools to the model.
    #[serde(default = "default_true")]
    pub agent_enabled: bool,
    /// Max tool→model loops per assistant turn.
    #[serde(default = "default_max_tool_rounds")]
    pub max_tool_rounds: u32,
    /// Max individual tool executions per assistant turn.
    #[serde(default = "default_max_tool_calls")]
    pub max_tool_calls: u32,
}

fn default_theme() -> String {
    "light".into()
}

fn default_true() -> bool {
    true
}

fn default_max_tool_rounds() -> u32 {
    8
}

fn default_max_tool_calls() -> u32 {
    24
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            workspace_root: None,
            theme: default_theme(),
            providers: Vec::new(),
            active_provider_id: String::new(),
            active_model: String::new(),
            system_prompt: String::new(),
            temperature: None,
            max_tokens: None,
            agent_enabled: true,
            max_tool_rounds: default_max_tool_rounds(),
            max_tool_calls: default_max_tool_calls(),
        }
    }
}

pub struct SettingsStore;

impl SettingsStore {
    fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        Ok(dir.join("settings.json"))
    }

    /// Default: Documents/WePChat/workspaces
    pub fn default_workspace_root(app: &AppHandle) -> Result<String, String> {
        let docs = app
            .path()
            .document_dir()
            .map_err(|e| e.to_string())?;
        Ok(docs
            .join("WePChat")
            .join("workspaces")
            .to_string_lossy()
            .into_owned())
    }

    pub fn resolve_workspace_root(app: &AppHandle, settings: &AppSettings) -> Result<String, String> {
        match settings
            .workspace_root
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            Some(custom) => Ok(custom.to_string()),
            None => Self::default_workspace_root(app),
        }
    }

    pub fn load(app: &AppHandle) -> Result<AppSettings, String> {
        let path = Self::settings_path(app)?;
        if !path.exists() {
            return Ok(AppSettings::default());
        }
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())
    }

    pub fn save(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
        let path = Self::settings_path(app)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
        fs::write(&path, raw).map_err(|e| e.to_string())
    }
}
