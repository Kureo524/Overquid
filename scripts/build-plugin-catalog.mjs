#!/usr/bin/env node
// Builds the plugin catalog (ADR 0009) from the plugins already built by
// `pnpm build`: one folder per plugin (manifest and dist/) and an index.json
// listing their files with hashes.
//
//   node scripts/build-plugin-catalog.mjs <output folder>

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX_VERSION = 1;
/** Development helpers, not for users. */
const EXCLUDED = new Set(['dev.overquid.sdk-demo', 'dev.overquid.isolation-check']);

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2];
if (!output) {
  console.error('usage: build-plugin-catalog.mjs <output folder>');
  process.exit(2);
}

function filesIn(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

const plugins = [];
const source = join(repo, 'plugins');
for (const id of readdirSync(source).sort()) {
  if (EXCLUDED.has(id)) continue;
  const manifest = JSON.parse(readFileSync(join(source, id, 'manifest.json'), 'utf8'));
  if (manifest.id !== id) throw new Error(`${id}: manifest id is ${manifest.id}`);

  const target = join(output, id);
  mkdirSync(target, { recursive: true });
  cpSync(join(source, id, 'manifest.json'), join(target, 'manifest.json'));
  if (manifest.entry) {
    const dist = join(source, id, 'dist');
    if (!existsSync(dist)) throw new Error(`${id}: run "pnpm build" first`);
    cpSync(dist, join(target, 'dist'), { recursive: true });
  }

  const files = filesIn(target).map((path) => ({
    path: relative(target, path).split(sep).join('/'),
    size: statSync(path).size,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  }));
  plugins.push({ manifest, files });
}

writeFileSync(join(output, 'index.json'), JSON.stringify({ version: INDEX_VERSION, plugins }));
console.log(`catalog: ${plugins.length} plugins in ${output}`);
