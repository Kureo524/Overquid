import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaults, generate, inOverquidWorkspace, isValidId, SDK_RANGE } from './generate.js';

const dirs = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'create-overlay-plugin-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('generate', () => {
  it('writes a plugin with its id and name', () => {
    const dir = join(temp(), 'weather');
    const files = generate({ dir, id: 'com.example.weather', name: 'Weather', workspace: false });
    expect(files).toEqual([
      '.gitignore',
      'README.md',
      'index.html',
      'manifest.json',
      'package.json',
      'src/main.ts',
      'src/style.css',
      'tsconfig.json',
      'vite.config.ts',
    ]);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      id: 'com.example.weather',
      name: 'Weather',
      permissions: ['storage'],
    });
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('com-example-weather');
    expect(pkg.dependencies['@overquid/sdk']).toBe(SDK_RANGE);
    expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).not.toContain('source');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('plugins/com.example.weather');
  });

  it('uses the workspace SDK, and its sources, inside the monorepo', () => {
    const dir = join(temp(), 'w');
    generate({ dir, id: 'com.example.w', name: 'W', workspace: true });
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@overquid/sdk']).toBe('workspace:*');
    expect(
      JSON.parse(readFileSync(join(dir, 'tsconfig.json'), 'utf8')).compilerOptions.customConditions,
    ).toEqual(['source']);
    expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toContain("conditions: ['source'");
  });

  it('refuses invalid ids and non-empty folders', () => {
    const dir = temp();
    expect(() =>
      generate({ dir: join(dir, 'a'), id: 'Com.Bad', name: 'A', workspace: false }),
    ).toThrow('invalid id');
    generate({ dir: join(dir, 'b'), id: 'com.example.b', name: 'B', workspace: false });
    expect(() =>
      generate({ dir: join(dir, 'b'), id: 'com.example.b', name: 'B', workspace: false }),
    ).toThrow('not empty');
  });

  it('keeps names from breaking the files', () => {
    const dir = join(temp(), 'x');
    generate({ dir, id: 'com.example.x', name: 'My "<b>" plugin', workspace: false });
    expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).name).toBe(
      'My b/ plugin'.replace('/', ''),
    );
  });
});

describe('defaults and checks', () => {
  it('derives an id and a name from the folder', () => {
    expect(defaults('my-weather_app')).toEqual({
      id: 'com.example.my-weather-app',
      name: 'My Weather App',
    });
  });

  it('accepts the ids the core accepts', () => {
    expect(isValidId('dev.overquid.notes')).toBe(true);
    for (const bad of ['', '.x', 'a..b', 'Upper', 'a/b', 'a#2']) expect(isValidId(bad)).toBe(false);
  });

  it('accepts the current SDK release', () => {
    const sdk = JSON.parse(readFileSync(new URL('../sdk/package.json', import.meta.url), 'utf8'));
    expect(SDK_RANGE).toBe(`^${sdk.version.split('.')[0]}`);
  });

  it('knows the monorepo', () => {
    expect(inOverquidWorkspace(new URL('.', import.meta.url).pathname)).toBe(true);
    expect(inOverquidWorkspace(tmpdir())).toBe(false);
  });
});
