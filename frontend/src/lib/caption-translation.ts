export const CLOUD_TRANSLATION_MODELS = ['qwen3.8-flash','qwen3.7-plus','qwen-plus','qwen-flash'] as const;
export const DEFAULT_CLOUD_TRANSLATION_MODEL = 'qwen3.8-flash';
export const TRANSLATION_DIRECTIONS = {
  english: 'English → Mandarin (written Chinese)',
  'zh-en': 'Mandarin → English',
  cantonese: 'Cantonese → Mandarin (written Chinese)',
  'zh-yue': 'Mandarin → Cantonese',
  'en-yue': 'English → Cantonese',
  'yue-en': 'Cantonese → English',
} as const;
export type TranslationMode = 'off' | keyof typeof TRANSLATION_DIRECTIONS;
export type TranslationProvider = 'local' | 'aliyun' | 'realtime';
export type TranslationResult = {text:string;model:string;elapsed_ms:number};
export type TranslationJob = {id?:string;text:string;mode:Exclude<TranslationMode,'off'>;provider:TranslationProvider;cloudConsent:boolean;model:string};
// One running + one latest pending sentence: bounded work, no accumulating delay.
// Display results together with their own source, never beside an unrelated draft.
export class CaptionTranslationQueue {
  private pending:TranslationJob|null=null;
  private busy=false;
  private generation=0;
  constructor(private run:(job:TranslationJob)=>Promise<TranslationResult>,private deliver:(job:TranslationJob,result:TranslationResult|null,error:string)=>void){}
  reset(){this.generation++;this.pending=null;}
  submit(job:TranslationJob){this.pending=job;void this.pump();}
  private async pump(){
    if(this.busy)return;
    this.busy=true;
    try {
      while(this.pending){
        const job=this.pending;this.pending=null;const generation=this.generation;
        try {const result=await this.run(job);if(generation===this.generation)this.deliver(job,result,'');}
        catch(error){if(generation===this.generation)this.deliver(job,null,String(error));}
      }
    } finally {this.busy=false;}
  }
}
