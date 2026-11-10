#!/usr/bin/env python3
"""Run installed Qwen weights through Ting's existing offline worker, sequentially."""
import argparse
import hashlib
import json
import selectors
import subprocess
import sys
import time
from pathlib import Path
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pack', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    rows = json.loads((args.pack/'manifest.json').read_text())
    specs = json.loads((ROOT/'tools/cantonese/catalog.json').read_text())
    installed = [s['id'] for s in specs if (args.models/s['id']/'ting-ready.json').exists()]
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output/'qwen.jsonl').open('w') as report:
        for model in installed:
            with (args.output/f'{model}.stderr.log').open('w') as log:
                process = subprocess.Popen([sys.executable, str(ROOT/'tools/cantonese/worker.py'), '--root', str(args.models)],
                                           stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True)
                selector = selectors.DefaultSelector()
                selector.register(process.stdout, selectors.EVENT_READ)
                def request(payload):
                    process.stdin.write(json.dumps({'model':model, **payload})+'\n')
                    process.stdin.flush()
                    if not selector.select(timeout=300):
                        process.kill()
                        raise TimeoutError('Worker did not respond within 300 seconds')
                    line = process.stdout.readline()
                    if not line:
                        raise RuntimeError(f'Worker exited: {process.poll()}')
                    return json.loads(line)
                try:
                    started = time.monotonic()
                    loaded = request({'op':'load'})
                    if not loaded.get('ok'):
                        raise RuntimeError(loaded)
                    load_seconds = time.monotonic()-started
                    cases = [(item,'auto',None) for item in rows]
                    cases += [(item,'explicit-English','en') for item in rows if item['file'].startswith('01-English/')]
                    for item, mode, language in cases:
                        path = args.pack/item['file']
                        assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256']
                        audio, sr = sf.read(path, dtype='float32')
                        assert sr == 16000 and audio.ndim == 1
                        started = time.monotonic()
                        response = request({'op':'transcribe','samples':audio.tolist(),'language':language})
                        seconds = time.monotonic()-started
                        row = {'model':model,'file':item['file'],'mode':mode,'language':language or 'auto',
                               'audio_seconds':item['duration_seconds'],'seconds':seconds,'load_seconds':load_seconds,
                               'text':response.get('text'),'error':response.get('error'),
                               'timing_scope':'worker request including JSON IPC and inference, excludes model load and file decode'}
                        report.write(json.dumps(row,ensure_ascii=False)+'\n');report.flush()
                        print(model,mode,item['file'],f'{seconds:.2f}s', 'OK' if response.get('ok') else response, flush=True)
                finally:
                    selector.close()
                    process.stdin.close()
                    try:process.wait(timeout=15)
                    except subprocess.TimeoutExpired:process.kill();process.wait()


if __name__ == '__main__':
    main()
