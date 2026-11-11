'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { TranscriptionModelCard } from './TranscriptionModelCard';
import { useLocalModelSelection } from '../hooks/useLocalModelSelection';
import { localModelLabel } from '../lib/local-model-labels';
import type { ModelStatus } from '../lib/parakeet';

interface LocalModel { id: string; label: string; size_mb: number; installed: boolean }
interface LocalStatus {
  runtime_ready: boolean; preparing: boolean; preparing_model?: string;
  preparation_message?: string; preparation_progress?: number; models: LocalModel[];
}
interface Props {
  selectedModel?: string;
  onSelect: (provider: 'localQwen' | 'localWhisper', model: string) => void;
}
export function CantoneseModelManager({ selectedModel, onSelect }: Props) {
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [buzzInstalled, setBuzzInstalled] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});
  const pending = useRef(false);
  const cancelled = useRef(false);
  const qwen = useLocalModelSelection('localQwen', model => onSelect('localQwen', model));
  const buzz = useLocalModelSelection('localWhisper', model => onSelect('localWhisper', model));
  const selecting = qwen.selecting || buzz.selecting;
  const refresh = useCallback(async () => {
    const result = await invoke<LocalStatus>('cantonese_status');
    setStatus(result);
    setMessage(result.preparation_message || '');
    setProgress(result.preparation_progress ?? null);
    if (!result.preparing) setCancelling(false);
    await invoke('whisper_init');
    const whisper = await invoke<{ name: string; status: unknown }[]>('whisper_get_available_models');
    setBuzzInstalled(whisper.some(m => m.name === 'buzz-cantonese' && m.status === 'Available'));
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    refresh().catch(e => { if (!disposed) setError(String(e)); });
    listen<{ model: string; message: string; progress?: number | null }>('cantonese-preparation', event => {
      if (!disposed) { setMessage(event.payload.message); setProgress(event.payload.progress ?? null); }
    }).then(fn => { if (disposed) fn(); else unlisten = fn; })
      .catch(e => { if (!disposed) setError(String(e)); });
    const interval = setInterval(() => { refresh().catch(e => { if (!disposed) setError(String(e)); }); }, 2000);
    return () => { disposed = true; unlisten?.(); clearInterval(interval); };
  }, [refresh]);

  const prepare = async (model: string) => {
    if (pending.current) return;
    pending.current = true; cancelled.current = false;
    setPreparing(model); setError(''); setMessage('Starting preparation…'); setProgress(null);
    setModelErrors(prev => { const next = {...prev}; delete next[model]; return next; });
    try {
      await invoke('cantonese_prepare_model', { model });
      toast.success('Model ready', { description: 'Select the model card to use it.' });
    } catch (e) {
      if (cancelled.current) toast.info('Preparation cancelled');
      else setModelErrors(prev => ({...prev, [model]: String(e)}));
    } finally {
      await refresh().catch(e => setError(String(e)));
      pending.current = false; setPreparing(null); setCancelling(false);
    }
  };
  const cancel = async () => {
    setCancelling(true); cancelled.current = true;
    try { await invoke('cantonese_cancel_preparation'); }
    catch (e) { setError(String(e)); setCancelling(false); }
  };
  const remove = async (model: string) => {
    if (pending.current) return;
    pending.current = true; setError('');
    try {
      await invoke('delete_transcription_model', { provider: model === 'buzz-cantonese' ? 'localWhisper' : 'localQwen', model });
      await refresh(); toast.success('Model deleted');
    } catch (e) { setError(String(e)); }
    finally { pending.current = false; }
  };
  if (!status) return <div role={error ? 'alert' : 'status'} className="p-4 text-sm">{error || 'Loading models…'}{error && <button onClick={() => { setError(''); refresh().catch(e => setError(String(e))); }} className="ml-2 text-blue-600">Retry</button>}</div>;
  const models = [...status.models, { id: 'buzz-cantonese', label: 'BuzzASR · Cantonese Whisper', size_mb: 2951, installed: buzzInstalled }]
    .map(model => ({ ...model, label: localModelLabel(model.id, model.label) }));
  const active = preparing || status.preparing_model;
  return <div className="space-y-3">
    <p className="text-sm text-gray-600">Audio stays on your device. Original Qwen is recommended for Mandarin-dominant recordings and also supports English and Cantonese. Start with Qwen3-ASR 0.6B. Cantonese fine-tunes favor written Chinese output.</p>
    <p className="text-xs text-gray-500">Live speed depends on your device. Model preparation may require extra disk space.</p>
    {!status.runtime_ready && <p role="alert" className="text-sm text-amber-700">The local runtime is unavailable. This development build requires Apple Silicon and the Ting runtime setup.</p>}
    {models.map(model => {
      const modelStatus: ModelStatus = active === model.id ? { Downloading: { progress: progress ?? 0 } }
        : modelErrors[model.id] ? { Error: modelErrors[model.id] } : model.installed ? 'Available' : 'Missing';
      return <TranscriptionModelCard key={model.id}
        model={{ name: model.id, size_mb: model.size_mb, status: modelStatus }} displayName={model.label}
        icon={model.id === 'buzz-cantonese' ? '🏠' : '🎙️'}
        description={model.id.startsWith('qwen3-yue') ? 'Cantonese fine-tune · Written Chinese output' : model.id === 'buzz-cantonese' ? 'Cantonese fine-tune · Whisper engine' : 'Original · Recommended for Mandarin-dominant audio · Also supports English and Cantonese'}
        badge={model.id === 'qwen3-asr-1.7b' ? 'Live captions · Higher accuracy in testing' : model.id.includes('1.7b') ? 'Speed not yet tested' : model.id === 'buzz-cantonese' ? 'Slower · File transcription' : 'Fast · Live captions'}
        isSelected={selectedModel === model.id} isSelecting={selecting === model.id}
        disabled={!!selecting || !!active || !status.runtime_ready || status.preparing}
        isDownloading={active === model.id} isCancelling={active === model.id && cancelling}
        indeterminate={progress === null} progressMessage={message || status.preparation_message}
        onSelect={() => model.id === 'buzz-cantonese' ? buzz.select(model.id) : qwen.select(model.id)}
        onDownload={() => prepare(model.id)} onCancel={cancel} onDelete={() => remove(model.id)} />;
    })}
    {selectedModel && <p className="text-xs text-gray-500 text-center pt-2">Using {models.find(m => m.id === selectedModel)?.label || selectedModel} for transcription</p>}
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-sm text-red-700">{error}</p>}
  </div>;
}
