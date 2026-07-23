mod db;
mod http_client;
mod preview_server;
mod sessions;
mod settings;
mod workspace_fs;

use http_client::{http_request, http_stream, http_stream_abort, AbortRegistry};
use preview_server::{preview_ensure, preview_stage, preview_stop, preview_unstage};
use serde_json::Value;
use settings::{AppSettings, SettingsStore};
use tauri::Manager;
use workspace_fs::{
    ws_delete, ws_edit, ws_exists, ws_list, ws_mkdir, ws_move, ws_read, ws_read_bytes, ws_stat_tree,
    ws_write,
};

#[tauri::command]
fn get_app_meta() -> serde_json::Value {
    serde_json::json!({
        "name": "WePChat",
        "version": env!("CARGO_PKG_VERSION"),
        "platform": "windows",
    })
}

#[tauri::command]
fn get_default_workspace_root(app: tauri::AppHandle) -> Result<String, String> {
    SettingsStore::default_workspace_root(&app)
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    SettingsStore::load(&app)
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    SettingsStore::save(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn resolve_workspace_root(app: tauri::AppHandle) -> Result<String, String> {
    let s = SettingsStore::load(&app)?;
    Ok(SettingsStore::resolve_workspace_root(&app, &s)?)
}

#[tauri::command]
fn get_workspace_info(app: tauri::AppHandle) -> Result<Value, String> {
    sessions::get_workspace_info(app)
}

#[tauri::command]
fn list_sessions(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    sessions::list_sessions(app)
}

#[tauri::command]
fn load_session(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    sessions::load_session(app, id)
}

#[tauri::command]
fn save_session(app: tauri::AppHandle, session: Value) -> Result<Value, String> {
    sessions::save_session(app, session)
}

#[tauri::command]
fn session_upsert_message(
    app: tauri::AppHandle,
    args: sessions::UpsertMessageArgs,
) -> Result<(), String> {
    sessions::upsert_message(app, args)
}

#[tauri::command]
fn delete_session(app: tauri::AppHandle, id: String) -> Result<(), String> {
    sessions::delete_session(app, id)
}

#[tauri::command]
fn copy_session(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    sessions::copy_session(app, id)
}

#[tauri::command]
fn get_session_workspace(app: tauri::AppHandle, id: String) -> Result<String, String> {
    sessions::get_session_workspace(app, id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(http_client::new_abort_registry() as AbortRegistry)
        .setup(|app| {
            let handle = app.handle().clone();
            if let Ok(settings) = SettingsStore::load(&handle) {
                if let Ok(root) = SettingsStore::resolve_workspace_root(&handle, &settings) {
                    let _ = std::fs::create_dir_all(&root);
                }
            }
            if let Ok(data) = handle.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&data);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_meta,
            get_default_workspace_root,
            get_settings,
            save_settings,
            resolve_workspace_root,
            get_workspace_info,
            list_sessions,
            load_session,
            save_session,
            session_upsert_message,
            delete_session,
            copy_session,
            get_session_workspace,
            http_request,
            http_stream,
            http_stream_abort,
            ws_list,
            ws_read,
            ws_read_bytes,
            ws_write,
            ws_edit,
            ws_delete,
            ws_mkdir,
            ws_move,
            ws_exists,
            ws_stat_tree,
            preview_ensure,
            preview_stage,
            preview_unstage,
            preview_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WePChat");
}
