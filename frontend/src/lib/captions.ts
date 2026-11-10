export interface CaptionState { text:string; draft:string; sequence:number; provider:string; status:string }
export const emptyCaption: CaptionState = {text:'',draft:'',sequence:-1,provider:'',status:'Waiting for speech'};
export function acceptFinal(state:CaptionState, update:{text:string;sequence_id:number;source?:string}):CaptionState {
  if (update.sequence_id <= state.sequence || !update.text.trim()) return state;
  return {...state,text:update.text,draft:'',sequence:update.sequence_id,provider:update.source === 'Cloud' ? 'Alibaba Cloud' : 'Local transcription',status:'Live captions'};
}
export const captionFontSize = (size:number) => Math.max(18,Math.min(40,size));
