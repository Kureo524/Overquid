//! Follows the focused app, so overlays can switch with it (ADR 0006).
//!
//! Hyprland only for now: it reports focus changes on its event socket
//! (`activewindow>>class,title`). Other desktops report nothing, and overlays
//! then only switch by hand.

use std::io::{BufRead, BufReader};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;

/// The focused app, as the interface sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ActiveApp {
    /// Window class (`code`, `firefox`, `org.vinegarhq.Sober`…): what overlays are bound to.
    pub class: String,
}

/// The app focused by an `activewindow>>class,title` event. `None` for other
/// events, for no window (empty class), and for Overquid itself: summoning
/// the overlay must not count as switching apps.
pub fn parse_event(line: &str) -> Option<ActiveApp> {
    let data = line.strip_prefix("activewindow>>")?;
    let class = data.split(',').next()?.trim();
    if class.is_empty() || is_overquid(class) {
        return None;
    }
    Some(ActiveApp {
        class: class.to_owned(),
    })
}

fn is_overquid(class: &str) -> bool {
    let class = class.to_ascii_lowercase();
    class == "overquid" || class.starts_with("dev.overquid")
}

/// Hyprland's event socket, from the environment it gives its children.
fn hyprland_socket() -> Option<PathBuf> {
    let runtime = std::env::var_os("XDG_RUNTIME_DIR")?;
    let instance = std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE")?;
    Some(
        PathBuf::from(runtime)
            .join("hypr")
            .join(instance)
            .join(".socket2.sock"),
    )
}

/// Whether a Hyprland event says its config was just reloaded.
fn is_config_reload(line: &str) -> bool {
    line.starts_with("configreloaded>>")
}

/// Calls `on_change` with the focused app whenever it changes, and `on_reload`
/// after Hyprland reloads its config, from a background thread. Reconnects if
/// Hyprland restarts. Does nothing outside Hyprland.
pub fn watch(
    on_change: impl Fn(ActiveApp) + Send + 'static,
    on_reload: impl Fn() + Send + 'static,
) {
    let Some(socket) = hyprland_socket() else {
        return;
    };
    std::thread::spawn(move || {
        let mut last: Option<ActiveApp> = None;
        loop {
            match UnixStream::connect(&socket) {
                Ok(stream) => {
                    for line in BufReader::new(stream).lines() {
                        let Ok(line) = line else { break };
                        if is_config_reload(&line) {
                            on_reload();
                        }
                        if let Some(app) = parse_event(&line)
                            && last.as_ref() != Some(&app)
                        {
                            last = Some(app.clone());
                            on_change(app);
                        }
                    }
                }
                Err(error) => eprintln!("overquid: cannot follow the focused app: {error}"),
            }
            std::thread::sleep(Duration::from_secs(5));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(class: &str) -> Option<ActiveApp> {
        Some(ActiveApp {
            class: class.to_owned(),
        })
    }

    #[test]
    fn reads_focus_changes() {
        assert_eq!(
            parse_event("activewindow>>code,main.rs - Overquid"),
            app("code")
        );
        assert_eq!(
            parse_event("activewindow>>org.vinegarhq.Sober,Sober"),
            app("org.vinegarhq.Sober")
        );
        // Titles may hold commas; the class never does.
        assert_eq!(parse_event("activewindow>>firefox,a, b, c"), app("firefox"));
    }

    #[test]
    fn reads_config_reloads() {
        assert!(is_config_reload("configreloaded>>"));
        assert!(!is_config_reload("activewindow>>code,x"));
    }

    #[test]
    fn ignores_other_events_no_window_and_itself() {
        assert_eq!(parse_event("activewindowv2>>55d2c5e0"), None);
        assert_eq!(parse_event("workspace>>2"), None);
        assert_eq!(parse_event("activewindow>>,"), None);
        assert_eq!(parse_event("activewindow>>overquid,Overquid"), None);
        assert_eq!(parse_event("activewindow>>dev.overquid.app,Overquid"), None);
    }
}
