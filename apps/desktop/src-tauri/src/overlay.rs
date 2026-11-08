//! The overlay window: how it is placed above other apps, and how each
//! [`Visibility`] is rendered.
//!
//! On Wayland compositors that implement wlr-layer-shell (Hyprland, KDE, Sway,
//! niri), the window becomes a layer surface on the `overlay` layer: the only
//! reliable way to stay above fullscreen windows there. Elsewhere (X11, GNOME
//! Wayland), it falls back to a regular always-on-top window.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{Emitter, Runtime, WebviewWindow};

use crate::cli::Command;
use crate::state::{self, Rect, Visibility};

/// Event sent to the web view each time the visibility changes.
pub const STATE_EVENT: &str = "overlay-state";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    LayerShell,
    Fallback,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Status {
    pub mode: Mode,
    pub visibility: Visibility,
}

pub struct Overlay {
    mode: Mode,
    inner: Mutex<Inner>,
}

struct Inner {
    visibility: Visibility,
    pinned: Vec<Rect>,
}

impl Overlay {
    /// Turns the (still hidden) window into an overlay.
    pub fn setup<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<Self> {
        let mode = platform_setup(window)?;
        Ok(Self {
            mode,
            inner: Mutex::new(Inner {
                visibility: Visibility::Hidden,
                pinned: Vec::new(),
            }),
        })
    }

    pub fn status(&self) -> Status {
        Status {
            mode: self.mode,
            visibility: self.lock().visibility,
        }
    }

    pub fn command<R: Runtime>(
        &self,
        window: &WebviewWindow<R>,
        command: Command,
    ) -> tauri::Result<()> {
        self.transition(window, |inner| {
            state::after_command(inner.visibility, command, !inner.pinned.is_empty())
        })
    }

    pub fn dismiss<R: Runtime>(&self, window: &WebviewWindow<R>) -> tauri::Result<()> {
        self.transition(window, |inner| {
            state::after_dismiss(inner.visibility, !inner.pinned.is_empty())
        })
    }

    /// Records where the pinned panels are; they are the only clickable areas
    /// while pinned.
    pub fn set_pinned<R: Runtime>(
        &self,
        window: &WebviewWindow<R>,
        rects: Vec<Rect>,
    ) -> tauri::Result<()> {
        self.transition(window, |inner| {
            inner.pinned = rects;
            state::after_pinned_change(inner.visibility, !inner.pinned.is_empty())
        })
    }

    /// Hands the keyboard back to the app underneath while pinned.
    pub fn release_keyboard<R: Runtime>(&self, window: &WebviewWindow<R>) -> tauri::Result<()> {
        if self.mode == Mode::LayerShell && self.lock().visibility == Visibility::Pinned {
            set_keyboard(window, Keyboard::Release)?;
        }
        Ok(())
    }

    /// Applies `next` to the state, then renders the new visibility. Pinned
    /// rectangles are re-applied even when the visibility does not change.
    fn transition<R: Runtime>(
        &self,
        window: &WebviewWindow<R>,
        next: impl FnOnce(&mut Inner) -> Visibility,
    ) -> tauri::Result<()> {
        let (previous, visibility, pinned) = {
            let mut inner = self.lock();
            let previous = inner.visibility;
            inner.visibility = next(&mut inner);
            (previous, inner.visibility, inner.pinned.clone())
        };
        self.render(window, previous, visibility, pinned)
    }

    fn render<R: Runtime>(
        &self,
        window: &WebviewWindow<R>,
        previous: Visibility,
        visibility: Visibility,
        pinned: Vec<Rect>,
    ) -> tauri::Result<()> {
        match visibility {
            Visibility::Hidden => window.hide()?,
            Visibility::Summoned => {
                set_input_region(window, None)?;
                window.show()?;
                if self.mode == Mode::Fallback {
                    cover_monitor(window)?;
                    window.set_focus()?;
                } else {
                    set_keyboard(window, Keyboard::Exclusive)?;
                }
            }
            Visibility::Pinned => {
                set_input_region(window, Some(pinned))?;
                // Coming from summoned, the overlay still holds the keyboard:
                // give it back to the app underneath right away.
                if self.mode == Mode::LayerShell && previous != Visibility::Pinned {
                    set_keyboard(window, Keyboard::Release)?;
                }
            }
        }
        if visibility != previous {
            window.emit(STATE_EVENT, visibility)?;
        }
        Ok(())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn platform_setup<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<Mode> {
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
    use gtk_layer_shell::{Edge, Layer, LayerShell};

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
    Ok(())
}

#[derive(Clone, Copy)]
enum Keyboard {
    /// Take the keyboard, like a launcher (summoned).
    Exclusive,
    /// Give it back now, then take it again only when a panel is clicked
    /// (pinned).
    Release,
}

/// Layer-shell keyboard interactivity. No-op outside Linux.
fn set_keyboard<R: Runtime>(window: &WebviewWindow<R>, keyboard: Keyboard) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    return on_gtk_window(window, move |gtk_window| {
        use gtk_layer_shell::{KeyboardMode, LayerShell};
        match keyboard {
            Keyboard::Exclusive => gtk_window.set_keyboard_mode(KeyboardMode::Exclusive),
            Keyboard::Release => {
                gtk_window.set_keyboard_mode(KeyboardMode::None);
                gtk_window.set_keyboard_mode(KeyboardMode::OnDemand);
            }
        }
    });
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, keyboard);
        Ok(())
    }
}

/// Restricts mouse input to `rects` (`None`: the whole window). Outside the
/// region, clicks go to whatever is underneath. No-op outside Linux.
fn set_input_region<R: Runtime>(
    window: &WebviewWindow<R>,
    rects: Option<Vec<Rect>>,
) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    return on_gtk_window(window, move |gtk_window| {
        use gtk::cairo::{RectangleInt, Region};
        use gtk::prelude::*;
        let region = rects.map(|rects| {
            let region = Region::create();
            for (x, y, width, height) in rects.into_iter().filter_map(Rect::to_pixels) {
                // Only fails on allocation failure; an incomplete region is
                // still better than none.
                let _ = region.union_rectangle(&RectangleInt::new(x, y, width, height));
            }
            region
        });
        gtk_window.input_shape_combine_region(region.as_ref());
    });
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, rects);
        Ok(())
    }
}

/// Runs `f` with the GTK window, on the main thread as GTK requires (commands
/// and the single-instance callback may run elsewhere).
#[cfg(target_os = "linux")]
fn on_gtk_window<R: Runtime>(
    window: &WebviewWindow<R>,
    f: impl FnOnce(&gtk::ApplicationWindow) + Send + 'static,
) -> tauri::Result<()> {
    let target = window.clone();
    window.run_on_main_thread(move || match target.gtk_window() {
        Ok(gtk_window) => f(&gtk_window),
        Err(error) => eprintln!("overquid: no GTK window: {error}"),
    })
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
