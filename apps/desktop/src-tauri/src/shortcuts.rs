//! Keyboard shortcuts: the ones read while the overlay has the keyboard, and
//! the global one that shows or hides it.
//!
//! Wayland lets no client grab a global key, so the global shortcut is set up
//! in the desktop itself where there is a way to: at runtime on Hyprland
//! (`hyprctl`), as a custom shortcut on GNOME (`gsettings`). Elsewhere the user
//! binds `overquid toggle` by hand.

use std::process::Command;

use serde::{Deserialize, Serialize};

/// A key with its modifiers, written `Ctrl+Shift+X`. The key is an XKB name
/// (`X`, `F5`, `comma`, `Return`), which GTK, Hyprland and GNOME all read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Accel {
    ctrl: bool,
    shift: bool,
    alt: bool,
    logo: bool,
    key: String,
}

impl Accel {
    /// `None` for anything but known modifiers followed by one plain key name:
    /// what gets through ends up in a Lua string and a command line.
    pub fn parse(text: &str) -> Option<Self> {
        let mut accel = Accel {
            ctrl: false,
            shift: false,
            alt: false,
            logo: false,
            key: String::new(),
        };
        let mut parts = text.split('+').map(str::trim).peekable();
        while let Some(part) = parts.next() {
            if parts.peek().is_none() {
                let valid = !part.is_empty()
                    && !matches!(part, "Ctrl" | "Shift" | "Alt" | "Super")
                    && part.len() <= 32
                    && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
                if !valid {
                    return None;
                }
                accel.key = part.to_owned();
                return Some(accel);
            }
            let flag = match part {
                "Ctrl" => &mut accel.ctrl,
                "Shift" => &mut accel.shift,
                "Alt" => &mut accel.alt,
                "Super" => &mut accel.logo,
                _ => return None,
            };
            if std::mem::replace(flag, true) {
                return None;
            }
        }
        None
    }

    fn hyprland(&self) -> String {
        let mut parts: Vec<&str> = Vec::new();
        for (on, name) in [
            (self.ctrl, "CTRL"),
            (self.shift, "SHIFT"),
            (self.alt, "ALT"),
            (self.logo, "SUPER"),
        ] {
            if on {
                parts.push(name);
            }
        }
        parts.push(&self.key);
        parts.join(" + ")
    }

    fn gnome(&self) -> String {
        let mut text = String::new();
        for (on, name) in [
            (self.ctrl, "<Control>"),
            (self.shift, "<Shift>"),
            (self.alt, "<Alt>"),
            (self.logo, "<Super>"),
        ] {
            if on {
                text.push_str(name);
            }
        }
        if self.key.len() == 1 {
            text.push_str(&self.key.to_ascii_lowercase());
        } else {
            text.push_str(&self.key);
        }
        text
    }

    /// Whether a key event is this shortcut. `key` is the event's key name.
    pub fn matches(&self, key: &str, mods: Mods) -> bool {
        // Shift+Tab reports a key of its own.
        let key = if key.eq_ignore_ascii_case("ISO_Left_Tab") {
            "Tab"
        } else {
            key
        };
        key.eq_ignore_ascii_case(&self.key)
            && mods.ctrl == self.ctrl
            && mods.shift == self.shift
            && mods.alt == self.alt
            && mods.logo == self.logo
    }
}

/// Modifiers held during a key event.
#[derive(Debug, Clone, Copy, Default)]
pub struct Mods {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
    pub logo: bool,
}

/// What a shortcut does while the overlay has the keyboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Close,
    NextOverlay,
    PreviousOverlay,
    Settings,
}

/// The shortcuts read while the overlay has the keyboard.
#[derive(Debug, Clone, Default)]
pub struct Keymap(Vec<(Accel, Action)>);

impl Keymap {
    pub fn action(&self, key: &str, mods: Mods) -> Option<Action> {
        self.0
            .iter()
            .find(|(accel, _)| accel.matches(key, mods))
            .map(|(_, action)| *action)
    }
}

/// What the interface sends: each shortcut as text, empty for none.
#[derive(Debug, Clone, Deserialize)]
pub struct Shortcuts {
    /// `None`: left to the desktop's own configuration.
    pub toggle: Option<String>,
    pub close: String,
    pub next: String,
    pub prev: String,
    pub settings: String,
}

impl Shortcuts {
    pub fn keymap(&self) -> Result<Keymap, String> {
        let mut map = Vec::new();
        for (text, action) in [
            (&self.close, Action::Close),
            (&self.next, Action::NextOverlay),
            (&self.prev, Action::PreviousOverlay),
            (&self.settings, Action::Settings),
        ] {
            if !text.is_empty() {
                map.push((parse(text)?, action));
            }
        }
        Ok(Keymap(map))
    }

    pub fn toggle(&self) -> Result<Option<Accel>, String> {
        self.toggle.as_deref().map(parse).transpose()
    }
}

fn parse(text: &str) -> Result<Accel, String> {
    Accel::parse(text).ok_or_else(|| format!("invalid shortcut '{text}'"))
}

/// The desktop the global shortcut is set up in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Desktop {
    Hyprland,
    Gnome,
    /// No way to set a shortcut from here: bind `overquid toggle` by hand.
    Manual,
}

pub fn detect_desktop() -> Desktop {
    if std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some() {
        Desktop::Hyprland
    } else if std::env::var("XDG_CURRENT_DESKTOP").is_ok_and(|desktop| desktop.contains("GNOME")) {
        Desktop::Gnome
    } else {
        Desktop::Manual
    }
}

/// The shortcut the documentation tells Hyprland users to set up in their
/// config: it gives way to the one chosen in the settings.
fn default_toggle() -> Accel {
    Accel::parse("Alt+Shift+X").expect("valid shortcut")
}

fn toggle_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    Ok(format!("{} toggle", exe.display()))
}

fn run(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("cannot run {program}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "{program} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn lua_string(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Lua run by Hyprland (0.56 and later) to replace a shortcut.
fn hyprland_script(remove: &Accel, add: Option<(&Accel, &str)>) -> String {
    let mut script = format!("hl.unbind({})", lua_string(&remove.hyprland()));
    if let Some((accel, command)) = add {
        script.push_str(&format!(
            "; hl.bind({}, hl.dsp.exec_cmd({}))",
            lua_string(&accel.hyprland()),
            lua_string(command)
        ));
    }
    script
}

/// Replaces `remove` with `add` in a Hyprland using a classic config.
fn hyprland_keywords(remove: &Accel, add: Option<(&Accel, &str)>) -> Result<(), String> {
    let classic = |accel: &Accel| {
        let mods: Vec<&str> = [
            (accel.ctrl, "CTRL"),
            (accel.shift, "SHIFT"),
            (accel.alt, "ALT"),
            (accel.logo, "SUPER"),
        ]
        .into_iter()
        .filter_map(|(on, name)| on.then_some(name))
        .collect();
        format!("{},{}", mods.join(" "), accel.key)
    };
    run("hyprctl", &["keyword", "unbind", &classic(remove)])?;
    if let Some((accel, command)) = add {
        let bind = format!("{},exec,{command}", classic(accel));
        run("hyprctl", &["keyword", "bind", &bind])?;
    }
    Ok(())
}

fn apply_hyprland(remove: &Accel, add: Option<&Accel>) -> Result<(), String> {
    let command = toggle_command()?;
    let add = add.map(|accel| (accel, command.as_str()));
    let script = hyprland_script(remove, add);
    match run("hyprctl", &["eval", &script]) {
        Ok(reply) if reply == "ok" => Ok(()),
        _ => hyprland_keywords(remove, add),
    }
}

const GNOME_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys";
const GNOME_KEY: &str = "custom-keybindings";
const GNOME_PATH: &str =
    "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/overquid/";

/// GNOME's list of custom shortcuts (`['/a/', '/b/']`) with Overquid's added or removed.
fn gnome_list(current: &str, present: bool) -> String {
    let mut paths: Vec<String> = current
        .trim()
        .trim_start_matches("@as")
        .trim()
        .trim_matches(['[', ']'])
        .split(',')
        .map(|path| path.trim().trim_matches('\'').to_owned())
        .filter(|path| !path.is_empty() && path != GNOME_PATH)
        .collect();
    if present {
        paths.push(GNOME_PATH.to_owned());
    }
    let quoted: Vec<String> = paths.iter().map(|path| format!("'{path}'")).collect();
    format!("[{}]", quoted.join(", "))
}

fn apply_gnome(add: Option<&Accel>) -> Result<(), String> {
    let current = run("gsettings", &["get", GNOME_SCHEMA, GNOME_KEY])?;
    if let Some(accel) = add {
        let schema = format!("{GNOME_SCHEMA}.custom-keybinding:{GNOME_PATH}");
        let command = toggle_command()?;
        run("gsettings", &["set", &schema, "name", "Overquid"])?;
        run("gsettings", &["set", &schema, "command", &command])?;
        run("gsettings", &["set", &schema, "binding", &accel.gnome()])?;
    }
    run(
        "gsettings",
        &[
            "set",
            GNOME_SCHEMA,
            GNOME_KEY,
            &gnome_list(&current, add.is_some()),
        ],
    )
    .map(|_| ())
}

/// Moves the global shortcut from `previous` to `next`. Either may be `None`:
/// the desktop's own configuration then decides.
pub fn apply_global(
    desktop: Desktop,
    previous: Option<&Accel>,
    next: Option<&Accel>,
) -> Result<(), String> {
    match desktop {
        Desktop::Manual => Ok(()),
        Desktop::Gnome => apply_gnome(next),
        Desktop::Hyprland => {
            let default = default_toggle();
            match (previous, next) {
                (None, None) => Ok(()),
                // Taking over: the shortcut from the user's config gives way.
                (None, Some(next)) => apply_hyprland(&default, Some(next)),
                (Some(previous), next @ Some(_)) => apply_hyprland(previous, next),
                // Giving back: the config's shortcut works again right away.
                (Some(previous), None) => {
                    apply_hyprland(previous, None)?;
                    apply_hyprland(&default, Some(&default))
                }
            }
        }
    }
}

/// Sets the global shortcut up again after Hyprland reloaded its config, which
/// drops what was bound at runtime and brings back what the config binds.
pub fn reapply_global(accel: &Accel) -> Result<(), String> {
    apply_hyprland(&default_toggle(), Some(accel))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn accel(text: &str) -> Accel {
        Accel::parse(text).unwrap()
    }

    #[test]
    fn parses_shortcuts() {
        let parsed = accel("Ctrl+Shift+X");
        assert!(parsed.ctrl && parsed.shift && !parsed.alt && !parsed.logo);
        assert_eq!(parsed.key, "X");
        assert_eq!(accel("F5").key, "F5");
        assert_eq!(accel("Super+Return").key, "Return");
    }

    #[test]
    fn refuses_anything_else() {
        for bad in [
            "",
            "Ctrl+",
            "Ctrl",
            "Meta+X",
            "Ctrl+Ctrl+X",
            "Ctrl+X\"); os.execute(\"x",
            "X Y",
            "Alt+a/b",
        ] {
            assert_eq!(Accel::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn writes_each_desktops_format() {
        let parsed = accel("Alt+Shift+X");
        assert_eq!(parsed.hyprland(), "SHIFT + ALT + X");
        assert_eq!(parsed.gnome(), "<Shift><Alt>x");
        assert_eq!(accel("Super+Return").gnome(), "<Super>Return");
    }

    #[test]
    fn matches_key_events() {
        let held = |ctrl, shift| Mods {
            ctrl,
            shift,
            ..Mods::default()
        };
        assert!(accel("Ctrl+X").matches("x", held(true, false)));
        assert!(!accel("Ctrl+X").matches("x", held(false, false)));
        assert!(!accel("Ctrl+X").matches("x", held(true, true)));
        assert!(accel("Ctrl+Shift+Tab").matches("ISO_Left_Tab", held(true, true)));
        assert!(accel("Escape").matches("Escape", Mods::default()));
    }

    #[test]
    fn keymap_finds_actions_and_skips_empty_ones() {
        let shortcuts = Shortcuts {
            toggle: None,
            close: "Escape".into(),
            next: "Ctrl+Tab".into(),
            prev: String::new(),
            settings: String::new(),
        };
        let map = shortcuts.keymap().unwrap();
        assert_eq!(map.action("Escape", Mods::default()), Some(Action::Close));
        let ctrl = Mods {
            ctrl: true,
            ..Mods::default()
        };
        assert_eq!(map.action("Tab", ctrl), Some(Action::NextOverlay));
        assert_eq!(map.action("x", ctrl), None);
        let bad = Shortcuts {
            close: "nope+x".into(),
            ..shortcuts
        };
        assert!(bad.keymap().is_err());
    }

    #[test]
    fn hyprland_script_replaces_a_binding() {
        assert_eq!(
            hyprland_script(
                &accel("Alt+Shift+X"),
                Some((&accel("Super+O"), "/a b/overquid toggle"))
            ),
            "hl.unbind(\"SHIFT + ALT + X\"); hl.bind(\"SUPER + O\", hl.dsp.exec_cmd(\"/a b/overquid toggle\"))"
        );
        assert_eq!(hyprland_script(&accel("F1"), None), "hl.unbind(\"F1\")");
    }

    #[test]
    fn lua_strings_are_escaped() {
        assert_eq!(lua_string(r#"a"b\c"#), r#""a\"b\\c""#);
    }

    #[test]
    fn gnome_list_adds_and_removes_once() {
        let other = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/other/";
        let added = gnome_list(&format!("['{other}']"), true);
        assert_eq!(added, format!("['{other}', '{GNOME_PATH}']"));
        assert_eq!(gnome_list(&added, true), added);
        assert_eq!(gnome_list(&added, false), format!("['{other}']"));
        assert_eq!(gnome_list("@as []", false), "[]");
    }
}
