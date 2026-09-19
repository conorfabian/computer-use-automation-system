import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function startDemo(port = 3000) {
  const root = new URL('./public/', import.meta.url);
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const files: Record<string, [string, string]> = {
      '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
    };
    const pages = ['/', '/search', '/results', '/details', '/savings', '/review', '/created', '/locked'];
    const asset = files[path] ?? (pages.includes(path) ? ['index.html', 'text/html'] : undefined);
    if (req.method !== 'GET' || !asset) { res.writeHead(404).end(); return; }
    try {
      res.writeHead(200, { 'Content-Type': asset[1]!, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'" });
      res.end(await readFile(new URL(asset[0]!, root)));
    } catch { res.writeHead(500).end('Demo unavailable'); }
  });
  return new Promise<ReturnType<typeof createServer>>(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  await startDemo(port);
  console.log(`Demo: http://127.0.0.1:${port}/search`);
}
