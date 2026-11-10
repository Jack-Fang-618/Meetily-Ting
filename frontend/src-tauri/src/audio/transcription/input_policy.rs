//! Application-safe inference windows, shared with the Python worker.
//! These are operational limits, not claims about each model's theoretical context.
use super::provider::TranscriptResult;
use serde::Deserialize;
use std::{collections::HashMap, future::Future, ops::Range, sync::OnceLock};

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct InputPolicy {
    pub sample_rate: usize,
    pub channels: usize,
    pub max_samples: usize,
    pub min_samples: usize,
    pub search_samples: usize,
    pub frame_samples: usize,
}

pub fn policy(engine: &str) -> Result<InputPolicy, String> {
    static POLICIES: OnceLock<Result<HashMap<String, InputPolicy>, String>> = OnceLock::new();
    let policies = POLICIES.get_or_init(|| serde_json::from_str(include_str!(
        "../../../../../tools/transcription-input-limits.json"
    )).map_err(|e| format!("Invalid transcription input registry: {e}")));
    let p = *policies.as_ref().map_err(Clone::clone)?.get(engine)
        .ok_or_else(|| format!("No input policy registered for engine {engine}"))?;
    if p.sample_rate != 16000 || p.channels != 1 || p.min_samples == 0
        || p.min_samples > p.max_samples || p.frame_samples == 0
        || p.search_samples < p.frame_samples || p.search_samples >= p.max_samples {
        return Err(format!("Invalid input policy for {engine}"));
    }
    Ok(p)
}

/// Exact coverage, no overlap and never beyond the inference limit.
pub fn ranges(audio: &[f32], p: InputPolicy) -> Result<Vec<Range<usize>>, String> {
    if audio.iter().any(|s| !s.is_finite()) {
        return Err("Audio contains non-finite samples (NaN or infinity)".into());
    }
    let mut out = Vec::new();
    let mut start = 0;
    while start < audio.len() {
        let mut end = (start + p.max_samples).min(audio.len());
        if end < audio.len() {
            let search = end - p.search_samples;
            let mut best = f64::INFINITY;
            for i in (search..=end - p.frame_samples).step_by(p.frame_samples) {
                let energy: f64 = audio[i..i+p.frame_samples].iter()
                    .map(|&x| f64::from(x).powi(2)).sum();
                if energy < best { best = energy; end = i + p.frame_samples; }
            }
        }
        out.push(start..end);
        start = end;
    }
    Ok(out)
}

/// Batch Parakeet must retain quiet speech: Silero's binary speech gate can
/// reject entire low-level utterances before ASR sees them. Use the same bounded,
/// sample-complete windows as the engine. Other providers keep their VAD path.
pub fn file_segments_with_progress<F>(audio: &[f32], engine: &str, redemption_ms: u32, mut progress: F)
    -> Result<Vec<crate::audio::vad::SpeechSegment>, String>
where F: FnMut(u32, usize) -> bool {
    let p = policy(engine)?;
    if engine != "parakeet" {
        return crate::audio::vad::get_speech_chunks_with_progress(audio, redemption_ms, progress)
            .map_err(|e| e.to_string());
    }
    if !progress(0, 0) { return Err("Audio preparation cancelled".into()); }
    let spans = ranges(audio, p)?;
    let mut segments = Vec::with_capacity(spans.len());
    for span in spans {
        let start_timestamp_ms = span.start as f64 * 1000.0 / p.sample_rate as f64;
        let end_timestamp_ms = span.end as f64 * 1000.0 / p.sample_rate as f64;
        let percent = (span.end as f64 / audio.len() as f64 * 100.0) as u32;
        segments.push(crate::audio::vad::SpeechSegment {
            samples: audio[span].to_vec(), start_timestamp_ms, end_timestamp_ms,
            confidence: -1.0, // No speech classifier or calibrated confidence here.
        });
        if !progress(percent, segments.len()) { return Err("Audio preparation cancelled".into()); }
    }
    Ok(segments)
}

/// All public engine entry points use this guard, including live, import and retry.
/// Short tails are zero-padded rather than silently discarded.
pub async fn transcribe_bounded<F, Fut>(audio: Vec<f32>, p: InputPolicy, mut infer: F)
    -> Result<TranscriptResult, String>
where F: FnMut(Vec<f32>) -> Fut,
      Fut: Future<Output = Result<TranscriptResult, String>> {
    let mut texts = Vec::new();
    let mut weighted = 0.0;
    let mut weight = 0;
    let mut confidence_known = true;
    let mut partial = false;
    for range in ranges(&audio, p)? {
        let original_len = range.len();
        let mut part = audio[range].to_vec();
        part.resize(part.len().max(p.min_samples), 0.0);
        let result = infer(part).await?;
        partial |= result.is_partial;
        if !result.text.trim().is_empty() {
            texts.push(result.text.trim().to_owned());
            match result.confidence {
                Some(c) if c.is_finite() => { weighted += c as f64 * original_len as f64; weight += original_len; }
                _ => confidence_known = false,
            }
        }
    }
    Ok(TranscriptResult { text: texts.join("\n"),
        confidence: if confidence_known && weight > 0 { Some((weighted / weight as f64) as f32) } else { None },
        is_partial: partial })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parakeet_file_windows_preserve_quiet_audio_and_absolute_times() {
        let p = policy("parakeet").unwrap();
        assert_eq!(p.max_samples, 240000);
        let mut audio = vec![0.00001; 1_184_640];
        audio[210000..218000].fill(0.0);
        let parts = file_segments_with_progress(&audio, "parakeet", 2000, |_, _| true).unwrap();
        assert_eq!(parts.iter().flat_map(|s| s.samples.iter().copied()).collect::<Vec<_>>(), audio);
        assert_eq!(parts.first().unwrap().start_timestamp_ms, 0.0);
        assert_eq!(parts.last().unwrap().end_timestamp_ms, 74040.0);
        for pair in parts.windows(2) { assert_eq!(pair[0].end_timestamp_ms, pair[1].start_timestamp_ms); }
        assert!(parts.iter().all(|s| s.samples.len() <= p.max_samples));
        assert!(file_segments_with_progress(&audio, "parakeet", 2000, |_, _| false).is_err());
        assert!(file_segments_with_progress(&[f32::NAN], "parakeet", 2000, |_, _| true).is_err());
    }
    #[tokio::test]
    async fn every_engine_bounds_long_audio_and_preserves_short_tails() {
        for name in ["whisper", "parakeet", "qwen"] {
            let p = policy(name).unwrap();
            for len in [0, 1, 400000, 400001, 982240, 2118880, 1193920] {
                let audio = vec![0.1; len];
                let spans = ranges(&audio, p).unwrap();
                assert_eq!(spans.iter().map(|r| r.len()).sum::<usize>(), len);
                assert!(spans.windows(2).all(|r| r[0].end == r[1].start));
                let mut calls = 0;
                let result = transcribe_bounded(audio, p, |part| {
                    calls += 1;
                    assert!((p.min_samples..=p.max_samples).contains(&part.len()));
                    async { Ok(TranscriptResult {text: "text".into(), confidence: None, is_partial: false}) }
                }).await.unwrap();
                assert_eq!(calls, spans.len());
                assert_eq!(result.text.lines().count(), calls);
                assert_eq!(result.confidence, None);
            }
        }
    }
    #[tokio::test]
    async fn invalid_input_never_reaches_model() {
        let p = policy("qwen").unwrap();
        for value in [f32::NAN, f32::INFINITY] {
            assert!(transcribe_bounded(vec![value], p, |_| async { panic!("called model") }).await.is_err());
        }
        assert!(policy("unknown-engine").is_err());
    }
    #[tokio::test]
    async fn model_error_is_not_silently_dropped() {
        let p = policy("qwen").unwrap();
        let mut calls = 0;
        let result = transcribe_bounded(vec![0.1; 800000], p, |_| {
            calls += 1;
            let fail = calls == 2;
            async move {
                if fail { Err("model failed".into()) }
                else { Ok(TranscriptResult {text: "first".into(), confidence: None, is_partial: false}) }
            }
        }).await;
        assert_eq!(result.unwrap_err(), "model failed");
        assert_eq!(calls, 2);
    }

    #[test]
    fn quiet_boundary_before_limit() {
        let mut audio = vec![0.1; 800000];
        audio[368000..368320].fill(0.0);
        assert_eq!(ranges(&audio, policy("qwen").unwrap()).unwrap()[0].end, 368320);
    }
}
