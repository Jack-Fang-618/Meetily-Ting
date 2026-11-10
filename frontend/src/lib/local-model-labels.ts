/** UI copy is separate from catalog metadata stored in installation markers. */
const labels: Record<string, string> = {
  'qwen3-asr-0.6b': 'Qwen3-ASR 0.6B',
  'qwen3-asr-1.7b': 'Qwen3-ASR 1.7B',
  'qwen3-yue-0.6b': 'Qwen3-ASR 0.6B · Cantonese written-style fine-tune',
  'qwen3-yue-1.7b': 'Qwen3-ASR 1.7B · Cantonese written-style fine-tune',
  'buzz-cantonese': 'BuzzASR · Cantonese Whisper',
};
export function localModelLabel(id: string, fallback = id): string {
  return labels[id] ?? fallback;
}
