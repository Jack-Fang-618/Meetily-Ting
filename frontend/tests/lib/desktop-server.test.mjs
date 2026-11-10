import { test, expect } from 'bun:test';
import { desktopServer } from '../../scripts/serve-desktop.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('built desktop frontend serves pages and chunks without SPA fallbacks for missing scripts', async () => {
  const root = await mkdtemp(join(tmpdir(),'ting-preview-'));
  await writeFile(join(root,'index.html'),'<main>Ready</main>');
  await writeFile(join(root,'settings.html'),'<main>Settings</main>');
  await writeFile(join(root,'chunk.js'),'window.ready=true');
  const server = desktopServer(root);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    expect(await (await fetch(base)).text()).toContain('Ready');
    expect(await (await fetch(base+'/settings')).text()).toContain('Settings');
    expect((await fetch(base+'/chunk.js')).headers.get('content-type')).toContain('javascript');
    expect((await fetch(base+'/missing.js')).status).toBe(404);
    expect((await fetch(base+'/%2e%2e%2foutside')).status).toBe(403);
    expect((await fetch(base+'/%E0%A4%A')).status).toBe(400);
    expect((await fetch(base,{method:'POST'})).status).toBe(405);
    expect(await (await fetch(base,{method:'HEAD'})).text()).toBe('');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root,{recursive:true});
  }
});
