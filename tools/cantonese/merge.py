"""One-time CPU merge; inference uses the separate MLX environment."""
import sys
from pathlib import Path
import torch
from peft import PeftModel
from qwen_asr.core.transformers_backend import Qwen3ASRForConditionalGeneration, Qwen3ASRProcessor

torch.set_num_threads(4)
base, adapter, dest = sys.argv[1:]
model = Qwen3ASRForConditionalGeneration.from_pretrained(base, dtype=torch.float32, local_files_only=True)
model = PeftModel.from_pretrained(model, adapter, local_files_only=True)
model = model.merge_and_unload(safe_merge=True)
model.to(torch.float16)
# The upstream greedy decoding config includes a sampling-only temperature.
# Reset that unused parameter to its neutral default before strict serialization.
if not model.generation_config.do_sample:
    model.generation_config.temperature = 1.0
model.save_pretrained(dest, safe_serialization=True)
Qwen3ASRProcessor.from_pretrained(base, local_files_only=True).save_pretrained(dest)
print('Merged adapter successfully', flush=True)
