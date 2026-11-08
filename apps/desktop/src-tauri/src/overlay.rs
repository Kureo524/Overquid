//! The overlay window: how it is placed above other apps, shown and hidden.
//!
//! On Wayland compositors that implement wlr-layer-shell (Hyprland, KDE, Sway,
//! niri), the window becomes a layer surface on the `overlay` layer: the only
//! reliable way to stay above fullscreen windows there. Elsewhere (X11, GNOME
//! Wayland), it falls back to a regular always-on-top window.

use serde::Serialize;
use tauri::{Runtime, WebviewWindow};

use crate::cli::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    LayerShell,
    Fallback,
}

/// Turns the (still hidden) window into an overlay and reports how.
pub fn setup<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<Mode> {
    #[cfg(target_os = "linux")]
    if gtk_layer_shell::is_supported() {
        init_layer_shell(window)?;
        return Ok(Mode::LayerShell);
    }

    window.set_always_on_top(true)?;
    Ok(Mode::Fallback)
}

#[cfg(target_os = "linux")]
fn init_layer_shell<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    use gtk::prelude::*;
    use gtk_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};

    let gtk_window = window.gtk_window()?;
    // Layer shell must be set up before GTK maps the surface. Tao may already
    // have realized the window, so unrealize it first.
    if gtk_window.is_realized() {
        gtk_window.unrealize();
    }
    gtk_window.init_layer_shell();
    gtk_window.set_namespace("overquid");
    gtk_window.set_layer(Layer::Overlay);
    for edge in [Edge::Top, Edge::Bottom, Edge::Left, Edge::Right] {
        gtk_window.set_anchor(edge, true);
    }
    // -1: do not reserve space, and ignore the space reserved by bars.
    gtk_window.set_exclusive_zone(-1);
    // Take the keyboard while shown, like a launcher. Hidden = unmapped, so
    // nothing is captured then.
    gtk_window.set_keyboard_mode(KeyboardMode::Exclusive);
    Ok(())
}

pub fn apply<R: Runtime>(
    window: &WebviewWindow<R>,
    mode: Mode,
    command: Command,
) -> tauri::Result<()> {
    match command {
        Command::Run => Ok(()),
        Command::Show => show(window, mode),
        Command::Hide => window.hide(),
        Command::Toggle if window.is_visible()? => window.hide(),
        Command::Toggle => show(window, mode),
    }
}

fn show<R: Runtime>(window: &WebviewWindow<R>, mode: Mode) -> tauri::Result<()> {
    window.show()?;
    if mode == Mode::Fallback {
        cover_monitor(window)?;
    }
    window.set_focus()
}

/// Sizes the fallback window to its monitor. Layer-shell surfaces are sized by
/// their anchors instead.
///
/// Done after `show()` because window managers ignore geometry requests on
/// unmapped windows. Not `maximize()`: GNOME and Hyprland ignore it for a
/// non-resizable window. Not `set_fullscreen()`: GNOME paints black behind
/// fullscreen windows, which kills the transparency.
fn cover_monitor<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    let monitor = match window.current_monitor()? {
        Some(monitor) => Some(monitor),
        None => window.primary_monitor()?,
    };
    if let Some(monitor) = monitor {
        window.set_position(*monitor.position())?;
        window.set_size(*monitor.size())?;
    }
    Ok(())
}
