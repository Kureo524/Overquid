# @overquid/sdk

Write a panel for [Overquid](../../README.md), the plugin-driven desktop overlay.

A plugin is a folder named after its id, with a `manifest.json` and web files. It runs in a sandboxed iframe and
reaches the overlay only through this SDK; every call is checked against the manifest.

```json
{
  "id": "com.example.counter",
  "name": "Counter",
  "version": "1.0.0",
  "entry": "dist/index.html",
  "panel": { "defaultSize": [300, 150] },
  "permissions": ["storage"],
  "network": []
}
```

```ts
import { connect } from '@overquid/sdk';

const overquid = connect();

overquid.onShow(() => resume());
overquid.onHide(() => pause()); // stop timers and media while hidden

const count = (await overquid.storage.get<number>('count')) ?? 0;
await overquid.storage.set('count', count + 1);
```

| API                                                                    | Permission        |
| ---------------------------------------------------------------------- | ----------------- |
| `onShow`, `onHide`, `visible`                                          | none              |
| `storage.get`, `set`, `remove`, `keys` (JSON values, 1 MiB per plugin) | `storage`         |
| `notify({ title, body })`: desktop notification, 5 per minute          | `notifications`   |
| `fetch` and `WebSocket` (`https`, `wss`) to the hosts in `network`     | `network` entries |

Notes:

- Build with [Vite](https://vite.dev) and `base: './'`: plugin files are served from the plugin's folder.
- Resources must be requested in CORS mode (`crossorigin` on `<link>`, `<img>`…). Vite already adds it to the tags it
  emits.
- `localStorage` and cookies are unavailable (sandboxed iframe): use `storage`.
- A notification's title always starts with the plugin's name: a plugin cannot pass for another one.
- A `network` entry is a host name, with an optional port: `api.example.com`, `example.com:8443`, or `*` for any port
  (`archipelago.gg:*`). Plain `http` and `ws` are blocked.

See [`plugins/dev.overquid.sdk-demo`](../../plugins/dev.overquid.sdk-demo) for a complete example.
