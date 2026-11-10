//! Explicit opt-in cloud evaluation. Key arrives on stdin; never written to outputs.
use app_lib::audio::transcription::aliyun::{CloudClient, CloudConfig};
use std::{
    io::{Read, Write},
    path::PathBuf,
    time::Instant,
};
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        anyhow::bail!("Usage: evaluate_aliyun MANIFEST AUDIO_ROOT OUTPUT_DIR [MODEL] [LIMIT]. API key on stdin.");
    }
    let mut key = String::new();
    std::io::stdin().read_to_string(&mut key)?;
    let config = CloudConfig {
        model: args
            .get(4)
            .cloned()
            .unwrap_or_else(|| CloudConfig::default().model),
        ..CloudConfig::default()
    };
    let model = config.model.clone();
    let client = CloudClient::new(config, key.trim().into())?;
    client.upload_policy().await?;
    println!("Upload access verified for {model}");
    let manifest: Vec<serde_json::Value> = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let audio = PathBuf::from(&args[2]);
    let out = PathBuf::from(&args[3]);
    std::fs::create_dir_all(&out)?;
    let limit: usize = args
        .get(5)
        .and_then(|v| v.parse().ok())
        .unwrap_or(manifest.len());
    let mut output = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(out.join("results.jsonl"))?;
    for item in manifest.iter().take(limit) {
        let file = item["file"].as_str().unwrap();
        let start = Instant::now();
        let result = client
            .transcribe(
                &audio.join(file),
                &out.join("jobs"),
                None,
                |s| eprintln!("{file}: {s}"),
                || false,
            )
            .await;
        let row = match result {
            Ok(segments) => {
                serde_json::json!({"model":model,"file":file,"audio_seconds":item["duration_seconds"],"elapsed_seconds":start.elapsed().as_secs_f64(),"text":segments.iter().map(|s|s.text.as_str()).collect::<Vec<_>>().join(" "),"segments":segments})
            }
            Err(e) => {
                serde_json::json!({"model":model,"file":file,"error":e.to_string(),"elapsed_seconds":start.elapsed().as_secs_f64()})
            }
        };
        writeln!(output, "{}", row)?;
        output.flush()?;
        println!(
            "{}: {} ({:.1}s)",
            file,
            if row.get("error").is_some() {
                "FAILED"
            } else {
                "OK"
            },
            start.elapsed().as_secs_f64()
        );
        if row.get("error").is_some() {
            anyhow::bail!("Stopping after first cloud failure; see redacted result file");
        }
    }
    Ok(())
}
