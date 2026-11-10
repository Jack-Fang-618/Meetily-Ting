import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

import { AliyunConfig, AliyunStatus, ALIYUN_MODELS } from '../lib/aliyun';

export function AliyunSettings({ call = invoke }: { call?: typeof invoke } = {}) {
  const [saved, setSaved] = useState<AliyunStatus | null>(null);
  const [config, setConfig] = useState<AliyunConfig | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = async () => { const s = await call<AliyunStatus>('aliyun_status'); setSaved(s); setConfig(s.config); };
  useEffect(() => { refresh().catch(e => setError(String(e))); }, [call]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); } catch(e) { setError(String(e)); } finally { setBusy(false); }
  };
  const dirty = !!config && (JSON.stringify(config) !== JSON.stringify(saved?.config) || !!key);
  return <section className="mt-8 space-y-4 border-t pt-6">
    <div><h3 className="text-lg font-semibold">Alibaba Cloud · File transcription</h3>
      <p className="text-sm text-gray-600">Optional. Use your own Bailian API Key and account. Live recording continues to use your local model.</p></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!config ? <Button disabled={busy} variant="outline" onClick={() => action(refresh)}>Reload cloud settings</Button> : <fieldset disabled={busy} className="space-y-4">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.enabled} onChange={e => setConfig({...config, enabled:e.target.checked})} />Enable cloud models in Import Audio</label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="aliyun-region">Account region</Label><select id="aliyun-region" className="w-full rounded-md border bg-transparent p-2" value={config.region} onChange={e => { setConfig({...config, region:e.target.value}); setKey(''); setMessage(''); }}>
          <option value="beijing">China (Beijing)</option><option value="singapore">Singapore</option>
        </select></div>
        <div><Label htmlFor="aliyun-workspace">Workspace ID (optional)</Label><Input id="aliyun-workspace" value={config.workspace} onChange={e => setConfig({...config,workspace:e.target.value.trim()})} placeholder="Leave empty to use the regional endpoint" /></div>
      </div>
      <div><Label htmlFor="aliyun-model">Preferred file model</Label><select id="aliyun-model" className="w-full rounded-md border bg-transparent p-2" value={config.model} onChange={e => setConfig({...config,model:e.target.value})}>
        {ALIYUN_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
      </select></div>
      <div><Label htmlFor="aliyun-key">Your API Key</Label><Input id="aliyun-key" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={saved?.has_key && saved.config.region === config.region ? 'Saved securely · leave blank to keep' : 'Enter your own Bailian API Key'} />
        <p className="mt-1 text-xs text-gray-500">Saved in your operating system credential store. Existing keys are never displayed. Each region uses its own key.</p></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.keep_dialect} onChange={e => setConfig({...config,keep_dialect:e.target.checked})} />Preserve dialect wording (3.1 only; recommended for Cantonese)</label>
      <p className="text-sm text-gray-600">Development preview: selected audio is uploaded to Alibaba Cloud temporary storage and expires within 48 hours. Charges apply to your account. This upload method is not intended for production deployment. The first audio track is transcribed.</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => action(async () => { await call('aliyun_save_config',{config,apiKey:key || null}); setKey(''); await refresh(); setMessage('Cloud settings saved. Select a cloud model explicitly when importing audio.'); })}>Save cloud settings</Button>
        <Button variant="outline" disabled={busy || dirty || !saved?.has_key} onClick={() => action(async () => { setMessage(await call<string>('aliyun_test_connection')); })}>Test saved connection</Button>
        <Button variant="outline" disabled={busy || dirty || !saved?.has_key} onClick={() => action(async () => { await call('aliyun_delete_key'); setKey(''); await refresh(); setMessage('API Key removed; cloud import disabled.'); })}>Remove saved key</Button>
      </div>
      <p className="text-xs text-gray-500">Connection test requests upload access only; it does not upload audio or run transcription. Save changes before testing.</p>
    </fieldset>}
    {busy && <p role="status" className="text-sm">Working…</p>}
    {message && <p role="status" className="text-sm text-gray-700">{message}</p>}
  </section>;
}
