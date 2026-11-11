export interface CaptionState { text:string; history?:string[]; draft:string; sequence:number; provider:string; status:string }
export const emptyCaption: CaptionState = {text:'',draft:'',sequence:-1,provider:'',status:'Waiting for speech'};
export function acceptFinal(state:CaptionState, update:{text:string;sequence_id:number;source?:string}):CaptionState {
  if (update.sequence_id <= state.sequence || !update.text.trim()) return state;
  const history=[...(state.history||[]),update.text].slice(-50);
  return {...state,text:update.text,history,draft:'',sequence:update.sequence_id,provider:update.source === 'Cloud' ? 'Alibaba Cloud' : 'Local transcription',status:'Live captions'};
}
export const captionFontSize = (size:number) => Math.max(18,Math.min(40,size));

export type TranslationCaption = {id:string;source:string;text:string};
export function updateTranslationHistory(history:TranslationCaption[], entry:TranslationCaption):TranslationCaption[] {
  if(!entry.id || !entry.text.trim()) return history;
  const index=history.findIndex(item=>item.id===entry.id);
  if(index<0)return [...history,entry].slice(-50);
  return history.map((item,i)=>i===index?entry:item);
}
