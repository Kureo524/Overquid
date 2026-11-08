//! What the overlay shows, as a pure state machine (no window involved).
//!
//! - `Hidden`: nothing on screen, no input taken.
//! - `Summoned`: every panel, a veil over the desktop, keyboard and mouse
//!   captured. What the hotkey brings up.
//! - `Pinned`: only the pinned panels stay on screen. Clicks outside them and
//!   the keyboard go to the app underneath; a pinned panel gets the keyboard
//!   only when clicked.

use serde::{Deserialize, Serialize};

use crate::cli::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Visibility {
    Hidden,
    Summoned,
    Pinned,
}

/// A pinned panel's area, in CSS pixels relative to the overlay window.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    /// Integer rectangle covering this one entirely (rounded outwards), or
    /// `None` if it is empty.
    pub fn to_pixels(self) -> Option<(i32, i32, i32, i32)> {
        let left = self.x.floor();
        let top = self.y.floor();
        let right = (self.x + self.width).ceil();
        let bottom = (self.y + self.height).ceil();
        let (width, height) = (right - left, bottom - top);
        (width > 0.0 && height > 0.0).then_some((
            left as i32,
            top as i32,
            width as i32,
            height as i32,
        ))
    }
}

/// Where the overlay goes when dismissed: pinned panels stay, otherwise hide.
pub fn resting(has_pinned: bool) -> Visibility {
    if has_pinned {
        Visibility::Pinned
    } else {
        Visibility::Hidden
    }
}

/// Visibility after a command line command (`overquid toggle`…).
pub fn after_command(current: Visibility, command: Command, has_pinned: bool) -> Visibility {
    match command {
        Command::Run => current,
        Command::Show => Visibility::Summoned,
        Command::Hide => Visibility::Hidden,
        Command::Toggle => match current {
            Visibility::Summoned => resting(has_pinned),
            Visibility::Hidden | Visibility::Pinned => Visibility::Summoned,
        },
    }
}

/// Visibility after the user dismisses the overlay (Escape).
pub fn after_dismiss(current: Visibility, has_pinned: bool) -> Visibility {
    match current {
        Visibility::Summoned => resting(has_pinned),
        other => other,
    }
}

/// Visibility after the set of pinned panels changed.
pub fn after_pinned_change(current: Visibility, has_pinned: bool) -> Visibility {
    match current {
        Visibility::Pinned if !has_pinned => Visibility::Hidden,
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::Visibility::{Hidden, Pinned, Summoned};
    use super::*;

    #[test]
    fn toggle_summons_then_rests() {
        assert_eq!(after_command(Hidden, Command::Toggle, false), Summoned);
        assert_eq!(after_command(Summoned, Command::Toggle, false), Hidden);
        assert_eq!(after_command(Summoned, Command::Toggle, true), Pinned);
        assert_eq!(after_command(Pinned, Command::Toggle, true), Summoned);
    }

    #[test]
    fn show_and_hide_are_absolute() {
        for current in [Hidden, Summoned, Pinned] {
            assert_eq!(after_command(current, Command::Show, true), Summoned);
            assert_eq!(after_command(current, Command::Hide, true), Hidden);
            assert_eq!(after_command(current, Command::Run, true), current);
        }
    }

    #[test]
    fn dismiss_only_leaves_summoned() {
        assert_eq!(after_dismiss(Summoned, true), Pinned);
        assert_eq!(after_dismiss(Summoned, false), Hidden);
        assert_eq!(after_dismiss(Pinned, true), Pinned);
        assert_eq!(after_dismiss(Hidden, false), Hidden);
    }

    #[test]
    fn unpinning_the_last_panel_hides() {
        assert_eq!(after_pinned_change(Pinned, false), Hidden);
        assert_eq!(after_pinned_change(Pinned, true), Pinned);
        assert_eq!(after_pinned_change(Summoned, false), Summoned);
    }

    #[test]
    fn rect_rounds_outwards() {
        let rect = Rect {
            x: 10.4,
            y: 20.6,
            width: 100.2,
            height: 50.0,
        };
        assert_eq!(rect.to_pixels(), Some((10, 20, 101, 51)));
        let empty = Rect {
            x: 5.0,
            y: 5.0,
            width: 0.0,
            height: 10.0,
        };
        assert_eq!(empty.to_pixels(), None);
    }
}
