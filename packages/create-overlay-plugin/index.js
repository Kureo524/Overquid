#!/usr/bin/env node
// create-overlay-plugin [folder] [--id com.example.x] [--name "My plugin"]

import { resolve } from 'node:path';
import { defaults, generate, inOverquidWorkspace } from './generate.js';

const args = process.argv.slice(2);
const option = (flag) => {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const [value] = args.splice(index, 2).slice(1);
  return value;
};
const id = option('--id');
const name = option('--name');
const folder = args[0];

if (!folder || folder.startsWith('-')) {
  console.log('Usage: create-overlay-plugin <folder> [--id com.example.notes] [--name "Notes"]');
  process.exit(folder ? 1 : 0);
}

const dir = resolve(folder);
const fallback = defaults(folder);
const workspace = inOverquidWorkspace(dir);
try {
  const files = generate({ dir, id: id ?? fallback.id, name: name ?? fallback.name, workspace });
  console.log(`Created ${id ?? fallback.id} in ${dir}:`);
  for (const file of files) console.log(`  ${file}`);
  console.log(`
Next:
  cd ${folder}
  ${workspace ? 'pnpm install' : 'npm install'}
  ${workspace ? 'pnpm build' : 'npm run build'}
Then copy the folder (manifest.json and dist/) into ~/.local/share/dev.overquid.app/plugins/${id ?? fallback.id}/
and restart Overquid. See README.md.`);
} catch (error) {
  console.error(`create-overlay-plugin: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
