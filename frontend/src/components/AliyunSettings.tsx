import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { AliyunConfig, AliyunStatus, ALIYUN_MODELS, ALIYUN_LIVE_MODELS } from '../lib/aliyun';

type Action = 'save' | 'test' | 'remove' | 'reload';

export function AliyunSettings({ call = invoke }: { call?: typeof invoke } = {}) {
  const [saved, setSaved] = useState<AliyunStatus | null>(null);
  const [config, setConfig] = useState<AliyunConfig | null>(null);
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Action | null>(null);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = async () => {
    const status = await call<AliyunStatus>('aliyun_status');
    setSaved(status);
    setConfig(status.config);
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    call<AliyunStatus>('aliyun_status').then(status => {
      if (active) { setSaved(status); setConfig(status.config); }
    }).catch(e => { if (active) setError(String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [call]);

  const action = async (name: Action, fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(name); setError(''); setMessage('');
    try { await fn(); } catch (e) { setError(String(e)); }
    finally { inFlight.current = false; setPending(null); }
  };
  const dirty = !!config && (JSON.stringify(config) !== JSON.stringify(saved?.config) || !!key.trim());
  const hasSavedKey = !!saved?.has_key && saved.config.region === config?.region;
  const busy = pending !== null;
  const update = (patch: Partial<AliyunConfig>) => {
    if (config) setConfig({ ...config, ...patch });
    setMessage(''); setError('');
  };
  const save = async () => {
    await call('aliyun_save_config', { config, apiKey: key.trim() || null });
    setKey('');
    await refresh();
  };

  return <section className="space-y-5" aria-label="Alibaba Cloud settings" aria-busy={loading || busy}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-lg font-semibold">Alibaba Cloud</h3>
        <p className="mt-1 text-sm text-muted-foreground">Transcribe recordings and audio files with your own Bailian account.</p>
      </div>
      <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">Cloud ASR</span>
    </div>
    {loading ? <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />Loading cloud settings…</p>
      : !config ? <Button disabled={busy} variant="outline" onClick={() => action('reload', refresh)}>Reload cloud settings</Button>
      : <fieldset disabled={busy} className="min-w-0 space-y-5">
        <div className="divide-y rounded-lg border bg-card">
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="space-y-1">
              <Label htmlFor="aliyun-enabled">Enable cloud transcription</Label>
              <p id="aliyun-enabled-hint" className="text-sm text-muted-foreground">Make cloud models available when importing audio.</p>
            </div>
            <Switch id="aliyun-enabled" disabled={busy} aria-describedby="aliyun-enabled-hint" checked={config.enabled} onCheckedChange={enabled => update({ enabled, default_for_files: enabled && config.default_for_files })} />
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="space-y-1">
              <Label htmlFor="aliyun-default">Default for file imports</Label>
              <p id="aliyun-default-hint" className="text-sm text-muted-foreground">Each upload still needs your confirmation. The live recording choice below is independent.</p>
            </div>
            <Switch id="aliyun-default" disabled={busy || !config.enabled} aria-describedby="aliyun-default-hint" checked={config.default_for_files} onCheckedChange={default_for_files => update({ default_for_files })} />
          </div>
        </div>
        <div className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1"><Label htmlFor="aliyun-live">Use cloud for live recording</Label><p className="text-sm text-muted-foreground">Off: use your selected local model. On: stream audio after confirming each recording.</p></div>
            <Switch id="aliyun-live" disabled={busy} checked={!!config.live_enabled} onCheckedChange={live_enabled => update({live_enabled})} />
          </div>
          {config.live_enabled && <div className="space-y-2">
            <Label htmlFor="aliyun-live-model">Live transcription model</Label>
            <Select disabled={busy} value={config.live_model || ALIYUN_LIVE_MODELS[0]} onValueChange={live_model => update({live_model})}>
              <SelectTrigger id="aliyun-live-model"><SelectValue /></SelectTrigger>
              <SelectContent>{ALIYUN_LIVE_MODELS.map((m, i) => <SelectItem key={m} value={m}>{i === 0 ? 'Qwen ASR 3.1 Streaming' : 'Qwen ASR 3.0 Streaming'}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Automatic language detection. Local audio is always saved for recovery. Connection testing below checks file upload access; live model access is checked when recording starts.</p>
          </div>}
        </div>
        <div className="space-y-5 rounded-lg border bg-card p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="aliyun-region">Account region</Label>
              <Select disabled={busy} value={config.region} onValueChange={region => { update({ region }); setKey(''); }}>
                <SelectTrigger id="aliyun-region"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="beijing">China (Beijing)</SelectItem><SelectItem value="singapore">Singapore</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="aliyun-model">File transcription model</Label>
              <Select disabled={busy} value={config.model} onValueChange={model => update({ model })}>
                <SelectTrigger id="aliyun-model"><SelectValue /></SelectTrigger>
                <SelectContent>{ALIYUN_MODELS.map(m => <SelectItem key={m} value={m}>{m.includes('3.1') ? 'Qwen ASR 3.1' : 'Qwen ASR 3.0'}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="aliyun-key">API Key</Label>
              {hasSavedKey && <span className="flex items-center gap-1 text-xs text-green-700"><Check className="h-3.5 w-3.5" />Saved on this device</span>}
            </div>
            <Input id="aliyun-key" type="password" autoComplete="off" spellCheck={false} aria-describedby="aliyun-key-hint" value={key} onChange={e => { setKey(e.target.value); setMessage(''); setError(''); }} placeholder={hasSavedKey ? 'Leave blank to keep your saved key' : 'Enter your Bailian API Key'} />
            <p id="aliyun-key-hint" className="text-xs text-muted-foreground">Stored in your system credential store, never displayed. Each region has a separate key.</p>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="aliyun-dialect">Preserve dialect wording</Label>
              <p id="aliyun-dialect-hint" className="text-sm text-muted-foreground">{'Applies to Qwen ASR 3.1 file and live models. Keep Cantonese phrasing instead of standardizing it.'}</p>
            </div>
            <Switch id="aliyun-dialect" disabled={busy || (!config.model.includes('3.1') && !(config.live_enabled && (config.live_model || ALIYUN_LIVE_MODELS[0]).includes('3.1')))} aria-describedby="aliyun-dialect-hint" checked={config.keep_dialect && (config.model.includes('3.1') || !!(config.live_enabled && (config.live_model || ALIYUN_LIVE_MODELS[0]).includes('3.1')))} onCheckedChange={keep_dialect => update({ keep_dialect })} />
          </div>
          <details className="text-sm">
            <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Advanced settings</summary>
            <div className="mt-3 space-y-2">
              <Label htmlFor="aliyun-workspace">Workspace ID (optional)</Label>
              <Input id="aliyun-workspace" value={config.workspace} onChange={e => update({ workspace: e.target.value.trim() })} placeholder="Leave empty for the default workspace" />
            </div>
          </details>
        </div>
        <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
          <p className="font-medium">File uploads · Development preview</p>
          <p>Selected audio is sent to Alibaba Cloud. Temporary uploads expire within 48 hours; charges apply to your account. Only the first audio track is transcribed.</p>
          <p className="text-xs">This temporary upload method must be replaced before production release.</p>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button data-action="save" disabled={busy || !dirty} onClick={() => action('save', async () => { await save(); setMessage('Settings saved. Your recording and file preferences have been saved.'); })}>
              {pending === 'save' && <Loader2 className="animate-spin motion-reduce:animate-none" />}{pending === 'save' ? 'Saving…' : 'Save settings'}
            </Button>
            <Button data-action="test" variant="outline" disabled={busy || (!hasSavedKey && !key.trim())} onClick={() => action('test', async () => { if (dirty) await save(); setMessage(await call<string>('aliyun_test_connection')); })}>
              {pending === 'test' && <Loader2 className="animate-spin motion-reduce:animate-none" />}{pending === 'test' ? 'Testing…' : dirty ? 'Save & test connection' : 'Test connection'}
            </Button>
            <Button data-action="remove" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={busy || dirty || !hasSavedKey} onClick={() => action('remove', async () => { await call('aliyun_delete_key'); setKey(''); await refresh(); setMessage('API Key removed. Cloud file and live transcription are disabled.'); })}>
              {pending === 'remove' ? 'Removing…' : 'Remove key'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Connection testing checks upload access. It does not send audio or run transcription.</p>
        </div>
      </fieldset>}
    <div aria-live="polite" className="text-sm">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
      {message && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-green-800">{message}</p>}
    </div>
  </section>;
}
