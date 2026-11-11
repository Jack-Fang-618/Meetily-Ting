//! Offline Qwen worker. Model installation and inference are separate operations.
use super::provider::{TranscriptResult, TranscriptionError, TranscriptionProvider};
use async_trait::async_trait;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex,
};

static WORKER: Lazy<Mutex<Option<Worker>>> = Lazy::new(|| Mutex::new(None));
static PREPARE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static PREPARATION: Lazy<Mutex<Option<(String, String)>>> = Lazy::new(|| Mutex::new(None));
static CANCEL_PREPARATION: Lazy<tokio::sync::watch::Sender<bool>> = Lazy::new(|| tokio::sync::watch::channel(false).0);
const CATALOG: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tools/cantonese/catalog.json"
));

#[derive(Clone, Deserialize, Serialize)]
pub struct ModelSpec {
    pub id: String,
    pub label: String,
    pub size_mb: u32,
}
#[derive(Serialize)]
pub struct ModelStatus {
    pub id: String,
    pub label: String,
    pub size_mb: u32,
    pub installed: bool,
}
#[derive(Serialize)]
pub struct LocalStatus {
    pub runtime_ready: bool,
    pub experimental_models: bool,
    pub preparing: bool,
    pub preparing_model: Option<String>,
    pub preparation_message: Option<String>,
    pub preparation_progress: Option<f64>,
    pub models: Vec<ModelStatus>,
}

fn runtime_root() -> PathBuf {
    #[cfg(target_os = "macos")]
    if let Ok(exe) = std::env::current_exe() {
        if let Some(contents) = exe.parent().and_then(Path::parent) {
            if contents.ends_with("Contents") {
                return contents.join("Resources/ting-local");
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn runtime() -> PathBuf {
    runtime_root().join(".ting-runtime/bin/python")
}
pub(crate) fn python_command() -> Command {
    let mut command = Command::new(runtime());
    command.env_remove("PYTHONHOME").env_remove("PYTHONPATH")
        .env("PYTHONNOUSERSITE", "1").env("PYTHONDONTWRITEBYTECODE", "1");
    command
}
pub(crate) fn script(name: &str) -> PathBuf {
    runtime_root().join("tools/cantonese").join(name)
}
pub fn root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("models/cantonese"))
        .map_err(|e| e.to_string())
}
fn supported() -> bool {
    cfg!(all(target_os = "macos", target_arch = "aarch64"))
}
fn known(id: &str) -> bool {
    serde_json::from_str::<Vec<ModelSpec>>(CATALOG)
        .unwrap()
        .iter()
        .any(|m| m.id == id)
}
fn installed(root: &Path, id: &str) -> bool {
    if !known(id) {
        return false;
    }
    let spec: Vec<Value> = serde_json::from_str(CATALOG).unwrap();
    let expected = spec.iter().find(|s| s["id"] == id).unwrap();
    let marker = std::fs::read(root.join(id).join("ting-ready.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    marker
        .as_ref()
        .map(|m| &m["spec"] == expected)
        .unwrap_or(false)
        && root.join(id).join("config.json").is_file()
        && std::fs::read_dir(root.join(id)).ok().map(|entries| entries.flatten().any(|e|
            e.path().extension().and_then(|x| x.to_str()) == Some("safetensors")
            && e.metadata().map(|m| m.len() > 8).unwrap_or(false)
        )).unwrap_or(false)
}

#[tauri::command]
pub async fn cantonese_status<R: Runtime>(app: AppHandle<R>) -> Result<LocalStatus, String> {
    let root = root(&app)?;
    let models = serde_json::from_str::<Vec<ModelSpec>>(CATALOG)
        .unwrap()
        .into_iter()
        .filter(|s| cfg!(debug_assertions) || s.id.starts_with("qwen3-asr-"))
        .map(|s| {
            let ready = installed(&root, &s.id);
            ModelStatus {
                id: s.id,
                label: s.label,
                size_mb: s.size_mb,
                installed: ready,
            }
        })
        .collect();
    let preparation = PREPARATION.lock().await.clone();
    Ok(LocalStatus {
        experimental_models: cfg!(debug_assertions),
        runtime_ready: supported() && runtime().is_file() && script("worker.py").is_file(),
        preparing: PREPARE_LOCK.try_lock().is_err(),
        preparing_model: preparation.as_ref().map(|p| p.0.clone()),
        preparation_message: preparation.as_ref().map(|p| preparation_update(&p.1).0),
        preparation_progress: preparation.as_ref().and_then(|p| preparation_update(&p.1).1),
        models,
    })
}

fn preparation_update(line: &str) -> (String, Option<f64>) {
    if let Ok(value) = serde_json::from_str::<Value>(line) {
        if value["type"] == "preparation-progress" {
            if let Some(message) = value["message"].as_str() {
                let progress = value["progress"].as_f64().filter(|p| p.is_finite() && (0.0..=100.0).contains(p));
                return (message.to_owned(), progress);
            }
        }
    }
    (line.to_owned(), None)
}

#[tauri::command]
pub async fn cantonese_prepare_model<R: Runtime>(
    app: AppHandle<R>,
    model: String,
) -> Result<(), String> {
    if !cfg!(debug_assertions) && !model.starts_with("qwen3-asr-") {
        return Err("This experimental model is available in development builds.".into());
    }
    if !known(&model) && model != "buzz-cantonese" {
        return Err("Unknown Cantonese model".into());
    }
    if !supported() || !runtime().is_file() {
        return Err(
            "Local runtime missing. Run tools/cantonese/setup.sh on Apple Silicon first.".into(),
        );
    }
    let _lifecycle = crate::audio::common::try_engine_lifecycle_lock()?;
    let _guard = PREPARE_LOCK
        .try_lock()
        .map_err(|_| "Another model is being prepared")?;
    if crate::audio::recording_commands::is_recording().await
        || crate::audio::import::is_import_in_progress()
        || crate::audio::retranscription::is_retranscription_in_progress()
    {
        return Err("Stop recording or transcription before preparing a model".into());
    }
    shutdown().await;
    CANCEL_PREPARATION.send_replace(false);
    let mut cancelled = CANCEL_PREPARATION.subscribe();
    *PREPARATION.lock().await = Some((model.clone(), "Starting preparation…".into()));
    let result = prepare_process(&app, &model, &mut cancelled).await;
    *PREPARATION.lock().await = None;
    result
}

async fn prepare_process<R: Runtime>(app: &AppHandle<R>, model: &str, cancelled: &mut tokio::sync::watch::Receiver<bool>) -> Result<(), String> {
    let mut command = python_command();
    #[cfg(unix)] {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    let mut child = command
        .arg("-u")
        .arg(script("prepare.py"))
        .arg("--model")
        .arg(&model)
        .arg("--root")
        .arg(root(&app)?)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut lines =
        BufReader::new(child.stdout.take().ok_or("Missing preparation output")?).lines();
    let mut recent = std::collections::VecDeque::new();
    loop {
        let next = tokio::select! {
            biased;
            _ = cancelled.changed() => {
                stop_preparation(&mut child).await;
                return Err("Preparation cancelled. You can retry the download.".into());
            }
            line = lines.next_line() => line.map_err(|e| e.to_string())?,
        };
        let Some(line) = next else { break; };
        *PREPARATION.lock().await = Some((model.to_owned(), line.clone()));
        let (message, progress) = preparation_update(&line);
        // Only our high-level steps are surfaced; model-library logs stay on stderr.
        recent.push_back(message.clone());
        if recent.len() > 14 {
            recent.pop_front();
        }
        let _ = app.emit(
            "cantonese-preparation",
            json!({"model":model,"message":message,"progress":progress}),
        );
    }
    let status = tokio::select! {
        biased;
        _ = cancelled.changed() => {
            stop_preparation(&mut child).await;
            return Err("Preparation cancelled. You can retry the download.".into());
        }
        status = child.wait() => status.map_err(|e| e.to_string())?,
    };
    if !status.success() {
        return Err(if recent.is_empty() {
            "Model preparation failed; see runtime log".into()
        } else {
            recent.into_iter().collect::<Vec<_>>().join("\n")
        });
    }
    if model == "buzz-cantonese" {
        crate::whisper_engine::commands::whisper_init().await?;
    }
    Ok(())
}

async fn stop_preparation(child: &mut Child) {
    // Preparation may spawn CPU merge/conversion workers. Stop the whole group.
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        let _ = Command::new("/bin/kill").args(["-KILL", "--", &format!("-{pid}")]).status().await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[tauri::command]
pub async fn cantonese_cancel_preparation() -> Result<(), String> {
    if PREPARATION.lock().await.is_some() { CANCEL_PREPARATION.send_replace(true); }
    Ok(())
}

pub async fn delete_prepared(root: &Path, id: &str) -> Result<(), String> {
    if !known(id) { return Err("Unknown Qwen model".into()); }
    let _guard = PREPARE_LOCK.try_lock().map_err(|_| "Wait for model preparation to finish")?;
    shutdown().await;
    // Restrict deletion to catalog IDs in Ting's own model folder; never the shared HF cache.
    for suffix in ["", ".preparing", ".merged"] {
        let path = root.join(format!("{id}{suffix}"));
        if path.exists() { tokio::fs::remove_dir_all(path).await.map_err(|e| e.to_string())?; }
    }
    Ok(())
}

struct Worker {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    root: PathBuf,
}
impl Worker {
    fn spawn(root: &Path) -> Result<Self, String> {
        if !supported() || !runtime().is_file() {
            return Err("Qwen runtime is not installed on this Mac".into());
        }
        let mut child = python_command()
            .arg("-u")
            .arg(script("worker.py"))
            .arg("--root")
            .arg(root)
            .env("HF_HUB_OFFLINE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| e.to_string())?;
        let input = child.stdin.take().ok_or("Missing worker stdin")?;
        let output = BufReader::new(child.stdout.take().ok_or("Missing worker stdout")?);
        Ok(Self {
            child,
            input,
            output,
            root: root.to_owned(),
        })
    }
    async fn call(&mut self, request: Value) -> Result<Value, String> {
        let mut data = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        data.push(b'\n');
        self.input
            .write_all(&data)
            .await
            .map_err(|e| e.to_string())?;
        self.input.flush().await.map_err(|e| e.to_string())?;
        let mut line = String::new();
        if self
            .output
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?
            == 0
        {
            return Err(
                "Local Qwen process exited; retry after checking memory availability".into(),
            );
        }
        let result: Value =
            serde_json::from_str(&line).map_err(|_| "Invalid local worker response")?;
        if result["ok"] != true {
            return Err(result["error"]
                .as_str()
                .unwrap_or("Local inference failed")
                .into());
        }
        Ok(result)
    }
}
async fn rpc(root: &Path, request: Value) -> Result<Value, String> {
    let mut worker = WORKER.lock().await;
    if worker.as_ref().map(|w| w.root != root).unwrap_or(false) {
        *worker = None;
    }
    if worker.is_none() {
        *worker = Some(Worker::spawn(root)?);
    }
    let response = tokio::time::timeout(
        Duration::from_secs(300),
        worker.as_mut().unwrap().call(request),
    )
    .await;
    let result = response.unwrap_or_else(|_| Err("Local Qwen timed out; worker stopped".into()));
    if result.is_err() {
        *worker = None;
    }
    result
}
pub async fn shutdown() {
    let mut worker = WORKER.lock().await;
    if let Some(mut w) = worker.take() {
        let _ = w.child.kill().await;
    }
}

pub struct MlxProvider {
    root: PathBuf,
    model: String,
}
impl MlxProvider {
    pub async fn load(root: PathBuf, model: String) -> Result<Arc<Self>, String> {
        if !installed(&root, &model) {
            return Err(
                "Download and prepare this Qwen model in transcription settings first".into(),
            );
        }
        rpc(&root, json!({"op":"load","model":model})).await?;
        Ok(Arc::new(Self { root, model }))
    }
}
#[tauri::command]
pub async fn cantonese_load_model<R: Runtime>(
    app: AppHandle<R>,
    model: String,
) -> Result<(), String> {
    let _lifecycle = crate::audio::common::try_engine_lifecycle_lock()?;
    if crate::audio::recording_commands::is_recording().await
        || crate::audio::import::is_import_in_progress()
        || crate::audio::retranscription::is_retranscription_in_progress()
    {
        return Err("Stop recording or transcription before switching models".into());
    }
    MlxProvider::load(root(&app)?, model).await.map(|_| ())
}
#[async_trait]
impl TranscriptionProvider for MlxProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> Result<TranscriptResult, TranscriptionError> {
        use super::input_policy::{policy, transcribe_bounded};
        transcribe_bounded(audio, policy("qwen").map_err(TranscriptionError::EngineFailed)?, |part| {
            let language = language.clone();
            async move {
                let result = rpc(&self.root,
                    json!({"op":"transcribe","model":self.model,"samples":part,"language":language})).await?;
                Ok(TranscriptResult { text: result["text"].as_str().unwrap_or_default().into(),
                    confidence: None, is_partial: false })
            }
        }).await.map_err(TranscriptionError::EngineFailed)
    }

    async fn is_model_loaded(&self) -> bool {
        installed(&self.root, &self.model)
    }
    async fn get_current_model(&self) -> Option<String> {
        Some(self.model.clone())
    }
    fn provider_name(&self) -> &'static str {
        "Qwen3-ASR (local MLX)"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preparation_progress_handles_bytes_stages_and_legacy_output() {
        assert_eq!(preparation_update(r#"{"type":"preparation-progress","message":"10 / 20 MiB","progress":50}"#), ("10 / 20 MiB".into(), Some(50.0)));
        assert_eq!(preparation_update(r#"{"type":"preparation-progress","message":"Converting · 8s","progress":null}"#), ("Converting · 8s".into(), None));
        assert_eq!(preparation_update("Preparation failed: disk full"), ("Preparation failed: disk full".into(), None));
        assert_eq!(preparation_update(r#"{"type":"preparation-progress","message":"bad","progress":120}"#).1, None);
    }
    /// Opt-in: uses an existing installation, never downloads weights.
    #[tokio::test]
    #[ignore]
    async fn installed_worker_protocol_smoke() {
        let root =
            PathBuf::from(std::env::var("TING_TEST_MODEL_ROOT").expect("Set TING_TEST_MODEL_ROOT"));
        let provider = MlxProvider::load(root.clone(), "qwen3-asr-0.6b".into())
            .await
            .unwrap();
        let silence = provider
            .transcribe(vec![0.0; 16000], Some("yue".into()))
            .await
            .unwrap();
        assert!(silence.text.is_empty());
        assert!(silence.confidence.is_none());
        assert!(rpc(&root, json!({"op":"load","model":"../../unknown"}))
            .await
            .is_err());
        // An invalid request kills the worker; the next valid request starts cleanly.
        assert!(provider
            .transcribe(vec![0.0; 16000], None)
            .await
            .unwrap()
            .text
            .is_empty());
        shutdown().await;
    }

    #[tokio::test]
    async fn deletion_is_scoped_to_known_model_and_its_staging_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("models");
        let unrelated = dir.path().join("keep");
        std::fs::create_dir_all(&unrelated).unwrap();
        for suffix in ["", ".merged", ".preparing"] {
            std::fs::create_dir_all(root.join(format!("qwen3-asr-0.6b{suffix}"))).unwrap();
        }
        assert!(delete_prepared(&root, "../keep").await.is_err());
        delete_prepared(&root, "qwen3-asr-0.6b").await.unwrap();
        assert!(unrelated.exists());
        assert!(!root.join("qwen3-asr-0.6b").exists());
        assert!(!root.join("qwen3-asr-0.6b.merged").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_reaps_preparation_process() {
        use std::os::unix::process::CommandExt;
        let mut command = Command::new("/bin/sleep");
        command.arg("60");
        command.as_std_mut().process_group(0);
        let mut child = command.spawn().unwrap();
        stop_preparation(&mut child).await;
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn refuses_unknown_paths_and_stale_manifests() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!installed(dir.path(), "../../unexpected"));
        let model = dir.path().join("qwen3-asr-0.6b");
        std::fs::create_dir_all(&model).unwrap();
        std::fs::write(model.join("config.json"), "{}").unwrap();
        std::fs::write(
            model.join("ting-ready.json"),
            r#"{"spec":{"id":"qwen3-asr-0.6b"}}"#,
        )
        .unwrap();
        assert!(!installed(dir.path(), "qwen3-asr-0.6b"));
    }
}
