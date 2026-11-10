'use client';
import { useEffect, useState } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

/** Temporary subtitles never enter transcript storage or summaries. */
export function CloudLiveStatus() {
  const [state, setState] = useState('');
  const [message, setMessage] = useState('');
  const [partial, setPartial] = useState('');
  useEffect(() => {
    let active = true;
    const unlisteners: UnlistenFn[] = [];
    const attach = async <T,>(name: string, callback: (data: T) => void) => {
      const unlisten = await listen<T>(name, e => { if (active) callback(e.payload); });
      if (active) unlisteners.push(unlisten); else unlisten();
    };
    const setup = async () => {
      await attach<{state:string;message:string}>('cloud-live-status', data => { setState(data.state); setMessage(data.message); if (data.state !== 'connected') setPartial(''); });
      await attach<{text:string}>('cloud-live-partial', data => setPartial(data.text));
      await attach('recording-stopped', () => { setState(''); setPartial(''); });
      await attach('recording-started', () => { setPartial(''); });
    };
    setup().catch(() => {});
    return () => { active = false; unlisteners.forEach(fn => fn()); };
  }, []);
  if (!state || state === 'finished') return null;
  return <aside aria-label="Cloud live transcription" className={`fixed bottom-36 left-1/2 z-40 w-[min(36rem,calc(100vw-3rem))] -translate-x-1/2 rounded-lg border bg-background p-4 shadow-lg ${state === 'error' ? 'border-red-300' : 'border-blue-200'}`}>
    <p role="status" className={`text-xs font-medium ${state === 'error' ? 'text-red-700' : 'text-blue-700'}`}>{message}</p>
    {partial && <p className="mt-2 max-h-28 overflow-y-auto text-sm">{partial}<span className="ml-2 text-xs text-muted-foreground">Draft</span></p>}
  </aside>;
}
