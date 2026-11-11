"""Map locally recognized speaker turns back to slices of the existing transcript."""
from difflib import SequenceMatcher
from functools import lru_cache
import unicodedata

from opencc import OpenCC

simplify = OpenCC('t2s')


@lru_cache(maxsize=4096)
def comparison_chars(char):
    return simplify.convert(unicodedata.normalize('NFKC', char)).casefold()


def normalized(text):
    chars, offsets = [], []
    for index, char in enumerate(text):
        if char.isalnum():
            part = comparison_chars(char)
            chars.extend(part)
            offsets.extend([index] * len(part))
    return ''.join(chars), offsets


def assign_text(rows, readings, text):
    # Align the combined readings once so repeated words cannot move a turn
    # backwards, or make a phrase from its middle look like its opening.
    if not readings:
        return
    source, offsets = normalized(text)
    spoken = ''.join(words for _, words in readings)
    matches = {}
    for a, b, length in SequenceMatcher(None, spoken, source, autojunk=False).get_matching_blocks():
        for delta in range(length):
            matches[a + delta] = b + delta

    cursor = 0
    spans = []
    for index, words in readings:
        pairs = [(i, matches[cursor + i]) for i in range(len(words)) if cursor + i in matches]
        if len(pairs) < max(2, len(words) * 0.5):
            return
        spans.append((index, words, pairs))
        cursor += len(words)

    # Only assign text when both sides support the boundary. Keep unsupported
    # text in the original paragraph instead of attaching it to a nearby voice.
    if spans[0][2][0][1] > 3 or len(source) - 1 - spans[-1][2][-1][1] > 3:
        return
    cuts = [0]
    for (_, left, lp), (_, right, rp) in zip(spans, spans[1:]):
        li, last = lp[-1]
        ri, first = rp[0]
        if first - last > 8 or ri > 4 or len(left) - li > 5:
            return
        projected = (last + len(left) - li + first - ri) / 2
        choices = range(last + 1, first + 1)
        def cost(pos):
            punctuation = text[offsets[pos-1]+1:offsets[pos]]
            return abs(pos - projected) - (2 if any(c in '。！？.!?' for c in punctuation) else 0)
        cuts.append(offsets[min(choices, key=cost)])
    cuts.append(len(text))
    for (index, _, _), start, end in zip(spans, cuts, cuts[1:]):
        rows[index]['text'] = text[start:end]


def build_dialogue(segments, turns, recognize):
    result = {}
    for key, text, start, end in segments:
        clips = [dict(speaker=t['speaker'], start=max(start, t['start']), end=min(end, t['end']),
                      full_duration=t['end'] - t['start'])
                 for t in turns if t['start'] < end and t['end'] > start]
        clips.sort(key=lambda t: t['start'])
        if len({c['speaker'] for c in clips}) < 2:
            continue
        rows, readings = [], []
        for c in clips:
            overlap = any(other['speaker'] != c['speaker'] and
                          other['full_duration'] >= c['full_duration'] and
                          min(other['end'], c['end']) - max(other['start'], c['start']) >
                          (c['end'] - c['start']) / 2 for other in clips)
            row = dict(start=c['start'], end=c['end'], speaker=c['speaker'], text='', overlap=overlap)
            rows.append(row)
            if overlap or c['end'] - c['start'] < 0.6:
                continue
            heard, _ = normalized(recognize(c['start'], c['end']))
            readings.append((len(rows) - 1, heard))
        assign_text(rows, readings, text)
        for row in rows:
            if not row['overlap'] or row['end'] - row['start'] < 0.3:
                continue
            candidate = recognize(row['start'], row['end']).strip()
            words, _ = normalized(candidate)
            # A mono excerpt also contains the main speaker. Suppress obvious
            # echoes of their transcript and implausibly long decodes.
            nearby = [heard for index, heard in readings
                      if rows[index]['start'] < row['end'] and row['start'] < rows[index]['end']]
            echoes_main = any(words in heard for heard in nearby)
            if words and not echoes_main and len(words) <= 12 * (row['end'] - row['start']):
                row['candidate'] = candidate
        result[key] = rows
    return result
