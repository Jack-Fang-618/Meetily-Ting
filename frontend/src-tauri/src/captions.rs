//! Optional, presentation-only caption window. Closing it never controls capture.
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub async fn open_caption_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("ting-captions") {
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(&app, "ting-captions", WebviewUrl::App("captions".into()))
        .title("Ting · Live captions")
        .inner_size(680.0, 220.0)
        .min_inner_size(380.0, 180.0)
        .decorations(false)
        .transparent(true)
        .resizable(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .center()
        .build()
        .map(|_| ())
        .map_err(|_| "Could not open the caption window. Please retry.".into())
}
