mod cli;
mod layout;
mod overlay;
mod plugins;
mod state;

use tauri::{Manager, Runtime, State, WebviewWindow};

use cli::{CliError, Command};
use layout::LayoutStore;
use overlay::{Overlay, Status};
use state::Rect;

const WINDOW: &str = "overlay";

#[tauri::command]
fn overlay_status(overlay: State<'_, Overlay>) -> Status {
    overlay.status()
}

/// Escape while summoned: back to the pinned panels, or hidden.
#[tauri::command]
fn dismiss_overlay<R: Runtime>(
    window: WebviewWindow<R>,
    overlay: State<'_, Overlay>,
) -> tauri::Result<()> {
    overlay.dismiss(&window)
}

/// Where the pinned panels are, in CSS pixels. Empty when nothing is pinned.
#[tauri::command]
fn set_pinned_regions<R: Runtime>(
    window: WebviewWindow<R>,
    overlay: State<'_, Overlay>,
    rects: Vec<Rect>,
    restore: bool,
) -> tauri::Result<()> {
    overlay.set_pinned(&window, rects, restore)
}

#[tauri::command(async)]
fn load_layout(store: State<'_, LayoutStore>) -> Option<serde_json::Value> {
    store.load()
}

#[tauri::command(async)]
fn save_layout(store: State<'_, LayoutStore>, layout: serde_json::Value) -> Result<(), String> {
    store.save(&layout)
}

/// Gives the keyboard back to the app underneath (pinned panels only).
#[tauri::command]
fn release_keyboard<R: Runtime>(
    window: WebviewWindow<R>,
    overlay: State<'_, Overlay>,
) -> tauri::Result<()> {
    overlay.release_keyboard(&window)
}

/// Spike (ADR 0003): a call relayed by the host from a plugin iframe. The host
/// sets `plugin_id` from the iframe that sent the message, never from its
/// content.
#[tauri::command]
fn plugin_call(
    plugin_id: String,
    method: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    match method.as_str() {
        "echo" => Ok(serde_json::json!({ "pluginId": plugin_id, "args": args })),
        "report" => {
            eprintln!("[plugin {plugin_id}] {args}");
            Ok(serde_json::Value::Null)
        }
        other => Err(format!("unknown method '{other}'")),
    }
}

#[tauri::command(async)]
fn list_plugins<R: Runtime>(app: tauri::AppHandle<R>) -> Vec<plugins::Manifest> {
    plugins::list(&plugins_dir(&app))
}

/// Folder holding one sub-folder per plugin. `OVERQUID_PLUGINS_DIR` overrides
/// it during development.
fn plugins_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> std::path::PathBuf {
    std::env::var_os("OVERQUID_PLUGINS_DIR")
        .map(Into::into)
        .or_else(|| {
            app.path()
                .app_data_dir()
                .ok()
                .map(|dir| dir.join("plugins"))
        })
        .unwrap_or_default()
}

fn apply<R: Runtime>(app: &tauri::AppHandle<R>, command: Command) {
    let Some(window) = app.get_webview_window(WINDOW) else {
        return;
    };
    if let Err(error) = app.state::<Overlay>().command(&window, command) {
        eprintln!("overquid: {command:?} failed: {error}");
    }
}

pub fn run() {
    // Validate arguments before anything else, so `overquid --help` or a typo
    // never reaches (and disturbs) a running instance.
    let command = match cli::parse(std::env::args().skip(1)) {
        Ok(command) => command,
        Err(CliError::Help) => {
            println!("{}", cli::USAGE);
            return;
        }
        Err(error) => {
            eprintln!("overquid: {error}");
            std::process::exit(2);
        }
    };

    tauri::Builder::default()
        // Must be the first plugin: a second `overquid …` process forwards its
        // arguments here and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Ok(command) = cli::parse(argv.iter().skip(1)) {
                apply(app, command);
            }
        }))
        .register_uri_scheme_protocol(plugins::SCHEME, |ctx, request| {
            plugins::serve(&plugins_dir(ctx.app_handle()), request.uri().path())
        })
        .setup(move |app| {
            let window = app
                .get_webview_window(WINDOW)
                .expect("overlay window is declared in tauri.conf.json");
            app.manage(LayoutStore::new(&app.path().app_config_dir()?));
            app.manage(Overlay::setup(&window)?);
            apply(app.handle(), command);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            overlay_status,
            dismiss_overlay,
            set_pinned_regions,
            release_keyboard,
            load_layout,
            save_layout,
            plugin_call,
            list_plugins
        ])
        .run(tauri::generate_context!())
        .expect("error while running Overquid");
}
