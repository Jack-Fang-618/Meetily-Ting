'use client';
import { createRoot } from 'react-dom/client';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import type { AliyunStatus } from '@/lib/aliyun';
let pending: Promise<boolean> | null = null;

/** One explicit confirmation per start; no credential enters this component. */
export function confirmCloudRecording(status: AliyunStatus): Promise<boolean> {
  if (pending) return pending;
  pending = new Promise<boolean>(resolve => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;
    const finish = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      resolve(accepted); pending = null;
      queueMicrotask(() => { root.unmount(); host.remove(); });
    };
    root.render(<Dialog open onOpenChange={open => { if (!open) finish(false); }}>
      <DialogContent>
        <DialogTitle>Start cloud transcription?</DialogTitle>
        <DialogDescription>Your selected microphone and system audio will be streamed to Alibaba Cloud ({status.config.region === 'beijing' ? 'China · Beijing' : 'Singapore'}) throughout this recording. Usage is charged to your Bailian account.</DialogDescription>
        <p className="text-sm text-muted-foreground">A local audio recording will also be saved so you can recover text if the connection fails. Make sure participants know they are being recorded.</p>
        <DialogFooter><Button variant="outline" onClick={() => finish(false)}>Cancel</Button><Button onClick={() => finish(true)}>Agree & start recording</Button></DialogFooter>
      </DialogContent>
    </Dialog>);
  });
  return pending;
}
