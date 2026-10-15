/* Copy the parts of the Oaken Tower Fan Hub that the overlay uses (simulator, game data, overlay view,
 * item pictures) into shared/. Only files the tool really imports are copied, following the imports.
 *
 *   HUB_DIR=../oaken-tower-hub npm run sync
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hub = path.resolve(here, process.env.HUB_DIR || '../oaken-tower-hub');
if (!fs.existsSync(path.join(hub, 'src'))) {
  console.error('Hub not found at ' + hub + ' (set HUB_DIR).');
  process.exit(1);
}
const shared = path.join(here, 'shared');
const IMPORT = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|new URL\(\s*['"]([^'"]+)['"]/g;

const resolve = (file, spec) => resolveAbs(path.resolve(path.dirname(file), spec));
function resolveAbs(base) {
  for (const c of [base, base + '.ts', path.join(base, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

/** the tool's own files: their imports into shared/src are the start */
const start = [];
const walkDir = (d) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walkDir(p);
    else if (/\.ts$/.test(f.name)) start.push(p);
  }
};
walkDir(path.join(here, 'renderer'));
walkDir(path.join(here, 'tests'));

// start clean, so files the tool no longer needs go away
fs.rmSync(path.join(shared, 'src'), { recursive: true, force: true });
const copied = new Set();
const todo = [];
for (const f of start) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(IMPORT)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec.startsWith('.')) continue;
    const target = path.resolve(path.dirname(f), spec);
    const rel = path.relative(shared, target);
    if (rel.startsWith('..')) continue;
    todo.push(path.join(hub, rel));
  }
}
while (todo.length) {
  const raw = todo.pop();
  const src = resolveAbs(raw);
  if (!src || copied.has(src)) continue;
  copied.add(src);
  const dst = path.join(shared, path.relative(hub, src));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  if (!/\.(ts|css)$/.test(src)) continue;
  for (const m of fs.readFileSync(src, 'utf8').matchAll(IMPORT)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec.startsWith('.')) continue;
    const r = resolve(src, spec);
    if (r) todo.push(r);
    else console.warn('not found: ' + spec + ' in ' + path.relative(hub, src));
  }
}

// item, perk and slot pictures
fs.rmSync(path.join(shared, 'public'), { recursive: true, force: true });
fs.cpSync(path.join(hub, 'public', 'img'), path.join(shared, 'public', 'img'), { recursive: true });

console.log('Copied ' + copied.size + ' files and the pictures from ' + hub);
