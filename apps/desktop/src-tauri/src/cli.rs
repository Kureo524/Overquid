//! Command line of the `overquid` binary.
//!
//! The first invocation starts the overlay. Later invocations are forwarded to
//! the running instance (see `tauri-plugin-single-instance`), so a compositor
//! hotkey can simply run `overquid toggle`.

use std::fmt;

use serde::Serialize;

/// What an invocation asks the running instance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Request {
    /// Show, hide or toggle the overlay (handled by the core).
    Visibility(Command),
    /// Change the active overlay (handled by the interface, ADR 0006).
    Overlay(OverlaySwitch),
}

/// Which overlay to show, relayed to the interface as is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OverlaySwitch {
    Next,
    Prev,
    Switch { name: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    /// Start the overlay hidden, or do nothing if it already runs.
    Run,
    Toggle,
    Show,
    Hide,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CliError {
    Help,
    Unknown(String),
    TooManyArguments,
    MissingName,
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CliError::Help => f.write_str(USAGE),
            CliError::Unknown(arg) => write!(f, "unknown command '{arg}'\n\n{USAGE}"),
            CliError::TooManyArguments => write!(f, "too many arguments\n\n{USAGE}"),
            CliError::MissingName => write!(f, "switch needs an overlay name\n\n{USAGE}"),
        }
    }
}

pub const USAGE: &str = "\
Usage: overquid [COMMAND]

Commands:
  (none)         start the overlay in the background, hidden
  toggle         show the overlay if hidden, hide it otherwise
  show           show the overlay
  hide           hide the overlay
  next, prev     go to the next or previous overlay
  switch NAME    go to the overlay called NAME";

/// Parses the arguments that follow the program name.
pub fn parse<I, S>(args: I) -> Result<Request, CliError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut args = args.into_iter();
    let request = match args.next() {
        None => Request::Visibility(Command::Run),
        Some(arg) => match arg.as_ref() {
            "toggle" => Request::Visibility(Command::Toggle),
            "show" => Request::Visibility(Command::Show),
            "hide" => Request::Visibility(Command::Hide),
            "next" => Request::Overlay(OverlaySwitch::Next),
            "prev" => Request::Overlay(OverlaySwitch::Prev),
            "switch" => {
                let name = args.next().ok_or(CliError::MissingName)?;
                let name = name.as_ref().trim();
                if name.is_empty() {
                    return Err(CliError::MissingName);
                }
                Request::Overlay(OverlaySwitch::Switch {
                    name: name.to_owned(),
                })
            }
            "-h" | "--help" | "help" => return Err(CliError::Help),
            other => return Err(CliError::Unknown(other.to_owned())),
        },
    };
    if args.next().is_some() {
        return Err(CliError::TooManyArguments);
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn visibility(command: Command) -> Result<Request, CliError> {
        Ok(Request::Visibility(command))
    }

    #[test]
    fn no_argument_runs() {
        assert_eq!(parse(Vec::<&str>::new()), visibility(Command::Run));
    }

    #[test]
    fn known_commands() {
        assert_eq!(parse(["toggle"]), visibility(Command::Toggle));
        assert_eq!(parse(["show"]), visibility(Command::Show));
        assert_eq!(parse(["hide"]), visibility(Command::Hide));
        assert_eq!(parse(["next"]), Ok(Request::Overlay(OverlaySwitch::Next)));
        assert_eq!(parse(["prev"]), Ok(Request::Overlay(OverlaySwitch::Prev)));
        assert_eq!(
            parse(["switch", " Gaming "]),
            Ok(Request::Overlay(OverlaySwitch::Switch {
                name: "Gaming".into()
            }))
        );
    }

    #[test]
    fn help_and_errors() {
        assert_eq!(parse(["--help"]), Err(CliError::Help));
        assert_eq!(parse(["fly"]), Err(CliError::Unknown("fly".into())));
        assert_eq!(parse(["toggle", "now"]), Err(CliError::TooManyArguments));
        assert_eq!(parse(["switch"]), Err(CliError::MissingName));
        assert_eq!(parse(["switch", "  "]), Err(CliError::MissingName));
        assert_eq!(parse(["switch", "a", "b"]), Err(CliError::TooManyArguments));
    }

    #[test]
    fn overlay_switches_reach_the_interface_as_tagged_json() {
        let json = serde_json::to_value(OverlaySwitch::Switch {
            name: "Work".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "switch", "name": "Work" })
        );
    }
}
