#!/usr/bin/env bash
# Build a self-contained Apple Silicon pilot with the pinned local ASR runtimes.
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ "$(uname -sm)" == 'Darwin arm64' ]]
bash tools/cantonese/setup.sh --inference-only
(cd frontend && CI=true pnpm tauri build --features metal --bundles app)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
app="$stage/Ting Dev.app"
ditto 'target/release/bundle/macos/Ting Dev.app' "$app"
root="$app/Contents/Resources/ting-local"
mkdir -p "$root/tools/cantonese"
cp tools/transcription-input-limits.json "$root/tools/"
cp tools/cantonese/{catalog.json,diarize.py,worker.py,audio_segments.py,prepare.py,preparation_progress.py} "$root/tools/cantonese/"
envdir=.ting-runtime
    base=$("$envdir/bin/python" -c 'import sys; print(sys.base_prefix)')
    dst="$root/$envdir"
    mkdir -p "$dst/bin" "$dst/lib"
    cp "$base/bin/python3.11" "$dst/bin/python"
    cp "$base/lib/"*.dylib "$dst/lib/"
    rsync -a --exclude __pycache__ --exclude site-packages "$base/lib/python3.11" "$dst/lib/"
    rsync -a --exclude __pycache__ "$envdir/lib/python3.11/site-packages" "$dst/lib/python3.11/"
codesign --force --sign - --options runtime --entitlements frontend/src-tauri/entitlements.plist "$app"
codesign --verify --deep --strict "$app"
ln -s /Applications "$stage/Applications"
out="target/release/bundle/dmg/Ting-Dev-$(git rev-parse --short HEAD)-MLX-arm64.dmg"
mkdir -p "$(dirname "$out")"
hdiutil create -ov -format UDZO -volname 'Ting Dev' -srcfolder "$stage" "$out"
hdiutil verify "$out"
