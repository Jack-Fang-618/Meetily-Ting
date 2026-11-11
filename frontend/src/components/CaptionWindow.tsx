'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Plus, Pin, PinOff, X, Captions, Settings2, RotateCcw, ArrowDown } from 'lucide-react';
import { CLOUD_TRANSLATION_MODELS, DEFAULT_CLOUD_TRANSLATION_MODEL, CaptionTranslationQueue, TranslationMode, TranslationProvider, TranslationResult } from '@/lib/caption-translation';
import { acceptFinal, captionFontSize, CaptionState, emptyCaption, TranslationCaption, updateTranslationHistory } from '@/lib/captions';

type Appearance = { text: string; background: string; opacity: number };
const defaultAppearance: Appearance = {text:'#f1f5f9',background:'#10141c',opacity:28};
const appearanceKey = 'ting.caption-appearance.v2';

export function CaptionPanel({caption,size,pinned,onSize,onPin,onClose,onDrag,error='',translation,translationControls,historyKey=''}:{caption:CaptionState;size:number;pinned:boolean;onSize:(size:number)=>void;onPin:()=>void;onClose:()=>void;onDrag:()=>void;error?:string;translation?:{source:string;result:TranslationResult|null;status:string;history?:TranslationCaption[]};translationControls?:React.ReactNode;historyKey?:string}) {
  const [appearance,setAppearance]=useState<Appearance>(defaultAppearance);
  const [settingsOpen,setSettingsOpen]=useState(false);
  useEffect(()=>{
    try {
      const saved=JSON.parse(localStorage.getItem(appearanceKey)||'null');
      if(saved && /^#[0-9a-f]{6}$/i.test(saved.text) && /^#[0-9a-f]{6}$/i.test(saved.background) && Number.isFinite(saved.opacity))
        setAppearance({...saved,opacity:Math.max(0,Math.min(100,saved.opacity))});
    } catch { /* Unavailable or old preferences use the readable default. */ }
  },[]);
  const updateAppearance=(next:Appearance)=>{
    setAppearance(next);
    try {localStorage.setItem(appearanceKey,JSON.stringify(next));} catch { /* Session settings still work. */ }
  };
  const background=appearance.background+Math.round(appearance.opacity*2.55).toString(16).padStart(2,'0');
  const textArea=useRef<HTMLDivElement>(null);
  const followLatest=useRef(true);
  const [reviewing,setReviewing]=useState(false);
  const returnToLatest=()=>{followLatest.current=true;setReviewing(false);if(textArea.current)textArea.current.scrollTop=textArea.current.scrollHeight;};
  useEffect(()=>{returnToLatest();},[historyKey]);
  useLayoutEffect(()=>{if(textArea.current && followLatest.current) textArea.current.scrollTop=textArea.current.scrollHeight;},[caption.text,caption.draft,size,translation,settingsOpen,reviewing]);
  const control='flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-30';
  return <main className="flex h-screen min-h-0 flex-col overflow-hidden rounded-2xl border border-white/15 text-slate-100" style={{backgroundColor:background,backdropFilter:'blur(28px) saturate(120%)',WebkitBackdropFilter:'blur(28px) saturate(120%)'}}>

    <header onPointerDown={e=>{if(e.button===0 && !(e.target as HTMLElement).closest('button')) onDrag();}} className="flex shrink-0 cursor-move select-none items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
      <div className="flex items-center gap-2 text-xs"><Captions className="h-4 w-4 text-blue-400"/><span className="font-semibold tracking-wide">TING</span><span className="text-slate-400">Live captions</span></div>
      <div className="flex cursor-default items-center gap-1">
        <button className={control} onClick={()=>setSettingsOpen(v=>!v)} aria-label="Caption appearance" aria-expanded={settingsOpen} title="Appearance"><Settings2 size={15}/></button>
        <button className={control} disabled={size<=18} onClick={()=>onSize(size-2)} aria-label="Smaller text" title="Smaller text"><Minus size={15}/></button>
        <button className={control} disabled={size>=40} onClick={()=>onSize(size+2)} aria-label="Larger text" title="Larger text"><Plus size={15}/></button>
        <span className="mx-1 h-4 w-px bg-white/10"/>
        <button className={`${control} ${pinned?'text-blue-400':''}`} aria-label={pinned?'Turn off always on top':'Keep on top'} aria-pressed={pinned} onClick={onPin} title={pinned?'Always on top':'Keep on top'}>{pinned?<Pin size={15}/>:<PinOff size={15}/>}</button>
        <button className={control} onClick={onClose} aria-label="Close captions" title="Close captions · recording continues"><X size={17}/></button>
      </div>
    </header>
    {translationControls}
    {settingsOpen ? <section aria-label="Caption appearance" className="min-h-0 flex-1 overflow-y-auto bg-slate-950/95 px-4 py-3 text-sm text-slate-100">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2">Text<input aria-label="Text color" type="color" value={appearance.text} onChange={e=>updateAppearance({...appearance,text:e.target.value})} className="h-8 w-10 cursor-pointer rounded border border-white/20 bg-transparent"/></label>
        <label className="flex items-center gap-2">Background<input aria-label="Background color" type="color" value={appearance.background} onChange={e=>updateAppearance({...appearance,background:e.target.value})} className="h-8 w-10 cursor-pointer rounded border border-white/20 bg-transparent"/></label>
        <button className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-slate-300 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-blue-400" onClick={()=>updateAppearance(defaultAppearance)} title="Reset appearance"><RotateCcw size={13}/>Reset</button>
      </div>
      <label className="mt-3 flex items-center gap-3">Opacity<input aria-label="Background opacity" type="range" min="0" max="100" value={appearance.opacity} onChange={e=>updateAppearance({...appearance,opacity:Number(e.target.value)})} className="min-w-0 flex-1 accent-blue-400"/><span className="w-9 text-right tabular-nums">{appearance.opacity}%</span></label>
      <p className="mt-2 text-xs text-slate-400">Changes are saved automatically. Close Appearance to return to captions.</p>
    </section> : <>    <div ref={textArea} role="region" aria-label="Caption history" tabIndex={0} onScroll={()=>{const el=textArea.current;if(el){const follows=el.scrollHeight-el.scrollTop-el.clientHeight<32;followLatest.current=follows;setReviewing(!follows);}}} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-3" style={{fontSize:size,lineHeight:1.45,color:appearance.text}}>
      {translation ? <>
        {translation.history?.length ? <div className="space-y-4">{translation.history.map((entry,index)=><div key={entry.id} className={index===translation.history!.length-1?'':'opacity-75'}>
          <p className="break-words opacity-70" style={{fontSize:Math.max(16,size-6)}}>{entry.source || 'Source text pending…'}</p>
          <p className="mt-1 break-words font-medium">{entry.text}</p>
        </div>)}</div> : <>
          <p className="break-words opacity-70" style={{fontSize:Math.max(16,size-6)}}>{translation.source || (translation.result ? 'Source text pending…' : caption.text || caption.draft || 'Waiting for speech…')}</p>
          {translation.result && <p className="mt-2 break-words font-medium">{translation.result.text}</p>}
        </>}
        <p className="mt-2 text-xs opacity-70" role="status">{translation.status}</p>
      </> : <>
        {caption.history?.length ? <div className="space-y-3">{caption.history.map((line,index)=><p key={caption.sequence-caption.history!.length+index} className={index===caption.history!.length-1?'break-words font-medium':'break-words opacity-60'}>{line}</p>)}</div> : caption.text ? <p className="break-words font-medium">{caption.text}</p> : !caption.draft && <p className="opacity-60" style={{fontSize:Math.max(18,size-4)}}>Your conversation, in view.<br/><span className="text-sm">Start a recording in Ting. Captions appear here.</span></p>}
        {caption.draft && <p className="mt-3 break-words">{caption.draft}</p>}
      </>}

    </div>
</>}
    {reviewing && !settingsOpen && <button onClick={returnToLatest} className="mx-auto mb-2 flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"><ArrowDown size={13}/>Back to latest</button>}
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
  const [mode,setMode]=useState<TranslationMode>('off');
  const [provider,setProvider]=useState<TranslationProvider>('local');
  const [cloudConsent,setCloudConsent]=useState(false);
  const [localModel,setLocalModel]=useState('qwen3.5:4b');
  useEffect(()=>{try {if(localStorage.getItem('ting.caption-local-model')==='qwen3.5:2b')setLocalModel('qwen3.5:2b');}catch{}},[]);
  const chooseLocalModel=(value:string)=>{setLocalModel(value);try{localStorage.setItem('ting.caption-local-model',value);}catch{}};
  const [cloudModel,setCloudModel]=useState<string>(DEFAULT_CLOUD_TRANSLATION_MODEL);
  useEffect(()=>{try {const saved=localStorage.getItem('ting.caption-cloud-model');if(saved && CLOUD_TRANSLATION_MODELS.some(m=>m===saved))setCloudModel(saved);}catch{}},[]);
  const chooseCloudModel=(value:string)=>{setCloudModel(value);try{localStorage.setItem('ting.caption-cloud-model',value);}catch{}};
  const [session,setSession]=useState(0);
  const [liveSession,setLiveSession]=useState(0);
  const liveEnded=useRef(false);
  const [translation,setTranslation]=useState<{source:string;result:TranslationResult|null;status:string}>({source:'',result:null,status:''});
  const [translationHistory,setTranslationHistory]=useState<TranslationCaption[]>([]);
  const queue=useRef<CaptionTranslationQueue|null>(null);
  if(!queue.current)queue.current=new CaptionTranslationQueue(
    job=>invoke<TranslationResult>('translate_caption',job),
    (job,result,error)=>{
      setTranslation({source:job.text,result,status:error || `${result!.model} · ${(result!.elapsed_ms/1000).toFixed(1)} s · AI translation`});
      if(result)setTranslationHistory(history=>updateTranslationHistory(history,{id:job.id!,source:job.text,text:result.text}));
    }
  );
  useEffect(()=>{
    queue.current!.reset();setTranslationHistory([]);setTranslation({source:'',result:null,status:provider!=='local'&&!cloudConsent?'Allow cloud translation below to begin.':'Waiting for a completed sentence…'});
    return ()=>queue.current!.reset();
  },[mode,provider,cloudConsent,session,cloudModel,localModel]);
  useEffect(()=>{
    if(mode==='off'||provider==='realtime'||!caption.text||(provider!=='local'&&!cloudConsent))return;
    setTranslation(s=>({...s,status:s.result?'Translating next sentence…':'Translating… first local request may take longer.'}));
    queue.current!.submit({id:`asr:${session}:${caption.sequence}`,text:caption.text,mode,provider,cloudConsent,model:provider==='local'?localModel:cloudModel});
  },[caption.text,caption.sequence,mode,provider,cloudConsent,session,cloudModel,localModel]);

  useEffect(()=>{
    if(mode==='off'||provider!=='realtime'||!cloudConsent)return;
    liveEnded.current=false;
    const sessionId=crypto.randomUUID();let active=true;let unlisten:UnlistenFn|undefined;
    setTranslation({source:'',result:null,status:'Connecting to live audio translation…'});
    const start=async()=>{
      unlisten=await listen<{session_id:string;state:string;item_id?:string;source?:string;text?:string;message?:string}>('live-translation',event=>{
        const value=event.payload;if(!active||value.session_id!==sessionId)return;
        if(value.state==='ended'||value.state==='error')liveEnded.current=true;
        if(value.state==='text' && value.item_id)setTranslationHistory(history=>updateTranslationHistory(history,{id:`${sessionId}:${value.item_id}`,source:value.source||'',text:value.text||''}));
        if(value.state==='text')setTranslation({source:value.source||'',result:{text:value.text||'',model:'qwen3.8-livetranslate-flash-realtime',elapsed_ms:0},status:'Live audio translation · experimental'});
        else setTranslation(s=>({...s,status:value.message||value.state}));
      });
      if(!active){unlisten();return;}
      await invoke('start_live_translation',{sessionId,consent:true});
      if(!active)await invoke('stop_live_translation',{sessionId});
    };
    start().catch(error=>{if(active){liveEnded.current=true;setTranslation({source:'',result:null,status:String(error)});}});
    return ()=>{active=false;unlisten?.();void invoke('stop_live_translation',{sessionId}).catch(()=>{});};
  },[mode,provider,cloudConsent,liveSession]);
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
      await attach('recording-started',()=>{setCaption({...emptyCaption,status:'Listening'});setError('');setSession(v=>v+1);if(liveEnded.current)setLiveSession(v=>v+1);});
      await attach('recording-stopped',()=>setCaption(s=>({...s,draft:'',status:'Recording ended'})));
      await attach('recording-paused',()=>setCaption(s=>({...s,status:'Paused'})));
      await attach('recording-resumed',()=>{setCaption(s=>({...s,status:'Listening'}));if(liveEnded.current)setLiveSession(v=>v+1);});
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
  const controls=<CaptionTranslationControls mode={mode} setMode={setMode} provider={provider} setProvider={setProvider} localModel={localModel} chooseLocalModel={chooseLocalModel} cloudModel={cloudModel} chooseCloudModel={chooseCloudModel} cloudConsent={cloudConsent} setCloudConsent={setCloudConsent}/>;
  return <CaptionPanel translationControls={controls} historyKey={`${session}:${mode}:${provider}:${cloudModel}`} translation={mode==='off'?undefined:{...translation,history:translationHistory}} caption={caption} size={size} pinned={pinned} error={error}
    onSize={value=>setSize(captionFontSize(value))}
    onPin={()=>action(async()=>{await getCurrentWindow().setAlwaysOnTop(!pinned);setPinned(!pinned);})}
    onClose={()=>action(()=>invoke('close_caption_window'))}
    onDrag={()=>action(()=>getCurrentWindow().startDragging())}/>;
}

export function CaptionTranslationControls({mode,setMode,provider,setProvider,localModel,chooseLocalModel,cloudModel,chooseCloudModel,cloudConsent,setCloudConsent}:{mode:TranslationMode;setMode:(value:TranslationMode)=>void;provider:TranslationProvider;setProvider:(value:TranslationProvider)=>void;localModel:string;chooseLocalModel:(value:string)=>void;cloudModel:string;chooseCloudModel:(value:string)=>void;cloudConsent:boolean;setCloudConsent:(value:boolean)=>void}) {
  const selectClass='min-w-0 rounded-md border border-white/15 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
  return <div className="shrink-0 border-b border-white/10 px-4 py-2 text-xs text-slate-300">
    <div className="flex flex-wrap gap-2">
      <select aria-label="Caption translation" className={selectClass} value={mode} onChange={e=>setMode(e.target.value as TranslationMode)}>
        <option value="off">Original only</option><option value="english">English → Chinese</option><option value="cantonese">Cantonese → Written Chinese</option>
      </select>
      {mode!=='off' && <select aria-label="Translation language model" className={selectClass} value={provider} onChange={e=>{setProvider(e.target.value as TranslationProvider);setCloudConsent(false);}}>
        <option value="local">Local · Ollama</option><option value="aliyun">Bailian · Sentence translation</option><option value="realtime">Bailian · Live audio (Experimental)</option>
      </select>}
      {mode!=='off' && provider==='local' && <select aria-label="Local translation model" className={selectClass} value={localModel} onChange={e=>chooseLocalModel(e.target.value)}>
        <option value="qwen3.5:2b">Qwen3.5 2B</option><option value="qwen3.5:4b">Qwen3.5 4B</option>
      </select>}
      {mode!=='off' && provider==='aliyun' && <select aria-label="Cloud translation model" className={selectClass} value={cloudModel} onChange={e=>chooseCloudModel(e.target.value)}>
        {CLOUD_TRANSLATION_MODELS.map(model=><option key={model} value={model}>{model}{model===DEFAULT_CLOUD_TRANSLATION_MODEL?' · Recommended':''}</option>)}
      </select>}
    </div>
    {mode!=='off' && provider!=='local' && <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={cloudConsent} onChange={e=>setCloudConsent(e.target.checked)} className="mt-0.5 accent-blue-400"/>{provider==='realtime'?'Allow sending recording audio to Bailian in an additional live translation session. Additional charges may apply.':'Allow sending caption text to Bailian for translation. Uses your saved key and region; charges may apply.'}</label>}
    {mode!=='off' && provider==='local' && <p className="mt-1">Local translation · experimental, verify dates and amounts.</p>}
  </div>;
}
