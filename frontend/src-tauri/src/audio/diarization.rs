use super::{ffmpeg, retranscription::find_audio_file, transcription::mlx_provider};
use crate::{database::repositories::meeting::MeetingsRepository, state::AppState};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::Mutex;

static RUNNING: Mutex<()> = Mutex::const_new(());

async fn recording(state: &AppState, id: &str) -> Result<PathBuf, String> {
    let meeting = MeetingsRepository::get_meeting_metadata(state.db_manager.pool(), id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Meeting not found")?;
    let folder = meeting
        .folder_path
        .ok_or("This meeting has no saved recording.")?;
    find_audio_file(std::path::Path::new(&folder))
        .and_then(|p| Ok(p.canonicalize()?))
        .map_err(|e| e.to_string())
}

fn model_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models/speaker-diarization-v1"))
}

#[tauri::command]
pub async fn meeting_speakers<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    meeting_id: String,
) -> Result<Value, String> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT analysis,names FROM meeting_speaker_analysis WHERE meeting_id=?")
            .bind(&meeting_id)
            .fetch_optional(state.db_manager.pool())
            .await
            .map_err(|e| e.to_string())?;
    let mut result = json!({"ready":model_dir(&app)?.join("embed.onnx").is_file(),"supported":cfg!(all(target_os="macos",target_arch="aarch64"))});
    if let Some((analysis, names)) = row {
        result["analysis"] = serde_json::from_str(&analysis).map_err(|e| e.to_string())?;
        result["names"] = serde_json::from_str(&names).map_err(|e| e.to_string())?;
        if let Ok(audio) = recording(&state, &meeting_id).await {
            app.asset_protocol_scope()
                .allow_file(&audio)
                .map_err(|e| e.to_string())?;
            result["audio"] = json!(audio);
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn identify_meeting_speakers<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    meeting_id: String,
    speaker_count: Option<i32>,
) -> Result<(), String> {
    let count = speaker_count.unwrap_or(-1);
    if count != -1 && !(2..=10).contains(&count) {
        return Err("Select 2–10 speakers or Auto".into());
    }
    let _job = RUNNING
        .try_lock()
        .map_err(|_| "A speaker analysis is already running.")?;
    let audio = recording(&state, &meeting_id).await?;
    let result = mlx_provider::python_command()
        .arg(mlx_provider::script("diarize.py"))
        .arg(model_dir(&app)?)
        .arg(ffmpeg::find_ffmpeg_path().ok_or("Audio decoder unavailable")?)
        .arg(audio)
        .arg(count.to_string())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| format!("Could not start the local speaker engine: {e}"))?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr)
            .lines()
            .last()
            .unwrap_or("Speaker analysis failed")
            .to_string());
    }
    let analysis: Value = serde_json::from_slice(&result.stdout).map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO meeting_speaker_analysis(meeting_id,analysis) VALUES(?,?) ON CONFLICT(meeting_id) DO UPDATE SET analysis=excluded.analysis,names='{}'")
        .bind(meeting_id).bind(analysis.to_string()).execute(state.db_manager.pool()).await.map_err(|e|e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn rename_meeting_speaker(
    state: State<'_, AppState>,
    meeting_id: String,
    speaker: u32,
    name: String,
) -> Result<(), String> {
    sqlx::query("UPDATE meeting_speaker_analysis SET names=json_set(names,?,?) WHERE meeting_id=?")
        .bind(format!("$.\"{speaker}\""))
        .bind(name.trim())
        .bind(meeting_id)
        .execute(state.db_manager.pool())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
