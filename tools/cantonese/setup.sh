#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo 'This development runtime currently requires an Apple Silicon Mac.' >&2
  exit 1
fi
# Installs runtimes only. No model weights are downloaded automatically.
[[ -x .ting-runtime/bin/python ]] || UV_NATIVE_TLS=true uv venv --python 3.11 .ting-runtime
UV_NATIVE_TLS=true uv pip install --python .ting-runtime/bin/python -r tools/cantonese/runtime-requirements.txt
[[ -x .ting-convert/bin/python ]] || UV_NATIVE_TLS=true uv venv --python 3.11 .ting-convert
UV_NATIVE_TLS=true uv pip install --python .ting-convert/bin/python -r tools/cantonese/convert-requirements.txt
