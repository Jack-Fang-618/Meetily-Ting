//! Trace sample coverage and raw model text independently of UI/persistence.
use app_lib::{
    audio::{
        decoder::decode_audio_file,
        transcription::input_policy::{policy, ranges},
        vad::get_speech_chunks,
    },
    parakeet_engine::ParakeetModel,
};
use serde_json::json;
use std::{env, fs, path::PathBuf};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<String> = env::args().collect();
    if a.len() != 4 {
        return Err("MODEL_DIR WAV OUTPUT_JSON".into());
    }
    let samples = decode_audio_file(&PathBuf::from(&a[2]))?.to_whisper_format();
    let mut model = ParakeetModel::new(&a[1], true)?;
    let mut report = Vec::new();
    let mut p = policy("parakeet")?;
    if let Ok(max) = env::var("TING_DIAG_MAX") {
        p.max_samples = max.parse()?;
        p.search_samples = env::var("TING_DIAG_SEARCH")?.parse()?;
    }
    for (mode, spans) in [
        ("raw-full", vec![0..samples.len()]),
        ("bounded", ranges(&samples, p)?),
    ] {
        for span in spans {
            let r = model.transcribe_samples(samples[span.clone()].to_vec())?;
            println!(
                "{} {:.2}-{:.2}: {}",
                mode,
                span.start as f64 / 16000.,
                span.end as f64 / 16000.,
                r.text
            );
            report.push(json!({"mode":mode,"start":span.start,"end":span.end,"text":r.text,"timestamps":r.timestamps,"tokens":r.tokens}));
        }
    }
    // Exact speech detection helper and configuration used by file import before the fix.
    let segments = get_speech_chunks(&samples, 2000)?;
    for segment in segments {
        for span in ranges(&segment.samples, p)? {
            let r = model.transcribe_samples(segment.samples[span.clone()].to_vec())?;
            let start = segment.start_timestamp_ms + span.start as f64 / 16.;
            let end = segment.start_timestamp_ms + span.end as f64 / 16.;
            println!(
                "import-vad {:.2}-{:.2}: {}",
                start / 1000.,
                end / 1000.,
                r.text
            );
            report.push(json!({"mode":"import-vad","start_ms":start,"end_ms":end,"text":r.text}));
        }
    }
    fs::write(&a[3], serde_json::to_vec_pretty(&report)?)?;
    Ok(())
}
