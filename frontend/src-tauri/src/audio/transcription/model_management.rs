//! Model actions share the recording lifecycle lock and persistence boundary.
use tauri::{AppHandle, Manager, Runtime};
use crate::database::repositories::setting::SettingsRepository;
use crate::state::AppState;
use super::mlx_provider;

pub async fn ensure_idle() -> Result<(), String> {
    if crate::audio::recording_commands::is_recording().await
        || crate::audio::import::is_import_in_progress()
        || crate::audio::retranscription::is_retranscription_in_progress() {
        return Err("Stop recording or transcription before changing models".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn select_transcription_model<R: Runtime>(app: AppHandle<R>, provider: String, model: String) -> Result<(), String> {
    let _guard = crate::audio::common::try_engine_lifecycle_lock()?;
    ensure_idle().await?;
    match provider.as_str() {
        "localQwen" => { mlx_provider::MlxProvider::load(mlx_provider::root(&app)?, model.clone()).await?; }
        "localWhisper" => {
            crate::whisper_engine::commands::whisper_init().await?;
            let engine = crate::whisper_engine::commands::WHISPER_ENGINE.lock().unwrap().as_ref().cloned().ok_or("Whisper unavailable")?;
            engine.discover_models().await.map_err(|e| e.to_string())?;
            engine.load_model(&model).await.map_err(|e| e.to_string())?;
        }
        "parakeet" => { crate::parakeet_engine::commands::parakeet_init().await?;
            let engine = crate::parakeet_engine::commands::PARAKEET_ENGINE.lock().unwrap().as_ref().cloned().ok_or("Parakeet unavailable")?;
            engine.discover_models().await.map_err(|e| e.to_string())?;
            engine.load_model(&model).await.map_err(|e| e.to_string())?;
        }
        _ => return Err("Unsupported local transcription provider".into()),
    }
    // No optimistic UI selection: only acknowledge after persistence succeeds.
    let state = app.state::<AppState>();
    SettingsRepository::save_transcript_config(state.db_manager.pool(), &provider, &model).await.map_err(|e| e.to_string())?;
    // Release other engines only after the new selection is committed.
    if provider != "localQwen" { mlx_provider::shutdown().await; }
    if provider != "localWhisper" {
        let engine = crate::whisper_engine::commands::WHISPER_ENGINE.lock().unwrap().as_ref().cloned();
        if let Some(engine) = engine { engine.unload_model().await; }
    }
    if provider != "parakeet" {
        let engine = crate::parakeet_engine::commands::PARAKEET_ENGINE.lock().unwrap().as_ref().cloned();
        if let Some(engine) = engine { engine.unload_model().await; }
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_transcription_model<R: Runtime>(app: AppHandle<R>, provider: String, model: String) -> Result<(), String> {
    let _guard = crate::audio::common::try_engine_lifecycle_lock()?;
    ensure_idle().await?;
    let state = app.state::<AppState>();
    if let Some(current) = SettingsRepository::get_transcript_config(state.db_manager.pool()).await.map_err(|e| e.to_string())? {
        if current.provider == provider && current.model == model {
            return Err("Select another model before deleting the current model".into());
        }
    }
    match provider.as_str() {
        "localQwen" => mlx_provider::delete_prepared(&mlx_provider::root(&app)?, &model).await,
        "localWhisper" => crate::whisper_engine::commands::whisper_delete_corrupted_model(model).await.map(|_| ()),
        "parakeet" => crate::parakeet_engine::commands::parakeet_delete_corrupted_model(model).await.map(|_| ()),
        _ => Err("Unsupported local transcription provider".into()),
    }
}

#[cfg(test)]
mod tests {
    /// Explicit opt-in: uses existing weights and synthetic fixtures, never downloads.
    #[tokio::test]
    #[ignore]
    async fn installed_parakeet_long_audio_smoke() {
        let root = std::path::PathBuf::from(std::env::var("TING_TEST_MODELS").unwrap());
        let audio = std::path::PathBuf::from(std::env::var("TING_TEST_AUDIO").unwrap());
        let samples = crate::audio::decoder::decode_audio_file(&audio).unwrap().to_whisper_format();
        let engine = crate::parakeet_engine::ParakeetEngine::new_with_models_dir(Some(root)).unwrap();
        engine.discover_models().await.unwrap();
        engine.load_model("parakeet-tdt-0.6b-v3-int8").await.unwrap();
        let text = engine.transcribe_audio(samples.repeat(5)).await.unwrap();
        assert!(!text.trim().is_empty());
        assert!(text.to_lowercase().contains("english"), "{text}");
        engine.unload_model().await;
    }
}
