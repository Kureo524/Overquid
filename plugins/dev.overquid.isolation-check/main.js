// Isolation check (ADR 0003, #21): everything a plugin can try from the inside.
// Talks the raw protocol on purpose, without the SDK.
// Each one states what must happen for the isolation model to hold.

async function tryFetch(url) {
  try {
    const response = await fetch(url);
    return `reached (${response.status})`;
  } catch {
    return 'blocked';
  }
}

let nextId = 1;
const pending = new Map();
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.data?.overquid !== 1) return;
  const { id, result, error } = event.data;
  pending.get(id)?.({ result, error });
  pending.delete(id);
});
const call = (method, args) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    window.parent.postMessage({ overquid: 1, id, method, args }, '*');
  });

const checks = [];
const check = (name, actual, expected) => checks.push({ name, actual, pass: actual === expected });

check('ES module loaded', 'yes', 'yes');
check('Tauri IPC object', typeof window.__TAURI_INTERNALS__, 'undefined');
let parentDom;
try {
  parentDom = window.parent.document ? 'accessible' : 'blocked';
} catch {
  parentDom = 'blocked';
}
check('Parent DOM', parentDom, 'blocked');
let storage;
try {
  storage = typeof window.localStorage.length === 'number' ? 'accessible' : 'blocked';
} catch {
  storage = 'blocked';
}
check('localStorage', storage, 'blocked');
check(
  'fetch declared domain',
  (await tryFetch('https://api.github.com/zen')).slice(0, 7),
  'reached',
);
check('fetch other domain', await tryFetch('https://example.com/'), 'blocked');
check('fetch Tauri IPC (ipc://)', await tryFetch('ipc://localhost/overlay_status'), 'blocked');
check('fetch Tauri IPC (http)', await tryFetch('http://ipc.localhost/overlay_status'), 'blocked');
check('fetch app files', await tryFetch('tauri://localhost/index.html'), 'blocked');
check('fetch outside folder', await tryFetch('../dev.overquid.other/manifest.json'), 'blocked');

// Opaque origin: WebKit only loads our protocol's files in CORS mode, so the
// <link> needs `crossorigin` (without it the stylesheet is silently dropped).
check(
  'Stylesheet (crossorigin)',
  document.styleSheets.length > 0 ? 'loaded' : 'not loaded',
  'loaded',
);

const echo = await call('echo', { claimedPluginId: 'com.evil.other' });
check('Round trip', echo.result ? 'ok' : `error: ${echo.error}`, 'ok');
check('Caller identity', echo.result?.pluginId, 'dev.overquid.isolation-check');
const storageCall = await call('storage.get', { key: 'x' });
check(
  'storage without the permission',
  storageCall.error?.includes('permission') ? 'refused' : 'allowed',
  'refused',
);

document.getElementById('results').replaceChildren(
  ...checks.map(({ name, actual, pass }) => {
    const item = document.createElement('li');
    item.className = pass ? 'pass' : 'fail';
    item.textContent = `${pass ? 'PASS' : 'FAIL'} ${name}: ${actual}`;
    return item;
  }),
);
await call('log', checks);
