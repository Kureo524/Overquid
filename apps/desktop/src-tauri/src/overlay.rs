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

use crate::cli::{Command, OverlaySwitch};
use crate::shortcuts::{Action, Keymap};
use crate::state::{self, Rect, Visibility};

/// Event sent to the web view each time the visibility changes.
pub const STATE_EVENT: &str = "overlay-state";
/// Sent with a `cli::OverlaySwitch` to change the active overlay.
pub const SWITCH_EVENT: &str = "overlay-switch";
/// Sent when the shortcut that opens the settings is pressed.
const SETTINGS_EVENT: &str = "open-settings";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    LayerShell,
    Fallback,
}

/// A screen the overlay can be placed on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MonitorInfo {
    /// Stable across restarts: model and position.
    pub id: String,
    pub name: String,
    pub width: i32,
    pub height: i32,
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
    keymap: Keymap,
    /// The screen the user chose (`MonitorInfo::id`); `None` lets the desktop choose.
    monitor: Option<String>,
    /// While a shortcut is being recorded, keys go to the page.
    shortcuts_suspended: bool,
    /// The shortcut held down, run once its key is released.
    pressed: Option<Action>,
}

impl Overlay {
    /// Turns the (still hidden) window into an overlay.
    pub fn setup<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<Self> {
        let mode = platform_setup(window)?;
        #[cfg(target_os = "linux")]
        {
            handle_shortcuts(window)?;
            crate::web_panels::install(&window.gtk_window()?);
        }
        Ok(Self {
            mode,
            inner: Mutex::new(Inner {
                visibility: Visibility::Hidden,
                pinned: Vec::new(),
                keymap: Keymap::default(),
                monitor: None,
                shortcuts_suspended: false,
                pressed: None,
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
    /// while pinned. `restore` is set for the first report after the saved
    /// layout is loaded: pinned panels then come back on screen.
    pub fn set_pinned<R: Runtime>(
        &self,
        window: &WebviewWindow<R>,
        rects: Vec<Rect>,
        restore: bool,
    ) -> tauri::Result<()> {
        self.transition(window, |inner| {
            inner.pinned = rects;
            let has_pinned = !inner.pinned.is_empty();
            if restore {
                state::after_restore(inner.visibility, has_pinned)
            } else {
                state::after_pinned_change(inner.visibility, has_pinned)
            }
        })
    }

    /// Hands the keyboard back to the app underneath while pinned.
    pub fn release_keyboard<R: Runtime>(&self, window: &WebviewWindow<R>) -> tauri::Result<()> {
        if self.mode == Mode::LayerShell && self.lock().visibility == Visibility::Pinned {
            set_keyboard(window, Keyboard::Release)?;
        }
        Ok(())
    }

    /// Escape: closes the summoned overlay, or hands the keyboard back while
    /// pinned.
    pub fn escape<R: Runtime>(&self, window: &WebviewWindow<R>) -> tauri::Result<()> {
        if self.lock().visibility == Visibility::Summoned {
            self.dismiss(window)
        } else {
            self.release_keyboard(window)
        }
    }

    /// Moves the overlay to a screen. `None` gives the choice back to the desktop.
    pub fn set_monitor<R: Runtime>(
        &self,
        window: &WebviewWindow<R>,
        monitor: Option<String>,
    ) -> tauri::Result<()> {
        self.lock().monitor.clone_from(&monitor);
        place_on_monitor(window, self.mode, monitor)
    }

    pub fn set_keymap(&self, keymap: Keymap) {
        self.lock().keymap = keymap;
    }

    /// Stops reading shortcuts while one is being recorded.
    pub fn suspend_shortcuts(&self, suspended: bool) {
        let mut inner = self.lock();
        inner.shortcuts_suspended = suspended;
        inner.pressed = None;
    }

    fn run_action<R: Runtime>(
        &self,
        window: &WebviewWindow<R>,
        action: Action,
    ) -> tauri::Result<()> {
        match action {
            Action::Close => self.escape(window),
            Action::NextOverlay => window.emit(SWITCH_EVENT, OverlaySwitch::Next),
            Action::PreviousOverlay => window.emit(SWITCH_EVENT, OverlaySwitch::Prev),
            Action::Settings => window.emit(SETTINGS_EVENT, ()),
        }
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
                if self.mode == Mode::Fallback {
                    window.set_focusable(true)?;
                    // Already mapped for pinned panels: GNOME would neither
                    // raise nor focus it. Map it again, as a new window.
                    if previous == Visibility::Pinned {
                        window.hide()?;
                    }
                }
                set_input_region(window, None)?;
                window.show()?;
                if self.mode == Mode::Fallback {
                    self.cover(window)?;
                    window.set_focus()?;
                } else {
                    set_keyboard(window, Keyboard::Exclusive)?;
                }
            }
            Visibility::Pinned => {
                if self.mode == Mode::Fallback && previous == Visibility::Summoned {
                    remap_unfocused(window)?;
                    self.cover(window)?;
                } else if previous == Visibility::Hidden {
                    // Saved layout restored at startup.
                    if self.mode == Mode::Fallback {
                        // Unfocusable from the start: pinned panels never
                        // take the keyboard in fallback mode.
                        window.set_focusable(false)?;
                        window.show()?;
                        self.cover(window)?;
                    } else {
                        window.show()?;
                    }
                }
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

    /// Fallback mode: sizes the window to its screen.
    fn cover<R: Runtime>(&self, window: &WebviewWindow<R>) -> tauri::Result<()> {
        let monitor = self.lock().monitor.clone();
        place_on_monitor(window, Mode::Fallback, monitor)
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

/// Shortcuts are read on the GTK window, before WebKit: a key typed while a
/// plugin's iframe has the focus never reaches the overlay's own page.
///
/// Both press and release are consumed, and the action runs on the release:
/// hiding on the press unmaps the window before the release arrives (see the
/// Escape fix in #11), and a press without its release leaves WebKit thinking
/// the key is still held.
#[cfg(target_os = "linux")]
fn handle_shortcuts<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    use gtk::gdk::ModifierType;
    use gtk::glib::Propagation;
    use gtk::prelude::*;
    use tauri::Manager;

    use crate::shortcuts::Mods;

    let gtk_window = window.gtk_window()?;
    let source = window.clone();
    gtk_window.connect_key_press_event(move |_, event| {
        let Some(overlay) = source.try_state::<Overlay>() else {
            return Propagation::Proceed;
        };
        let state = event.state();
        let mods = Mods {
            ctrl: state.contains(ModifierType::CONTROL_MASK),
            shift: state.contains(ModifierType::SHIFT_MASK),
            alt: state.contains(ModifierType::MOD1_MASK),
            logo: state.intersects(ModifierType::SUPER_MASK | ModifierType::MOD4_MASK),
        };
        let name = event.keyval().to_lower().name().unwrap_or_default();
        let mut inner = overlay.lock();
        if inner.shortcuts_suspended {
            return Propagation::Proceed;
        }
        match inner.keymap.action(&name, mods) {
            Some(action) => {
                inner.pressed = Some(action);
                Propagation::Stop
            }
            None => Propagation::Proceed,
        }
    });
    let target = window.clone();
    gtk_window.connect_key_release_event(move |_, _| {
        let Some(overlay) = target.try_state::<Overlay>() else {
            return Propagation::Proceed;
        };
        let Some(action) = overlay.lock().pressed.take() else {
            return Propagation::Proceed;
        };
        if let Err(error) = overlay.run_action(&target, action) {
            eprintln!("overquid: shortcut failed: {error}");
        }
        Propagation::Stop
    });
    Ok(())
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

/// Fallback mode, summoned to pinned: gives up the keyboard focus.
///
/// On GNOME, while the overlay window has the keyboard focus, no click goes
/// through it, whatever its input region. Making it unfocusable is not enough
/// once it has the focus: it is unmapped and mapped again. GNOME then gives
/// the focus to no window (a Wayland client cannot hand it to another one),
/// so the user clicks the app underneath to type in it again. A pinned panel
/// cannot take the keyboard in fallback mode.
fn remap_unfocused<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    window.set_focusable(false)?;
    window.hide()?;
    window.show()
}

/// Identifies a monitor across restarts (GTK 3 does not expose its connector).
#[cfg(target_os = "linux")]
fn monitor_id(monitor: &gtk::gdk::Monitor) -> String {
    use gtk::prelude::*;
    let box_ = monitor.geometry();
    format!(
        "{}:{}x{}+{}+{}",
        monitor.model().unwrap_or_default(),
        box_.width(),
        box_.height(),
        box_.x(),
        box_.y()
    )
}

#[cfg(target_os = "linux")]
fn gdk_monitors() -> Vec<gtk::gdk::Monitor> {
    let Some(display) = gtk::gdk::Display::default() else {
        return Vec::new();
    };
    (0..display.n_monitors())
        .filter_map(|index| display.monitor(index))
        .collect()
}

/// Screens the overlay can be placed on. Must run on the main thread.
#[cfg(target_os = "linux")]
pub fn monitors() -> Vec<MonitorInfo> {
    use gtk::prelude::*;
    gdk_monitors()
        .iter()
        .map(|monitor| {
            let box_ = monitor.geometry();
            MonitorInfo {
                id: monitor_id(monitor),
                name: monitor
                    .model()
                    .map(|model| model.to_string())
                    .filter(|model| !model.is_empty())
                    .unwrap_or_else(|| "Screen".to_owned()),
                width: box_.width(),
                height: box_.height(),
            }
        })
        .collect()
}

#[cfg(not(target_os = "linux"))]
pub fn monitors() -> Vec<MonitorInfo> {
    Vec::new()
}

/// Puts the window on the chosen screen. A layer surface is remapped by GTK; a
/// fallback window is sized to the screen (the current one if none is chosen).
fn place_on_monitor<R: Runtime>(
    window: &WebviewWindow<R>,
    mode: Mode,
    monitor: Option<String>,
) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    let target = window.clone();
    #[cfg(target_os = "linux")]
    return window.run_on_main_thread(move || {
        let chosen = monitor.as_ref().and_then(|id| {
            gdk_monitors()
                .into_iter()
                .find(|candidate| monitor_id(candidate) == *id)
        });
        if mode == Mode::LayerShell {
            match target.gtk_window() {
                Ok(gtk_window) => set_layer_monitor(&gtk_window, chosen.as_ref()),
                Err(error) => eprintln!("overquid: no GTK window: {error}"),
            }
            return;
        }
        let placed = match &chosen {
            Some(monitor) => cover_gdk_monitor(&target, monitor),
            None => cover_monitor(&target),
        };
        if let Err(error) = placed {
            eprintln!("overquid: cannot size the overlay: {error}");
        }
    });
    #[cfg(not(target_os = "linux"))]
    {
        let _ = monitor;
        if mode == Mode::Fallback {
            cover_monitor(window)?;
        }
        Ok(())
    }
}

/// The binding only accepts a monitor; the C function also takes none, which
/// gives the choice back to the compositor.
#[cfg(target_os = "linux")]
fn set_layer_monitor(window: &gtk::ApplicationWindow, monitor: Option<&gtk::gdk::Monitor>) {
    use gtk::glib::translate::ToGlibPtr;
    use gtk::prelude::*;
    let window: &gtk::Window = window.upcast_ref();
    // SAFETY: both pointers are valid for the call (or null for the monitor,
    // which the function documents as "let the compositor choose").
    unsafe {
        gtk_layer_shell_sys::gtk_layer_set_monitor(
            window.to_glib_none().0,
            monitor.to_glib_none().0,
        );
    }
}

#[cfg(target_os = "linux")]
fn cover_gdk_monitor<R: Runtime>(
    window: &WebviewWindow<R>,
    monitor: &gtk::gdk::Monitor,
) -> tauri::Result<()> {
    use gtk::prelude::*;
    let box_ = monitor.geometry();
    let scale = monitor.scale_factor();
    window.set_position(tauri::PhysicalPosition::new(
        box_.x() * scale,
        box_.y() * scale,
    ))?;
    window.set_size(tauri::PhysicalSize::new(
        (box_.width() * scale) as u32,
        (box_.height() * scale) as u32,
    ))
}

/// Sizes the fallback window to its monitor. Layer-shell surfaces are sized by
/// their anchors instead.
///
/// Done after `show()` because window managers ignore geometry requests on
/// unmapped windows. Not `maximize()`: GNOME and Hyprland ignore it for a
/// non-resizable window. Not `set_fullscreen()`: GNOME paints black behind
/// fullscreen windows, which kills the transparency.
fn cover_monitor<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    // A window that was never shown has no current monitor, and Wayland has
    // no primary monitor: fall back to the first one rather than do nothing.
    let monitor = match window.current_monitor()? {
        Some(monitor) => Some(monitor),
        None => match window.primary_monitor()? {
            Some(monitor) => Some(monitor),
            None => window.available_monitors()?.into_iter().next(),
        },
    };
    if let Some(monitor) = monitor {
        window.set_position(*monitor.position())?;
        window.set_size(*monitor.size())?;
    }
    Ok(())
}
