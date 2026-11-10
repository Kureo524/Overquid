//! Starting the applications a plugin declares in its manifest (ADR 0013).
//!
//! An application is named by its desktop entry (`com.obsproject.Studio`), so
//! the same name works for a distribution package and a Flatpak. The command
//! comes from that entry; a plugin only adds arguments, and nothing goes
//! through a shell it controls.

use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

const MAX_ARGS: usize = 16;
const MAX_ARG_LEN: usize = 256;

/// A desktop entry id: letters, digits, `.`, `-`, `_`.
pub fn is_valid_app(app: &str) -> bool {
    !app.is_empty()
        && !app.starts_with('.')
        && !app.contains("..")
        && app
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// A Hyprland workspace: a number, a name or `special:name`.
fn is_valid_workspace(workspace: &str) -> bool {
    !workspace.is_empty()
        && workspace.len() <= 64
        && workspace
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '-' | '_'))
}

/// Folders that hold desktop entries, the user's first.
fn entry_folders() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| home.map(|home| home.join(".local/share")));
    let data_dirs =
        std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
    data_home
        .into_iter()
        .chain(std::env::split_paths(&data_dirs))
        .map(|folder| folder.join("applications"))
        .collect()
}

/// The command of a desktop entry, without its `%f`-like placeholders.
pub fn command_of(entry: &str) -> Option<Vec<String>> {
    let mut in_main = false;
    for line in entry.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_main = line == "[Desktop Entry]";
        } else if in_main && let Some(exec) = line.strip_prefix("Exec") {
            let exec = exec.trim_start().strip_prefix('=')?;
            let words = split_exec(exec.trim());
            return (!words.is_empty()).then_some(words);
        }
    }
    None
}

/// Splits an `Exec` value: words, double quotes, backslash escapes inside
/// quotes; placeholders (`%u`, `%F`…) are dropped, `%%` is a percent sign.
fn split_exec(exec: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut started = false;
    let mut quoted = false;
    let mut chars = exec.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            '\\' if quoted => word.extend(chars.next()),
            '%' => {
                if let Some('%') = chars.next() {
                    word.push('%');
                }
            }
            c if c.is_whitespace() && !quoted => {
                if started || !word.is_empty() {
                    words.push(std::mem::take(&mut word));
                }
                started = false;
            }
            c => word.push(c),
        }
    }
    if started || !word.is_empty() {
        words.push(word);
    }
    words
}

fn find_command(app: &str) -> Option<Vec<String>> {
    entry_folders().into_iter().find_map(|folder| {
        let entry = std::fs::read_to_string(folder.join(format!("{app}.desktop"))).ok()?;
        command_of(&entry)
    })
}

/// One word for `sh`, whatever it contains.
fn shell_quote(word: &str) -> String {
    format!("'{}'", word.replace('\'', r"'\''"))
}

/// The Lua asking Hyprland to start `command` on `workspace` without going
/// there.
pub fn hyprland_script(command: &[String], workspace: &str) -> String {
    let line: Vec<String> = command.iter().map(|word| shell_quote(word)).collect();
    let rule = format!("[workspace {workspace} silent] {}", line.join(" "));
    let literal = rule.replace('\\', r"\\").replace('"', "\\\"");
    format!("hl.dispatch(hl.dsp.exec_cmd(\"{literal}\"))")
}

fn on_hyprland() -> bool {
    std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some()
}

fn hyprctl(args: &[&str]) -> bool {
    Command::new("hyprctl")
        .args(args)
        .output()
        .is_ok_and(|output| {
            output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "ok"
        })
}

fn launch(command: &[String], workspace: Option<&str>) -> Result<(), String> {
    if let Some(workspace) = workspace.filter(|_| on_hyprland()) {
        // Lua configs take `eval`; older ones take the classic dispatcher.
        if hyprctl(&["eval", &hyprland_script(command, workspace)]) {
            return Ok(());
        }
        let line: Vec<String> = command.iter().map(|word| shell_quote(word)).collect();
        let rule = format!("[workspace {workspace} silent] {}", line.join(" "));
        if hyprctl(&["dispatch", "exec", &rule]) {
            return Ok(());
        }
    }
    let mut child = Command::new(&command[0])
        .args(&command[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("cannot start it: {error}"))?;
    // Reaped when it ends, so that it does not stay as a zombie.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

fn arguments(args: &Value) -> Result<Vec<String>, String> {
    let Some(list) = args.get("args") else {
        return Ok(Vec::new());
    };
    let list = list.as_array().ok_or("'args' must be a list of strings")?;
    if list.len() > MAX_ARGS {
        return Err("too many arguments".into());
    }
    list.iter()
        .map(|arg| {
            arg.as_str()
                .filter(|arg| arg.len() <= MAX_ARG_LEN && !arg.contains('\0'))
                .map(str::to_owned)
                .ok_or_else(|| "'args' must be a list of short strings".to_owned())
        })
        .collect()
}

/// `apps.*` calls. `declared` is the manifest's `apps` list.
pub fn call(declared: &[String], method: &str, args: &Value) -> Result<Value, String> {
    let app = args
        .get("app")
        .and_then(Value::as_str)
        .ok_or("'app' must be a string")?;
    if !is_valid_app(app) || !declared.iter().any(|known| known == app) {
        return Err(format!("'{app}' is not in the manifest's apps"));
    }
    match method {
        "apps.installed" => Ok(json!(find_command(app).is_some())),
        "apps.launch" => {
            let workspace = match args.get("workspace") {
                None | Some(Value::Null) => None,
                Some(value) => Some(
                    value
                        .as_str()
                        .filter(|workspace| is_valid_workspace(workspace))
                        .ok_or("'workspace' is not a workspace name")?,
                ),
            };
            let mut command = find_command(app).ok_or(format!("{app} is not installed"))?;
            command.extend(arguments(args)?);
            launch(&command, workspace).map(|()| Value::Null)
        }
        other => Err(format!("unknown method '{other}'")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(list: &[&str]) -> Vec<String> {
        list.iter().map(|word| (*word).to_owned()).collect()
    }

    #[test]
    fn reads_the_command_of_a_desktop_entry() {
        let entry = "[Desktop Entry]\nName=OBS\nExec=/usr/bin/flatpak run --command=obs com.obsproject.Studio %U\n\n[Desktop Action new]\nExec=other\n";
        assert_eq!(
            command_of(entry),
            Some(words(&[
                "/usr/bin/flatpak",
                "run",
                "--command=obs",
                "com.obsproject.Studio"
            ]))
        );
        assert_eq!(
            command_of("[Desktop Entry]\nExec = \"my app\" --title \"a \\\"b\\\"\" 100%% %f"),
            Some(words(&["my app", "--title", "a \"b\"", "100%"]))
        );
        assert_eq!(command_of("[Desktop Action x]\nExec=other"), None);
        assert_eq!(command_of("[Desktop Entry]\nExec="), None);
    }

    #[test]
    fn only_declared_apps_can_be_started() {
        let declared = vec!["com.example.App".to_owned()];
        let call = |args| call(&declared, "apps.launch", &args);
        assert!(call(json!({ "app": "org.other.App" })).is_err());
        assert!(call(json!({ "app": "../../bin/sh" })).is_err());
        assert!(call(json!({})).is_err());
        // Declared, but refused before anything starts.
        assert!(call(json!({ "app": "com.example.App", "workspace": "1; rm" })).is_err());
        assert!(call(json!({ "app": "com.example.App", "workspace": 3 })).is_err());
    }

    #[test]
    fn arguments_are_short_strings() {
        assert_eq!(arguments(&json!({})), Ok(Vec::new()));
        assert_eq!(
            arguments(&json!({ "args": ["--a", "b c"] })),
            Ok(words(&["--a", "b c"]))
        );
        assert!(arguments(&json!({ "args": "--a" })).is_err());
        assert!(arguments(&json!({ "args": [1] })).is_err());
        assert!(arguments(&json!({ "args": ["x".repeat(MAX_ARG_LEN + 1)] })).is_err());
        assert!(arguments(&json!({ "args": vec!["a"; MAX_ARGS + 1] })).is_err());
    }

    #[test]
    fn hyprland_gets_one_quoted_command() {
        let script = hyprland_script(&words(&["obs", "--pass", "a'b \"c\" \\"]), "special:obs");
        assert_eq!(
            script,
            r#"hl.dispatch(hl.dsp.exec_cmd("[workspace special:obs silent] 'obs' '--pass' 'a'\\''b \"c\" \\'"))"#
        );
    }
}
