"""Offline, serialized JSON-lines worker. stdout is exclusively the protocol."""
import argparse
from contextlib import redirect_stdout
import json
import os
from pathlib import Path
import sys
from audio_segments import transcribe_audio

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
LANGUAGES = {'yue':'Cantonese','zh':'Chinese','en':'English','ja':'Japanese','ko':'Korean',
             'fr':'French','de':'German','es':'Spanish','pt':'Portuguese','ru':'Russian',
             'ar':'Arabic','id':'Indonesian','it':'Italian','th':'Thai','vi':'Vietnamese',
             'tr':'Turkish','hi':'Hindi','ms':'Malay','nl':'Dutch','sv':'Swedish','da':'Danish',
             'fi':'Finnish','pl':'Polish','cs':'Czech','tl':'Filipino','fa':'Persian','el':'Greek',
             'ro':'Romanian','hu':'Hungarian','mk':'Macedonian'}

def language_hint(language, cantonese=False):
    if language == 'auto-translate':
        raise ValueError('Qwen ASR transcribes audio; English translation is not supported')
    # Model specialization must not override the user's source-language choice.
    if language in (None, '', 'auto'):
        return None
    if language not in LANGUAGES:
        raise ValueError(f'Unsupported language hint: {language}; use automatic detection')
    return LANGUAGES[language]

class Worker:
    def __init__(self, root):
        self.root = root
        self.model_id = None
        self.model = None
        self.catalog = {s['id']:s for s in json.loads((Path(__file__).parent/'catalog.json').read_text())}

    def request(self, req):
        import mlx.core as mx
        from mlx_audio.stt import load
        model_id = req['model']
        if model_id not in self.catalog:
            raise ValueError('Unknown model')
        path = self.root/model_id
        marker = path/'ting-ready.json'
        if not marker.exists() or json.loads(marker.read_text()).get('spec') != self.catalog[model_id]:
            raise ValueError('Model is not prepared; download it in transcription settings')
        if self.model_id != model_id:
            self.model = None
            mx.clear_cache()
            self.model = load(str(path))
            self.model_id = model_id
        if req.get('op') == 'load':
            return {'ok':True}
        language = language_hint(req.get('language'), model_id.startswith('qwen3-yue'))
        text = transcribe_audio(self.model, req['samples'], language)
        return {'ok':True, 'text':text}

def main():
    p=argparse.ArgumentParser(); p.add_argument('--root',type=Path); p.add_argument('--check',type=Path)
    args=p.parse_args()
    if args.check:
        with redirect_stdout(sys.stderr):
            from mlx_audio.stt import load
            load(str(args.check))
        print('Model load verified',flush=True)
        return
    worker=Worker(args.root)
    for line in sys.stdin:
        try:
            with redirect_stdout(sys.stderr):
                response=worker.request(json.loads(line))
        except Exception as exc:
            response={'ok':False,'error':str(exc)}
        print(json.dumps(response,ensure_ascii=False),flush=True)

if __name__ == '__main__': main()
