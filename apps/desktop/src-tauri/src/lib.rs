mod active_app;
mod catalog;
mod cli;
mod content_filter;
mod json_file;
mod layout;
mod overlay;
mod plugin_storage;
mod plugins;
mod settings;
mod shortcuts;
mod state;
mod web_panels;
#[cfg(target_os = "linux")]
mod webkit_filter;

use tauri::{Emitter, Manager, Runtime, State, WebviewWindow};

use cli::{CliError, Request};
use layout::LayoutStore;
use overlay::{Overlay, Status};
use settings::SettingsStore;
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

#[tauri::command(async)]
fn load_settings(store: State<'_, SettingsStore>) -> Option<serde_json::Value> {
    store.load()
}

#[tauri::command(async)]
fn save_settings(
    store: State<'_, SettingsStore>,
    settings: serde_json::Value,
) -> Result<(), String> {
    store.save(&settings)
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
    limiter: State<'_, plugins::RateLimiter>,
    plugin_id: String,
    method: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (_, manifest) = plugins::find(&plugin_roots(&app), &plugin_id)
        .ok_or_else(|| format!("unknown plugin '{plugin_id}'"))?;
    let notify = |title: &str, body: &str| {
        use tauri_plugin_notification::NotificationExt;
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|error| error.to_string())
    };
    let host = plugins::Host {
        storage: &storage,
        limiter: &limiter,
        notify: &notify,
    };
    plugins::call(&manifest, &host, &method, &args)
}

/// Places a web plugin's native view over `rect` (CSS pixels in the overlay
/// window), minus the `holes` covered by panels in front of it, or hides it
/// when `rect` is `None` (ADR 0004). `panel_id` is the plugin's id, or
/// `plugin#n` for another instance of it (ADR 0007).
#[tauri::command(async)]
fn web_panel<R: Runtime>(
    app: tauri::AppHandle<R>,
    panel_id: String,
    rect: Option<Rect>,
    holes: Vec<web_panels::Hole>,
) -> Result<(), String> {
    let (plugin_id, spec) = web_spec(&app, &panel_id)?;
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
        let edge_events = events.clone();
        let id = panel_id.clone();
        let hooks = web_panels::Hooks {
            on_change: Box::new(move |page| {
                let _ = events.emit(WEB_PAGE_EVENT, page);
            }),
            on_press: Box::new(move || {
                let _ = pressed.emit(WEB_PANEL_PRESSED_EVENT, &id);
            }),
            on_edges: Box::new(move |edges| {
                let _ = edge_events.emit(WEB_PANEL_EDGES_EVENT, edges);
            }),
        };
        let _ = tx.send(web_panels::place(
            &panel_id, &plugin_id, &spec, dirs, rect, &holes, hooks,
        ));
    })
    .map_err(|error| error.to_string())?;
    rx.recv().map_err(|error| error.to_string())?
}

/// Sent with a `web_panels::PageState` whenever a web panel's page changes.
const WEB_PAGE_EVENT: &str = "web-page";
/// The plugin of a web panel (`plugin` or `plugin#n`), and its web spec.
/// Another instance needs a plugin that allows several (ADR 0007).
fn web_spec<R: Runtime>(
    app: &tauri::AppHandle<R>,
    panel_id: &str,
) -> Result<(String, plugins::WebSpec), String> {
    let (plugin_id, instance) =
        plugins::split_panel_id(panel_id).ok_or_else(|| format!("invalid panel '{panel_id}'"))?;
    let (_, manifest) = plugins::find(&plugin_roots(app), plugin_id)
        .ok_or_else(|| format!("unknown plugin '{plugin_id}'"))?;
    if instance > 1 && !manifest.panel.multiple {
        return Err(format!("'{plugin_id}' allows a single panel"));
    }
    let spec = manifest
        .web
        .ok_or_else(|| format!("'{plugin_id}' is not a web plugin"))?;
    Ok((plugin_id.to_owned(), spec))
}

/// Closes a web panel instance for good: its page is destroyed (ADR 0007).
#[tauri::command(async)]
fn web_panel_close<R: Runtime>(app: tauri::AppHandle<R>, panel_id: String) -> Result<(), String> {
    plugins::split_panel_id(&panel_id).ok_or_else(|| format!("invalid panel '{panel_id}'"))?;
    app.run_on_main_thread(move || web_panels::close(&panel_id))
        .map_err(|error| error.to_string())
}

/// Sent with the panel id when the user clicks in a web panel's page.
const WEB_PANEL_PRESSED_EVENT: &str = "web-panel-pressed";

/// Sent with a `web_panels::PageEdges` when a page's edge colours are read.
const WEB_PANEL_EDGES_EVENT: &str = "web-panel-edges";

/// Runs a browser button or address bar entry (ADR 0004).
#[tauri::command(async)]
fn web_navigate<R: Runtime>(
    app: tauri::AppHandle<R>,
    panel_id: String,
    navigation: web_panels::Navigation,
) -> Result<(), String> {
    let (_, spec) = web_spec(&app, &panel_id)?;
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(web_panels::navigate(&panel_id, &spec, navigation));
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

/// A plugin the settings can manage.
#[derive(serde::Serialize)]
struct InstalledPlugin {
    #[serde(flatten)]
    manifest: plugins::Manifest,
    /// In the user's folder: it can be removed.
    removable: bool,
}

#[tauri::command(async)]
fn list_plugins<R: Runtime>(app: tauri::AppHandle<R>) -> Vec<InstalledPlugin> {
    let roots = plugin_roots(&app);
    plugins::list_all(&roots)
        .into_iter()
        .map(|manifest| {
            let removable = roots
                .first()
                .is_some_and(|user| plugins::load_manifest(user, &manifest.id).is_some());
            InstalledPlugin {
                manifest,
                removable,
            }
        })
        .collect()
}

/// The folder plugins are installed to.
fn user_plugins<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<std::path::PathBuf, String> {
    plugin_roots(app)
        .into_iter()
        .next()
        .ok_or_else(|| "no folder for plugins".to_owned())
}

/// Plugins offered by the official catalog (ADR 0009).
#[tauri::command(async)]
fn plugin_catalog() -> Result<Vec<catalog::Entry>, String> {
    catalog::fetch_index(&catalog::base_url(), &catalog::http_fetch)
}

/// Installs or updates a plugin from the catalog.
#[tauri::command(async)]
fn install_plugin<R: Runtime>(app: tauri::AppHandle<R>, id: String) -> Result<(), String> {
    let base = catalog::base_url();
    let entry = catalog::fetch_index(&base, &catalog::http_fetch)?
        .into_iter()
        .find(|entry| entry.manifest.id == id)
        .ok_or_else(|| format!("'{id}' is not in the catalog"))?;
    catalog::install(&user_plugins(&app)?, &base, &entry, &catalog::http_fetch)
}

/// Removes an installed plugin; its data stays, for a later reinstall.
#[tauri::command(async)]
fn uninstall_plugin<R: Runtime>(app: tauri::AppHandle<R>, id: String) -> Result<(), String> {
    catalog::uninstall(&user_plugins(&app)?, &id)
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

/// Sent with a `content_filter::Status` whenever the content filter changes.
const CONTENT_FILTER_EVENT: &str = "content-filter";

/// The content filter's state (ADR 0005). `generation` drops the result of a
/// build that a later switch made obsolete.
struct ContentFilter {
    settings: std::path::PathBuf,
    status: std::sync::Mutex<content_filter::Status>,
    generation: std::sync::atomic::AtomicU64,
}

#[tauri::command]
fn content_filter_status(filter: State<'_, ContentFilter>) -> content_filter::Status {
    filter
        .status
        .lock()
        .map(|status| status.clone())
        .unwrap_or(content_filter::Status::Off)
}

#[tauri::command]
fn set_content_filter<R: Runtime>(
    app: tauri::AppHandle<R>,
    filter: State<'_, ContentFilter>,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = content_filter::Settings::load(&filter.settings);
    settings.enabled = enabled;
    settings.save(&filter.settings)?;
    start_content_filter(&app, if enabled { Start::On } else { Start::Off });
    Ok(())
}

/// Sites where the user switched the filter off.
#[tauri::command]
fn content_filter_exceptions(filter: State<'_, ContentFilter>) -> Vec<String> {
    content_filter::Settings::load(&filter.settings).disabled_sites
}

/// Switches the filter off (`filtered: false`) or back on for the site of `host`.
#[tauri::command]
fn set_site_filter<R: Runtime>(
    app: tauri::AppHandle<R>,
    filter: State<'_, ContentFilter>,
    host: String,
    filtered: bool,
) -> Result<Vec<String>, String> {
    let site = content_filter::site_of(&host);
    if site.is_empty() {
        return Err("no site".into());
    }
    let mut settings = content_filter::Settings::load(&filter.settings);
    settings.set_site(&site, filtered);
    settings.save(&filter.settings)?;
    let sites = settings.disabled_sites;
    let applied = sites.clone();
    app.run_on_main_thread(move || web_panels::set_filter_exceptions(applied, &site))
        .map_err(|error| error.to_string())?;
    let _ = app.emit(CONTENT_FILTER_EXCEPTIONS_EVENT, &sites);
    Ok(sites)
}

/// Sent with the sites where the filter is off, whenever they change.
const CONTENT_FILTER_EXCEPTIONS_EVENT: &str = "content-filter-exceptions";

/// What `start_content_filter` does.
#[derive(Clone, Copy, PartialEq)]
enum Start {
    Off,
    /// Switched on by the user: pages reload once the filter is ready.
    On,
    /// Lists refreshed in the background: pages keep going, new rules apply
    /// to what they load next.
    Refresh,
}

/// How often the background check looks for lists older than a day.
const REFRESH_CHECK: std::time::Duration = std::time::Duration::from_secs(60 * 60);

fn report_content_filter<R: Runtime>(app: &tauri::AppHandle<R>, status: content_filter::Status) {
    if let Ok(mut current) = app.state::<ContentFilter>().status.lock() {
        *current = status.clone();
    }
    let _ = app.emit(CONTENT_FILTER_EVENT, status);
}

/// Switches the filter on (lists fetched and compiled on a worker thread),
/// refreshes it, or switches it off.
fn start_content_filter<R: Runtime>(app: &tauri::AppHandle<R>, start: Start) {
    use content_filter::Status;
    use std::sync::atomic::Ordering;

    let generation = app
        .state::<ContentFilter>()
        .generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let Ok(store) = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("content-filter"))
    else {
        return;
    };
    if start == Start::Off {
        report_content_filter(app, Status::Off);
        let _ = app.run_on_main_thread(move || {
            web_panels::set_content_filter(None, store, true, |_| {});
        });
        return;
    }
    if start == Start::On {
        report_content_filter(app, Status::Loading);
    }
    let cache = app
        .path()
        .app_cache_dir()
        .map(|dir| content_filter::cache_dir(&dir))
        .unwrap_or_else(|_| store.join("lists"));
    let scriptlets = app
        .path()
        .resource_dir()
        .map(|dir| dir.join("ubo-scriptlets.json"))
        .unwrap_or_default();
    let app = app.clone();
    std::thread::spawn(move || {
        let current = move |app: &tauri::AppHandle<R>| {
            app.state::<ContentFilter>()
                .generation
                .load(Ordering::SeqCst)
                == generation
        };
        let compiled = content_filter::fetch_lists(&cache).and_then(|lists| {
            content_filter::compile(lists, content_filter::load_scriptlets(&scriptlets))
        });
        if !current(&app) {
            return;
        }
        let compiled = match compiled {
            Ok(compiled) => compiled,
            // A failed background refresh keeps the filter as it is.
            Err(message) if start == Start::Refresh => {
                return eprintln!("overquid: content filter refresh: {message}");
            }
            Err(message) => return report_content_filter(&app, Status::Error { message }),
        };
        let on = Status::On {
            lists: compiled.lists,
            scriptlets: compiled.scriptlets,
        };
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if !current(&handle) {
                return;
            }
            let reload = start == Start::On;
            web_panels::set_content_filter(Some(compiled), store, reload, move |result| {
                if let Err(error) = &result {
                    eprintln!("overquid: content filter: {error}");
                }
                report_content_filter(&handle, on);
            });
        });
    });
}

/// Refreshes the lists in the background once they are a day old, while the
/// filter is on.
fn refresh_content_filter_lists<R: Runtime>(app: tauri::AppHandle<R>) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(REFRESH_CHECK);
            let filter = app.state::<ContentFilter>();
            let on = content_filter::Settings::load(&filter.settings).enabled;
            let cache = app
                .path()
                .app_cache_dir()
                .map(|dir| content_filter::cache_dir(&dir));
            if on && cache.is_ok_and(|cache| content_filter::lists_stale(&cache)) {
                start_content_filter(&app, Start::Refresh);
            }
        }
    });
}

/// Sent with an `active_app::ActiveApp` whenever another app gets the focus.
const ACTIVE_APP_EVENT: &str = "active-app";

/// The last focused app (not Overquid), for an interface that starts after it.
struct LastActiveApp(std::sync::Mutex<Option<active_app::ActiveApp>>);

#[tauri::command]
fn active_app(last: State<'_, LastActiveApp>) -> Option<active_app::ActiveApp> {
    last.0.lock().ok().and_then(|app| app.clone())
}

/// The global shortcut in effect (`None`: the desktop's own configuration).
#[derive(Default)]
struct GlobalShortcut(std::sync::Mutex<Option<shortcuts::Accel>>);

/// Which desktop the global shortcut would be set up in.
#[tauri::command]
fn shortcut_desktop() -> shortcuts::Desktop {
    shortcuts::detect_desktop()
}

/// Applies the settings' shortcuts, moving the global one if it changed.
#[tauri::command(async)]
fn set_shortcuts(
    overlay: State<'_, Overlay>,
    global: State<'_, GlobalShortcut>,
    shortcuts: shortcuts::Shortcuts,
) -> Result<(), String> {
    overlay.set_keymap(shortcuts.keymap()?);
    let next = shortcuts.toggle()?;
    let mut current = global.0.lock().map_err(|error| error.to_string())?;
    if *current != next {
        shortcuts::apply_global(shortcuts::detect_desktop(), current.as_ref(), next.as_ref())?;
        *current = next;
    }
    Ok(())
}

/// Lets keys reach the page while a new shortcut is being recorded.
#[tauri::command]
fn suspend_shortcuts(overlay: State<'_, Overlay>, suspended: bool) {
    overlay.suspend_shortcuts(suspended);
}

fn apply<R: Runtime>(app: &tauri::AppHandle<R>, request: Request) {
    let command = match request {
        Request::Visibility(command) => command,
        Request::Overlay(switch) => {
            if let Err(error) = app.emit(overlay::SWITCH_EVENT, switch) {
                eprintln!("overquid: cannot switch overlay: {error}");
            }
            return;
        }
    };
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
        .plugin(tauri_plugin_notification::init())
        .register_uri_scheme_protocol(plugins::SCHEME, |ctx, request| {
            plugins::serve_from(&plugin_roots(ctx.app_handle()), request.uri().path())
        })
        .setup(move |app| {
            let window = app
                .get_webview_window(WINDOW)
                .expect("overlay window is declared in tauri.conf.json");
            app.manage(LayoutStore::new(&app.path().app_config_dir()?));
            app.manage(SettingsStore::new(&app.path().app_config_dir()?));
            // Notifications: 5 per minute per plugin.
            app.manage(plugins::RateLimiter::new(
                5,
                std::time::Duration::from_secs(60),
            ));
            app.manage(plugin_storage::PluginStorage::new(
                &app.path().app_data_dir()?.join("plugin-data"),
            ));
            app.manage(Overlay::setup(&window)?);
            let settings = app.path().app_config_dir()?.join("content-filter.json");
            let enabled = content_filter::Settings::load(&settings).enabled;
            app.manage(ContentFilter {
                settings: settings.clone(),
                status: std::sync::Mutex::new(content_filter::Status::Off),
                generation: std::sync::atomic::AtomicU64::new(0),
            });
            let sites = content_filter::Settings::load(&settings).disabled_sites;
            app.run_on_main_thread(move || web_panels::set_filter_exceptions(sites, ""))?;
            if enabled {
                start_content_filter(app.handle(), Start::On);
            }
            refresh_content_filter_lists(app.handle().clone());
            app.manage(LastActiveApp(std::sync::Mutex::new(None)));
            let handle = app.handle().clone();
            let reloaded = app.handle().clone();
            app.manage(GlobalShortcut::default());
            active_app::watch(
                move |focused| {
                    if let Ok(mut last) = handle.state::<LastActiveApp>().0.lock() {
                        *last = Some(focused.clone());
                    }
                    let _ = handle.emit(ACTIVE_APP_EVENT, focused);
                },
                move || {
                    let global = reloaded.state::<GlobalShortcut>();
                    let toggle = global.0.lock().ok().and_then(|toggle| toggle.clone());
                    if let Some(toggle) = toggle
                        && let Err(error) = shortcuts::reapply_global(&toggle)
                    {
                        eprintln!("overquid: cannot set the global shortcut again: {error}");
                    }
                },
            );
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
            load_settings,
            save_settings,
            shortcut_desktop,
            set_shortcuts,
            suspend_shortcuts,
            plugin_call,
            list_plugins,
            plugin_catalog,
            install_plugin,
            uninstall_plugin,
            web_panel,
            web_panel_close,
            web_navigate,
            content_filter_status,
            set_content_filter,
            content_filter_exceptions,
            set_site_filter,
            active_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Overquid");
}
