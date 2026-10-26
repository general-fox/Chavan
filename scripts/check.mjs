import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const errors = [];
const checkedAssets = new Set();
const checkedSyntax = new Set();
let syntaxCount = 0;
let productCount = 0;
let promotionCount = 0;

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
    const relative = path.relative(root, absolute);
    checkedAssets.add(relative);
    return relative;
  } catch {
    fail(`${from}: missing or invalid local file: ${value}`);
  }
}

async function checkSyntax(relative) {
  if (checkedSyntax.has(relative)) return;
  checkedSyntax.add(relative);
  const result = spawnSync(process.execPath, ['--check', path.resolve(root, relative)], { encoding: 'utf8' });
  if (result.error || result.status !== 0) fail(`JavaScript syntax: ${relative}\n${result.error?.message ?? result.stderr.trim()}`);
  else syntaxCount += 1;
}

async function checkModuleImports(relative, visited) {
  if (visited.has(relative)) return;
  visited.add(relative);
  const source = await readFile(path.join(root, relative), 'utf8');
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.[^"']+)\1/g)) {
    const target = await checkReference(match[2], relative);
    if (target && /\.(?:m?js)$/.test(target)) {
      await checkSyntax(target);
      await checkModuleImports(target, visited);
    }
  }
}

async function checkPromotions(products) {
  try {
    const { dishOfDayIds, promotions } = await import(pathToFileURL(path.join(root, 'data/promotions.js')).href);
    if (!Array.isArray(dishOfDayIds)) throw new Error('dishOfDayIds must be an array');
    if (!Array.isArray(promotions) || promotions.length === 0) throw new Error('promotions must be a non-empty array');
    const productById = new Map(products.map(product => [String(product.id), product]));
    const dailyIds = dishOfDayIds.map(String);
    if (dailyIds.length !== 4 || new Set(dailyIds).size !== 4) {
      fail('Dishes of the day: expected four unique product ids');
    }
    for (const id of dailyIds) {
      const product = productById.get(id);
      if (!product) fail(`Dish of the day: unknown catalog product ${id}`);
      else if (!Number.isFinite(product.oldPrice) || !Number.isFinite(product.price) || product.oldPrice <= product.price) {
        fail(`Dish of the day ${id}: must have a valid discounted price`);
      }
    }
    const promotionIds = new Set();
    promotionCount = promotions.length;
    for (const promotion of promotions) {
      if (!promotion.id || promotionIds.has(promotion.id)) fail(`Missing or duplicate promotion id: ${promotion.id}`);
      promotionIds.add(promotion.id);
      if (!Array.isArray(promotion.productIds)) fail(`Promotion ${promotion.id}: productIds must be an array`);
      else for (const id of promotion.productIds) {
        if (!productById.has(String(id))) fail(`Promotion ${promotion.id}: unknown catalog product ${id}`);
      }
      if (promotion.image) {
        if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(promotion.image)) fail(`Promotion ${promotion.id}: image must be a bundled local file`);
        else await checkReference(promotion.image, 'index.html');
      }
    }
  } catch (error) {
    fail(`Promotions: ${error.message}`);
  }
}

async function check() {
  const runtimeFiles = [
    ...await walk('app.js'),
    ...await walk('lib'),
    ...await walk('data'),
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

  const visitedModules = new Set();
  for (const file of runtimeFiles.filter(file => !file.startsWith(`scripts${path.sep}`))) {
    await checkModuleImports(file, visitedModules);
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
    await checkPromotions(products);
  } catch (error) {
    fail(`Catalog: ${error.message}`);
  }

  if (errors.length) {
    console.error(`Check failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):\n- ${errors.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Check passed: ${syntaxCount} JavaScript files, ${productCount} product images, ${promotionCount} promotions, ${checkedAssets.size} local references, unique HTML ids.`);
  }
}

check().catch(error => {
  console.error(`Check failed: ${error.message}`);
  process.exitCode = 1;
});
