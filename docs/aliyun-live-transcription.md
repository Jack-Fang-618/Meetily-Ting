# Alibaba Cloud live transcription — development preview

Implemented 2026-11-10. File and live transcription are independent preferences. Existing installations and new installs keep live cloud **off** until the user explicitly enables it.

## Use

1. Settings → Transcription → Alibaba Cloud (Live & files).
2. Keep your own regional Bailian key. Enable **Use cloud for live recording**, select **Qwen ASR 3.1 Streaming**, and save. The file-import enable/default switches do not control live recording. Turning live cloud off returns recording to the selected local model.
3. Start recording normally. Each start requires a separate confirmation naming Alibaba Cloud, the configured region, selected mic/system audio and account billing. Cancel sends no audio. Native commands reject cloud starts without consent, including legacy/tray paths.
4. Temporary subtitles appear above the recording controls, marked **Draft**. The optional [floating caption window](floating-captions.md) can display them above other apps. Final sentences enter the existing transcript. Stop waits for the service's final results before completing.
5. A local audio recording is always saved for cloud sessions, even if ordinary auto-save is disabled. This is disclosed before capture. If streaming fails, capture continues and a visible error explains recovery: stop, then import the saved audio with the desired model.

**Test connection** in settings checks file-upload authentication only. Streaming entitlement/handshake is checked at recording start before capture; a successful file connection test does not imply live model access.

## Implementation

- `qwen-audio-3.1-asr-flash-streaming` and `qwen-audio-3.0-asr-flash-streaming`, Beijing/Singapore regional endpoints or validated workspace endpoints; key remains in OS credential storage.
- One persistent WebSocket task. `run-task` → `task-started` → binary mono PCM → `finish-task` → remaining results → `task-finished`.
- Mixed mic/system audio branches before local VAD, preserving silence. Cloud sends the existing mixed output in 100 ms frames of 48 kHz PCM16, supported by the Streaming API; original mixer cadence and local VAD/model path remain unchanged. Flush includes sub-window audio at stop.
- Provider sentence IDs deduplicate final results. Millisecond timestamps become seconds. Draft updates never enter storage or summaries. No fabricated confidence or speaker identity.
- Final cloud sentences persist synchronously, including the shutdown interval when the recording manager has moved out of global state.
- Connection/task-start/send/finish deadlines are bounded. Audio backlog beyond 20 seconds fails explicitly. No automatic region/provider fallback, audio replay or duplicate billable task on failure.
- Config save/key removal is rejected during recording. Local readiness does not access an unused cloud credential.

## Verification

- Rust library: 265 passed, 7 ignored. Includes in-process WebSocket tests for final-result draining, duplicate sentence events and unexpected disconnect, plus PCM/parameter/result parsing tests.
- Frontend: 62 passed; TypeScript and production build passed. Includes independent file/live preferences and 3.1 dialect option behavior.
- Real Beijing API, public fixtures only: 3.1 English, Mandarin, Cantonese reading and Cantonese/English code switching, plus 74.04 s English regression; 3.0 English smoke. All six completed with final sentences and intermediate updates.
- 3.1 short samples produced 11/9/10/28 intermediate updates respectively. The long fixture produced 85 intermediate updates and 8 final sentences, last final timestamp 72.84 s (the fixture is 74.04 s). Real-time-paced transmission takes about the audio duration; these runs are functional checks, not an accuracy benchmark.
- Shared-component browser preview verified live enable/model controls and recording consent/cancel with mock settings. Native microphone/system-audio capture, permission prompts and real recording-stop UI still require client acceptance.

## Boundaries

- No automatic reconnect/replay yet. A prolonged pause or network interruption can terminate the task; the UI reports interruption and the local recording remains available. Stop/restart is the current recovery workflow.
- Automatic language detection only in this first Streaming integration. Dialect preservation is available only on 3.1. Speaker separation, context correction and commercial backend remain deferred.
- Live PCM goes directly over WebSocket and does not use Filetrans temporary OSS upload. Provider-side processing/retention still follows the user's Alibaba account terms; this is not a promise of zero provider retention.
- Regions other than Beijing were not live-tested with this account. Model quality, very long meetings, sleep/wake and device hot-swap need broader acceptance testing before release.

Sources checked 2026-11-10: [WebSocket connection](https://help.aliyun.com/zh/model-studio/qwen-audio-asr-streaming-websocket-api), [Client events](https://help.aliyun.com/zh/model-studio/qwen-audio-asr-streaming-client-events), [Server events](https://help.aliyun.com/zh/model-studio/qwen-audio-asr-streaming-server-events).
