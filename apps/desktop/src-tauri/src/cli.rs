//! Command line of the `overquid` binary.
//!
//! The first invocation starts the overlay. Later invocations are forwarded to
//! the running instance (see `tauri-plugin-single-instance`), so a compositor
//! hotkey can simply run `overquid toggle`.

use std::fmt;

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
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CliError::Help => f.write_str(USAGE),
            CliError::Unknown(arg) => write!(f, "unknown command '{arg}'\n\n{USAGE}"),
            CliError::TooManyArguments => write!(f, "expected at most one command\n\n{USAGE}"),
        }
    }
}

pub const USAGE: &str = "\
Usage: overquid [COMMAND]

Commands:
  (none)   start the overlay in the background, hidden
  toggle   show the overlay if hidden, hide it otherwise
  show     show the overlay
  hide     hide the overlay";

/// Parses the arguments that follow the program name.
pub fn parse<I, S>(args: I) -> Result<Command, CliError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut args = args.into_iter();
    let command = match args.next() {
        None => Command::Run,
        Some(arg) => match arg.as_ref() {
            "toggle" => Command::Toggle,
            "show" => Command::Show,
            "hide" => Command::Hide,
            "-h" | "--help" | "help" => return Err(CliError::Help),
            other => return Err(CliError::Unknown(other.to_owned())),
        },
    };
    if args.next().is_some() {
        return Err(CliError::TooManyArguments);
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_argument_runs() {
        assert_eq!(parse(Vec::<&str>::new()), Ok(Command::Run));
    }

    #[test]
    fn known_commands() {
        assert_eq!(parse(["toggle"]), Ok(Command::Toggle));
        assert_eq!(parse(["show"]), Ok(Command::Show));
        assert_eq!(parse(["hide"]), Ok(Command::Hide));
    }

    #[test]
    fn help_and_errors() {
        assert_eq!(parse(["--help"]), Err(CliError::Help));
        assert_eq!(parse(["fly"]), Err(CliError::Unknown("fly".into())));
        assert_eq!(parse(["toggle", "now"]), Err(CliError::TooManyArguments));
    }
}
