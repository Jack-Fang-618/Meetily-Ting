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


def analyze(root, ffmpeg, audio, count):
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
    return dict(seconds=time.monotonic() - start, duration=len(samples)/16000,
                turns=[dict(start=t.start, end=t.end, speaker=ids.setdefault(t.speaker, len(ids))) for t in turns])


if __name__ == '__main__':
    folder, ffmpeg_path, recording, count = sys.argv[1:]
    prepare(Path(folder))
    print(json.dumps(analyze(Path(folder), ffmpeg_path, recording, int(count))))
