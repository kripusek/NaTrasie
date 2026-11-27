import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const root = resolve('app/build/generated/web');
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/vehicles.pb') {
      const bucket = Math.floor(Date.now() / 30_000);
      const upstream = await fetch('https://mkuran.pl/gtfs/warsaw/vehicles.pb?t=' + bucket, {
        headers: { 'User-Agent': 'NaTrasie/1.0' }, signal: AbortSignal.timeout(12_000)
      });
      if (!upstream.ok) throw new Error('Feed unavailable');
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    const file = join(root, path === '/' ? 'index.html' : path);
    if (!file.startsWith(root + sep)) {
      response.writeHead(404).end();
      return;
    }
    const data = await readFile(file);
    response.writeHead(200, { 'Content-Type': (types[extname(file)] || 'text/plain') + (extname(file) === '.png' ? '' : '; charset=utf-8') });
    response.end(data);
  } catch (error) {
    if (!response.headersSent) response.writeHead(error.code === 'ENOENT' ? 404 : 503);
    response.end();
  }
}).listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173'));
