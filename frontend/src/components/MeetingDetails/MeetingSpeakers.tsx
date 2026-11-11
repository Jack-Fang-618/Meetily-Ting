'use client';

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TranscriptSegmentData } from '@/types';

type Turn = {start: number; end: number; speaker: number};
type Analysis = {turns: Turn[]; seconds: number; duration: number};
type Status = {ready: boolean; supported: boolean; analysis?: Analysis; names?: Record<number,string>; audio?: string};
const Speakers = createContext<{status: Status; play: (time: number) => void} | null>(null);
const label = (id: number) => 'Speaker ' + (id + 1);

export function SegmentSpeakers({segment}: {segment: TranscriptSegmentData}) {
  const ctx = useContext(Speakers);
  if (!ctx?.status.analysis) return null;
  const end = segment.endTime ?? segment.timestamp + 0.1;
  const turns = ctx.status.analysis.turns.filter(t => t.end > segment.timestamp && t.start < end);
  const speakers = new Map<number, number>();
  for (const turn of turns) {
    if (!speakers.has(turn.speaker)) speakers.set(turn.speaker, Math.max(segment.timestamp, turn.start));
  }
  return <div className="flex gap-2 ml-14">{Array.from(speakers, ([id,time]) =>
    <button key={id} type="button" disabled={!ctx.status.audio} onClick={() => ctx.play(time)}
      title="Play this speaker in the recording" className="text-xs font-medium text-teal-700 hover:underline">
      ▷ {ctx.status.names?.[id] || label(id)}
    </button>)}</div>;
}

export function MeetingSpeakers({meetingId, children}: {meetingId?: string; children: React.ReactNode}) {
  const [status, setStatus] = useState<Status>();
  const [count, setCount] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  const refresh = useCallback(async () => {
    if (meetingId) setStatus(await invoke<Status>('meeting_speakers', {meetingId}));
  }, [meetingId]);
  useEffect(() => {refresh().catch(e => setError(String(e)));}, [refresh]);
  const identify = async () => {
    setBusy(true); setError('');
    try {
      await invoke('identify_meeting_speakers', {meetingId, speakerCount: count});
      await refresh();
    } catch (e) {setError(String(e));} finally {setBusy(false);}
  };
  const play = (time: number) => {
    if (!audio.current) return;
    audio.current.currentTime = time;
    audio.current.play().catch(e => setError(String(e)));
  };
  const rename = async (id: number, name: string) => {
    try {
      await invoke('rename_meeting_speaker', {meetingId, speaker:id, name});
      await refresh();
    } catch(e) {setError(String(e));}
  };
  const analysis = status?.analysis;
  const ids = Array.from(new Set(analysis?.turns.map(turn => turn.speaker)));
  return <Speakers.Provider value={status ? {status,play} : null}>
    {status?.supported && <div className="border-b px-4 py-2 text-xs">
      {analysis ? <>
        <div className="flex items-center justify-between">
          <span>{ids.length} speakers · Analyzed locally in {Math.round(analysis.seconds)}s</span>
          {ids.length > 0 && <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Rename speakers'}</Button>}
        </div>
        {editing && ids.map(id => <label key={id} className="inline-flex items-center gap-1 mr-3">{label(id)}
          <input aria-label={label(id)} defaultValue={status.names?.[id] || ''} placeholder={label(id)} maxLength={80}
            onBlur={e => {if (e.target.value !== (status.names?.[id] || '')) void rename(id,e.target.value);}}
            className="rounded border px-2 py-1 w-28"/></label>)}
        {status.audio && <audio ref={audio} className="w-full h-8" controls preload="metadata" src={convertFileSrc(status.audio)} />}
      </> : <><label className="mr-2">Speakers <select value={count} disabled={busy} onChange={e => setCount(Number(e.target.value))} className="rounded border p-1"><option value={-1}>Auto</option>{Array.from({length:9}, (_,i) => <option key={i} value={i+2}>{i+2}</option>)}</select></label><Button size="sm" variant="outline" disabled={busy} onClick={identify}>
        {busy ? 'Preparing speakers locally…' : status.ready ? 'Identify speakers' : 'Download models (45 MB) & identify speakers'}
      </Button></>}
    </div>}
    {error && <p role="alert" className="text-xs text-red-700 px-4">{error}</p>}
    {children}
  </Speakers.Provider>;
}
