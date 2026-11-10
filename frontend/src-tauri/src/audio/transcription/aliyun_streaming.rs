//! Continuous cloud ASR. PCM is streamed before local VAD; final results alone
//! enter the existing transcript persistence path. Never retries billed audio.
use super::{
    aliyun::{self, CloudConfig},
    worker::TranscriptUpdate,
};
use crate::audio::AudioChunk;
use anyhow::{bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{collections::HashSet, time::Duration};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::{
    net::TcpStream,
    sync::mpsc,
    time::{timeout, Instant},
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
    MaybeTlsStream, WebSocketStream,
};

pub const MODELS: [&str; 2] = [
    "qwen-audio-3.1-asr-flash-streaming",
    "qwen-audio-3.0-asr-flash-streaming",
];
const IO_TIMEOUT: Duration = Duration::from_secs(15);
type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub fn configuration<R: Runtime>(app: &AppHandle<R>) -> Result<CloudConfig> {
    aliyun::read_config(&aliyun::root(app)?)
}

pub struct Session {
    socket: Socket,
    task: String,
}
impl Session {
    pub async fn connect(config: &CloudConfig, key: &str) -> Result<Self> {
        config.validate()?;
        let url = format!(
            "{}/api-ws/v1/inference",
            config.base().replacen("https://", "wss://", 1)
        );
        let mut request = url.into_client_request()?;
        request.headers_mut().insert(
            "Authorization",
            format!("Bearer {}", key)
                .parse()
                .map_err(|_| anyhow::anyhow!("Invalid API Key"))?,
        );
        // Do not surface the handshake request/headers in errors.
        let (mut socket, _) = timeout(IO_TIMEOUT, connect_async(request))
            .await
            .context("Cloud connection timed out")?
            .map_err(|_| {
                anyhow::anyhow!(
                    "Cannot connect to Alibaba Cloud. Check your region, key and network."
                )
            })?;
        let task = uuid::Uuid::new_v4().simple().to_string();
        timeout(
            IO_TIMEOUT,
            socket.send(Message::Text(
                start_message(&task, config).to_string().into(),
            )),
        )
        .await
        .context("Task send timed out")??;
        timeout(IO_TIMEOUT, async {
            while let Some(message) = socket.next().await {
                match message? {
                    Message::Text(text) => {
                        let v: Value = serde_json::from_str(&text)?;
                        if v["header"]["task_id"] != task { continue; }
                        match v["header"]["event"].as_str() {
                            Some("task-started") => return Ok(()),
                            Some("task-failed") => bail!("Cloud rejected the streaming task. Check model access, region and account balance."),
                            _ => {}
                        }
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            bail!("Cloud closed the connection before starting")
        }).await.context("Cloud task startup timed out")??;
        Ok(Self { socket, task })
    }
}

pub async fn prepare<R: Runtime>(app: &AppHandle<R>, consent: bool) -> Result<Option<Session>> {
    let config = configuration(app)?;
    if !config.live_enabled {
        return Ok(None);
    }
    if !consent {
        bail!("Cloud recording requires upload consent. Start recording from the Ting window.");
    }
    let key = aliyun::credential(app, &config.region)?.context("Save a Bailian API Key first")?;
    Ok(Some(Session::connect(&config, &key).await?))
}

fn start_message(task: &str, config: &CloudConfig) -> Value {
    let mut parameters = json!({"format":"pcm", "sample_rate":48000, "heartbeat":true});
    if config.live_model == MODELS[0] {
        parameters["keep_dialect"] = json!(config.keep_dialect);
    }
    json!({"header":{"action":"run-task","task_id":task,"streaming":"duplex"},
        "payload":{"task_group":"audio","task":"asr","function":"recognition", "model":config.live_model,"parameters":parameters,"input":{}}})
}

fn pcm(samples: &[f32]) -> Result<Vec<u8>> {
    if samples.iter().any(|s| !s.is_finite()) {
        bail!("Invalid audio samples");
    }
    Ok(samples
        .iter()
        .flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes())
        .collect())
}

#[derive(Debug, PartialEq)]
struct Sentence {
    id: u64,
    text: String,
    start: f64,
    end: f64,
    final_result: bool,
}
fn sentence(value: &Value) -> Option<Sentence> {
    let s = &value["payload"]["output"]["sentence"];
    if s["heartbeat"].as_bool() == Some(true) {
        return None;
    }
    let text = s["text"].as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    let start = s["begin_time"].as_u64()? as f64 / 1000.0;
    let final_result = s["sentence_end"].as_bool().unwrap_or(false);
    let end = s["end_time"].as_u64().map(|n| n as f64 / 1000.0);
    if final_result && (end.is_none() || end? < start) {
        return None;
    }
    Some(Sentence {
        id: s["sentence_id"].as_u64()?,
        text: text.into(),
        start,
        end: end.unwrap_or(start),
        final_result,
    })
}

pub fn start<R: Runtime>(
    app: AppHandle<R>,
    session: Session,
    receiver: mpsc::UnboundedReceiver<AudioChunk>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let _ = app.emit(
            "cloud-live-status",
            json!({"state":"connected","message":"Cloud transcription connected"}),
        );
        if let Err(error) = transcribe(session, receiver, |event| match event {
            StreamEvent::Final(update) => {
                crate::audio::recording_commands::retain_cloud_tail(&update);
                let _ = app.emit("transcript-update", update);
                let _ = app.emit("speech-detected", json!({"message":"Speech detected"}));
            }
            StreamEvent::Partial(text) => {
                let _ = app.emit("cloud-live-partial", json!({"text":text}));
            }
        })
        .await
        {
            log::warn!("Cloud streaming stopped: {}", error);
            let _ = app.emit("cloud-live-status", json!({"state":"error","message":"Cloud transcription interrupted. Local recording continues. Stop and use the saved audio to recover missing text."}));
            let _ = app.emit("transcription-warning", "Cloud transcription interrupted. Local recording continues; missing text can be recovered from the saved audio.");
        } else {
            let _ = app.emit(
                "cloud-live-status",
                json!({"state":"finished","message":"Cloud transcription complete"}),
            );
        }
        let _ = app.emit("cloud-live-partial", json!({"text":""}));
    })
}

pub enum StreamEvent {
    Final(TranscriptUpdate),
    Partial(String),
}
pub async fn transcribe(
    mut session: Session,
    mut receiver: mpsc::UnboundedReceiver<AudioChunk>,
    mut on_event: impl FnMut(StreamEvent),
) -> Result<()> {
    let mut done = HashSet::new();
    let mut finishing = false;
    let mut finish_deadline = Instant::now() + Duration::from_secs(86400);
    loop {
        // Bound queued audio rather than silently dropping it or consuming unlimited RAM.
        if receiver.len() > 200 {
            bail!("Cloud audio backlog exceeded 20 seconds");
        }
        tokio::select! {
            chunk = receiver.recv(), if !finishing => {
                match chunk {
                    Some(chunk) => {
                        if chunk.sample_rate != 48000 { bail!("Cloud capture must be 48 kHz mono"); }
                        timeout(IO_TIMEOUT, session.socket.send(Message::Binary(pcm(&chunk.data)?.into()))).await.context("Audio send timed out")??;
                    }
                    None => {
                        timeout(IO_TIMEOUT, session.socket.send(Message::Text(json!({"header":{"action":"finish-task","task_id":session.task,"streaming":"duplex"},"payload":{"input":{}}}).to_string().into()))).await.context("Finish send timed out")??;
                        finishing = true;
                        finish_deadline = Instant::now() + Duration::from_secs(20);
                    }
                }
            }
            message = session.socket.next() => {
                match message.context("Cloud disconnected before final results")?? {
                    Message::Text(text) => {
                        let value: Value = serde_json::from_str(&text)?;
                        if value["header"]["task_id"] != session.task { continue; }
                        match value["header"]["event"].as_str() {
                            Some("task-failed") => bail!("Cloud task failed"),
                            Some("task-finished") if finishing => { let _ = timeout(IO_TIMEOUT, session.socket.close(None)).await; return Ok(()); }
                            Some("task-finished") => bail!("Cloud task ended before recording stopped"),
                            Some("result-generated") => if let Some(s) = sentence(&value) {
                                if done.contains(&s.id) { continue; }
                                if s.final_result {
                                    done.insert(s.id);
                                    let update = TranscriptUpdate {
                                        text:s.text, timestamp:chrono::Local::now().format("%H:%M:%S").to_string(),source:"Cloud".into(),
                                        sequence_id:super::worker::next_sequence_id(),chunk_start_time:s.start,is_partial:false,confidence:-1.0,
                                        audio_start_time:s.start,audio_end_time:s.end,duration:s.end-s.start,
                                    };
                                    on_event(StreamEvent::Final(update));
                                    on_event(StreamEvent::Partial(String::new()));
                                } else {
                                    on_event(StreamEvent::Partial(s.text));
                                }
                            },
                            _ => {}
                        }
                    }
                    Message::Close(_) => bail!("Cloud connection closed"),
                    Message::Ping(data) => { timeout(IO_TIMEOUT, session.socket.send(Message::Pong(data))).await.context("Heartbeat send timed out")??; }
                    _ => {}
                }
            }
            _ = tokio::time::sleep_until(finish_deadline), if finishing => bail!("Timed out waiting for final cloud subtitles"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn audio_encoding_rejects_invalid_and_clamps() {
        assert!(pcm(&[f32::NAN]).is_err());
        assert_eq!(
            pcm(&[0.0, 2.0, -2.0]).unwrap(),
            vec![0, 0, 255, 127, 1, 128]
        );
    }
    #[test]
    fn dialect_only_on_31_and_pcm_stream_has_no_local_vad() {
        let mut c = CloudConfig::default();
        assert_eq!(
            start_message("t", &c)["payload"]["parameters"]["keep_dialect"],
            true
        );
        c.live_model = MODELS[1].into();
        assert!(start_message("t", &c)["payload"]["parameters"]
            .get("keep_dialect")
            .is_none());
    }
    #[test]
    fn partial_final_and_heartbeat_are_distinct() {
        let mut v = json!({"payload":{"output":{"sentence":{"sentence_id":1,"begin_time":120,"end_time":null,"text":"Hello","sentence_end":false}}}});
        assert!(!sentence(&v).unwrap().final_result);
        v["payload"]["output"]["sentence"]["sentence_end"] = json!(true);
        assert!(sentence(&v).is_none());
        v["payload"]["output"]["sentence"]["end_time"] = json!(1200);
        assert_eq!(sentence(&v).unwrap().end, 1.2);
        v["payload"]["output"]["sentence"]["heartbeat"] = json!(true);
        assert!(sentence(&v).is_none());
    }
    #[tokio::test]
    async fn finish_drains_final_results_and_deduplicates_sentences() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(tcp).await.unwrap();
            let mut bytes = 0;
            while let Some(Ok(message)) = ws.next().await {
                match message {
                    Message::Binary(data) => bytes += data.len(),
                    Message::Text(data) => {
                        let v: Value = serde_json::from_str(&data).unwrap();
                        assert_eq!(v["header"]["action"], "finish-task");
                        assert_eq!(bytes, 9600);
                        let partial = json!({"header":{"task_id":"t","event":"result-generated"},"payload":{"output":{"sentence":{"sentence_id":1,"begin_time":0,"end_time":null,"text":"hello","sentence_end":false}}}});
                        ws.send(Message::Text(partial.to_string().into()))
                            .await
                            .unwrap();
                        let final_result = json!({"header":{"task_id":"t","event":"result-generated"},"payload":{"output":{"sentence":{"sentence_id":1,"begin_time":0,"end_time":100,"text":"hello world","sentence_end":true}}}});
                        for _ in 0..2 {
                            ws.send(Message::Text(final_result.to_string().into()))
                                .await
                                .unwrap();
                        }
                        ws.send(Message::Text(
                            json!({"header":{"task_id":"t","event":"task-finished"}})
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                        break;
                    }
                    _ => {}
                }
            }
        });
        let (socket, _) = connect_async(format!("ws://{}", address)).await.unwrap();
        let (tx, rx) = mpsc::unbounded_channel();
        tx.send(AudioChunk {
            data: vec![0.1; 4800],
            sample_rate: 48000,
            timestamp: 0.0,
            chunk_id: 0,
            device_type: crate::audio::RecordingDeviceType::Microphone,
        })
        .unwrap();
        drop(tx);
        let mut final_count = 0;
        let mut draft_count = 0;
        transcribe(
            Session {
                socket,
                task: "t".into(),
            },
            rx,
            |event| match event {
                StreamEvent::Final(update) => {
                    final_count += 1;
                    assert_eq!(update.text, "hello world");
                    assert!(!update.is_partial);
                    assert_eq!(update.audio_end_time, 0.1);
                }
                StreamEvent::Partial(text) if !text.is_empty() => draft_count += 1,
                _ => {}
            },
        )
        .await
        .unwrap();
        server.await.unwrap();
        assert_eq!(final_count, 1);
        assert_eq!(draft_count, 1);
    }
    #[tokio::test]
    async fn disconnect_is_an_error_not_success_or_replay() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(tcp).await.unwrap();
            ws.close(None).await.unwrap();
        });
        let (socket, _) = connect_async(format!("ws://{}", address)).await.unwrap();
        let (_tx, rx) = mpsc::unbounded_channel();
        assert!(transcribe(
            Session {
                socket,
                task: "t".into()
            },
            rx,
            |_| {}
        )
        .await
        .is_err());
        server.await.unwrap();
    }
}
