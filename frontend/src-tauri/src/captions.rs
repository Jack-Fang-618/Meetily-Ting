//! Optional, presentation-only caption window. Closing it never controls capture.
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
mod native {
    use tauri_nspanel::tauri_panel;
    tauri_panel! { panel!(TingCaptionPanel { config: {
        can_become_key_window: true,
        can_become_main_window: false,
        is_floating_panel: true
    } }) }
}

#[tauri::command]
pub async fn open_caption_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("ting-captions") {
        #[cfg(target_os = "macos")]
        {
            use tauri_nspanel::ManagerExt;
            if let Ok(panel) = app.get_webview_panel("ting-captions") {
                return on_main_thread(&app, move || {
                    if !panel.is_visible() {
                        panel.set_level(tauri_nspanel::PanelLevel::Floating.value());
                    }
                    panel.show();
                    window.emit("caption-visibility", true).map_err(|error| error.to_string())
                }).await;
            }
        }
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let builder = WebviewWindowBuilder::new(&app, "ting-captions", WebviewUrl::App("captions".into()))
        .title("Ting · Live captions")
        .inner_size(720.0, 340.0)
        .min_inner_size(380.0, 280.0)
        .visible(!cfg!(target_os = "macos"))
        .decorations(false)
        .transparent(true)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .theme(Some(tauri::Theme::Dark))
        .resizable(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .center();
    #[cfg(target_os = "macos")]
    let builder = builder.effects(tauri::window::EffectsBuilder::new()
        .effect(tauri::window::Effect::Popover)
        .state(tauri::window::EffectState::Active)
        .radius(16.0)
        .build());
    let window = builder.build()
        .map_err(|_| "Could not open the caption window. Please retry.".to_string())?;
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::{WebviewWindowExt,CollectionBehavior,StyleMask,PanelLevel};
        on_main_thread(&app, move || {
        let panel = window.to_panel::<native::TingCaptionPanel>().map_err(|e|e.to_string())?;
        panel.add_style_mask(StyleMask::empty().nonactivating_panel().resizable().into()).map_err(|e|e.to_string())?;
        panel.set_collection_behavior(CollectionBehavior::new().can_join_all_spaces().full_screen_auxiliary().into());
        panel.set_hides_on_deactivate(false);
        panel.set_level(PanelLevel::Floating.value());
        panel.set_released_when_closed(false);
        panel.show();
        window.emit("caption-visibility", true).map_err(|error| error.to_string())
        }).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn close_caption_window<R:Runtime>(app:AppHandle<R>)->Result<(),String>{
    crate::live_translation::close();
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;
        let handle = app.clone();
        return on_main_thread(&app, move || {
            // Replacing the native class while AppKit is observing nextResponder
            // can invalidate Touch Bar KVO registrations on macOS 15.
            if let Ok(panel) = handle.get_webview_panel("ting-captions") {
                panel.hide();
                handle.emit_to("ting-captions", "caption-visibility", false)
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        }).await;
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("ting-captions") {
            window.close().map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

#[cfg(target_os="macos")]
async fn on_main_thread<R:Runtime>(app:&AppHandle<R>, task:impl FnOnce()->Result<(),String>+Send+'static)->Result<(),String>{
    let (tx,rx)=tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {let _=tx.send(task());}).map_err(|e|e.to_string())?;
    rx.await.map_err(|_|"Caption window operation did not complete".to_string())?
}
