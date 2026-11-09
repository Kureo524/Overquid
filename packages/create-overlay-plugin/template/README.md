# {{name}}

An [Overquid](https://github.com/Kureo524/Overquid) plugin.

## Build and install

```sh
npm install
npm run build
mkdir -p ~/.local/share/dev.overquid.app/plugins/{{id}}
cp -r manifest.json dist ~/.local/share/dev.overquid.app/plugins/{{id}}/
```

Restart Overquid, then "Add panel" → {{name}}.

## How it works

- `manifest.json` names the plugin, its entry file and the permissions it needs. The core checks every SDK call against
  them.
- The plugin runs in a sandboxed frame: no system access, no `localStorage`. Use the SDK (`@overquid/sdk`):
  `onShow`/`onHide`, `storage`, `notify`… See the SDK's README for the list and the permissions they need.
- Network requests are only allowed to the host names listed in `network`.
