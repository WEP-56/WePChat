use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Per-tool-group permission mode: "ask" | "always" | "never".
/// Keys match Android `toolPermissions` (snake_case tool group ids).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolPermissions {
    #[serde(default = "default_perm_ask")]
    pub run_js: String,
    #[serde(default = "default_perm_ask")]
    pub files: String,
    #[serde(default = "default_perm_ask")]
    pub delete_files: String,
    #[serde(default = "default_perm_ask")]
    pub web_fetch: String,
    #[serde(default = "default_perm_ask")]
    pub image_go: String,
}

impl Default for ToolPermissions {
    fn default() -> Self {
        Self {
            run_js: default_perm_ask(),
            files: default_perm_ask(),
            delete_files: default_perm_ask(),
            web_fetch: default_perm_ask(),
            image_go: default_perm_ask(),
        }
    }
}

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
    /// Per-tool-group permissions (ask | always | never). Aligns with Android.
    #[serde(default)]
    pub tool_permissions: ToolPermissions,

    /* ---------- Image generation (align Android store.js) ---------- */
    #[serde(default)]
    pub image_provider_id: String,
    #[serde(default)]
    pub image_model: String,
    #[serde(default)]
    pub image_edit_model: String,
    #[serde(default = "default_image_size")]
    pub image_default_size: String,
    #[serde(default = "default_image_auto")]
    pub image_quality: String,
    #[serde(default = "default_image_auto")]
    pub image_background: String,
    #[serde(default = "default_image_count")]
    pub image_default_count: u32,
    #[serde(default = "default_image_format")]
    pub image_output_format: String,
    #[serde(default)]
    pub image_style_preset_id: String,
    #[serde(default)]
    pub image_style_presets: Vec<serde_json::Value>,
    #[serde(default = "default_image_api_mode")]
    pub image_api_mode: String,
    #[serde(default)]
    pub image_endpoint_path: String,
    #[serde(default)]
    pub image_edit_endpoint_path: String,
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

fn default_perm_ask() -> String {
    "ask".into()
}

fn default_image_size() -> String {
    "auto".into()
}

fn default_image_auto() -> String {
    "auto".into()
}

fn default_image_count() -> u32 {
    1
}

fn default_image_format() -> String {
    "png".into()
}

fn default_image_api_mode() -> String {
    "images".into()
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
            tool_permissions: ToolPermissions::default(),
            image_provider_id: String::new(),
            image_model: String::new(),
            image_edit_model: String::new(),
            image_default_size: default_image_size(),
            image_quality: default_image_auto(),
            image_background: default_image_auto(),
            image_default_count: default_image_count(),
            image_output_format: default_image_format(),
            image_style_preset_id: String::new(),
            image_style_presets: Vec::new(),
            image_api_mode: default_image_api_mode(),
            image_endpoint_path: String::new(),
            image_edit_endpoint_path: String::new(),
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
