import { isTauri } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { toast } from 'sonner';

/** Native desktop clipboard avoids WebKit user-activation expiry after async work. */
export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri()) {
    await writeText(text);
  } else {
    await navigator.clipboard.writeText(text);
  }
}

/** Event handlers must not leak a rejected clipboard promise or report false success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await writeClipboardText(text);
    return true;
  } catch {
    toast.error('Copy failed. Please try again or select the text and copy manually.');
    return false;
  }
}
