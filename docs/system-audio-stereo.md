# System audio: split-channel interviews

2026-11-10. User reports ordinary stereo recordings work, but interviews with speakers isolated on left/right do not; headphones were used with the microphone enabled.

The active macOS Core Audio path previously requested an OS mono tap and read channel zero. It now requests stereo, decodes both planar and interleaved Float32 buffers, and explicitly produces mono for the unchanged downstream 48kHz pipeline. A speech-oriented downmix preserves single-sided level, avoids doubling identical stereo, and retains one channel during strong phase cancellation. Independent simultaneous speakers are still mixed; this is not source separation or diarization. The existing microphone path, file import and ring-buffer timing are unchanged.

Regression tests cover left/right-only speech, identical stereo, mono, silence, nonfinite samples, opposite phase, and planar/interleaved alternating speakers with preserved frame count/order. This verifies sample handling, not recognition accuracy on the original private interview. The original clip has not been uploaded or automatically replayed. After restart, manually replay it using the same headphones; compare both speakers. If still poor, compare system-only capture against mic+system and inspect the saved audio before changing ASR.

The former mono tap's exact behavior on that interview has not been reproduced, so the original root cause remains provisional. The change removes dependence on its downmix and the channel-zero assumption.

Validation: full Rust library suite 269 passed / 7 ignored; frontend suite 62 passed; TypeScript and production export passed. The four added regression tests include callback buffer layout decoding. No cloud accuracy claim is made from these synthetic checks.

## Quiet playback gain (2026-11-10)

System audio receives bounded smooth gain after stereo downmix/resampling, before the mixing/transcription path. Target RMS is 0.035, maximum gain 16×, with peak headroom, 50 ms gain rise and immediate reduction for louder input. Silence and extremely low-level input below RMS 0.0001 receive no boost. Microphone processing is unchanged. Regression tests cover quiet signal amplification, loud-signal protection and silence/noise. This cannot recover speech absent from capture or resolve overlapping voices; the original split-channel interview still needs user retesting.
