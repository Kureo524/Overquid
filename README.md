# Overquid

[![CI](https://github.com/Kureo524/Overquid/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/Kureo524/Overquid/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Kureo524/Overquid/actions/workflows/codeql.yml/badge.svg?branch=dev)](https://github.com/Kureo524/Overquid/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-8fa4cc.svg)](LICENSE)

A universal desktop overlay you summon with a hotkey, on top of anything: a game, a browser, your IDE, a video call.
The core is a thin shell. Everything inside it is a plugin.

> **Status: early development.** The repository foundations are in place; the app itself does not exist yet.

## Why

Existing overlays are built for games. Overquid is meant as much for work as for play:

- **Work**: notes, to-do, Pomodoro timer, clipboard, music, Discord or Slack without leaving your app.
- **Games**: music, video, Discord, match stats, guides.
- **Study and creation**: quick notes, references, a video player while you code or draw.

Open source, no ads, no account required, light on memory, and an SDK designed so a developer can write a plugin in an evening.
Save several layouts ("Work", "Game") and bind them to the app in the foreground.

## How it works

- A borderless, transparent, always-on-top window that lets clicks through while hidden.
- A global shortcut (`Alt+Shift+O` by default) shows the overlay and captures the mouse.
- No code injection into games, ever: nothing for an anti-cheat to flag.
- Plugins run in isolated web frames and reach the system only through the SDK, gated by the permissions in their manifest.

```json
{
  "id": "com.example.notes",
  "name": "Notes",
  "version": "1.0.0",
  "entry": "dist/index.html",
  "panel": { "defaultSize": [360, 480], "resizable": true },
  "permissions": ["storage", "hotkeys"],
  "network": []
}
```

## Platforms

Linux first, Windows next. macOS is out of scope for now.

| Desktop                                    | Overlay                                 | Notes                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hyprland, KDE Plasma, Sway, niri (Wayland) | Layer-shell surface above everything    | Full support                                                                                                                                                                                                                                                                                                         |
| X11                                        | Always-on-top window                    | Bind `overquid toggle` in your window manager                                                                                                                                                                                                                                                                        |
| GNOME (Wayland)                            | Always-on-top window, below the top bar | No layer-shell, so it may not stay above a fullscreen game. Bind `overquid toggle` as a custom shortcut in Settings › Keyboard. After closing the overlay with pinned panels, click the app underneath to type in it again; pinned panels cannot take the keyboard and come back on the first summon after a restart |

## Stack

Rust + [Tauri 2](https://tauri.app) for the core, React + TypeScript + Vite for the UI, a TypeScript SDK for plugins,
all in a pnpm monorepo.

## Development

Requires Node 20+, pnpm 10, Rust (stable) and the
[Tauri system dependencies](https://v2.tauri.app/start/prerequisites/#linux), plus `gtk-layer-shell` on Linux.

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
cargo clippy --workspace -- -D warnings && cargo test --workspace
```

### Try the overlay

```sh
pnpm desktop build --no-bundle      # builds target/release/overquid
./target/release/overquid &          # starts hidden, in the background
./target/release/overquid toggle     # shows it; Escape or toggle again hides it
```

Bind `overquid toggle` to a hotkey in your desktop. On Hyprland (Lua config):

```lua
hl.bind("ALT + SHIFT + X", hl.dsp.exec_cmd("overquid toggle"))
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for branches, commit conventions and the PR flow.

## License

[MIT](LICENSE)
