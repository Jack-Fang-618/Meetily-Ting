// Local-only static frontend for the desktop launcher. No HMR or cold page compilation.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.txt':'text/plain; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.woff2':'font/woff2' };
export function desktopServer(root) {
  const base = resolve(root);
  return createServer(async (req, res) => {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const target = resolve(base, '.' + pathname);
      if (target !== base && !target.startsWith(base + sep)) { res.writeHead(403).end(); return; }
      const candidates = pathname.endsWith('/') ? [resolve(target, 'index.html')] : [target, target + '.html', resolve(target, 'index.html')];
      let file;
      for (const candidate of candidates) {
        if ((await stat(candidate).catch(() => null))?.isFile()) { file = candidate; break; }
      }
      if (!file) { res.writeHead(404).end('Not found'); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(400).end('Bad request'); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../out/', import.meta.url));
  await stat(resolve(root, 'index.html')); // Fail clearly if frontend build is missing.
  desktopServer(root).listen(3118, '127.0.0.1', () => console.log('Ting built frontend: http://127.0.0.1:3118'));
}
