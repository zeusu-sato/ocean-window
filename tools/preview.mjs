import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/ocean-window.js') {
      const config = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
      config.photos = JSON.parse(await fs.readFile(path.join(root, 'assets/photos.json'), 'utf8'));
      const source = await fs.readFile(path.join(root, 'src/wikimedia-source.js'), 'utf8');
      const js = await fs.readFile(path.join(root, 'src/ocean-window.js'), 'utf8');
      res.setHeader('Content-Type', types['.js']);
      res.end(`globalThis.__oceanWindowConfig = ${JSON.stringify(config)};\n${source}\n${js}`);
      return;
    }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/preview/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const content = await fs.readFile(file);
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(4179, '127.0.0.1', () => console.log('Ocean Window preview: http://127.0.0.1:4179'));
