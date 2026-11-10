//! User-owned Bailian Filetrans. No bundled credentials or environment fallback.
use anyhow::{anyhow, bail, Context, Result};
use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager, Runtime};
use tokio::io::AsyncReadExt;

pub const MODELS: [&str; 2] = [
    "qwen-audio-3.1-asr-flash-filetrans",
    "qwen-audio-3.0-asr-flash-filetrans",
];
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct CloudConfig {
    pub enabled: bool,
    pub default_for_files: bool,
    pub region: String,
    pub workspace: String,
    pub model: String,
    pub keep_dialect: bool,
}
impl Default for CloudConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            default_for_files: false,
            region: "beijing".into(),
            workspace: String::new(),
            model: MODELS[0].into(),
            keep_dialect: true,
        }
    }
}
impl CloudConfig {
    pub fn validate(&self) -> Result<()> {
        if !["beijing", "singapore"].contains(&self.region.as_str()) {
            bail!("Unsupported region");
        }
        if !MODELS.contains(&self.model.as_str()) {
            bail!("Unsupported Filetrans model");
        }
        if !self
            .workspace
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || self.workspace.len() > 100
        {
            bail!("Invalid workspace ID");
        }
        Ok(())
    }
    pub fn base(&self) -> String {
        if self.workspace.is_empty() {
            if self.region == "beijing" {
                "https://dashscope.aliyuncs.com".into()
            } else {
                "https://dashscope-intl.aliyuncs.com".into()
            }
        } else {
            format!(
                "https://{}.{}.maas.aliyuncs.com",
                self.workspace,
                if self.region == "beijing" {
                    "cn-beijing"
                } else {
                    "ap-southeast-1"
                }
            )
        }
    }
    fn upload_base(&self) -> &str {
        if self.region == "beijing" {
            "https://dashscope.aliyuncs.com"
        } else {
            "https://dashscope-intl.aliyuncs.com"
        }
    }
}
#[derive(Serialize)]
pub struct CloudStatus {
    pub config: CloudConfig,
    pub has_key: bool,
}
fn root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("aliyun"))
}
fn entry<R: Runtime>(app: &AppHandle<R>, region: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(
        &format!("{}.aliyun", app.config().identifier),
        region,
    )?)
}
fn credential<R: Runtime>(app: &AppHandle<R>, region: &str) -> Result<Option<String>> {
    match entry(app, region)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => bail!("Cannot access the system credential store. Unlock it and retry."),
    }
}
fn read_config(path: &Path) -> Result<CloudConfig> {
    let file = path.join("config.json");
    let c = if file.exists() {
        serde_json::from_slice(&std::fs::read(file)?)?
    } else {
        CloudConfig::default()
    };
    CloudConfig::validate(&c)?;
    Ok(c)
}
fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    use std::io::Write;
    std::fs::create_dir_all(path.parent().unwrap())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            path.parent().unwrap(),
            std::fs::Permissions::from_mode(0o700),
        )?;
    }
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
    file.write_all(&serde_json::to_vec_pretty(value)?)?;
    file.as_file().sync_all()?;
    file.persist(path)
        .map_err(|_| anyhow!("Cannot save cloud task state"))?;
    Ok(())
}
#[tauri::command]
pub async fn aliyun_status<R: Runtime>(app: AppHandle<R>) -> Result<CloudStatus, String> {
    let c = read_config(&root(&app).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let has_key = credential(&app, &c.region)
        .map_err(|e| e.to_string())?
        .is_some();
    Ok(CloudStatus { config: c, has_key })
}
#[tauri::command]
pub async fn aliyun_save_config<R: Runtime>(
    app: AppHandle<R>,
    config: CloudConfig,
    api_key: Option<String>,
) -> Result<(), String> {
    config.validate().map_err(|e| e.to_string())?;
    if let Some(key) = api_key.filter(|s| !s.trim().is_empty()) {
        if key.trim().len() < 10 || key.trim().contains(char::is_whitespace) {
            return Err("Invalid API Key format".into());
        }
        entry(&app, &config.region)
            .map_err(|_| "Credential store unavailable")?
            .set_password(key.trim())
            .map_err(|_| "Could not save API Key in the system credential store")?;
    }
    if config.enabled
        && credential(&app, &config.region)
            .map_err(|e| e.to_string())?
            .is_none()
    {
        return Err("Enter your own API Key for this region first".into());
    }
    write_json(
        &root(&app).map_err(|e| e.to_string())?.join("config.json"),
        &config,
    )
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn aliyun_delete_key<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let path = root(&app).map_err(|e| e.to_string())?;
    let mut c = read_config(&path).map_err(|e| e.to_string())?;
    match entry(&app, &c.region)
        .map_err(|_| "Credential store unavailable")?
        .delete_credential()
    {
        Ok(_) | Err(keyring::Error::NoEntry) => {}
        Err(_) => return Err("Could not remove API Key".into()),
    }
    c.enabled = false;
    write_json(&path.join("config.json"), &c).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn aliyun_test_connection<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let c = read_config(&root(&app).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let key = credential(&app, &c.region)
        .map_err(|e| e.to_string())?
        .ok_or("Save your API Key first")?;
    CloudClient::new(c, key)
        .map_err(|e| e.to_string())?
        .upload_policy()
        .await
        .map_err(|e| e.to_string())?;
    Ok("Credentials and upload access verified. No audio was sent. Model inference is verified only by a transcription.".into())
}

pub struct CloudClient {
    config: CloudConfig,
    key: String,
    http: Client,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CloudSegment {
    pub text: String,
    pub start_ms: f64,
    pub end_ms: f64,
}
#[derive(Serialize, Deserialize)]
struct Journal {
    // No signed URLs, API keys, or original source paths.
    status: String,
    task_id: Option<String>,
    segments: Option<Vec<CloudSegment>>,
}
impl CloudClient {
    pub fn new(config: CloudConfig, key: String) -> Result<Self> {
        config.validate()?;
        if key.trim().is_empty() {
            bail!("Configure your own Alibaba Cloud API Key first");
        }
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(120))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self { config, key, http })
    }
    pub async fn upload_policy(&self) -> Result<Value> {
        let r = self
            .http
            .get(format!("{}/api/v1/uploads", self.config.upload_base()))
            .bearer_auth(&self.key)
            .query(&[("action", "getPolicy"), ("model", &self.config.model)])
            .send()
            .await
            .map_err(|_| anyhow!("Cannot reach Alibaba Cloud. Check your network and region."))?;
        let v = response(r).await?;
        if !v["data"].is_object() {
            bail!("Upload policy is missing");
        }
        Ok(v["data"].clone())
    }
    async fn upload(&self, file: &Path) -> Result<String> {
        let policy = self.upload_policy().await?;
        let size = tokio::fs::metadata(file).await?.len();
        let limit = policy["max_file_size_mb"]
            .as_f64()
            .or_else(|| {
                policy["max_file_size_mb"]
                    .as_str()
                    .and_then(|s| s.parse().ok())
            })
            .ok_or_else(|| anyhow!("Upload policy has no size limit"))?;
        if size == 0 || size > 1024 * 1024 * 1024 || size as f64 > limit * 1024.0 * 1024.0 {
            bail!("File exceeds temporary upload size limit ({limit} MiB, at most 1 GiB)");
        }
        let host = field(&policy, "upload_host")?;
        validate_storage_url(host)?;
        let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("wav");
        let name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
        let object = format!("{}/{}", field(&policy, "upload_dir")?, name);
        let mut form = reqwest::multipart::Form::new()
            .text("key", object.clone())
            .text("success_action_status", "200");
        for (target, source) in [
            ("OSSAccessKeyId", "oss_access_key_id"),
            ("Signature", "signature"),
            ("policy", "policy"),
            ("x-oss-object-acl", "x_oss_object_acl"),
            ("x-oss-forbid-overwrite", "x_oss_forbid_overwrite"),
        ] {
            form = form.text(target, field(&policy, source)?.to_owned());
        }
        let stream = tokio_util::io::ReaderStream::new(tokio::fs::File::open(file).await?);
        form = form.part(
            "file",
            reqwest::multipart::Part::stream_with_length(reqwest::Body::wrap_stream(stream), size)
                .file_name(name),
        );
        let r = self
            .http
            .post(host)
            .multipart(form)
            .timeout(Duration::from_secs(1800))
            .send()
            .await
            .map_err(|_| anyhow!("Audio upload failed. Check your network and retry."))?;
        if !r.status().is_success() {
            bail!("Audio upload failed (HTTP {})", r.status().as_u16());
        }
        Ok(format!("oss://{object}"))
    }
    /// Persistent content-addressed jobs prevent resubmitting known tasks on retry.
    pub async fn transcribe<F, C>(
        &self,
        file: &Path,
        jobs: &Path,
        language: Option<&str>,
        progress: F,
        cancelled: C,
    ) -> Result<Vec<CloudSegment>>
    where
        F: Fn(&str),
        C: Fn() -> bool,
    {
        let params = parameters(&self.config, language)?;
        let mut hash = Sha256::new();
        hash.update(serde_json::to_vec(&json!([
            self.config.base(),
            self.config.model,
            params
        ]))?);
        hash.update(Sha256::digest(self.key.as_bytes())); // Scope cache to credential; never persist the credential.
        let mut input = tokio::fs::File::open(file).await?;
        let mut buffer = vec![0; 65536];
        loop {
            let n = input.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            hash.update(&buffer[..n]);
            if cancelled() {
                bail!("Import cancelled before upload");
            }
        }
        let path = jobs.join(format!("{:x}.json", hash.finalize()));
        let mut job = if path.exists() {
            serde_json::from_slice::<Journal>(&std::fs::read(&path)?)?
        } else {
            Journal {
                status: "new".into(),
                task_id: None,
                segments: None,
            }
        };
        if let Some(segments) = job.segments {
            progress("Using saved cloud result (no new transcription charge)");
            return Ok(segments);
        }
        if job.status == "submitting" && job.task_id.is_none() {
            bail!("Previous submission status is unknown. Check your Alibaba Cloud tasks before retrying; Ting will not automatically create another billable task.");
        }
        if job.status == "failed" {
            bail!("Previous cloud task failed. Check the task in Alibaba Cloud before submitting it again.");
        }
        if job.task_id.is_none() {
            progress("Uploading audio to Alibaba Cloud temporary storage...");
            let upload = tokio::select! {
                result = self.upload(file) => result?,
                _ = async { while !cancelled() { tokio::time::sleep(Duration::from_millis(250)).await; } } => {
                    bail!("Upload stopped. Any completed temporary copy expires within 48 hours.");
                }
            };
            if cancelled() {
                bail!("Import cancelled. The uploaded copy expires within 48 hours.");
            }
            job.status = "submitting".into();
            write_json(&path, &job)?;
            progress("Submitting cloud transcription...");
            let r = self.http.post(format!("{}/api/v1/services/audio/asr/transcription", self.config.base()))
                .bearer_auth(&self.key).header("X-DashScope-Async", "enable").header("X-DashScope-OssResourceResolve", "enable")
                .json(&json!({"model": self.config.model,"input":{"file_urls":[upload]},"parameters":params})).send().await
                .map_err(|_| anyhow!("Submission response lost. Status is unknown; no automatic resubmission. Check Alibaba Cloud tasks."))?;
            // Definite rejection permits a deliberate retry. Server errors remain ambiguous.
            if r.status().is_client_error() {
                job.status = "new".into();
                write_json(&path, &job)?;
            }
            let v = response(r).await?;
            let id = field(&v["output"], "task_id")?.to_owned();
            if !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
                bail!("Invalid cloud task ID");
            }
            job.task_id = Some(id);
            job.status = "pending".into();
            write_json(&path, &job)?;
        }
        let id = job.task_id.as_ref().unwrap();
        let start = std::time::Instant::now();
        let mut failures = 0;
        loop {
            if cancelled() {
                bail!("Stopped waiting. The cloud task may continue and incur charges. Import this file again to resume it.");
            }
            if start.elapsed() > Duration::from_secs(14400) {
                bail!("Cloud wait timed out. Import this file again to resume the saved task.");
            }
            progress(&format!("Cloud task pending / running · {}s elapsed. You can stop waiting and resume later.", start.elapsed().as_secs()));
            let r = self
                .http
                .get(format!("{}/api/v1/tasks/{id}", self.config.base()))
                .timeout(Duration::from_secs(30))
                .bearer_auth(&self.key)
                .send()
                .await;
            let v = match r {
                Ok(r) if !r.status().is_server_error() && r.status().as_u16() != 429 => {
                    failures = 0;
                    response(r).await?
                }
                _ => {
                    failures += 1;
                    if failures > 5 {
                        bail!("Cloud status unavailable. Import this file again to resume the saved task.");
                    }
                    tokio::time::sleep(Duration::from_secs(2 * failures)).await;
                    continue;
                }
            };
            match v["output"]["task_status"].as_str() {
                Some("PENDING" | "RUNNING") => tokio::time::sleep(Duration::from_secs(3)).await,
                Some("SUCCEEDED") => {
                    let results = v["output"]["results"]
                        .as_array()
                        .ok_or_else(|| anyhow!("Cloud response has no file results"))?;
                    if results.len() != 1 || results[0]["subtask_status"] != "SUCCEEDED" {
                        job.status = "failed".into();
                        write_json(&path, &job)?;
                        bail!("Cloud file subtask failed; inspect the task in Alibaba Cloud.");
                    }
                    let url = field(&results[0], "transcription_url")?;
                    validate_storage_url(url)?;
                    // Never forward the API key to storage or follow arbitrary redirects.
                    let r = self.http.get(url).send().await.map_err(|_| {
                        anyhow!("Could not fetch cloud result. Retry to resume the saved task.")
                    })?;
                    let segments = parse_result(&response(r).await?)?;
                    job.status = "complete".into();
                    job.segments = Some(segments.clone());
                    write_json(&path, &job)?;
                    return Ok(segments);
                }
                Some("FAILED" | "CANCELED" | "UNKNOWN") => {
                    job.status = "failed".into();
                    write_json(&path, &job)?;
                    bail!(
                        "Cloud task failed, expired or was cancelled. Check Alibaba Cloud tasks."
                    );
                }
                _ => bail!("Unrecognized cloud task state; task retained for recovery"),
            }
        }
    }
}
fn field<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("Cloud response missing {key}"))
}
async fn response(r: Response) -> Result<Value> {
    let status = r.status();
    // Do not surface vendor bodies: they can contain signed URLs, audio text or credentials.
    if !status.is_success() {
        let hint = match status.as_u16() {
            401 | 403 => "Check API Key, region, workspace and model permissions",
            429 => "Rate limit or quota exceeded",
            400 => "Request rejected; check model and audio settings",
            404 => "Model or task unavailable in this region",
            _ => "Cloud service request failed",
        };
        bail!("{hint} (HTTP {})", status.as_u16());
    }
    r.json()
        .await
        .map_err(|_| anyhow!("Invalid JSON from cloud service"))
}
fn validate_storage_url(s: &str) -> Result<()> {
    let u = url::Url::parse(s).map_err(|_| anyhow!("Invalid storage URL"))?;
    let h = u.host_str().unwrap_or("");
    if u.scheme() != "https"
        || !h.ends_with(".aliyuncs.com")
        || !u.username().is_empty()
        || u.password().is_some()
        || u.port().is_some()
    {
        bail!("Unexpected cloud storage destination");
    }
    Ok(())
}
pub fn parameters(config: &CloudConfig, language: Option<&str>) -> Result<Value> {
    let mut p = json!({"channel_id":[0],"diarization_enabled":false});
    if config.model == MODELS[0] {
        p["keep_dialect"] = json!(config.keep_dialect);
    }
    if let Some(lang) = language.filter(|s| !s.is_empty() && *s != "auto") {
        let lang = if lang == "yue" { "zh" } else { lang };
        if ![
            "zh", "en", "ja", "ko", "vi", "th", "id", "ms", "tl", "hi", "ar", "fr", "de", "es",
            "pt", "ru", "it", "nl", "sv", "da", "fi", "no", "el", "pl", "cs", "hu", "ro", "bg",
            "hr", "sk",
        ]
        .contains(&lang)
        {
            bail!("Language is not supported by this Filetrans model");
        }
        p["language_hints"] = json!([lang]);
    }
    Ok(p)
}
pub fn parse_result(v: &Value) -> Result<Vec<CloudSegment>> {
    let transcripts = v["transcripts"]
        .as_array()
        .ok_or_else(|| anyhow!("Missing cloud transcripts"))?;
    let mut out = Vec::new();
    for transcript in transcripts {
        let sentences = transcript["sentences"]
            .as_array()
            .ok_or_else(|| anyhow!("Missing sentence timestamps"))?;
        for sentence in sentences {
            let text = sentence["text"]
                .as_str()
                .ok_or_else(|| anyhow!("Missing sentence text"))?;
            let start = sentence["begin_time"]
                .as_f64()
                .ok_or_else(|| anyhow!("Missing start timestamp"))?;
            let end = sentence["end_time"]
                .as_f64()
                .ok_or_else(|| anyhow!("Missing end timestamp"))?;
            if !start.is_finite() || !end.is_finite() || start < 0.0 || end < start {
                bail!("Invalid sentence timestamps");
            }
            if !text.trim().is_empty() {
                out.push(CloudSegment {
                    text: text.into(),
                    start_ms: start,
                    end_ms: end,
                });
            }
        }
    }
    out.sort_by(|a, b| a.start_ms.total_cmp(&b.start_ms));
    Ok(out)
}
pub async fn import_file<R: Runtime, F: Fn(&str), C: Fn() -> bool>(
    app: &AppHandle<R>,
    file: &Path,
    model: &str,
    language: Option<&str>,
    progress: F,
    cancelled: C,
) -> Result<Vec<(String, f64, f64)>> {
    let path = root(app)?;
    let mut c = read_config(&path)?;
    if !c.enabled {
        bail!("Enable Alibaba Cloud file transcription in Settings first");
    }
    c.model = model.into();
    c.validate()?;
    let key = credential(app, &c.region)?.context("Configure your own API Key first")?;
    let result = CloudClient::new(c, key)?
        .transcribe(file, &path.join("jobs"), language, progress, cancelled)
        .await?;
    Ok(result
        .into_iter()
        .map(|s| (s.text, s.start_ms, s.end_ms))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn saved_results_resume_offline_and_unknown_submission_never_resubmits() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("audio.wav");
        std::fs::write(&file, b"fixture").unwrap();
        let c = CloudConfig::default();
        let key = "test-only";
        let mut hash = Sha256::new();
        hash.update(
            serde_json::to_vec(&json!([c.base(), c.model, parameters(&c, None).unwrap()])).unwrap(),
        );
        hash.update(Sha256::digest(key.as_bytes()));
        hash.update(b"fixture");
        let path = dir.path().join(format!("{:x}.json", hash.finalize()));
        let client = CloudClient::new(c, key.into()).unwrap();
        write_json(
            &path,
            &Journal {
                status: "complete".into(),
                task_id: Some("saved-task".into()),
                segments: Some(vec![CloudSegment {
                    text: "saved".into(),
                    start_ms: 0.0,
                    end_ms: 1000.0,
                }]),
            },
        )
        .unwrap();
        let result = client
            .transcribe(&file, dir.path(), None, |_| {}, || false)
            .await
            .unwrap();
        assert_eq!(result[0].text, "saved");
        write_json(
            &path,
            &Journal {
                status: "submitting".into(),
                task_id: None,
                segments: None,
            },
        )
        .unwrap();
        let error = client
            .transcribe(
                &file,
                dir.path(),
                None,
                |_| panic!("must not upload"),
                || false,
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("unknown"));
    }
    #[tokio::test]
    async fn cancel_before_upload_sends_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("audio.wav");
        std::fs::write(&file, b"fixture").unwrap();
        let client = CloudClient::new(CloudConfig::default(), "test-only".into()).unwrap();
        let error = client
            .transcribe(
                &file,
                dir.path(),
                None,
                |_| panic!("must not upload"),
                || true,
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("cancelled"));
    }
    #[test]
    #[ignore = "Uses the operating system credential store with a temporary dummy credential"]
    fn credential_store_roundtrip() {
        let name = format!("ting-test-{}", uuid::Uuid::new_v4());
        let entry = keyring::Entry::new(&name, "dummy").unwrap();
        entry.set_password("non-secret-test-value").unwrap();
        let value = entry.get_password();
        entry.delete_credential().unwrap();
        assert_eq!(value.unwrap(), "non-secret-test-value");
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
    #[test]
    fn defaults_never_enable_cloud_and_regions_are_allowlisted() {
        let mut c = CloudConfig::default();
        assert!(!c.enabled);
        assert!(!c.default_for_files);
        let old: CloudConfig = serde_json::from_value(json!({"enabled":true})).unwrap();
        assert!(!old.default_for_files);
        assert!(c.keep_dialect);
        c.workspace = "evil.com/path".into();
        assert!(c.validate().is_err());
        c.workspace.clear();
        c.region = "other".into();
        assert!(c.validate().is_err());
    }
    #[test]
    fn preserve_dialect_only_for_31_and_validate_language() {
        let mut c = CloudConfig::default();
        assert_eq!(
            parameters(&c, Some("yue")).unwrap()["language_hints"],
            json!(["zh"])
        );
        assert_eq!(parameters(&c, None).unwrap()["keep_dialect"], true);
        c.model = MODELS[1].into();
        assert!(parameters(&c, None).unwrap().get("keep_dialect").is_none());
        assert!(parameters(&c, Some("invalid")).is_err());
    }
    #[test]
    fn parses_exact_milliseconds_and_rejects_bad_times() {
        let good = json!({"transcripts":[{"sentences":[{"text":"Hello 粵語", "begin_time":120,"end_time":3400}]}]});
        let s = parse_result(&good).unwrap();
        assert_eq!(s[0].start_ms, 120.0);
        assert_eq!(s[0].end_ms, 3400.0);
        assert!(parse_result(
            &json!({"transcripts":[{"sentences":[{"text":"x","begin_time":5,"end_time":1}]}]})
        )
        .is_err());
        assert!(parse_result(&json!({"text":"No timestamps"})).is_err());
    }
    #[test]
    fn storage_urls_cannot_redirect_credentials_or_fetch_local_services() {
        for u in [
            "http://a.aliyuncs.com/x",
            "https://aliyuncs.com.evil.test/x",
            "http://127.0.0.1/x",
            "https://user@a.aliyuncs.com/x",
        ] {
            assert!(validate_storage_url(u).is_err());
        }
        assert!(
            validate_storage_url("https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/x")
                .is_ok()
        );
    }
}
