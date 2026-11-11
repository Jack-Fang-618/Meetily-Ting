'use client';
import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { CaptionWindow } from '@/components/CaptionWindow';

export default function CaptionsPage() {
  const [visible, setVisible] = useState(true);
  const [session, setSession] = useState(0);
  useEffect(() => {
    const window = getCurrentWindow();
    let disposed = false;
    let receivedEvent = false;
    const subscription = window.listen<boolean>('caption-visibility', ({payload}) => {
      if (disposed) return;
      receivedEvent = true;
      if (!payload) setSession(value => value + 1);
      setVisible(payload);
    });
    void subscription.then(async () => {
      const current = await window.isVisible();
      if (!disposed && !receivedEvent) setVisible(current);
    }).catch(() => {});
    return () => { disposed = true; void subscription.then(stop => stop()).catch(() => {}); };
  }, []);
  return visible ? <CaptionWindow key={session}/> : null;
}
