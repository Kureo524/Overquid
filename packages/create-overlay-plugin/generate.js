// Generates an Overquid plugin from ./template.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The SDK releases new plugins accept outside the Overquid monorepo: the
 * latest of the current major version.
 */
export const SDK_RANGE = '^0';

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), 'template');

/** Same rule as the core (`plugins::is_valid_id`): lowercase reverse DNS. */
export function isValidId(id) {
  return id.length > 0 && !id.startsWith('.') && !id.includes('..') && /^[a-z0-9._-]+$/.test(id);
}

/** `my-plugin` → `com.example.my-plugin`; `My Plugin` → `My Plugin`. */
export function defaults(folder) {
  const slug = basename(folder)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const name = basename(folder)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return { id: `com.example.${slug || 'plugin'}`, name: name || 'My plugin' };
}

/** Whether `dir` lies in the Overquid monorepo (it then uses the workspace SDK). */
export function inOverquidWorkspace(dir) {
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (
      existsSync(join(current, 'pnpm-workspace.yaml')) &&
      existsSync(join(current, 'packages', 'sdk', 'package.json'))
    ) {
      return true;
    }
    if (dirname(current) === current) return false;
  }
}

function tsconfig(workspace) {
  const options = {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    types: ['vite/client'],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  // In the monorepo, the SDK resolves to its sources (no build needed).
  if (workspace) options.customConditions = ['source'];
  return `${JSON.stringify({ compilerOptions: options, include: ['src', 'vite.config.ts'] }, null, 2)}\n`;
}

function viteConfig(workspace) {
  const conditions = workspace
    ? "\n  resolve: { conditions: ['source', ...defaultClientConditions] },"
    : '';
  const imports = workspace ? 'defaultClientConditions, defineConfig' : 'defineConfig';
  return `import { ${imports} } from 'vite';

// Overquid serves the plugin from its own folder: relative URLs only.
export default defineConfig({
  base: './',${conditions}
  build: { target: 'es2022', outDir: 'dist' },
});
`;
}

/**
 * Writes a plugin in `dir` (which must not exist or be empty). Returns the
 * files written, relative to `dir`.
 */
export function generate({ dir, id, name, workspace }) {
  if (!isValidId(id)) {
    throw new Error(
      `invalid id "${id}": use lowercase letters, digits, dots, - and _ (com.example.notes)`,
    );
  }
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`${dir} is not empty`);
  }
  const values = {
    id,
    name: name.replace(/["\\<>]/g, ''),
    package: id.replace(/[^a-z0-9-]+/g, '-'),
    sdk: workspace ? 'workspace:*' : SDK_RANGE,
  };
  const written = [];
  const copy = (from, to) => {
    for (const entry of readdirSync(from)) {
      const source = join(from, entry);
      // npm drops dotfiles and renames .gitignore: the template keeps it as _gitignore.
      const target = join(to, entry === '_gitignore' ? '.gitignore' : entry);
      if (statSync(source).isDirectory()) {
        copy(source, target);
        continue;
      }
      const text = readFileSync(source, 'utf8').replace(
        /\{\{(\w+)\}\}/g,
        (match, key) => values[key] ?? match,
      );
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
      written.push(target.slice(dir.length + 1));
    }
  };
  copy(TEMPLATE, dir);
  writeFileSync(join(dir, 'tsconfig.json'), tsconfig(workspace));
  writeFileSync(join(dir, 'vite.config.ts'), viteConfig(workspace));
  written.push('tsconfig.json', 'vite.config.ts');
  return written.sort();
}
