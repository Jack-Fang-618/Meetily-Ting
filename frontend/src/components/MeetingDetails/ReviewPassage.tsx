import {Button} from '@/components/ui/button';
import {ChevronDown} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';

type Edit = {start:number; end:number; speakers:number[]};
type Props = {
  storageKey:string; source:string; offset:number; text:string; inferred:number[];
  canAssign:boolean; listen?:(start:number,end:number)=>void;
  choices:number[]; name:(id:number)=>string;
};

export function replaceAssignment(edits:Edit[], start:number, end:number, speakers:number[]) {
  const kept = edits.flatMap(edit => {
    if (edit.end <= start || edit.start >= end) return [edit];
    const pieces:Edit[] = [];
    if (edit.start < start) pieces.push({...edit,end:start});
    if (edit.end > end) pieces.push({...edit,start:end});
    return pieces;
  });
  if (speakers.length) kept.push({start,end,speakers});
  return kept.sort((a,b)=>a.start-b.start);
}

export function ReviewPassage({storageKey,source,offset,text,inferred,choices,name,canAssign,listen}:Props) {
  const read = ():Edit[] => {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    return saved?.source === source ? saved.edits : [];
  };
  const [edits,setEdits] = useState<Edit[]>([]);
  const [target,setTarget] = useState<[number,number]>();
  const [assigning,setAssigning] = useState(false);
  const [picked,setPicked] = useState<number[]>([]);
  const [error,setError] = useState('');
  const body = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const refresh = () => {
      try {setEdits(read());} catch {setError('Could not read saved speaker edits.');}
    };
    refresh();
    window.addEventListener(storageKey,refresh);
    return ()=>window.removeEventListener(storageKey,refresh);
  },[storageKey,source]);
  const finish = offset+text.length;
  const relevant = edits.filter(edit=>edit.start<finish && edit.end>offset);
  const cuts = Array.from(new Set([offset,finish,...relevant.flatMap(e=>[Math.max(offset,e.start),Math.min(finish,e.end)])])).sort((a,b)=>a-b);
  const open = (a:number,b:number,edit=false) => {
    setAssigning(edit);
    setTarget([a,b]); setPicked(edits.find(e=>e.start<=a && e.end>=b)?.speakers ?? inferred);
  };
  const save = (ids:number[]) => {
    if (!target) return;
    try {
      const next = replaceAssignment(read(),...target,ids);
      localStorage.setItem(storageKey,JSON.stringify({source,edits:next}));
      window.dispatchEvent(new Event(storageKey));
      setTarget(undefined); setError('');
    } catch {setError('Could not save this speaker edit.');}
  };
  return <div className="space-y-1">
    <div ref={body} onMouseUp={()=>{
      const sel = window.getSelection();
      if (!sel?.rangeCount || sel.isCollapsed) return;
      const r = sel.getRangeAt(0);
      const span = r.startContainer.parentElement?.closest<HTMLElement>('[data-word-offset]');
      if (!span || !body.current?.contains(span) || !span.contains(r.endContainer)) return;
      const before=r.cloneRange(); before.selectNodeContents(span); before.setEnd(r.startContainer,r.startOffset);
      const start=Number(span.dataset.wordOffset)+before.toString().length;
      open(start,start+r.toString().length);
    }}>
      {cuts.slice(0,-1).map((a,i)=>{
        const b=cuts[i+1];
        const ids=relevant.find(e=>e.start<=a && e.end>=b)?.speakers ?? inferred;
        return <div key={a}>{canAssign && <button className="mb-1 inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 hover:bg-teal-100" onClick={()=>open(a,b,true)}>
          {ids.map(name).join(' + ') || 'Choose speakers'} <ChevronDown size={12}/>
        </button>}<div className="select-text whitespace-pre-wrap leading-relaxed selection:bg-teal-200 selection:text-teal-950" data-word-offset={a}>{target && target[0]>=a && target[1]<=b ? <>{text.slice(a-offset,target[0]-offset)}<mark className="rounded-sm bg-teal-100 text-teal-950 underline decoration-teal-500 underline-offset-4">{text.slice(target[0]-offset,target[1]-offset)}</mark>{text.slice(target[1]-offset,b-offset)}</> : text.slice(a-offset,b-offset)}</div></div>;
      })}
    </div>
    {target && <div className="my-2 flex flex-wrap items-center gap-2 rounded-xl border border-teal-200 bg-background p-2.5 text-xs shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 duration-150">
      {listen && <Button size="sm" variant="outline" onClick={()=>listen(target[0]-offset,target[1]-offset)}>Listen with context</Button>}
      {canAssign && !assigning && <Button size="sm" variant="secondary" onClick={()=>setAssigning(true)}>Change speaker</Button>}
      {canAssign && assigning && <>
      <span className="w-full font-medium">Who spoke?</span>
      {Array.from(new Set([...choices,...picked])).sort((a,b)=>a-b).map(id=><label key={id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 has-[:checked]:border-teal-400 has-[:checked]:bg-teal-50">
        <input className="accent-teal-700" type="checkbox" checked={picked.includes(id)} onChange={e=>setPicked(e.target.checked?[...picked,id]:picked.filter(v=>v!==id))}/> {name(id)}
      </label>)}
      <Button size="sm" className="ml-auto" disabled={!picked.length} onClick={()=>save(picked)}>Save</Button>
      <Button size="sm" variant="ghost" onClick={()=>save([])}>Use automatic result</Button>
      </>}
      <Button size="sm" variant="ghost" onClick={()=>setTarget(undefined)}>Cancel</Button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
