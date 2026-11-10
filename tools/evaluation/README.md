# Offline local speech comparison

Prepare fixtures with `prepare_speech_pack.py`; see `docs/speech-test-pack.md`.
Run engines sequentially, with no ongoing recording or competing inference, for interpretable timings. Tools read model weights and public fixtures; they do not write app settings or meeting records. Do not use private audio in published reports.

From repository root, with an existing output directory:

```sh
mkdir -p experiments/speech-comparison-2026-11-10
cd frontend/src-tauri
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer CARGO_BUILD_JOBS=4 cargo build --example evaluate_parakeet --features metal
cd ../..
./target/debug/examples/evaluate_parakeet "$HOME/Library/Application Support/com.ting.dev/models" experiments/speech-test-pack-v1 experiments/speech-comparison-2026-11-10/parakeet.jsonl
.ting-runtime/bin/python tools/evaluation/run_qwen_comparison.py --pack experiments/speech-test-pack-v1 --models "$HOME/Library/Application Support/com.ting.dev/models/cantonese" --output experiments/speech-comparison-2026-11-10
uv pip install --python .ting-runtime/bin/python --target experiments/speech-comparison-2026-11-10/scoring-deps opencc-python-reimplemented==0.1.7
PYTHONPATH=experiments/speech-comparison-2026-11-10/scoring-deps .ting-runtime/bin/python tools/evaluation/score_speech_comparison.py --pack experiments/speech-test-pack-v1 --results experiments/speech-comparison-2026-11-10
```

Use a **new output directory** to preserve previous runs. Parakeet takes the parent `models` directory, not `models/parakeet`. Build from `frontend/src-tauri` so macOS linker configuration is applied. Qwen finds installed catalog models, loads one at a time and has a five-minute request timeout. It runs all fixtures in Auto and additionally runs English clips with explicit English.

Scoring/report headings describe this v1 baseline: two Qwen models plus Parakeet, 30 fixtures, 106 cases. Update those descriptions if changing installed models or fixtures. Raw results are JSONL and survive a partial run; inspect completeness before reporting. OpenCC is installed only into an ignored scoring directory, leaving app dependencies unchanged. CER uses t2s, letter/digit characters only; WER uses lowercase English word tokens and removes apostrophes. Numeric spelling equivalence is **not** applied; do not read the metric as semantic accuracy.
