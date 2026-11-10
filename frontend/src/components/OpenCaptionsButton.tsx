'use client';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Captions, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';
export function OpenCaptionsButton() {
  const [busy,setBusy]=useState(false);
  return <Button variant="outline" disabled={busy} onClick={async()=>{
    setBusy(true);
    try{await invoke('open_caption_window');}catch(e){toast.error('Could not open captions',{description:String(e)});}finally{setBusy(false);}
  }}>{busy?<Loader2 className="animate-spin"/>:<Captions/>}Floating captions</Button>;
}
