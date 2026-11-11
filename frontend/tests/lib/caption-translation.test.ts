import { expect, test } from 'bun:test';
import { CaptionTranslationQueue, TranslationJob, TranslationResult } from '../../src/lib/caption-translation';
const job=(text:string):TranslationJob=>({text,mode:'english',provider:'local',cloudConsent:false,model:'qwen3.5:4b'});
const result:TranslationResult={text:'译文',model:'test',elapsed_ms:100};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('bounds backlog and pairs results with the source actually translated',async()=>{
  const pending:Array<(r:TranslationResult)=>void>=[];const sent:string[]=[];const shown:string[]=[];
  const queue=new CaptionTranslationQueue(j=>{sent.push(j.text);return new Promise(resolve=>pending.push(resolve));},j=>shown.push(j.text));
  queue.submit(job('first'));queue.submit(job('second'));queue.submit(job('latest'));
  expect(sent).toEqual(['first']);pending.shift()!(result);await tick();
  expect(sent).toEqual(['first','latest']);expect(shown).toEqual(['first']);
  pending.shift()!(result);await tick();expect(shown).toEqual(['first','latest']);
});
test('changing mode or session discards old in-flight result and pending text',async()=>{
  let finish!:(r:TranslationResult)=>void;const shown:string[]=[];
  const queue=new CaptionTranslationQueue(()=>new Promise(resolve=>finish=resolve),j=>shown.push(j.text));
  queue.submit(job('old sentence'));queue.submit(job('stale pending'));queue.reset();finish(result);await tick();expect(shown).toEqual([]);
});
test('a failed sentence does not stop later translations',async()=>{
  const errors:string[]=[];const shown:string[]=[];
  const queue=new CaptionTranslationQueue(async j=>{if(j.text==='bad')throw new Error('offline');return result;},(j,r,e)=>{if(e)errors.push(e);else shown.push(j.text);});
  queue.submit(job('bad'));await tick();queue.submit(job('good'));await tick();expect(errors).toHaveLength(1);expect(shown).toEqual(['good']);
});
