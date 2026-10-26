import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const errors = [];
const checkedAssets = new Set();
let syntaxCount = 0;
let productCount = 0;

function fail(message) { errors.push(message); }

function inside(candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function walk(relative) {
  const absolute = path.resolve(root, relative);
  let info;
  try { info = await lstat(absolute); }
  catch { fail(`Missing required path: ${relative}`); return []; }
  if (info.isSymbolicLink()) { fail(`Symbolic link is not supported: ${relative}`); return []; }
  if (!info.isDirectory()) return [relative];
  const entries = await readdir(absolute);
  const result = [];
  for (const entry of entries.sort()) result.push(...await walk(path.join(relative, entry)));
  return result;
}

async function checkReference(reference, from, { allowDirectory = false } = {}) {
  const value = reference.trim().replaceAll('&amp;', '&');
  if (!value || value.startsWith('#') || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(value)) return;
  if (value.startsWith('/')) {
    fail(`${from}: use a relative URL for GitHub Pages: ${value}`);
    return;
  }
  let filename;
  try { filename = decodeURIComponent(value.split(/[?#]/, 1)[0]); }
  catch { fail(`${from}: invalid URL encoding: ${value}`); return; }
  const absolute = path.resolve(root, path.dirname(from), filename);
  if (!inside(absolute)) { fail(`${from}: reference leaves the project: ${value}`); return; }
  try {
    const resolved = await realpath(absolute);
    if (!inside(resolved)) throw new Error('outside project');
    const info = await stat(resolved);
    if (info.isDirectory() && allowDirectory) await stat(path.join(resolved, 'index.html'));
    else if (!info.isFile()) throw new Error('not a file');
    checkedAssets.add(path.relative(root, absolute));
  } catch {
    fail(`${from}: missing or invalid local file: ${value}`);
  }
}

async function checkSyntax(relative) {
  const result = spawnSync(process.execPath, ['--check', path.resolve(root, relative)], { encoding: 'utf8' });
  if (result.error || result.status !== 0) fail(`JavaScript syntax: ${relative}\n${result.error?.message ?? result.stderr.trim()}`);
  else syntaxCount += 1;
}

async function check() {
  const runtimeFiles = [
    ...await walk('app.js'),
    ...await walk('lib'),
    ...await walk('data/catalog.js'),
    ...await walk('scripts'),
  ].filter(file => /\.(?:m?js)$/.test(file));
  for (const file of runtimeFiles) await checkSyntax(file);

  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const ids = new Set();
  for (const match of html.matchAll(/\s+id\s*=\s*(["'])(.*?)\1/gi)) {
    if (ids.has(match[2])) fail(`Duplicate HTML id: ${match[2]}`);
    ids.add(match[2]);
  }
  for (const match of html.matchAll(/\s+(src|href|poster)\s*=\s*(["'])(.*?)\2/gi)) {
    const reference = match[3];
    if (reference.startsWith('#') && reference.length > 1 && !ids.has(reference.slice(1))) {
      fail(`index.html: missing anchor target ${reference}`);
    }
    await checkReference(reference, 'index.html', { allowDirectory: match[1].toLowerCase() === 'href' });
  }

  const styles = ['styles.css', ...await walk('assets')].filter(file => file.endsWith('.css'));
  for (const file of styles) {
    const css = (await readFile(path.join(root, file), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/gi)) {
      await checkReference(match[1] ?? match[2] ?? match[3], file);
    }
  }

  for (const file of runtimeFiles.filter(file => !file.startsWith(`scripts${path.sep}`))) {
    const source = await readFile(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.[^"']+)\1/g)) {
      await checkReference(match[2], file);
    }
  }

  try {
    const { products } = await import(pathToFileURL(path.join(root, 'data/catalog.js')).href);
    if (!Array.isArray(products) || products.length === 0) throw new Error('products must be a non-empty array');
    productCount = products.length;
    const productIds = new Set();
    for (const product of products) {
      if (productIds.has(String(product.id))) fail(`Duplicate catalog product id: ${product.id}`);
      productIds.add(String(product.id));
      if (typeof product.image !== 'string' || !product.image.trim()) {
        fail(`Product ${product.id}: missing image path`);
      } else if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(product.image)) {
        fail(`Product ${product.id}: image must be a bundled local file`);
      } else {
        // Catalog image URLs are resolved by the page, not by the catalog module.
        await checkReference(product.image, 'index.html');
      }
    }
  } catch (error) {
    fail(`Catalog: ${error.message}`);
  }

  if (errors.length) {
    console.error(`Check failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):\n- ${errors.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Check passed: ${syntaxCount} JavaScript files, ${productCount} product images, ${checkedAssets.size} local references, unique HTML ids.`);
  }
}

check().catch(error => {
  console.error(`Check failed: ${error.message}`);
  process.exitCode = 1;
});
