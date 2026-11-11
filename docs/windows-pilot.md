# Ting Dev on Windows x64

The pilot installer is built from the `codex/ting-dev-isolation` branch. A successful **Ting Windows pilot** Actions run publishes **Ting-Windows-x64** under **Artifacts**. Sign in to GitHub, download and extract the ZIP, and open the setup EXE. This pilot uses an unsigned installer. If your work computer requires a signed installer or administrator approval, ask IT to install it.

Start **Ting Dev**, complete setup and allow microphone access if needed. For a local English test, select **Settings → Transcription → Parakeet** and download Lightning. Record a short English clip, stop, save and reopen it. For Mandarin or Cantonese, try multilingual Whisper or configure your own Bailian key and region for cloud transcription. Local Qwen3-ASR currently needs the Apple Silicon MLX runtime.

## Build on a Windows development PC

IT or a developer can produce the same CPU installer locally. Use an x64 Visual Studio 2022 developer PowerShell with the C++ desktop workload and Windows SDK, Rust stable MSVC, LLVM with libclang, CMake, Git, Node 22 and pnpm 9.15.9. The build requires internet access for dependencies, FFmpeg and ONNX Runtime.

```powershell
git clone --branch codex/ting-dev-isolation --single-branch https://github.com/Jack-Fang-618/Meetily-Ting.git
cd Meetily-Ting
$env:CMAKE_PROJECT_INCLUDE = (Resolve-Path .github/force-portable-ggml.cmake).Path.Replace('\','/')
$env:RUSTFLAGS = '-C target-cpu=x86-64-v2'
$env:LIBCLANG_PATH = 'C:\Program Files\LLVM\bin'
cargo build --locked --release -p llama-helper
if ($LASTEXITCODE) { throw 'Could not build llama-helper' }
New-Item frontend/src-tauri/binaries -ItemType Directory -Force
Copy-Item target/release/llama-helper.exe frontend/src-tauri/binaries/llama-helper-x86_64-pc-windows-msvc.exe
cd frontend
pnpm install --frozen-lockfile
if ($LASTEXITCODE) { throw 'Could not install frontend dependencies' }
pnpm tauri build --bundles nsis
if ($LASTEXITCODE) { throw 'Could not build the installer' }
Get-ChildItem ../target/release/bundle/nsis/*-setup.exe
```
