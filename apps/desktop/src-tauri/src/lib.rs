mod cli;
mod json_file;
mod layout;
mod overlay;
mod plugin_storage;
mod plugins;
mod state;
mod web_panels;

use tauri::{Emitter, Manager, Runtime, State, WebviewWindow};

use cli::{CliError, Command};
use layout::LayoutStore;
use overlay::{Overlay, Status};
use state::Rect;

const WINDOW: &str = "overlay";

#[tauri::command]
fn overlay_status(overlay: State<'_, Overlay>) -> Status {
    overlay.status()
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

/// A call relayed by the host from a plugin iframe (ADR 0003). The host sets
/// `plugin_id` from the iframe that sent the message, never from its content;
/// the call is then checked against that plugin's manifest.
#[tauri::command(async)]
fn plugin_call<R: Runtime>(
    app: tauri::AppHandle<R>,
    storage: State<'_, plugin_storage::PluginStorage>,
    plugin_id: String,
    method: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (_, manifest) = plugins::find(&plugin_roots(&app), &plugin_id)
        .ok_or_else(|| format!("unknown plugin '{plugin_id}'"))?;
    plugins::call(&manifest, &storage, &method, &args)
}

/// Places a web plugin's native view over `rect` (CSS pixels in the overlay
/// window), minus the `holes` covered by panels in front of it, or hides it
/// when `rect` is `None` (ADR 0004).
#[tauri::command(async)]
fn web_panel<R: Runtime>(
    app: tauri::AppHandle<R>,
    plugin_id: String,
    rect: Option<Rect>,
    holes: Vec<web_panels::Hole>,
) -> Result<(), String> {
    let (_, manifest) = plugins::find(&plugin_roots(&app), &plugin_id)
        .ok_or_else(|| format!("unknown plugin '{plugin_id}'"))?;
    let spec = manifest
        .web
        .ok_or_else(|| format!("'{plugin_id}' is not a web plugin"))?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("web")
        .join(&plugin_id);
    let (tx, rx) = std::sync::mpsc::channel();
    let events = app.clone();
    app.run_on_main_thread(move || {
        let dirs = web_panels::DataDirs {
            data: base.join("data"),
            cache: base.join("cache"),
        };
        let pressed = events.clone();
        let id = plugin_id.clone();
        let hooks = web_panels::Hooks {
            on_change: Box::new(move |page| {
                let _ = events.emit(WEB_PAGE_EVENT, page);
            }),
            on_press: Box::new(move || {
                let _ = pressed.emit(WEB_PANEL_PRESSED_EVENT, &id);
            }),
        };
        let _ = tx.send(web_panels::place(
            &plugin_id, &spec, dirs, rect, &holes, hooks,
        ));
    })
    .map_err(|error| error.to_string())?;
    rx.recv().map_err(|error| error.to_string())?
}

/// Sent with a `web_panels::PageState` whenever a web panel's page changes.
const WEB_PAGE_EVENT: &str = "web-page";
/// Sent with the plugin id when the user clicks in a web panel's page.
const WEB_PANEL_PRESSED_EVENT: &str = "web-panel-pressed";

/// Runs a browser button or address bar entry (ADR 0004).
#[tauri::command(async)]
fn web_navigate<R: Runtime>(
    app: tauri::AppHandle<R>,
    plugin_id: String,
    navigation: web_panels::Navigation,
) -> Result<(), String> {
    let (_, manifest) = plugins::find(&plugin_roots(&app), &plugin_id)
        .ok_or_else(|| format!("unknown plugin '{plugin_id}'"))?;
    let spec = manifest
        .web
        .ok_or_else(|| format!("'{plugin_id}' is not a web plugin"))?;
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(web_panels::navigate(&plugin_id, &spec, navigation));
    })
    .map_err(|error| error.to_string())?;
    rx.recv().map_err(|error| error.to_string())?
}

/// Quits cleanly on SIGTERM (`pkill`, end of session), SIGINT and SIGHUP:
/// web pages are unloaded first, so sites save their state (ADR 0004).
#[cfg(target_os = "linux")]
fn quit_on_signals<R: Runtime>(app: &tauri::AppHandle<R>) {
    use gtk::glib;
    const SIGHUP: i32 = 1;
    const SIGINT: i32 = 2;
    const SIGTERM: i32 = 15;
    for signal in [SIGHUP, SIGINT, SIGTERM] {
        let app = app.clone();
        glib::unix_signal_add_local(signal, move || {
            let app = app.clone();
            web_panels::unload_all(move || app.exit(0));
            glib::ControlFlow::Break
        });
    }
}

#[tauri::command(async)]
fn list_plugins<R: Runtime>(app: tauri::AppHandle<R>) -> Vec<plugins::Manifest> {
    plugins::list_all(&plugin_roots(&app))
}

/// Folders holding one sub-folder per plugin, by priority: the user's
/// (`<app data>/plugins`, or `OVERQUID_PLUGINS_DIR` during development), then
/// the plugins shipped with the app (bundled resources, also copied next to
/// the binary in `target/` for development builds).
fn plugin_roots<R: Runtime>(app: &tauri::AppHandle<R>) -> Vec<std::path::PathBuf> {
    let user = std::env::var_os("OVERQUID_PLUGINS_DIR")
        .map(Into::into)
        .or_else(|| {
            app.path()
                .app_data_dir()
                .ok()
                .map(|dir| dir.join("plugins"))
        });
    let shipped = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("plugins"));
    user.into_iter().chain(shipped).collect()
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
            plugins::serve_from(&plugin_roots(ctx.app_handle()), request.uri().path())
        })
        .setup(move |app| {
            let window = app
                .get_webview_window(WINDOW)
                .expect("overlay window is declared in tauri.conf.json");
            app.manage(LayoutStore::new(&app.path().app_config_dir()?));
            app.manage(plugin_storage::PluginStorage::new(
                &app.path().app_data_dir()?.join("plugin-data"),
            ));
            app.manage(Overlay::setup(&window)?);
            #[cfg(target_os = "linux")]
            quit_on_signals(app.handle());
            apply(app.handle(), command);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            overlay_status,
            set_pinned_regions,
            release_keyboard,
            load_layout,
            save_layout,
            plugin_call,
            list_plugins,
            web_panel,
            web_navigate
        ])
        .run(tauri::generate_context!())
        .expect("error while running Overquid");
}
