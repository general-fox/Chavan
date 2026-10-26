import { copyFile, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const destination = path.resolve(root, 'dist');
// Publish only runtime files. The source audit and imported response stay private.
const entries = ['index.html', 'styles.css', 'app.js', 'data/catalog.js', 'data/promotions.js', 'lib', 'assets', '.nojekyll'];

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function collect(relative) {
  const source = path.resolve(root, relative);
  if (!isInside(root, source)) throw new Error(`Source outside project: ${relative}`);
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Symbolic links are not published: ${relative}`);
  if (!isInside(root, await realpath(source))) throw new Error(`Source resolves outside project: ${relative}`);
  if (info.isDirectory()) {
    const children = await readdir(source);
    const files = [];
    for (const child of children.sort()) {
      if (child.startsWith('.')) continue;
      files.push(...await collect(path.join(relative, child)));
    }
    return files;
  }
  if (!info.isFile()) throw new Error(`Unsupported source file: ${relative}`);
  return [{ relative, bytes: info.size }];
}

async function build() {
  // Validate all required inputs before replacing a previous generated build.
  const files = (await Promise.all(entries.map(collect))).flat();
  if (path.dirname(destination) !== root || path.basename(destination) !== 'dist' || !isInside(root, destination)) {
    throw new Error('Refusing to replace a destination outside the generated dist folder.');
  }
  try {
    const info = await lstat(destination);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(destination) !== destination) {
      throw new Error('The generated dist path must be a regular directory inside this project.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const file of files) {
    const target = path.resolve(destination, file.relative);
    if (!isInside(destination, target)) throw new Error(`Invalid output path: ${file.relative}`);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.resolve(root, file.relative), target);
  }
  const megabytes = files.reduce((sum, file) => sum + file.bytes, 0) / 1024 / 1024;
  console.log(`Built ${files.length} files (${megabytes.toFixed(2)} MB) in dist/.`);
}

build().catch(error => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});
