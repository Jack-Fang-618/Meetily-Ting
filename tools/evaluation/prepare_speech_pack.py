#!/usr/bin/env python3
"""Small, pinned public speech fixtures; run with .ting-runtime/bin/python.
Streams only the beginning of each FLEURS archive, never extracts arbitrary paths.
Audio and references stay in ignored experiments/, not the application bundle.
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

import numpy as np
import soundfile as sf
import truststore

truststore.inject_into_ssl()
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'experiments/speech-test-pack-v1'
REV = '70bb2e84b976b7e960aa89f1c648e09c59f894dd'
BASE = f'https://huggingface.co/datasets/google/fleurs/resolve/{REV}'
GROUPS = [('01-English', 'en_us'), ('02-Mandarin', 'cmn_hans_cn'),
          ('03-Cantonese-Read', 'yue_hant_hk')]
MIXED_IDS = ['0000005361', '0000012988', '0000034643', '0000054438', '0000074630']


def read(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save_clip(group, name, data, reference, metadata):
    path = OUT / group / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() != data:
        raise RuntimeError(f'Refusing to replace changed fixture: {path}')
    audio, rate = sf.read(io.BytesIO(data))
    if rate != 16000 or audio.ndim != 1 or not np.isfinite(audio).all() or not len(audio):
        raise ValueError(f'Invalid audio: {name}')
    path.write_bytes(data)
    path.with_suffix('.txt').write_text(reference + '\n', encoding='utf-8')
    return dict(file=str(path.relative_to(OUT)), sha256=digest(data),
                sample_rate=rate, duration_seconds=len(audio)/rate,
                reference=reference, **metadata)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    entries = []
    for group, config in GROUPS:
        # Retain the upstream card and complete small TSV for provenance.
        source = OUT / 'sources' / config
        source.mkdir(parents=True, exist_ok=True)
        tsv = read(f'{BASE}/data/{config}/test.tsv')
        (source / 'test.tsv').write_bytes(tsv)
        rows = {r[1]: r for r in csv.reader(io.StringIO(tsv.decode()), delimiter='\t')}
        url = f'{BASE}/data/{config}/audio/test.tar.gz'
        count = 0
        # Deterministic first eight matching WAV members of a pinned archive.
        with urllib.request.urlopen(url, timeout=60) as response:
            with tarfile.open(fileobj=response, mode='r|gz') as archive:
                for member in archive:
                    name = Path(member.name).name
                    if not member.isfile() or name not in rows:
                        continue
                    row = rows[name]
                    data = archive.extractfile(member).read()
                    count += 1
                    entries.append(save_clip(group, f'{count:02d}-{name}', data, row[2], {
                        'dataset': 'google/fleurs', 'revision': REV, 'config': config,
                        'split': 'test', 'source_id': row[0], 'source_filename': name,
                        'source_url': url, 'archive_member': member.name,
                        'license': 'CC-BY-4.0', 'attribution': 'FLEURS authors / Google',
                        'reference_style': 'upstream raw transcription, unchanged',
                        'modification': 'none', 'auditory_review': False}))
                    print(f'{group}: {count}/8', flush=True)
                    if count == 8:
                        break
        if count != 8:
            raise RuntimeError(f'Incomplete group: {config}')
    (OUT / 'sources/FLEURS-README.md').write_bytes(read(f'{BASE}/README.md'))

    previous = ROOT / 'experiments/cantonese/public-eval/pack'
    manifest = json.loads((previous / 'manifest.json').read_text())
    for number, ident in enumerate(MIXED_IDS, 1):
        item = next(x for x in manifest if x['id'] == ident)
        wav = previous / 'mixed' / f'{ident}.wav'
        data = wav.read_bytes()
        if digest(data) != item['sha256']:
            raise RuntimeError(f'Existing Cantonese fixture checksum mismatch: {ident}')
        entries.append(save_clip('04-Cantonese-English-NC', f'{number:02d}-{ident}.wav', data, item['reference'], {
            'dataset': 'ASLP-lab/WSYue-ASR-eval', 'split': 'Long', 'source_id': ident,
            'source_url': 'https://huggingface.co/datasets/ASLP-lab/WSYue-ASR-eval',
            'license': 'CC-BY-NC-4.0', 'attribution': 'WenetSpeech-Yue team; annotation: AISHELL',
            'selection': 'reference-screened English words, not yet auditory-reviewed',
            'reference_style': 'upstream colloquial reference, unchanged',
            'modification': 'none', 'auditory_review': False}))

    # A real-speech >60s regression fixture, explicitly concatenated, not a real meeting.
    english = [x for x in entries if x['file'].startswith('01-English/')]
    chunks, timeline, offset = [], [], 0.0
    for item in english:
        audio, _ = sf.read(OUT / item['file'])
        chunks.extend([audio, np.zeros(8000)])
        timeline.append(f'[{offset:.3f}–{offset+len(audio)/16000:.3f}] {item["reference"]}')
        offset += len(audio)/16000 + 0.5
    combined = io.BytesIO()
    sf.write(combined, np.concatenate(chunks), 16000, format='WAV', subtype='PCM_16')
    assert offset > 60, 'Need more English clips for long input regression'
    entries.append(save_clip('05-Long-Regression', 'English-over-60s.wav', combined.getvalue(), '\n'.join(timeline), {
        'dataset': 'google/fleurs', 'revision': REV, 'license': 'CC-BY-4.0',
        'attribution': 'FLEURS authors / Google', 'source_files': [x['file'] for x in english],
        'modification': 'Concatenated in listed order with 0.5s silence after each; PCM16 encoding',
        'auditory_review': False}))
    frozen = Path(__file__).with_name('speech-pack-v1.manifest.json')
    if frozen.exists() and json.loads(frozen.read_text()) != entries:
        raise RuntimeError('Fixtures differ from the versioned v1 manifest; do not silently replace the baseline')
    (OUT / 'manifest.json').write_text(json.dumps(entries, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'clips':len(entries), 'minutes':sum(x['duration_seconds'] for x in entries)/60,
                      'audio_MB':sum((OUT/x['file']).stat().st_size for x in entries)/1e6}, indent=2))


if __name__ == '__main__':
    main()
