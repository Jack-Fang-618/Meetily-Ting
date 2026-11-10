#!/usr/bin/env python3
"""Score a complete public-fixture cloud run with the same local normalization."""
import argparse
import json
import re
from collections import defaultdict
from pathlib import Path
from score_speech_comparison import normalize, distance, LABELS

p = argparse.ArgumentParser()
p.add_argument('--manifest', type=Path, required=True)
p.add_argument('--results', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
manifest = {r['file']: r for r in json.loads(a.manifest.read_text())}
rows = [json.loads(line) for line in a.results.read_text().splitlines()]
assert len(rows) == len(manifest) and {r['file'] for r in rows} == set(manifest), 'Incomplete or duplicate test set'
assert all('error' not in r for r in rows), 'Failed transcription in results'
groups = defaultdict(lambda: {'errors': 0, 'units': 0, 'seconds': 0, 'audio_seconds': 0, 'files': 0})
for row in rows:
    file = row['file']; group = file.split('/')[0]
    reference = manifest[file]['reference']
    if group == '05-Long-Regression': reference = re.sub(r'^\[[^\]]+\]\s*', '', reference, flags=re.M)
    chinese = group in ['02-Mandarin', '03-Cantonese-Read', '04-Cantonese-English-NC']
    ref = normalize(reference, chinese); hyp = normalize(row['text'], chinese)
    g = groups[group]
    g['errors'] += distance(ref, hyp); g['units'] += len(ref)
    g['seconds'] += row['elapsed_seconds']; g['audio_seconds'] += row['audio_seconds']; g['files'] += 1
lines = ['# 阿里云 3.1 文件转写实测 · 2026-11-10', '',
         '北京地域，原始文件上传，Auto 语言，keep_dialect=true，说话人分离关闭。使用与本地模型相同的 30 文件；顺序调用，未并行。耗时包含上传、提交、约 3 秒间隔轮询和获取结果，不是纯模型推理速度。', '',
         '| 场景 | 文件数 | 错误率 | 完整流程耗时 |', '|---|---:|---:|---:|']
for group, g in sorted(groups.items()):
    g['error_rate'] = g['errors'] / g['units']
    lines.append(f"| {LABELS[group]} | {g['files']} | {g['error_rate']:.1%} | {g['seconds']:.1f}s |")
lines += ['', f"全部音频 {sum(g['audio_seconds'] for g in groups.values()):.2f}s；总处理耗时 {sum(g['seconds'] for g in groups.values()):.1f}s。", '',
          '英语用 WER，其他用统一繁简后的 CER；沿用本地评测的数字/标点归一化规则。小样本仅用于开发回归，不代表通用排名。粤语书面朗读的参考文本是书面语，而此轮要求保留方言，表达风格差异也可能计为错误。', '',
          '原始逐条文本、句级时间戳和任务缓存只保存在本机 experiments/aliyun-2026-11-10，不进入 Git。没有上传私人会议录音。']
a.output.write_text('\n'.join(lines)+'\n')
a.output.with_suffix('.json').write_text(json.dumps(groups, ensure_ascii=False, indent=2))
print('\n'.join(lines))
