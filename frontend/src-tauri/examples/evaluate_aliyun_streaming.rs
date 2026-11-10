//! Opt-in public-fixture smoke test. Reads the key from stdin, never logs it.
use app_lib::audio::{
    transcription::{
        aliyun::CloudConfig,
        aliyun_streaming::{transcribe, Session, StreamEvent},
    },
    AudioChunk, RecordingDeviceType,
};
use std::{
    io::Read,
    time::{Duration, Instant},
};
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    anyhow::ensure!(
        args.len() >= 3,
        "Usage: evaluate_aliyun_streaming audio-48k-s16le.pcm output.json [model]"
    );
    let mut key = String::new();
    std::io::stdin().read_to_string(&mut key)?;
    let mut config = CloudConfig::default();
    if let Some(model) = args.get(3) {
        config.live_model = model.clone();
    }
    let session = Session::connect(&config, key.trim()).await?;
    let data = std::fs::read(&args[1])?;
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let start = Instant::now();
    let sender = tokio::spawn(async move {
        for (i, chunk) in data.chunks(9600).enumerate() {
            let data = chunk
                .chunks_exact(2)
                .map(|s| i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0)
                .collect();
            if tx
                .send(AudioChunk {
                    data,
                    sample_rate: 48000,
                    timestamp: i as f64 * 0.1,
                    chunk_id: i as u64,
                    device_type: RecordingDeviceType::Microphone,
                })
                .is_err()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    });
    let mut results = vec![];
    let mut partials = 0;
    let mut first = None;
    transcribe(session, rx, |event| match event {
        StreamEvent::Final(update) => {
            results.push(serde_json::to_value(update).unwrap());
        }
        StreamEvent::Partial(text) if !text.is_empty() => {
            partials += 1;
            if first.is_none() {
                first = Some(start.elapsed().as_secs_f64());
            }
        }
        _ => {}
    })
    .await?;
    sender.await?;
    anyhow::ensure!(!results.is_empty(), "No final results received");
    std::fs::write(
        &args[2],
        serde_json::to_vec_pretty(
            &serde_json::json!({"results":results,"partial_events":partials,"first_partial_seconds":first,"elapsed_seconds":start.elapsed().as_secs_f64()}),
        )?,
    )?;
    println!(
        "{} final sentences, {} partial updates, {:.2}s elapsed",
        results.len(),
        partials,
        start.elapsed().as_secs_f64()
    );
    Ok(())
}
