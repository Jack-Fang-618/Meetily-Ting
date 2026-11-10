import { describe, expect, test } from 'bun:test';
import { acceptFinal, captionFontSize, emptyCaption } from '../../src/lib/captions';
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
