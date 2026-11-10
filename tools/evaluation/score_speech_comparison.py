#!/usr/bin/env python3
"""Transparent small-fixture scoring, not a representative accuracy benchmark.
Requires opencc-python-reimplemented==0.1.7 (install separately from the app runtime).
"""
import argparse
import collections
import html
import json
import re
import unicodedata
from pathlib import Path
from opencc import OpenCC

CONVERT = OpenCC('t2s')
LABELS = {'01-English':'英语朗读','02-Mandarin':'普通话朗读','03-Cantonese-Read':'粤语书面文本朗读',
          '04-Cantonese-English-NC':'粤英口语（NC）','05-Long-Regression':'74 秒英文拼接'}


def normalize(text, chinese=False):
    text = unicodedata.normalize('NFKC', text).lower().replace('’', "'")
    if chinese:
        text = CONVERT.convert(text)
        return [c for c in text if c.isalnum()]
    text = text.replace("'", '')
    return re.findall(r'[a-z0-9]+', text)


def distance(a, b):
    previous = list(range(len(b)+1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(current[-1]+1, previous[j]+1, previous[j-1]+(x != y)))
        previous = current
    return previous[-1]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--pack',type=Path,required=True)
    p.add_argument('--results',type=Path,required=True)
    a = p.parse_args()
    manifest = {x['file']:x for x in json.loads((a.pack/'manifest.json').read_text())}
    rows = [json.loads(line) for name in ['parakeet.jsonl','qwen.jsonl','buzz.jsonl'] if (a.results/name).exists()
            for line in (a.results/name).read_text().splitlines()]
    keys = [(r['model'], r['file'], r['mode']) for r in rows]
    if len(keys) != len(set(keys)): raise ValueError('Duplicate results')
    models = sorted({r['model'] for r in rows})
    for model in models:
        if {r['file'] for r in rows if r['model'] == model and r['mode'] == 'auto'} != set(manifest):
            raise ValueError(f'Incomplete automatic-language test set: {model}')
    description = f'本机 M1 / 16 GB；依次加载并运行，没有并发模型竞争。{len(manifest)} 个文件 × {len(models)} 个模型，含补充语言验证共 {len(rows)} 次转写。'
    scored, grouped = [], collections.defaultdict(list)
    for row in rows:
        group = row['file'].split('/')[0]
        reference = manifest[row['file']]['reference']
        # Derived long fixture has human-readable timestamp prefixes, not spoken words.
        if group == '05-Long-Regression':
            reference = re.sub(r'^\[[^\]]+\]\s*','',reference,flags=re.M)
        chinese = group in ['02-Mandarin','03-Cantonese-Read','04-Cantonese-English-NC']
        ref = normalize(reference,chinese)
        hyp = normalize(row['text'] or '',chinese)
        edits = distance(ref,hyp)
        item = dict(row,group=group,reference=reference,metric='CER' if chinese else 'WER',
                    edits=edits,reference_units=len(ref),error_rate=edits/len(ref),
                    cjk_in_english=not chinese and any('\u4e00' <= c <= '\u9fff' for c in (row['text'] or '')),
                    rtf=row['seconds']/row['audio_seconds'])
        scored.append(item);grouped[(row['model'],row['mode'],group)].append(item)
    summaries=[]
    for (model,mode,group), items in sorted(grouped.items()):
        summaries.append(dict(model=model,mode=mode,group=group,n=len(items),metric=items[0]['metric'],
            error_rate=sum(x['edits'] for x in items)/sum(x['reference_units'] for x in items),
            seconds=sum(x['seconds'] for x in items),audio_seconds=sum(x['audio_seconds'] for x in items),
            rtf=sum(x['seconds'] for x in items)/sum(x['audio_seconds'] for x in items),
            errors=sum(bool(x['error']) for x in items),empty=sum(not(x['text'] or '').strip() for x in items),
            cjk_in_english=sum(x['cjk_in_english'] for x in items)))
    (a.results/'scored.json').write_text(json.dumps(scored,ensure_ascii=False,indent=2))
    (a.results/'summary.json').write_text(json.dumps(summaries,ensure_ascii=False,indent=2))
    lines=['# 已安装模型公开语音对比 · 2026-11-10','',
       description,
       '模型加载时间单列于原始 JSONL，不计入下表。Parakeet / BuzzASR 使用原生 debug 构建的实际解码/引擎入口；Qwen 使用实际离线 Python worker（含 JSON 通信）。不是严格同运行时速度排名，也不是完整 GUI/实时采集验收。','',
       '| 模型 | 语言设置 | 类别 | 文件数 | 错误率 ↓ | 耗时 | 音频时长 | RTF ↓ | 运行报错 |',
       '|---|---|---|---:|---:|---:|---:|---:|---:|']
    for x in summaries:
        lines.append(f'| {x["model"]} | {x["mode"]} | {LABELS[x["group"]]} | {x["n"]} | {x["metric"]} {100*x["error_rate"]:.1f}% | {x["seconds"]:.1f}s | {x["audio_seconds"]:.1f}s | {x["rtf"]:.2f} | {x["errors"]} |')
    lines += ['', '## 读数边界','',
      '- WER 按英文词；CER 按中文及混合文本的字符。两者不可互比，也不是“100% 减去错误率”的准确率；插入过多时错误率可超过 100%。',
      '- 中文经 OpenCC t2s 统一繁简；去标点/空白，英文忽略大小写和撇号。数字写法、同音字、口语/书面语改写仍会记错。没有做语义改写宽容评分。',
      '- CER 中英语按字母计数，不能单凭该值判断粤英术语识别；详看逐条对照。原始参考稿的 *、& 等标记不参与计分。',
      '- RTF = 处理耗时 / 音频时长，越低越快；不包括模型加载，不能直接证明录音实时字幕延迟。',
      '- Parakeet v3 官方支持列表没有普通话、粤语；相应结果是能力边界检查，不是公平的中文模型排名。',
      '- 74 秒长音频是前八段英语的拼接，不能再算作独立准确率样本；只检查长输入和分段。',
      '- 每组仅 5–8 个片段，可能含训练数据，不代表复杂会议或泛化表现；未做听审或统计显著性检验。',
      '- 所有素材留在本机。粤英口语为 CC BY-NC 4.0，继承原测试包的非商业限制。','',
      '来源：[FLEURS](https://huggingface.co/datasets/google/fleurs)、[WSYue-ASR-eval](https://huggingface.co/datasets/ASLP-lab/WSYue-ASR-eval)、[Parakeet 官方能力](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)。','',
      '## 逐条原文对照','']
    for file in manifest:
        lines += [f'### {file}', '', '**参考稿**', '',next(x['reference'] for x in scored if x['file']==file),'']
        for x in scored:
            if x['file']==file:
                lines += [f'**{x["model"]} / {x["mode"]}** — {x["metric"]} {x["error_rate"]:.1%}，{x["seconds"]:.2f}s','',x['text'] or f'（空输出 / {x["error"]}）','']
    (a.results/'report.md').write_text('\n'.join(lines)+'\n')
    # Offline, self-contained review: summary table and expandable per-file comparisons.
    h = html.escape
    table = ''.join('<tr>'+''.join(f'<td>{h(str(v))}</td>' for v in [x['model'], x['mode'],
        LABELS[x['group']], f'{x["metric"]} {100*x["error_rate"]:.1f}%',
        f'{x["seconds"]:.1f}s', f'{x["rtf"]:.2f}', x['errors']])+'</tr>' for x in summaries)
    details = []
    for file in manifest:
        cases = [x for x in scored if x['file'] == file]
        body = '<h3>参考稿</h3><p>'+h(cases[0]['reference'])+'</p>'
        for x in cases:
            body += f'<h3>{h(x["model"])} / {h(x["mode"])}</h3><small>{x["metric"]} {x["error_rate"]:.1%} · {x["seconds"]:.2f}s</small><p>{h(x["text"] or str(x["error"]))}</p>'
        details.append(f'<details><summary>{h(file)}</summary>{body}</details>')
    limitations = lines[lines.index('## 读数边界')+2:lines.index('## 逐条原文对照')]
    page = '''<!doctype html><html lang="zh"><meta charset="utf-8"><title>Ting 模型对比</title>
<style>body{max-width:1200px;margin:40px auto;padding:0 24px;font:16px/1.7 system-ui;color:#17202a;background:#fafafa}table{border-collapse:collapse;font-size:14px;width:100%}th,td{padding:10px;text-align:left;border-bottom:1px solid #ddd}details{background:white;border:1px solid #ddd;padding:16px;margin:12px 0}summary{cursor:pointer;font-weight:600}p{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#555}.table{overflow:auto}</style>
<body><h1>Ting 已安装模型对比</h1><p>REPORT_DESCRIPTION</p>
<p>错误率越低越好；WER 按英文词、CER 按字符，不能互比。小样本结果不代表所有会议。Parakeet 的普通话和粤语结果属于官方不支持的语言范围。</p>
<div class="table"><table><thead><tr><th>模型</th><th>语言设置</th><th>类别</th><th>错误率 ↓</th><th>耗时</th><th>RTF ↓</th><th>运行报错</th></tr></thead><tbody>'''
    page = page.replace('REPORT_DESCRIPTION', h(description))
    page += table+'</tbody></table></div><h2>如何解读</h2><p>'+h('\n'.join(limitations))+'</p><h2>逐条查看参考稿与模型输出</h2>'+''.join(details)+'</body></html>'
    (a.results/'report.html').write_text(page)
    for x in summaries: print(x['model'],x['mode'],x['group'],f'{x["error_rate"]:.1%}',f'RTF {x["rtf"]:.2f}',f'errors={x["errors"]}')


if __name__ == '__main__': main()
