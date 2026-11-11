# Caption translation and language models

2026-11-10. Implemented opt-in, sentence-level English → Chinese and Cantonese → written Chinese in the floating window. Source transcript is immutable. This is translation, not contextual transcript correction, confidence scoring or speaker memory (those remain phases 2–3).

## User flow

Open Floating captions, choose a translation mode. Local uses installed Ollama `qwen3.5:4b` at loopback only, without downloading models or needing a Key. Cloud uses the user's existing Bailian region/workspace and Keychain key. Explicitly check the cloud text-sharing checkbox to start; returning from local to cloud requires checking it again. No credentials are returned to the webview. Transcription provider remains independent.

Cloud models: `qwen3.8-flash` (recommended), `qwen3.7-plus`, `qwen-plus`, `qwen-flash`. The selected cloud model is remembered; translation itself starts off and consent is not persisted. No silent model fallback. Settings → **Language Model** exposes the same Bailian models for summary generation and explains cloud transmission. Summary selection and live translation selection are independent. Existing settings storage names are retained for compatibility.

Original and translation are displayed as a matched pair. Only finalized ASR sentences are translated. One in-flight request plus one latest pending sentence bounds lag: intermediate pending translations may be skipped during fast speech; full original transcript is unaffected. Changing model/mode/session or closing invalidates old results and pending work; an already-sent request may still finish (and be billed) but cannot update the new view. Timeout is 60s; missing models, Key, quota, network or invalid responses produce a visible message, never replace original text.

Numeric spans are temporarily masked and restored; missing/duplicated placeholders fail visibly. This guards literal numbers, NOT semantics, units, dates, negation or hallucinations. The small local model still made semantic errors in testing and is marked experimental. Translation is not a verified transcript. Formatting may retain traditional characters inside protected numbers, even with simplified Chinese requested.

## Controlled sample check

Four authored public/non-sensitive sentences: two English and two Cantonese (including mixed English terms). Same prompt and numeric handling for both new models, temperature 0, thinking disabled. Each model ran the same four sentences three times (12 responses/model). First round output cap 256, repeat rounds 512 matching application; none hit the limit. Times are wall-clock request-to-complete-text, including network, excluding ASR segmentation and recording delay.

| Model | Mean | Median | Range | Manual semantic inspection |
|---|---:|---:|---:|---|
| qwen3.8-flash | 1.71 s | 1.83 s | 1.05–2.51 s | All four unique cases preserve key meaning across three rounds |
| qwen3.7-plus | 2.01 s | 1.93 s | 1.30–2.86 s | All four unique cases preserve key meaning across three rounds |

Both preserved Thursday 2:30 without inventing AM/PM, tomorrow afternoon, the 2880-versus-10000 contrast, not confirmed/not released and possible delay. This tiny check is NOT a benchmark accuracy percentage or proof of general superiority. 3.8 Flash is the provisional default because observed quality tied and mean latency was modestly lower.

Earlier Qwen3.5 4B local runs were roughly 3–6s warm and about 9s on the first request, with longer runs during concurrent development builds; these were not controlled hardware benchmarks. It confused tomorrow/today and reversed a budget assertion even with literal numbers protected. Older cloud aliases also made errors on these examples. Neither should be described as equivalently reliable from these tests.

Artifacts (ignored development files): `experiments/caption-translation/versioned-results.json`, `versioned-repeat-results.json`, plus local/legacy results in the same directory. Re-run synthetic cloud probes using `tools/evaluate_caption_translation.py --output PATH`, passing your own Key through stdin. The script never includes a default developer Key.

Official references: https://help.aliyun.com/zh/model-studio/text-generation-model and https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions . Account calls succeeded for both versioned models in Beijing; other accounts/regions remain unverified.

Validation: 272 Rust tests passed (7 ignored), 65 frontend tests passed, TypeScript and production export passed. Tests cover numeric preservation failures, explicit cloud consent, input limits, request options, bounded queue, stale-result suppression and recovery. Browser component preview verified model selection and local/cloud consent reset. Native live recording + translation remains a manual acceptance step after restart.

## Experimental direct audio translation (2026-11-10)

Floating captions now offers **Bailian Live Audio (experimental)** alongside local and Bailian sentence translation. It uses `qwen3.8-livetranslate-flash-realtime`, text-only output, Chinese target, 16 kHz mono PCM input. Both English and Cantonese modes use automatic input-language recognition. Explicit audio-upload consent is required: this is an additional billable audio session, independent of ASR. It never edits the saved transcript. Disable the option or close the caption window to stop it. Failure leaves recording running; toggle consent off/on to reconnect. No automatic replay or reconnect.

Unlike sentence translation, translated deltas appear before the complete recording ends. This is not zero-latency interpretation. Public short-clip probes returned their first translated delta after 2.34 s (English), 5.58 s (read Cantonese), and 4.24 s (conversational Cantonese/English), measured from connection start, not end of speech. All three finished successfully. English repeated/expanded a communication clause; Cantonese samples produced readable written Chinese. Three samples are a smoke test, not an accuracy benchmark. The mixed-language NC fixture remains research-only. Results are in ignored `experiments/caption-translation/live-probe.json`. These API probes used Python/ffmpeg, not a native end-to-end UI test.

An initial request failed on an unsupported default voice. Explicit input PCM format and the documented Tina voice resolved setup in all three probes, even though output is text only. Source and translated events may arrive out of order; pairing uses item IDs. Session finish drains final events for up to 15 seconds.

Official reference: https://help.aliyun.com/zh/model-studio/qwen3-5-livetranslate-flash-realtime
