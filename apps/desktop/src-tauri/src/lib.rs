mod cli;
mod overlay;
mod state;

use tauri::{Manager, Runtime, State, WebviewWindow};

use cli::{CliError, Command};
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
) -> tauri::Result<()> {
    overlay.set_pinned(&window, rects)
}

/// Gives the keyboard back to the app underneath (pinned panels only).
#[tauri::command]
fn release_keyboard<R: Runtime>(
    window: WebviewWindow<R>,
    overlay: State<'_, Overlay>,
) -> tauri::Result<()> {
    overlay.release_keyboard(&window)
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
        .setup(move |app| {
            let window = app
                .get_webview_window(WINDOW)
                .expect("overlay window is declared in tauri.conf.json");
            app.manage(Overlay::setup(&window)?);
            apply(app.handle(), command);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            overlay_status,
            dismiss_overlay,
            set_pinned_regions,
            release_keyboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running Overquid");
}
