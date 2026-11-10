"""Offline installation smoke test against a supplied, non-sensitive WAV fixture."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
import numpy as np
import soundfile as sf

p=argparse.ArgumentParser()
p.add_argument('--root',type=Path,required=True)
p.add_argument('--model',required=True)
p.add_argument('--audio',type=Path,required=True)
p.add_argument('--report',type=Path,required=True)
a=p.parse_args()
audio,rate=sf.read(a.audio,dtype='float32')
if rate != 16000 or audio.ndim != 1:
    raise ValueError('Use a 16 kHz mono WAV fixture')
worker=subprocess.Popen([sys.executable,str(Path(__file__).with_name('worker.py')),'--root',str(a.root)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
def request(payload):
    worker.stdin.write(json.dumps({'model':a.model,**payload})+'\n');worker.stdin.flush()
    response=json.loads(worker.stdout.readline())
    if not response.get('ok'):raise RuntimeError(response)
    return response
start=time.monotonic()
try:
    request({'op':'load'})
    result=request({'op':'transcribe','samples':audio.tolist(),'language':'yue'})
    if not result.get('text','').strip():raise AssertionError('Speech produced an empty transcript')
    elapsed=time.monotonic()-start
    if request({'op':'transcribe','samples':[0.0]*16000,'language':'yue'}).get('text'):
        raise AssertionError('Silence produced a transcript')
    report={'model':a.model,'audio':str(a.audio),'seconds':len(audio)/rate,'load_and_inference_seconds':elapsed,'text':result['text'],'silence_passed':True,'note':'Smoke test only; non-empty output does not establish accuracy.'}
    a.report.parent.mkdir(parents=True,exist_ok=True)
    a.report.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False))
finally:
    worker.stdin.close()
    try: worker.wait(timeout=10)
    except subprocess.TimeoutExpired: worker.kill();worker.wait()
