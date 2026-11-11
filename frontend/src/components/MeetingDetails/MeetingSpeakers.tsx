'use client';

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ReviewPassage } from './ReviewPassage';
import { groupSpeakerTurns } from './groupSpeakerTurns';
import { Headphones, Users, Plus, Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TranscriptSegmentData } from '@/types';

type Turn = {start: number; end: number; speaker: number};
type DialogueRow = Turn & {text: string; overlap: boolean; candidate?: string};
type Analysis = {dialogue?: Record<string, DialogueRow[]>; turns: Turn[]; seconds: number; duration: number; references?: Turn[]};
type Status = {ready: boolean; supported: boolean; analysis?: Analysis; names?: Record<number,string>; audio?: string};
const Speakers = createContext<{meetingId?:string; status: Status; speakerIds: number[]; play: (time: number, end?: number, contextSeconds?: number) => void; refining: boolean; busy: boolean; samples: Turn[]; mark: (sample: Turn) => void} | null>(null);
const label = (id: number) => 'Speaker ' + (id + 1);

function LabelPassage({text,start,end}: {text:string;start:number;end?:number}) {
  const ctx = useContext(Speakers)!;
  const [range,setRange] = useState<[number,number]>();
  const root = useRef<HTMLSpanElement>(null);
  const [adjusting,setAdjusting] = useState(false);
  const [adjusted,setAdjusted] = useState<[number,number]>();
  const length = (end ?? start) - start;
  const clip = range && length > 0 ? adjusted ?? range.map(n => start + length*n/text.length) : null;
  function nudge(edge:0|1, delta:number) {
    if (!clip || end === undefined) return;
    const [a,b] = clip;
    if (edge === 0) setAdjusted([Math.max(start, Math.min(b - Math.min(1,b-a), a+delta)), b]);
    else setAdjusted([a, Math.min(end, Math.max(a + Math.min(1,b-a), b+delta))]);
  }
  const conflict = clip && ctx.samples.some(s => s.start < clip[1] && s.end > clip[0]);
  return <div className="py-1 leading-relaxed">
    <span ref={root} className="select-text whitespace-pre-wrap selection:bg-teal-200 selection:text-teal-950" onMouseUp={() => {
      setAdjusting(false); setAdjusted(undefined);
      const sel = window.getSelection();
      if (!sel?.rangeCount || sel.isCollapsed || !root.current) {setRange(undefined); return;}
      const r = sel.getRangeAt(0);
      if (!root.current.contains(r.startContainer) || !root.current.contains(r.endContainer)) {setRange(undefined); return;}
      const prefix = r.cloneRange();
      prefix.selectNodeContents(root.current); prefix.setEnd(r.startContainer,r.startOffset);
      const offset = prefix.toString().length;
      setRange([offset,offset+r.toString().length]);
    }}>{range ? <>{text.slice(0,range[0])}<mark className="rounded-sm bg-teal-100 text-teal-950 box-decoration-clone underline decoration-teal-500 underline-offset-4">{text.slice(...range)}</mark>{text.slice(range[1])}</> : text}</span>
    {range && <div className="my-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-teal-200 bg-background p-2 text-xs shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 duration-150">
      {clip ? <>
        <Button size="sm" variant="outline" onClick={() => ctx.play(clip[0],clip[1],2)} title="Include 2 seconds before and after the estimated selection"><Headphones size={14} className="mr-1.5"/>Listen with context</Button>
        <Button size="sm" variant="ghost" onClick={()=>ctx.play(clip[0],clip[1])}>Sample only</Button>
        <Button size="sm" variant="ghost" aria-expanded={adjusting} onClick={()=>setAdjusting(!adjusting)}>Adjust timing</Button>
        {adjusting && <div className="flex w-full flex-wrap gap-3 rounded-lg bg-muted/40 p-2">
          {([0,1] as const).map(edge => <div key={edge} className="flex items-center gap-1">
            <span className="tabular-nums">{edge===0 ? 'Start' : 'End'} {clip[edge].toFixed(2)}s</span>
            {([-0.25,0.25] as const).map(delta => <Button key={delta} size="sm" variant="outline"
              disabled={ctx.busy || (edge===0 ? delta<0 ? clip[0]<=start : clip[1]-clip[0]<=1 : delta>0 ? clip[1]>=(end ?? start) : clip[1]-clip[0]<=1)}
              aria-label={`${edge===0?'Start':'End'} ${delta<0?'earlier':'later'} by 0.25 seconds`}
              onClick={()=>nudge(edge,delta)}>{delta<0?'−':'+'}0.25s</Button>)}
          </div>)}
        </div>}
        {ctx.speakerIds.map(id => <Button size="sm" variant="secondary" key={id}
          disabled={ctx.busy || !!conflict || clip[1]-clip[0]<1}
          onClick={() => {ctx.mark({start:clip[0],end:clip[1],speaker:id});setRange(undefined);}}>
          <Plus size={12} className="mr-1"/> {ctx.status.names?.[id] || label(id)}</Button>)}
        {conflict ? 'Overlaps an existing sample' : clip[1]-clip[0]<1 ? 'Select at least one second of speech' : ''}
      </> : 'This passage has no audio timestamps. Choose another passage.'}
      <button className="ml-auto rounded px-2 py-1 text-muted-foreground hover:bg-muted" onClick={() => setRange(undefined)}>Cancel</button>
    </div>}
  </div>;
}

export function SegmentSpeakers({segment, children}: {segment: TranscriptSegmentData; children: React.ReactNode}) {
  const ctx = useContext(Speakers);
  if (!ctx?.status.supported) return <>{children}</>;
  const dialogue = ctx.status.analysis?.dialogue?.[segment.id];
  const alignedText = dialogue?.map(row => row.text).join('');
  const labeling = ctx.refining && ctx.speakerIds.length > 0;
  const turns = ctx.status.analysis?.turns ?? [];
  const inferred = Array.from(new Set(turns.filter(t=>t.end>segment.timestamp && t.start<(segment.endTime ?? segment.timestamp+0.1)).map(t=>t.speaker)));
  const review = (text:string,offset:number,ids:number[],start=segment.timestamp,end=segment.endTime) => <ReviewPassage
    canAssign={Boolean(ctx.status.analysis)}
    listen={ctx.status.audio && end !== undefined && end > start && text.length ? (from,to)=>{
      const secondsPerChar=(end-start)/text.length;
      ctx.play(start+from*secondsPerChar,start+to*secondsPerChar,2);
    } : undefined}
    storageKey={JSON.stringify(['ting-speaker-edits',ctx.meetingId,segment.id])}
    source={segment.text} offset={offset} text={text} inferred={ids}
    choices={Array.from(new Set([...ctx.speakerIds,...turns.map(t=>t.speaker)]))}
    name={id=>ctx.status.names?.[id] || label(id)}/>;
  const raw = labeling ? <LabelPassage text={segment.text} start={segment.timestamp} end={segment.endTime}/>
    : ctx.status.analysis || (ctx.status.audio && segment.endTime !== undefined) ? review(segment.text,0,inferred) : children;
  if (dialogue?.length && (!alignedText || alignedText === segment.text)) {
    return <div className="space-y-2 px-3 py-1">{!alignedText && <>{raw}<p className="text-xs text-muted-foreground">Speaker turns · text alignment needs review</p></>}{groupSpeakerTurns(dialogue).map(({row, interjections}, i) => {
      const offset = dialogue.slice(0,dialogue.indexOf(row)).reduce((n,r)=>n+r.text.length,0);
      return <div key={i}>
        <button className="text-xs text-teal-700 hover:underline" onClick={() => ctx.play(row.start, row.end)}>
          ▷ {Math.floor(row.start / 60)}:{Math.floor(row.start % 60).toString().padStart(2, '0')} · Listen
        </button>
        <div>{labeling && row.text ? <LabelPassage text={row.text} start={row.start} end={row.end}/> : row.text ? review(row.text,offset,[row.speaker],row.start,row.end) : (row.overlap ? 'Overlapping speech · listen to review' : 'Speech · listen to review')}</div>
        {interjections.length > 0 && <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">{interjections.length} {interjections.length === 1 ? 'interjection' : 'interjections'}</summary>
          <div className="flex flex-wrap gap-3 py-1">{interjections.map((clip, index) =>
            <button key={index} className="text-teal-700 hover:underline" onClick={() => ctx.play(clip.start, clip.end)}>
              ▷ {Math.floor(clip.start / 60)}:{Math.floor(clip.start % 60).toString().padStart(2, '0')} · {ctx.status.names?.[clip.speaker] || label(clip.speaker)}{clip.candidate && <span> · Possible words: {clip.candidate}</span>}
            </button>)}</div>
        </details>}
      </div>;
    })}</div>;
  }
  return <>{ctx.status.audio && <button type="button" className="text-xs text-teal-700 hover:underline"
    onClick={()=>ctx.play(segment.timestamp,segment.endTime)}>▷ {Math.floor(segment.timestamp/60)}:{String(Math.floor(segment.timestamp%60)).padStart(2,'0')} · Listen</button>}{raw}</>;
}

export function MeetingSpeakers({meetingId, children}: {meetingId?: string; children: React.ReactNode}) {
  const [storedStatus, setStatus] = useState<Status>();
  const nameKey = 'ting-speaker-draft-names:'+meetingId;
  const [draftNames,setDraftNames] = useState<Record<number,string>>({});
  useEffect(()=>{
    try {setDraftNames(JSON.parse(localStorage.getItem(nameKey) || '{}'));} catch {setDraftNames({});}
  },[nameKey]);
  const status = storedStatus && {...storedStatus,names:{...storedStatus.names,...draftNames}};
  const [confirming,setConfirming] = useState(false);
  const [guide,setGuide] = useState(false);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [position, setPosition] = useState(0);
  const [count, setCount] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [refining, setRefining] = useState(false);
  const [draft, setDraft] = useState<Turn[] | null>(null);
  const speakerIds = Array.from({length: Math.max(0, count)}, (_, i) => i);
  const samples = (draft ?? status?.analysis?.references ?? []).filter(sample => sample.speaker < count);
  const stopAt = useRef<number>();
  const mark = (sample: Turn) => {
    const existing = samples.find(r => r.start === sample.start && r.end === sample.end);
    const rest = samples.filter(r => r !== existing);
    setDraft(existing?.speaker === sample.speaker ? rest : [...rest, sample]);
  };
  const audio = useRef<HTMLAudioElement>(null);
  const refresh = useCallback(async () => {
    if (meetingId) setStatus(await invoke<Status>('meeting_speakers', {meetingId}));
  }, [meetingId]);
  useEffect(() => {refresh().catch(e => setError(String(e)));}, [refresh]);
  const identify = async (calibrate = false) => {
    setBusy(true); setError('');
    try {
      await invoke('identify_meeting_speakers', {meetingId, speakerCount: count, references: calibrate ? samples : null});
      if (calibrate) {
        for (const [id,name] of Object.entries(draftNames)) {
          if (Number(id)<count) await invoke('rename_meeting_speaker',{meetingId,speaker:Number(id),name});
        }
      }
      localStorage.removeItem(nameKey);
      setDraftNames({});
      await refresh();
      setDraft(null);
      setRefining(false);
    } catch (e) {setError(String(e));} finally {setBusy(false);}
  };
  const play = (time: number, end?: number, contextSeconds = 0) => {
    if (!audio.current) return;
    stopAt.current = end === undefined ? undefined : Math.min(duration || Infinity, end + contextSeconds);
    audio.current.currentTime = Math.max(0,time - contextSeconds);
    audio.current.play().catch(e => setError(String(e)));
  };
  const rename = async (id: number, name: string) => {
    try {
      if (!storedStatus?.analysis) {
        const next = {...draftNames,[id]:name.trim()};
        localStorage.setItem(nameKey,JSON.stringify(next));
        setDraftNames(next);
        return;
      }
      await invoke('rename_meeting_speaker', {meetingId, speaker:id, name});
      await refresh();
    } catch(e) {setError(String(e));}
  };
  const seek = (seconds: number) => {
    if (!audio.current || !duration) return;
    stopAt.current = undefined;
    audio.current.currentTime = Math.max(0, Math.min(duration, seconds));
    setPosition(audio.current.currentTime);
  };
  const clock = (seconds: number) => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
  const analysis = status?.analysis;
  const ids = Array.from(new Set(analysis?.turns.map(turn => turn.speaker)));
  return <Speakers.Provider value={status ? {meetingId,status,speakerIds,play,refining,busy,samples,mark} : null}>
    {status?.supported && <div className="max-h-[42vh] shrink-0 overflow-y-auto border-b bg-background px-4 py-3 text-xs">
      {analysis && <p>{ids.length} speaker groups detected · Analyzed locally in {Math.round(analysis.seconds)}s</p>}
      {<label className="mr-2 inline-flex items-center gap-2 font-medium"><Users size={15} className="text-teal-700"/>Speakers <select value={count} disabled={busy} onChange={e => {
        setCount(Number(e.target.value));
      }} className="rounded-md border bg-background px-2 py-1.5"><option value={-1} disabled={refining}>Auto</option>{Array.from({length:9}, (_,i) => <option key={i} value={i+2}>{i+2}</option>)}</select></label>}
      {(speakerIds.length>0 || ids.length>0) && <Button variant="ghost" size="sm" disabled={busy} aria-expanded={editing} onClick={()=>setEditing(!editing)}>{editing ? 'Done' : 'Name speakers'}</Button>}
      {editing && <div>{(speakerIds.length ? speakerIds : ids).map(id => <label key={id} className="inline-flex items-center gap-1 mr-3">{label(id)}
        <input aria-label={label(id)} defaultValue={status.names?.[id] || ''} placeholder={label(id)} maxLength={80}
          onBlur={e=>{if(e.target.value !== (status.names?.[id] || '')) void rename(id,e.target.value);}}
          className="rounded border px-2 py-1 w-28"/></label>)}</div>}
      {status.audio && <Button variant="outline" size="sm" disabled={busy} aria-expanded={refining}
        onClick={()=>{
          if (!refining && count<2) setCount(Math.min(10,Math.max(2,ids.length)));
          setRefining(!refining);
        }}>{refining ? 'Back to transcript' : 'Label voice samples'}</Button>}
      {refining && count >= 2 && <div className="my-2.5 space-y-2 rounded-xl border bg-muted/30 px-3 py-2.5">
        <details open={guide} onToggle={e=>setGuide(e.currentTarget.open)}>
          <summary className="cursor-pointer font-medium text-teal-800">How to label voice samples</summary>
          <ol className="mt-2 list-decimal pl-5 space-y-1 text-muted-foreground">
            <li>Drag across a sentence spoken by one person in the transcript.</li>
            <li>Listen with context to find the phrase. Choose Sample only to check that the clip contains one voice, then select their name.</li>
            <li>Repeat for each person, then choose Identify speakers.</li>
          </ol>
        </details>
        {samples.length > 0 && <details>
          <summary className="cursor-pointer">Review samples ({samples.length})</summary>
          {samples.map(sample => <div key={sample.start+'-'+sample.end} className="flex items-center gap-3">
            <button onClick={() => play(sample.start, sample.end)}>▷ {status.names?.[sample.speaker] || label(sample.speaker)} · {clock(sample.start)} – {clock(sample.end)}</button>
            <button disabled={busy} onClick={() => mark(sample)}>Remove</button>
          </div>)}
        </details>}
        <p className="text-muted-foreground">Highlight clear speech · Aim for 15–30 seconds per person</p>
        <div className="flex flex-wrap gap-1.5">{speakerIds.map(id => {
          const seconds = Math.round(samples.filter(s=>s.speaker===id).reduce((sum,s)=>sum+s.end-s.start,0));
          return <span key={id} className="inline-flex items-center gap-2 rounded-full border bg-background px-2.5 py-1">
            <span className={seconds ? 'size-2 rounded-full bg-teal-600' : 'size-2 rounded-full bg-slate-300'}/>
            {status.names?.[id] || label(id)} <span className="tabular-nums text-muted-foreground">{seconds}s</span>
          </span>;
        })}</div>
      </div>}
      <Button size="sm" disabled={busy || (count>=2 && samples.length>0 && !speakerIds.every(id=>samples.some(s=>s.speaker===id)))}
        onClick={()=>setConfirming(true)}>{busy ? 'Identifying speakers…' : status.ready ? 'Identify speakers' : 'Download models & identify speakers'}</Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle>Identify speakers?</DialogTitle>
            <DialogDescription>{analysis?.seconds ? 'Previous analysis of this recording took '+Math.round(analysis.seconds)+' seconds.'
              : duration ? 'Rough estimate: about '+(duration<240 ? Math.max(5,Math.round(duration/4))+' seconds' : Math.round(duration/240)+' minutes')+' on an M1 Mac. Actual time varies.' : 'Processing time depends on recording length and your Mac.'}
              {!status.ready && ' Allow extra time for the model download.'}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">Keep Ting open and your Mac awake. The display can turn off.</p>
          {!samples.length && <p className="text-sm">Clear voice samples can help Ting tell similar speakers apart. You can add them first or start automatically.{Object.keys(draftNames).length>0 && ' Add a sample for each person to match the names you entered to their voices.'}</p>}
          <DialogFooter>
            {!samples.length && <Button variant="outline" onClick={()=>{
              setConfirming(false); if(count<2) setCount(2); setRefining(true); setGuide(true);
            }}>Label voice samples</Button>}
            <Button onClick={()=>{setConfirming(false); void identify(count>=2 && samples.length>0);}}>Start analysis</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


    </div>}
    {error && <p role="alert" className="text-xs text-red-700 px-4">{error}</p>}
    {children}
    {status?.audio && <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-2">
      <div className="flex items-center gap-2">
        <Button size="icon" className="size-9 shrink-0 rounded-full bg-teal-800 text-white hover:bg-teal-900"
          aria-label={playing ? 'Pause' : 'Play recording'} onClick={() => {
            if (playing) audio.current?.pause(); else play(position);
          }}>{playing ? <Pause size={16} /> : <Play size={16} />}</Button>
        <button title="Back 15 seconds" aria-label="Back 15 seconds" onClick={() => seek(position-15)}><RotateCcw size={16} /></button>
        <button title="Forward 15 seconds" aria-label="Forward 15 seconds" onClick={() => seek(position+15)}><RotateCw size={16} /></button>
        <span className="text-xs tabular-nums">{clock(position)}</span>
        <input aria-label="Playback position" type="range" min={0} max={duration || 1} step={0.1} disabled={!duration}
          value={position} onChange={e => seek(Number(e.target.value))} className="min-w-0 flex-1 accent-teal-700" />
        <span className="text-xs tabular-nums text-slate-500">{clock(duration)}</span>
        <select aria-label="Playback speed" defaultValue="1" className="bg-transparent text-xs" onChange={e => {
          if (audio.current) audio.current.playbackRate = Number(e.target.value);
        }}>{[0.5,0.75,1,1.25,1.5,2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select>
        <button aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={16}/> : <Volume2 size={16}/>}</button>
      </div>
      <audio muted={muted} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onDurationChange={e => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)} onTimeUpdate={e => {
        setPosition(e.currentTarget.currentTime);
        if (audio.current && stopAt.current !== undefined && audio.current.currentTime >= stopAt.current) {
          audio.current.pause();
          stopAt.current = undefined;
        }
      }} key={status.audio} ref={audio}  preload="metadata" src={convertFileSrc(status.audio)} />
    </div>}
  </Speakers.Provider>;
}
