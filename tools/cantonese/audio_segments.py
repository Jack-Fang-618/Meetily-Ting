"""Bound Qwen inference windows without dropping or duplicating input samples."""
import numpy as np
import json
from pathlib import Path

POLICY = json.loads((Path(__file__).resolve().parents[1] / 'transcription-input-limits.json').read_text())['qwen']
SAMPLE_RATE = POLICY['sample_rate']
MAX_SAMPLES = POLICY['max_samples']
assert SAMPLE_RATE == 16000 and POLICY['channels'] == 1
assert 0 < POLICY['min_samples'] <= MAX_SAMPLES
assert 0 < POLICY['frame_samples'] <= POLICY['search_samples'] < MAX_SAMPLES

def validate_audio(audio):
    samples = np.asarray(audio, dtype=np.float32)
    if samples.ndim != 1:
        raise ValueError('Expected one-dimensional mono audio at 16 kHz')
    if not np.isfinite(samples).all():
        raise ValueError('Audio contains non-finite samples (NaN or infinity)')
    return samples

def chunks(samples):
    start = 0
    while len(samples) - start > MAX_SAMPLES:
        # Prefer the quietest 20 ms window in the last 5 seconds of the limit.
        search_start = start + MAX_SAMPLES - POLICY['search_samples']
        window = POLICY['frame_samples']
        search = samples[search_start:start + MAX_SAMPLES]
        frames = search[:len(search)//window*window].reshape(-1, window)
        energies = np.mean(frames.astype(np.float64)**2, axis=1)
        # Split at the end of a quiet frame; always make progress and stay bounded.
        end = search_start + (int(np.argmin(energies)) + 1) * window
        yield samples[start:end]
        start = end
    if start < len(samples):
        yield samples[start:]

def transcribe_audio(model, audio, language):
    samples = validate_audio(audio)
    texts = []
    for chunk in chunks(samples):
        if np.sqrt(np.mean(chunk.astype(np.float64)**2)) < 0.0001:
            continue
        if len(chunk) < POLICY['min_samples']:
            chunk = np.pad(chunk, (0, POLICY['min_samples'] - len(chunk)))
        result = model.generate(chunk, language=language, max_tokens=1024)
        text = result.text.strip()
        if text:
            texts.append(text)
    return '\n'.join(texts)
