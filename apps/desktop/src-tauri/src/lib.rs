mod cli;
mod overlay;

use tauri::{Manager, Runtime, State, WebviewWindow};

use cli::{CliError, Command};
use overlay::Mode;

const WINDOW: &str = "overlay";

#[tauri::command]
fn overlay_mode(mode: State<'_, Mode>) -> Mode {
    *mode
}

#[tauri::command]
fn hide_overlay<R: Runtime>(window: WebviewWindow<R>) -> tauri::Result<()> {
    window.hide()
}

fn apply<R: Runtime>(app: &tauri::AppHandle<R>, command: Command) {
    let Some(window) = app.get_webview_window(WINDOW) else {
        return;
    };
    let mode = *app.state::<Mode>();
    if let Err(error) = overlay::apply(&window, mode, command) {
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
            let mode = overlay::setup(&window)?;
            app.manage(mode);
            apply(app.handle(), command);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![overlay_mode, hide_overlay])
        .run(tauri::generate_context!())
        .expect("error while running Overquid");
}
