"""Local, whole-recording speaker diarization. Only model downloads use the network."""
import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

import numpy as np
import sherpa_onnx as so
import truststore

RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/'
SEG = 'sherpa-onnx-pyannote-segmentation-3-0'
EMB = '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'


def download(url, checksum, path):
    with urllib.request.urlopen(url, timeout=90) as response, path.open('wb') as out:
        shutil.copyfileobj(response, out)
    with path.open('rb') as source:
        if hashlib.file_digest(source, 'sha256').hexdigest() != checksum:
            raise ValueError('Incomplete speaker model download. Please try again.')


def prepare(root):
    if root.is_dir():
        return
    truststore.inject_into_ssl()
    root.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root.parent) as tmp:
        stage = Path(tmp) / 'models'
        stage.mkdir()
        archive = Path(tmp) / 'segmentation.tar.bz2'
        download(RELEASE + 'speaker-segmentation-models/' + SEG + '.tar.bz2',
                 '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488', archive)
        with tarfile.open(archive) as tar, (stage / 'segment.onnx').open('wb') as out:
            shutil.copyfileobj(tar.extractfile(SEG + '/model.onnx'), out)
        download(RELEASE + 'speaker-recongition-models/' + EMB,
                 '1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b', stage / 'embed.onnx')
        stage.rename(root)


def calibrate(root, samples, turns, references, count):
    rate = 16000
    frame = 320  # 20 ms timeline
    extractor = so.SpeakerEmbeddingExtractor(
        so.SpeakerEmbeddingExtractorConfig(model=str(root / 'embed.onnx'), num_threads=2))

    def embedding(clip):
        stream = extractor.create_stream()
        stream.accept_waveform(rate, clip)
        stream.input_finished()
        vector = np.asarray(extractor.compute(stream))
        norm = np.linalg.norm(vector)
        if not np.isfinite(norm) or norm == 0:
            raise ValueError('Could not identify a voice. Choose a clearer passage.')
        return vector / norm

    profiles = [[] for _ in range(count)]
    size = (len(samples) + frame - 1) // frame
    confirmed = np.full(size, -1, dtype=np.int8)
    for ref in references:
        speaker = ref['speaker']
        start, end = round(ref['start'] * rate), min(len(samples), round(ref['end'] * rate))
        if speaker not in range(count) or start < 0 or end - start < rate:
            raise ValueError('Select at least one second of recorded speech per passage.')
        region = confirmed[round(start/frame):round(end/frame)]
        if np.any((region >= 0) & (region != speaker)):
            raise ValueError('Samples for different speakers overlap.')
        region[:] = speaker
        clip = samples[start:end]
        if np.max(np.abs(clip)) < 1e-5:
            raise ValueError('A selected sample is silent.')
        # Keep inference bounded even when an imported transcript has long passages.
        for chunk in np.array_split(clip, max(1, round(len(clip) / (3 * rate)))):
            profiles[speaker].append(embedding(chunk))

    if not all(profiles):
        raise ValueError('Select a sample for each speaker.')
    centers = np.array([np.mean(group, axis=0) for group in profiles])
    centers /= np.linalg.norm(centers, axis=1, keepdims=True)
    active = np.zeros((count, size), dtype=bool)
    for turn in turns:
        active[turn['speaker'], round(turn['start']*50):round(turn['end']*50)] = True
    single = active.sum(axis=0) == 1
    for i in range(0, size, 25):
        window = slice(i, i+25)
        speech = single[window]
        if not speech.any():
            continue
        center = i * frame + 4000
        clip = samples[max(0, center-rate):center+rate]
        speaker = int(np.argmax(centers @ embedding(clip)))
        active[:, window] &= ~speech
        active[speaker, window] |= speech
    for speaker in range(count):
        active[speaker, confirmed >= 0] = confirmed[confirmed >= 0] == speaker
    result = []
    for speaker, mask in enumerate(active):
        edges = np.flatnonzero(np.diff(np.r_[False, mask, False]))
        for start, end in edges.reshape(-1, 2):
            result.append(dict(start=start/50, end=min(end/50, len(samples)/rate), speaker=speaker))
    return sorted(result, key=lambda turn: turn['start'])


def analyze(root, ffmpeg, audio, count, references=None, segments=None):
    start = time.monotonic()
    config = so.OfflineSpeakerDiarizationConfig(
        segmentation=so.OfflineSpeakerSegmentationModelConfig(
            pyannote=so.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(root / 'segment.onnx')),
            num_threads=2),
        embedding=so.SpeakerEmbeddingExtractorConfig(model=str(root / 'embed.onnx'), num_threads=2),
        clustering=so.FastClusteringConfig(num_clusters=count, threshold=0.5),
        min_duration_on=0.3, min_duration_off=0.5)
    engine = so.OfflineSpeakerDiarization(config)
    cmd = [ffmpeg, '-nostdin', '-v', 'error', '-i', audio, '-vn', '-ac', '1', '-ar', '16000',
           '-f', 'f32le', '-']
    samples = np.frombuffer(subprocess.check_output(cmd), dtype='<f4')
    if samples.size == 0:
        raise ValueError('The recording contains no audio samples.')
    turns = engine.process(samples).sort_by_start_time()
    ids = {}
    turns = [dict(start=t.start, end=t.end, speaker=ids.setdefault(t.speaker, len(ids))) for t in turns]
    if references is not None:
        turns = calibrate(root, samples, turns, references, count)
    dialogue = {}
    model_root = root.parent / 'cantonese'
    if segments:
        from dialogue import build_dialogue
        from worker import Worker
        worker = Worker(model_root)
        for model in ('qwen3-asr-1.7b', 'qwen3-asr-0.6b'):
            if (model_root / model / 'ting-ready.json').exists():
                def recognize(a, b):
                    return worker.request(dict(model=model, samples=samples[round(a*16000):round(b*16000)]))['text']
                from contextlib import redirect_stdout
                with redirect_stdout(sys.stderr):
                    dialogue = build_dialogue(segments, turns, recognize)
                break
    return dict(dialogue=dialogue, seconds=time.monotonic() - start, duration=len(samples)/16000,
                turns=turns, references=references or [])


if __name__ == '__main__':
    folder, ffmpeg_path, recording, count = sys.argv[1:5]
    job = json.loads(Path(sys.argv[5]).read_text()) if len(sys.argv) > 5 else {}
    if isinstance(job, list):
        job = dict(references=job)
    prepare(Path(folder))
    print(json.dumps(analyze(Path(folder), ffmpeg_path, recording, int(count), job.get('references'), job.get('segments'))))
