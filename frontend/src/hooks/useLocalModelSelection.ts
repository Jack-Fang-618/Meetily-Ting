import { useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

interface SelectionEffects {
  invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
  toast: Pick<typeof toast, 'success' | 'error'>;
}
const defaultEffects: SelectionEffects = { invoke, toast };

export function useLocalModelSelection(provider: 'localWhisper' | 'parakeet' | 'localQwen',
  onSelect?: (model: string) => void, persist = true, effects: SelectionEffects = defaultEffects) {
  const [selecting, setSelecting] = useState<string | null>(null);
  const pending = useRef(false);
  const select = async (model: string) => {
    if (pending.current) return;
    pending.current = true;
    setSelecting(model);
    try {
      if (persist) await effects.invoke('select_transcription_model', { provider, model });
      onSelect?.(model);
      effects.toast.success(`Selected ${model}`);
    } catch (error) {
      effects.toast.error('Could not switch model', { description: String(error), duration: 6000 });
    } finally { pending.current = false; setSelecting(null); }
  };
  return { selecting, select };
}
