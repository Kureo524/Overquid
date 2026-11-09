// Builds the scriptlet resources of the content filter (ADR 0005) from
// uBlock Origin's source, for Brave's engine (adblock-rust).
//
// Filter lists say what to inject (`youtube.com##+js(json-prune, …)`); these
// resources are the injected code. uBlock Origin keeps them as ES modules,
// which only JavaScript can read, so this runs at build time, like Brave's
// adblock-resources. The tag and the archive's SHA-256 are pinned.
//
// uBlock Origin is GPL-3.0: the resulting file is shipped as a separate,
// unmodified data file, with its source at the URL below.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TAG = '1.76.0';
const SHA256 = '3c74919a7763be38b9592104e23d3b8dde02af7dffbaaf1ba280de86e89350e3';
const ARCHIVE = `https://codeload.github.com/gorhill/uBlock/tar.gz/refs/tags/${TAG}`;

/** Permission bit uBlock Origin's own lists get: they may use trusted scriptlets. */
const TRUSTED = 1;

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, '..', 'src-tauri', 'resources', 'ubo-scriptlets.json');

function current() {
  try {
    return JSON.parse(readFileSync(output, 'utf8')).tag === TAG;
  } catch {
    return false;
  }
}

if (current()) process.exit(0);

try {
  // Offline builds, or builds that must not run uBlock Origin's code.
  if (process.env.OVERQUID_SKIP_SCRIPTLETS) throw new Error('skipped (OVERQUID_SKIP_SCRIPTLETS)');
  await build();
} catch (error) {
  // Offline build: the content filter still blocks requests and hides
  // elements, without scriptlets. The bundle needs the file to exist.
  console.warn(`ubo-scriptlets: ${error instanceof Error ? error.message : String(error)}`);
  if (!existsSync(output)) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify({ tag: null, source: ARCHIVE, resources: [] }));
  }
}

async function build() {
  const response = await fetch(ARCHIVE);
  if (!response.ok) throw new Error(`${ARCHIVE}: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(archive).digest('hex');
  if (digest !== SHA256) throw new Error(`${ARCHIVE}: SHA-256 ${digest}, expected ${SHA256}`);

  const work = mkdtempSync(join(tmpdir(), 'ubo-'));
  try {
    const tar = spawnSync('tar', ['-xz', '-C', work, '--wildcards', '*/src/js/*'], {
      input: archive,
    });
    if (tar.status !== 0) throw new Error(`tar: ${tar.stderr.toString()}`);
    const scriptlets = join(work, `uBlock-${TAG}`, 'src', 'js', 'resources', 'scriptlets.js');
    if (!existsSync(scriptlets)) throw new Error(`${scriptlets} not found`);

    const { builtinScriptlets } = await import(pathToFileURL(scriptlets).href);
    const resources = builtinScriptlets.map((scriptlet) => ({
      name: scriptlet.name,
      aliases: scriptlet.aliases ?? [],
      // `.fn` entries are helpers, only injected as dependencies.
      kind: { mime: scriptlet.name.endsWith('.fn') ? 'fn/javascript' : 'application/javascript' },
      content: Buffer.from(scriptlet.fn.toString()).toString('base64'),
      dependencies: scriptlet.dependencies ?? [],
      permission: scriptlet.requiresTrust ? TRUSTED : 0,
    }));

    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify({ tag: TAG, source: ARCHIVE, resources }));
    console.log(`ubo-scriptlets: ${resources.length} scriptlets from uBlock Origin ${TAG}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
