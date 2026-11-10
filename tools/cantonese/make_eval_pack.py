"""Build a deterministic small pack from downloaded WSYue-ASR-eval Long archives."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import wave

p = argparse.ArgumentParser()
p.add_argument('source', type=Path)
p.add_argument('destination', type=Path)
a = p.parse_args()
a.destination.mkdir(parents=True, exist_ok=True)
annotations = {}
with tarfile.open(a.source/'TextGrid.tar.gz') as archive:
    for member in archive:
        if not member.isfile() or not member.name.endswith('.TextGrid'):
            continue
        raw = archive.extractfile(member).read().decode('utf-8-sig')
        tier = raw.split('item [1]:', 1)[1].split('item [2]:', 1)[0]
        entries = re.findall(r'xmin\s*=\s*([\d.]+)\s+xmax\s*=\s*([\d.]+)\s+text\s*=\s*"((?:[^"]|"")*)"', tier)
        entries = [(float(start), float(end), text.replace('""', '"')) for start,end,text in entries if text.strip()]
        annotations[Path(member.name).stem] = (raw, entries)
selected = []
counts = {'mixed': 0, 'cantonese': 0}
with tarfile.open(a.source/'wav.tar.gz') as archive:
    for member in sorted(archive.getmembers(), key=lambda m:m.name):
        key = Path(member.name).stem
        if not member.isfile() or key not in annotations:
            continue
        raw, entries = annotations[key]
        reference = '\n'.join(text for _,_,text in entries)
        group = 'mixed' if re.search(r'[A-Za-z]{3,}', reference) else 'cantonese'
        if counts[group] >= 15:
            continue
        data = archive.extractfile(member).read()
        with wave.open(io.BytesIO(data)) as wav:
            duration = wav.getnframes()/wav.getframerate()
        folder = a.destination/group
        folder.mkdir(exist_ok=True)
        (folder/(key+'.wav')).write_bytes(data)
        (folder/(key+'.TextGrid')).write_text(raw)
        (folder/(key+'.txt')).write_text('\n'.join(f'[{start:06.2f}–{end:06.2f}] {text}' for start,end,text in entries)+'\n')
        selected.append({'id':key, 'file':f'{group}/{key}.wav', 'duration_seconds':duration, 'reference':reference, 'sha256':hashlib.sha256(data).hexdigest(), 'selection_group':group})
        counts[group] += 1
(a.destination/'manifest.json').write_text(json.dumps(selected,ensure_ascii=False,indent=2))
seconds=sum(x['duration_seconds'] for x in selected)
(a.destination/'README.md').write_text(f'''# Ting 粤语测试包

{len(selected)} 段真人录音，总时长 {seconds/60:.2f} 分钟。来源：
https://huggingface.co/datasets/ASLP-lab/WSYue-ASR-eval
原作者：WenetSpeech-Yue 项目团队；标注由北京爱数智慧（AISHELL）提供。
许可证：CC BY-NC 4.0，https://creativecommons.org/licenses/by-nc/4.0/
仅用于非商业评测；不随产品分发。下载的是 Long 分包，不是全部语料。

每段 WAV 旁有带时间的 TXT 参考稿和原始 TextGrid 标注。
TXT 仅从原始文本层提取，保留原有标注符号；音频未修改。
manifest.json 包含原始 ID、时长、参考文字和音频 SHA-256。

mixed 分组按参考稿存在至少三个连续英文字母筛选，可能含语气词；并非逐段人工确认的粤英混合标签。
cantonese 分组表示未命中上述条件，不保证绝对没有英文。
这批没有单独标定噪声强度或粤普切换，不能当作这两项的标准测试。
先导入单个 WAV 测转写；测试系统声音时用播放器播放同一文件。
''')
print(json.dumps({'clips':len(selected),'minutes':seconds/60,'groups':counts,'path':str(a.destination)},ensure_ascii=False))
