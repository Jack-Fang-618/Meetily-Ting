# Alibaba Cloud file transcription (development preview)

## Configure your account

1. Open Settings → Transcription → Transcript Model → **Alibaba Cloud (Files only)**.
2. Choose the region where your Bailian API Key was created: Beijing or Singapore. Enter your own key. Workspace ID is optional for the regional endpoint, or required to use your workspace-specific endpoint.
3. Choose 3.1 (recommended starting point) or 3.0. **Preserve dialect wording** applies only to 3.1; keep it enabled for Cantonese verbatim transcription.
4. Enable cloud models and select **Save cloud settings**, then **Test saved connection**. This checks authentication/upload access without uploading audio or running transcription; it is not proof of model inference availability.
5. Optionally select **Use this cloud model by default for file imports** and save. This preference is independent of the live/local model; switching local recording models does not clear it. Uncheck it to restore local file defaults. Upload consent is still required for every file.
6. Open Import Audio, select a cloud model and language (Auto for mixed language), and acknowledge upload/account billing for the selected file. Cloud is never chosen as an automatic fallback.

Every installation starts with cloud disabled and no credentials. There is no author-owned default key, bundled key, `.env` fallback, or automatic migration from an older Ting installation. Keys are stored in the OS credential store; the UI only receives a `has_key` boolean. Removing a key disables cloud import for that saved region. Live recording and existing retranscription remain local in this phase.

## Current limits and behavior

- Audio leaves the device only for an explicitly selected cloud import. The region is shown before submission; costs belong to the user's Alibaba Cloud account.
- This development implementation uses Bailian temporary storage: at most 1 GiB, additionally constrained by the model's upload policy; at most 12 hours. Only the first track is recognized. Audio is uploaded unchanged, without local VAD cutting.
- Alibaba documents temporary copies as expiring within 48 hours and does **not recommend temporary storage for production**. Before a public production release, replace this transport with an appropriate controlled storage strategy. Cancelling locally does not delete an uploaded copy immediately.
- Filetrans creates an asynchronous task. Its ID and normalized result are saved privately on this computer, scoped to audio contents, region/workspace, model, options and credential. Reimporting the same input with the same settings resumes the known task or reuses its result; it does not automatically submit a duplicate.
- **Stop waiting** stops local waiting. A submitted cloud task can continue and incur charges. Upload cancellation is responsive; a pending submission/status request may need to finish first to preserve the task ID. Submission timeout without a task ID is marked unknown and never automatically resubmitted; inspect the account's tasks before further action.
- Definitive failed/expired tasks currently require troubleshooting in the provider console. There is no UI for resetting a terminal job cache or recovering an unknown task ID yet. This limitation should be addressed before broad distribution.
- No confidence score is invented. Provider sentence timestamps are converted from milliseconds into the existing transcript's seconds. Imported audio, meeting and transcripts use the existing local save pipeline.
- Long tasks use bounded status polling. Rate/server/network failures retry status queries only, never automatically switch region/provider. Results must be retrieved before the provider's 24-hour result URL expiry.

## Validation and reproducibility

`evaluate_aliyun` calls the same Rust transport and parser as the application, with a key read from stdin. It does not configure the application or persist the key. It writes normalized outputs and timings under a caller-selected local directory. Run only on audio authorized for cloud processing; real requests may incur charges.

From `frontend/src-tauri`, build using the same platform features as Ting. Example invocation from the repository root after building:

```sh
./target/debug/examples/evaluate_aliyun \
  experiments/speech-test-pack-v1/manifest.json \
  experiments/speech-test-pack-v1 \
  experiments/aliyun-evaluation
```

Supply the key through a secure stdin source; do not paste it into shell arguments, source code, logs or this document. The test example defaults to Beijing; the app supports Beijing and Singapore. Windows/Linux credential adapters are configured but this round's runtime verification is on macOS only.

## Official references checked 2026-11-10

- [Filetrans HTTP API](https://help.aliyun.com/zh/model-studio/qwen-audio-asr-filetrans-http-api)
- [Temporary uploads](https://help.aliyun.com/zh/model-studio/get-temporary-file-url)
- [API Keys and regions](https://help.aliyun.com/zh/model-studio/get-api-key)

## Production storage decision (2026-11-10)

User intends to distribute the application to nontechnical users. Production storage should use private objects, short-lived signed read URLs for ASR, deletion after result retrieval, and lifecycle cleanup for interrupted/failed jobs. Signed-URL lifetime must cover queued task processing; local deletion cannot promise deletion of all provider-side copies.

Two ownership options remain to be designed: (1) user-owned OSS with their own configuration and billing, or (2) a Ting-hosted upload service with authentication, per-user isolation, size/quota controls and storage/traffic costs. The second reduces setup work but means audio passes through Ting-operated infrastructure and requires explicit disclosure. Long-lived OSS credentials must never ship inside the desktop app. This round implements neither hosted storage nor a commercial service; it keeps development temporary uploads clearly labeled.

References: [Private signed downloads](https://help.aliyun.com/zh/oss/user-guide/how-to-obtain-the-url-of-a-single-object-or-the-urls-of-multiple-objects/), [OSS lifecycle rules](https://help.aliyun.com/zh/oss/user-guide/lifecycle-rules-based-on-the-last-modified-time).

## Checks completed this round

Rust suite: 260 passed; separately enabled macOS credential-store set/read/delete smoke test passed with a disposable dummy credential. Frontend: 56 passed, TypeScript and production build passed. Public audio: 3.1 full 30-file run and 3.0 four-file smoke run succeeded. Native GUI interaction has not been revalidated after this change; restart from the desktop launcher to load the new code, then check save/test/remove key and an explicit cloud import. The author's real key was used only for the opt-in evaluation process and was not saved as the application's default.

Recovery check: the native evaluation client reimported a previously completed public sample, returned the saved result, and emitted no upload/submission stage. This complements the unit test that refuses to resubmit an unknown submission.

Local setup note (2026-11-10): at the owner's explicit request, the pre-existing key was copied into this machine's OS credential store and Beijing cloud import enabled. No key was added to source, frontend defaults, configuration JSON, Git history or shared distributions. Other installations still start with cloud disabled and no credentials.
