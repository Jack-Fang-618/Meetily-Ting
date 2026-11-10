'use client';
import { useEffect, useRef, useState } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Plus, Pin, PinOff, X, Captions } from 'lucide-react';
import { acceptFinal, captionFontSize, CaptionState, emptyCaption } from '@/lib/captions';

export function CaptionPanel({caption,size,pinned,onSize,onPin,onClose,onDrag,error=''}:{caption:CaptionState;size:number;pinned:boolean;onSize:(size:number)=>void;onPin:()=>void;onClose:()=>void;onDrag:()=>void;error?:string}) {
  const textArea=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(textArea.current) textArea.current.scrollTop=textArea.current.scrollHeight;},[caption.text,caption.draft,size]);
  const control='flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-30';
  return <main className="flex h-screen min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl">
    <header onPointerDown={e=>{if(e.button===0 && !(e.target as HTMLElement).closest('button')) onDrag();}} className="flex shrink-0 cursor-move select-none items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
      <div className="flex items-center gap-2 text-xs"><Captions className="h-4 w-4 text-blue-400"/><span className="font-semibold tracking-wide">TING</span><span className="text-slate-400">Live captions</span></div>
      <div className="flex cursor-default items-center gap-1">
        <button className={control} disabled={size<=18} onClick={()=>onSize(size-2)} aria-label="Smaller text" title="Smaller text"><Minus size={15}/></button>
        <button className={control} disabled={size>=40} onClick={()=>onSize(size+2)} aria-label="Larger text" title="Larger text"><Plus size={15}/></button>
        <span className="mx-1 h-4 w-px bg-white/10"/>
        <button className={`${control} ${pinned?'text-blue-400':''}`} aria-label={pinned?'Turn off always on top':'Keep on top'} aria-pressed={pinned} onClick={onPin} title={pinned?'Always on top':'Keep on top'}>{pinned?<Pin size={15}/>:<PinOff size={15}/>}</button>
        <button className={control} onClick={onClose} aria-label="Close captions" title="Close captions · recording continues"><X size={17}/></button>
      </div>
    </header>
    <div ref={textArea} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-3" style={{fontSize:size,lineHeight:1.45}}>
      {caption.draft ? <><p className="line-clamp-1 text-slate-500" style={{fontSize:Math.max(16,size-6)}}>{caption.text}</p><p className="mt-1 break-words text-slate-100">{caption.draft}</p></> : caption.text ? <p className="break-words font-medium">{caption.text}</p> : <p className="text-slate-500" style={{fontSize:Math.max(18,size-4)}}>Your conversation, in view.<br/><span className="text-sm">Start a recording in Ting. Captions appear here.</span></p>}
    </div>
    <footer className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 text-[11px] text-slate-400">
      <span role="status" className={`flex min-w-0 items-center gap-2 ${error?'text-amber-300':''}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${error?'bg-amber-400':caption.text||caption.draft?'bg-blue-400':'bg-slate-600'}`}/>{error || caption.status}</span>
      <span className="shrink-0">{caption.draft ? 'Draft · may change' : caption.provider || 'Drag to move · resize to fit'}</span>
    </footer>
  </main>;
}

export function CaptionWindow() {
  const [caption,setCaption]=useState<CaptionState>(emptyCaption);
  const [size,setSize]=useState(26);
  const [pinned,setPinned]=useState(true);
  const [error,setError]=useState('');
  const generation=useRef(0);
  useEffect(()=>{
    let active=true;const cleanup:UnlistenFn[]=[];
    const attach=async<T,>(event:string,callback:(data:T)=>void)=>{
      const stop=await listen<T>(event,e=>{if(active){generation.current++;callback(e.payload);}});
      if(active) cleanup.push(stop);else stop();
    };
    const setup=async()=>{
      await attach<{text:string;sequence_id:number;source:string}>('transcript-update',update=>setCaption(s=>acceptFinal(s,update)));
      await attach<{text:string}>('cloud-live-partial',update=>setCaption(s=>({...s,draft:update.text})));
      await attach<{state:string;message:string}>('cloud-live-status',update=>{
        setError(update.state==='error'?'Connection interrupted · local recording continues':'');
        if(update.state==='connected') setCaption(s=>({...s,provider:'Alibaba Cloud',status:'Listening'}));
      });
      await attach('recording-started',()=>{setCaption({...emptyCaption,status:'Listening'});setError('');});
      await attach('recording-stopped',()=>setCaption(s=>({...s,draft:'',status:'Recording ended'})));
      await attach('recording-paused',()=>setCaption(s=>({...s,status:'Paused'})));
      await attach('recording-resumed',()=>setCaption(s=>({...s,status:'Listening'})));
      const before=generation.current;
      const history=await invoke<Array<{text:string;sequence_id:number}>>('get_transcript_history');
      if(active && generation.current===before && history.length) {
        const last=history.reduce((a,b)=>a.sequence_id>b.sequence_id?a:b);
        setCaption(s=>({...acceptFinal(s,last),provider:'',status:'Latest transcript'}));
      }
    };
    setup().catch(()=>{if(active)setError('Waiting for Ting connection');});
    return()=>{active=false;cleanup.forEach(stop=>stop());};
  },[]);
  const action=async(fn:()=>Promise<void>)=>{try{await fn();}catch{setError('Window action failed. Please retry.');}};
  return <CaptionPanel caption={caption} size={size} pinned={pinned} error={error}
    onSize={value=>setSize(captionFontSize(value))}
    onPin={()=>action(async()=>{await getCurrentWindow().setAlwaysOnTop(!pinned);setPinned(!pinned);})}
    onClose={()=>action(()=>getCurrentWindow().close())}
    onDrag={()=>action(()=>getCurrentWindow().startDragging())}/>;
}
