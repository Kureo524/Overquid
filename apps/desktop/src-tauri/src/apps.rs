//! Starting the applications a plugin declares in its manifest (ADR 0013).
//!
//! An application is named by its desktop entry (`com.obsproject.Studio`), so
//! the same name works for a distribution package and a Flatpak. The command
//! comes from that entry; a plugin only adds arguments, and nothing goes
//! through a shell it controls.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;

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

/// Where a docked window goes when it leaves the overlay.
const DEFAULT_DOCK_WORKSPACE: &str = "special:overquid";

/// A rectangle in pixels: x, y, width, height.
pub type Pixels = (i32, i32, i32, i32);

/// A window shown through the overlay (ADR 0014).
struct Docked {
    app: String,
    /// Hyprland's address of the application's main window.
    address: String,
    pid: i64,
    /// Corner of the overlay's screen: the overlay's pixels start there.
    origin: (i32, i32),
    size: (i32, i32),
    /// Windows that were already open when the window was docked.
    known: HashSet<String>,
    /// The application's other windows on screen, in the overlay's pixels.
    extras: Vec<Pixels>,
}

/// The docked windows, by the plugin that asked for them.
#[derive(Default)]
pub struct Docks(Mutex<HashMap<String, Docked>>);

/// One window as `hyprctl clients -j` describes it.
struct Client {
    address: String,
    class: String,
    pid: i64,
    workspace: String,
    at: (i32, i32),
    size: (i32, i32),
}

fn clients() -> Vec<Client> {
    let pair = |value: &Value| -> Option<(i32, i32)> {
        let list = value.as_array()?;
        Some((
            list.first()?.as_i64()? as i32,
            list.get(1)?.as_i64()? as i32,
        ))
    };
    hyprctl_json("clients")
        .and_then(|clients| {
            Some(
                clients
                    .as_array()?
                    .iter()
                    .filter_map(|client| {
                        Some(Client {
                            address: client.get("address")?.as_str()?.to_owned(),
                            class: client.get("class")?.as_str()?.to_owned(),
                            pid: client.get("pid")?.as_i64()?,
                            workspace: client.get("workspace")?.get("name")?.as_str()?.to_owned(),
                            at: pair(client.get("at")?)?,
                            size: pair(client.get("size")?)?,
                        })
                    })
                    .collect(),
            )
        })
        .unwrap_or_default()
}

fn step(dispatcher: String) -> String {
    format!("hl.dispatch(hl.dsp.window.{dispatcher})")
}

/// Lua moving the window at `address` to a workspace without going there.
fn send_script(address: &str, workspace: &str) -> String {
    step(format!(
        "move({{window=\"address:{address}\", workspace=\"{workspace}\", follow=false}})"
    ))
}

/// Lua putting the window at a place on screen, and giving it a size first
/// when `size` is set. Moving comes last: resizing keeps the centre.
pub fn place_script(address: &str, at: (i32, i32), size: Option<(i32, i32)>) -> String {
    let window = format!("address:{address}");
    let resize = size.map(|(width, height)| {
        step(format!(
            "resize({{window=\"{window}\", x={width}, y={height}}})"
        ))
    });
    let moved = step(format!(
        "move({{window=\"{window}\", x={}, y={}, relative=false}})",
        at.0, at.1
    ));
    resize
        .into_iter()
        .chain([moved])
        .collect::<Vec<_>>()
        .join("; ")
}

/// Lua run once when a window is docked: floating, without the compositor's
/// animation (it has to follow a panel being dragged), on the current workspace.
fn adopt_script(address: &str) -> String {
    let window = format!("address:{address}");
    [
        step(format!("float({{action=\"on\", window=\"{window}\"}})")),
        step(format!(
            "set_prop({{prop=\"no_anim\", value=\"true\", window=\"{window}\"}})"
        )),
        send_script(address, "e+0"),
    ]
    .join("; ")
}

/// The application's other windows to show through the overlay: its own, and
/// any window that opened since it was docked (a dialog, the screen picker).
fn companions<'a>(docked: &Docked, clients: &'a [Client], workspace: &str) -> Vec<&'a Client> {
    clients
        .iter()
        .filter(|client| {
            client.address != docked.address
                && client.workspace == workspace
                && (client.pid == docked.pid || !docked.known.contains(&client.address))
        })
        .collect()
}

fn hyprctl_json(what: &str) -> Option<Value> {
    let output = Command::new("hyprctl").args([what, "-j"]).output().ok()?;
    serde_json::from_slice(&output.stdout).ok()
}

fn eval(script: &str) -> Result<(), String> {
    if hyprctl(&["eval", script]) {
        Ok(())
    } else {
        Err("Hyprland refused to move the window".into())
    }
}

impl Docks {
    /// Puts `app`'s main window under the overlay at `rect` (in the overlay's
    /// pixels), or away on `workspace` when `rect` is `None` (ADR 0014).
    /// Returns where the application's other windows are, to be shown too.
    /// `refresh` looks at the windows again; without it a known window is
    /// only moved, which is all a panel being dragged needs. Hyprland only.
    pub fn dock(
        &self,
        owner: &str,
        app: &str,
        rect: Option<Pixels>,
        workspace: Option<&str>,
        refresh: bool,
    ) -> Result<Vec<Pixels>, String> {
        let workspace = workspace.unwrap_or(DEFAULT_DOCK_WORKSPACE);
        if !is_valid_app(app) || !is_valid_workspace(workspace) {
            return Err("not an application or a workspace name".into());
        }
        if !on_hyprland() {
            return Err("showing a window in a panel needs Hyprland".into());
        }
        let mut docks = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some((x, y, width, height)) = rect else {
            let all = clients();
            let (address, pid) = match docks.remove(owner) {
                Some(docked) => (Some(docked.address), Some(docked.pid)),
                // Not docked by this run of the overlay: still put it away.
                None => {
                    let main = main_window(&all, app);
                    (
                        main.map(|main| main.address.clone()),
                        main.map(|main| main.pid),
                    )
                }
            };
            // Its dialogs leave with it, and come back with it.
            for client in &all {
                let leaves = Some(&client.address) == address.as_ref()
                    || (Some(client.pid) == pid && client.class == app);
                if leaves && client.workspace != workspace {
                    eval(&send_script(&client.address, workspace))?;
                }
            }
            return Ok(Vec::new());
        };

        if let Some(docked) = docks.get_mut(owner).filter(|docked| docked.app == app)
            && !refresh
        {
            let size = ((width, height) != docked.size).then_some((width, height));
            docked.size = (width, height);
            let at = (x + docked.origin.0, y + docked.origin.1);
            eval(&place_script(&docked.address, at, size))?;
            return Ok(docked.extras.clone());
        }

        let all = clients();
        let active = hyprctl_json("activeworkspace")
            .and_then(|active| Some(active.get("name")?.as_str()?.to_owned()))
            .unwrap_or_default();
        if let Some(docked) = docks.get_mut(owner).filter(|docked| docked.app == app) {
            if !all.iter().any(|client| client.address == docked.address) {
                docks.remove(owner);
                return Err(format!("{app} closed its window"));
            }
            let origin = docked.origin;
            docked.extras = companions(docked, &all, &active)
                .into_iter()
                .map(|client| {
                    (
                        client.at.0 - origin.0,
                        client.at.1 - origin.1,
                        client.size.0,
                        client.size.1,
                    )
                })
                .collect();
            let size = ((width, height) != docked.size).then_some((width, height));
            docked.size = (width, height);
            eval(&place_script(
                &docked.address,
                (x + origin.0, y + origin.1),
                size,
            ))?;
            return Ok(docked.extras.clone());
        }

        let main = main_window(&all, app).ok_or(format!("{app} has no window"))?;
        // The overlay covers the focused screen: its pixels start at that screen's corner.
        let origin = hyprctl_json("monitors")
            .and_then(|monitors| {
                let monitor = monitors
                    .as_array()?
                    .iter()
                    .find(|monitor| monitor.get("focused") == Some(&Value::Bool(true)))?
                    .clone();
                Some((
                    monitor.get("x")?.as_i64()? as i32,
                    monitor.get("y")?.as_i64()? as i32,
                ))
            })
            .unwrap_or((0, 0));
        eval(&adopt_script(&main.address))?;
        // The dialogs that left with it.
        for client in &all {
            if client.address != main.address
                && client.pid == main.pid
                && client.class == app
                && client.workspace == workspace
            {
                eval(&send_script(&client.address, "e+0"))?;
            }
        }
        // Two steps: the window may refuse the size, and resizing is centred.
        eval(&place_script(
            &main.address,
            (x + origin.0, y + origin.1),
            Some((width, height)),
        ))?;
        eval(&place_script(
            &main.address,
            (x + origin.0, y + origin.1),
            None,
        ))?;
        docks.insert(
            owner.to_owned(),
            Docked {
                app: app.to_owned(),
                address: main.address.clone(),
                pid: main.pid,
                origin,
                size: (width, height),
                known: all.iter().map(|client| client.address.clone()).collect(),
                extras: Vec::new(),
            },
        );
        Ok(Vec::new())
    }
}

/// The application's main window: the largest one of its class.
fn main_window<'a>(clients: &'a [Client], app: &str) -> Option<&'a Client> {
    clients
        .iter()
        .filter(|client| client.class == app)
        .max_by_key(|client| i64::from(client.size.0) * i64::from(client.size.1))
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

    fn client(address: &str, class: &str, pid: i64, workspace: &str, size: (i32, i32)) -> Client {
        Client {
            address: address.to_owned(),
            class: class.to_owned(),
            pid,
            workspace: workspace.to_owned(),
            at: (100, 50),
            size,
        }
    }

    #[test]
    fn docking_talks_to_one_window_by_address() {
        assert_eq!(
            place_script("0xabc", (10, 20), Some((300, 200))),
            "hl.dispatch(hl.dsp.window.resize({window=\"address:0xabc\", x=300, y=200})); \
             hl.dispatch(hl.dsp.window.move({window=\"address:0xabc\", x=10, y=20, relative=false}))"
        );
        // A panel being dragged: one move, nothing else.
        assert_eq!(
            place_script("0xabc", (10, 20), None),
            "hl.dispatch(hl.dsp.window.move({window=\"address:0xabc\", x=10, y=20, relative=false}))"
        );
        assert_eq!(
            send_script("0xabc", "special:x"),
            "hl.dispatch(hl.dsp.window.move({window=\"address:0xabc\", workspace=\"special:x\", follow=false}))"
        );
        assert!(adopt_script("0xabc").contains("no_anim"));
        let docks = Docks::default();
        assert!(docks.dock("p", "../x", None, None, false).is_err());
        assert!(
            docks
                .dock("p", "com.example.App", None, Some("1; rm"), false)
                .is_err()
        );
    }

    #[test]
    fn the_main_window_is_the_largest_and_dialogs_follow() {
        let all = [
            client("0x1", "com.example.App", 7, "2", (400, 300)),
            client("0x2", "com.example.App", 7, "2", (900, 600)),
            client("0x3", "picker", 9, "2", (300, 200)),
            client("0x4", "other", 5, "2", (300, 200)),
            client("0x5", "picker", 9, "3", (300, 200)),
        ];
        let main = main_window(&all, "com.example.App").unwrap();
        assert_eq!(main.address, "0x2");
        let docked = Docked {
            app: "com.example.App".into(),
            address: "0x2".into(),
            pid: 7,
            origin: (0, 0),
            size: (900, 600),
            // Open before docking: 0x4 is somebody else's window.
            known: ["0x1", "0x2", "0x4"].map(String::from).into(),
            extras: Vec::new(),
        };
        let shown: Vec<&str> = companions(&docked, &all, "2")
            .into_iter()
            .map(|client| client.address.as_str())
            .collect();
        // Its own dialog, and the picker that opened since; not the other screen's.
        assert_eq!(shown, ["0x1", "0x3"]);
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
