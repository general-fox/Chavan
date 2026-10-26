import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 4173);
const publicFiles = new Set(['index.html', 'styles.css', 'app.js']);
const publicFolders = new Set(['assets', 'data', 'lib']);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function allowed(relative) {
  const parts = relative.split(/[\\/]/);
  if (!relative || parts.some(part => !part || part.startsWith('.'))) return false;
  return parts.length === 1 ? publicFiles.has(parts[0]) : publicFolders.has(parts[0]);
}

function reply(response, status, message, method = 'GET', extra = {}) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  response.end(method === 'HEAD' ? undefined : message);
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer from 1 to 65535.');
  process.exitCode = 1;
} else {
  const server = createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    if (!['GET', 'HEAD'].includes(method)) {
      reply(response, 405, 'Method not allowed', method, { Allow: 'GET, HEAD' });
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent((request.url ?? '/').split(/[?#]/, 1)[0]);
    } catch {
      reply(response, 400, 'Invalid URL', method);
      return;
    }
    // Inspect the original decoded path before URL normalization can hide traversal.
    if (!pathname.startsWith('/') || pathname.includes('\\') || /[\0-\x1f\x7f]/.test(pathname)
      || pathname.split('/').some(part => part.startsWith('.'))) {
      reply(response, 403, 'Forbidden', method);
      return;
    }
    if (pathname === '/Chavan') {
      reply(response, 301, 'Use /Chavan/', method, { Location: '/Chavan/' });
      return;
    }
    if (pathname.startsWith('/Chavan/')) pathname = pathname.slice('/Chavan'.length);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!allowed(relative)) {
      reply(response, 404, 'Not found', method);
      return;
    }
    try {
      const candidate = path.resolve(root, relative);
      const resolved = await realpath(candidate);
      const canonicalRelative = path.relative(root, resolved);
      if (path.isAbsolute(canonicalRelative) || !allowed(canonicalRelative)) {
        reply(response, 403, 'Forbidden', method);
        return;
      }
      const info = await stat(resolved);
      if (!info.isFile()) {
        reply(response, 404, 'Not found', method);
        return;
      }
      response.writeHead(200, {
        'Content-Type': types[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (method === 'HEAD') response.end();
      else {
        const stream = createReadStream(resolved);
        stream.on('error', () => response.destroy());
        response.on('close', () => stream.destroy());
        stream.pipe(response);
      }
    } catch (error) {
      const missing = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code);
      reply(response, missing ? 404 : 500, missing ? 'Not found' : 'Unable to read file', method);
    }
  });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set PORT to another port.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`Local site: http://${host}:${port}/`);
    console.log(`GitHub Pages path preview: http://${host}:${port}/Chavan/`);
  });
}
