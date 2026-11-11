import { describe, expect, test } from 'bun:test';
import { acceptFinal, captionFontSize, emptyCaption, updateTranslationHistory } from '../../src/lib/captions';
describe('caption presentation',()=>{
  test('final results replace drafts; old or duplicate events cannot roll text back',()=>{
    const state={...emptyCaption,draft:'working'};
    const final=acceptFinal(state,{text:'Final sentence',sequence_id:4,source:'Cloud'});
    expect(final.text).toBe('Final sentence');expect(final.draft).toBe('');expect(final.provider).toBe('Alibaba Cloud');
    expect(acceptFinal(final,{text:'Old sentence',sequence_id:3})).toBe(final);
    expect(acceptFinal(final,{text:'Duplicate',sequence_id:4})).toBe(final);
    expect(acceptFinal(final,{text:' ',sequence_id:5})).toBe(final);
  });
  test('new recordings accept initial sequence and text size stays readable',()=>{
    expect(acceptFinal(emptyCaption,{text:'Local speech',sequence_id:0}).provider).toBe('Local transcription');
    expect(captionFontSize(10)).toBe(18);expect(captionFontSize(80)).toBe(40);expect(captionFontSize(28)).toBe(28);
  });
});

test('local captions retain a bounded recent history without duplicates',()=>{
 let state=emptyCaption;
 for(let i=0;i<53;i++) state=acceptFinal(state,{text:`part ${i}`,sequence_id:i});
 expect(state.history?.length).toBe(50);expect(state.history?.[0]).toBe('part 3');
 expect(acceptFinal(state,{text:'duplicate',sequence_id:52})).toBe(state);
 expect(acceptFinal(state,{text:'cloud',sequence_id:53,source:'Cloud'}).history?.at(-1)).toBe('cloud');
});

test('streaming translations update one paired entry, including late source text',()=>{
 let history=updateTranslationHistory([],{id:'a',source:'',text:'你'});
 history=updateTranslationHistory(history,{id:'a',source:'Hello',text:'你好'});
 history=updateTranslationHistory(history,{id:'b',source:'Next',text:'下一句'});
 history=updateTranslationHistory(history,{id:'a',source:'Hello there',text:'你好'});
 expect(history).toEqual([{id:'a',source:'Hello there',text:'你好'},{id:'b',source:'Next',text:'下一句'}]);
});
test('repeated spoken sentences remain separate and translation history is bounded',()=>{
 let history:ReturnType<typeof updateTranslationHistory>=[];
 for(let i=0;i<60;i++)history=updateTranslationHistory(history,{id:String(i),source:'Yes',text:'是的'});
 expect(history.length).toBe(50);expect(history[0].id).toBe('10');
 expect(updateTranslationHistory(history,{id:'empty',source:'',text:''})).toBe(history);
});
