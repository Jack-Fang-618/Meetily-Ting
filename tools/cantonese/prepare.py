"""Prepare a pinned model. No audio or credentials leave this machine."""
import argparse
from contextlib import redirect_stdout
import hashlib
import urllib.request
import gc
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import traceback

os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
# macOS system certificate store; don't disable certificate verification.
import truststore
truststore.inject_into_ssl()
from huggingface_hub import snapshot_download

HERE = Path(__file__).resolve().parent
CATALOG = json.loads((HERE / 'catalog.json').read_text())

def step(text):
    print(text, flush=True)

def run_checked(command, stage, root, **kwargs):
    log = root / 'logs' / (stage + '.log')
    log.parent.mkdir(parents=True, exist_ok=True)
    step(stage + ' · log: ' + str(log))
    with log.open('w') as output:
        result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, **kwargs)
    if result.returncode:
        lines = log.read_text(errors='replace').splitlines()
        detail = '\n'.join(lines[-10:])[-1800:]
        raise RuntimeError(f'{stage} failed (exit {result.returncode}). {detail}\nFull log: {log}')

def preflight(model_id, root):
    converter = model_id.startswith('qwen3-yue') or model_id == 'buzz-cantonese'
    python = HERE.parents[1] / '.ting-convert/bin/python' if converter else Path(sys.executable)
    if not python.is_file():
        raise RuntimeError('Runtime missing. Run bash tools/cantonese/setup.sh first.')
    imports = ('import torch, peft; from qwen_asr.core.transformers_backend import Qwen3ASRForConditionalGeneration, Qwen3ASRProcessor'
               if converter else 'from mlx_audio.stt import load')
    run_checked([str(python), '-c', imports], model_id + '-preflight', root)
    # Conservative free-space floor includes intermediate weights, not only the final model.
    required_gb = (16 if '1.7b' in model_id else 8) if converter else (4 if '1.7b' in model_id else 2)
    if shutil.disk_usage(root).free < required_gb * 1024**3:
        raise RuntimeError(f'At least {required_gb} GiB free space is required for preparation.')

def snapshot(repo, revision):
    step('Downloading ' + repo)
    return snapshot_download(repo_id=repo, revision=revision,
        allow_patterns=['*.json', '*.txt', '*.safetensors', '*.model'], max_workers=3)

def fetch_checked(url, digest, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = urllib.request.urlopen(url, timeout=120).read()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('Conversion asset checksum mismatch')
    path.write_bytes(data)

def prepare_buzz(root):
    dest = root.parent/'ggml-buzz-cantonese.bin'
    if dest.exists():
        step('BuzzASR is already installed')
        return
    source = snapshot('BuzzASR/cantonese', 'cb8f9659c0d5e9ea0ae84d652f49e209bebb1fec')
    build = root/'buzz-conversion'
    build.mkdir(parents=True, exist_ok=True)
    converter = build/'convert.py'
    fetch_checked('https://raw.githubusercontent.com/ggml-org/whisper.cpp/231638a0717b7822784297e5980965ffcec05810/models/convert-h5-to-ggml.py',
        '9cc282dfcd9a24da03ffa1b4123b5508ee935e19e369c33520b1a73f89440094', converter)
    fetch_checked('https://raw.githubusercontent.com/openai/whisper/86098128c0b4f24f0e2aa2994de830614b474227/whisper/assets/mel_filters.npz',
        '7450ae70723a5ef9d341e3cee628c7cb0177f36ce42c44b7ed2bf3325f0f6d4c', build/'whisper/assets/mel_filters.npz')
    step('Converting BuzzASR to GGML (local CPU)')
    run_checked([str(HERE.parents[1]/'.ting-convert/bin/python'),str(converter),source,str(build),str(build)], 'buzz-conversion', root)
    result=build/'ggml-model.bin'
    with result.open('rb') as stream:
        if stream.read(4) != b'lmgg':
            raise ValueError('Invalid converted Whisper header')
    result.replace(dest)
    shutil.rmtree(build)
    step('Converted; select the model to verify native loading')

def prepare(model_id, root):
    if model_id not in {s['id'] for s in CATALOG} | {'buzz-cantonese'}:
        raise ValueError('Unknown model')
    preflight(model_id, root)
    if model_id == 'buzz-cantonese':
        return prepare_buzz(root)
    spec = next((s for s in CATALOG if s['id'] == model_id), None)
    if spec is None:
        raise ValueError('Unknown model')
    dest = root / model_id
    marker = dest / 'ting-ready.json'
    if (marker.exists() and json.loads(marker.read_text()).get('spec') == spec
            and (dest / 'config.json').is_file() and any(dest.glob('*.safetensors'))):
        step('Already prepared')
        return
    src = snapshot(spec['repo'], spec['revision'])
    staging = root / (model_id + '.preparing')
    if staging.exists():
        shutil.rmtree(staging)
    if 'adapter' in spec:
        adapter = snapshot(spec['adapter'], spec['adapter_revision'])
        merged = root / (model_id + '.merged')
        step('Merging Cantonese adapter (local CPU)')
        run_checked([str(HERE.parents[1] / '.ting-convert/bin/python'),
            str(HERE / 'merge.py'), src, adapter, str(merged)], model_id + '-merge', root)
        step('Converting merged weights to MLX 8-bit')
        from mlx_audio.convert import convert
        with redirect_stdout(sys.stderr):
            convert(str(merged), mlx_path=str(staging), quantize=True, q_bits=8, model_domain='stt')
        import mlx.core as mx
        gc.collect()
        mx.clear_cache()
        shutil.rmtree(merged)
    else:
        shutil.copytree(src, staging, ignore=shutil.ignore_patterns('.*'))
    step('Checking local model load')
    # Verify in another process so conversion memory is released before inference.
    run_checked([sys.executable, str(HERE / 'worker.py'), '--check', str(staging)], model_id + '-load', root,
                   env={**os.environ, 'HF_HUB_OFFLINE':'1'})
    (staging / 'ting-ready.json').write_text(json.dumps({'spec':spec, 'runtime':'mlx-audio-0.6.1'}))
    if dest.exists():
        shutil.rmtree(dest)
    staging.rename(dest)
    step('Ready')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    args.root.mkdir(parents=True, exist_ok=True)
    try:
        prepare(args.model, args.root)
    except Exception as exc:
        log = args.root / 'logs' / (args.model + '-prepare.log')
        log.parent.mkdir(parents=True, exist_ok=True)
        log.write_text(traceback.format_exc())
        print(f'Preparation failed: {exc}\nDiagnostic log: {log}', flush=True)
        raise SystemExit(1)
