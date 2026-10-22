# Ting Dev isolation

This fork uses a separate development identity in the base Tauri configuration,
so both development runs and packaged builds are isolated from installed Meetily.
No special command-line override is required.

| Resource | Ting Dev default on macOS |
| --- | --- |
| Application name / window / tray tooltip | Ting Dev |
| Bundle identifier | com.ting.dev |
| Database and Tauri store preferences | ~/Library/Application Support/com.ting.dev/ |
| Models and custom templates | ~/Library/Application Support/com.ting.dev/ |
| Notification preferences | ~/Library/Application Support/com.ting.dev/notifications.json |
| Saved recordings | ~/Movies/ting-dev-recordings/ |

Model constructors without an explicit path can also use repository-local models
in debug builds. Release fallback paths use com.ting.dev. Recording paths may be
changed by the user; do not select the existing Meetily recording folder for tests.
No existing recordings, preferences, databases, or models are migrated or copied.

Upstream update endpoints are removed, updater artifact generation is disabled,
and automatic/manual update checks are disabled in the frontend and tray. A future
Ting release needs its own update endpoint and signing key before enabling updates.
Upstream attribution and license notices are retained.

## Starting later

Install full Xcode on macOS: Command Line Tools alone are insufficient. The
pinned `cidre` dependency invokes `xcodebuild` for its native audio bindings.
After installing Xcode, open it once to complete setup. If Command Line Tools
remain the active developer directory, set `DEVELOPER_DIR` to the installed
Xcode's Contents/Developer directory for the build process.

For a fresh checkout, install frontend dependencies with
`pnpm install --frozen-lockfile`, build `llama-helper` with Metal, and copy the
binary before starting Tauri. Commands from the repository root:

```sh
(cd frontend && pnpm install --frozen-lockfile)
cargo build --locked -p llama-helper --features metal -j 4
mkdir -p frontend/src-tauri/binaries
cp target/debug/llama-helper frontend/src-tauri/binaries/llama-helper-aarch64-apple-darwin
cd frontend
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer CARGO_BUILD_JOBS=4 pnpm tauri dev --features metal
```

The commands above target Apple Silicon. Frontend development still uses port 3118. The installed desktop
client does not normally need that development server; another source checkout
running the same port will conflict.

macOS may request microphone/system-audio permissions for the new identity.
System tools (for example FFmpeg on PATH) and explicitly configured external
services (for example Ollama) remain shared dependencies. The upstream FFmpeg
fallback installer can write ~/.local/bin and shell profiles when FFmpeg is
missing; ensure the packaged or system FFmpeg is available before audio testing.

## Verification status

Configuration and source-path checks passed. Frontend dependencies installed
with the frozen lockfile, `pnpm exec tsc --noEmit` passed, the development homepage
returned HTTP 200, and the Metal-enabled llama-helper compiled successfully.
After installing Xcode 16.4, desktop compilation passed and the native process
started alongside the installed Meetily process. Startup logs confirm models use
com.ting.dev; first-launch onboarding was emitted. Audio recording, permissions,
transcription, and database creation after onboarding still need verification. The installed Meetily application and its
data were not modified.

## Next.js development interactivity

The inherited CSP blocked Next.js development scripts (which use eval), leaving
rendered HTML without working interactions. A development-only `devCsp` now
permits those scripts and the localhost:3118 hot-reload connection. The production
CSP is unchanged. After restarting, frontend IPC calls resumed, the independent
SQLite database initialized, and onboarding step 1 persisted successfully.
