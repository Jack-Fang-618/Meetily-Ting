//! Offline evaluation using the application's actual decoder and Parakeet engine.
//! No application settings, recordings, database or downloads are touched.
use app_lib::{audio::decoder::decode_audio_file, parakeet_engine::ParakeetEngine};
use serde_json::{json, Value};
use std::{env, fs, io::Write, path::PathBuf, time::Instant};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 4 {
        return Err(
            "Usage: evaluate_parakeet MODEL_DIRECTORY FIXTURE_DIRECTORY OUTPUT_JSONL".into(),
        );
    }
    let pack = PathBuf::from(&args[2]);
    let manifest: Vec<Value> = serde_json::from_slice(&fs::read(pack.join("manifest.json"))?)?;
    let mut output = fs::File::create(&args[3])?;
    let engine = ParakeetEngine::new_with_models_dir(Some(PathBuf::from(&args[1])))?;
    engine.discover_models().await?;
    let started = Instant::now();
    engine.load_model("parakeet-tdt-0.6b-v3-int8").await?;
    let load_seconds = started.elapsed().as_secs_f64();
    for item in manifest {
        let file = item["file"].as_str().ok_or("Missing fixture file")?;
        let started = Instant::now();
        let result = match decode_audio_file(&pack.join(file)) {
            Ok(audio) => engine
                .transcribe_audio(audio.to_whisper_format())
                .await
                .map_err(|e| e.to_string()),
            Err(error) => Err(error.to_string()),
        };
        let seconds = started.elapsed().as_secs_f64();
        let (text, error) = match result {
            Ok(text) => (Some(text), None),
            Err(error) => (None, Some(error)),
        };
        let row = json!({"model":"parakeet-tdt-0.6b-v3-int8", "file":file,
            "language":"auto", "mode":"auto", "seconds":seconds,"load_seconds":load_seconds,
            "audio_seconds":item["duration_seconds"],"text":text,"error":error,
            "timing_scope":"decode + inference, excludes model load; native debug build"});
        writeln!(output, "{}", row)?;
        output.flush()?;
        println!("{} {:.2}s", file, seconds);
    }
    engine.unload_model().await;
    Ok(())
}
