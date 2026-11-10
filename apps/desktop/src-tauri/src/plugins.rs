//! Serving plugin files to their sandboxed iframes (spike, see ADR 0003).
//!
//! A plugin is a folder named after its id, holding a `manifest.json` and its
//! files. They are served at `overquid-plugin://localhost/<id>/<path>`, only
//! from inside that folder, with a Content-Security-Policy that limits the
//! plugin to its own files and to the network domains of its manifest. That
//! CSP is also what keeps a plugin from calling Tauri's IPC protocol directly.

use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::http::{Response, StatusCode, header};

pub const SCHEME: &str = "overquid-plugin";

/// What a plugin may ask the core for. A manifest naming anything else is
/// rejected as a whole.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    Storage,
    Hotkeys,
    Notifications,
    Context,
    Events,
}

/// Where a plugin's panel goes until the user moves it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PanelPosition {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    Center,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelSpec {
    pub default_size: Option<[u32; 2]>,
    pub position: Option<PanelPosition>,
    /// Several panels of this plugin may be open at once (ADR 0007).
    #[serde(default)]
    pub multiple: bool,
}

/// The plugin a panel belongs to, and its instance number: `id` is instance
/// 1, `id#2` instance 2… (ADR 0007). `None` for anything else.
pub fn split_panel_id(panel: &str) -> Option<(&str, u32)> {
    let (plugin, instance) = match panel.split_once('#') {
        None => (panel, 1),
        Some((plugin, number)) => {
            // Canonical numbers only: `#2`, not `#02` or `#+2`.
            if !number.bytes().all(|b| b.is_ascii_digit()) || number.starts_with('0') {
                return None;
            }
            (plugin, number.parse().ok().filter(|n| *n >= 2)?)
        }
    };
    is_valid_id(plugin).then_some((plugin, instance))
}

/// A web panel (ADR 0004): an official web app shown in a native view.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSpec {
    pub url: String,
    /// Host names the panel may navigate to (`example.com`, `*.example.com`).
    /// Links elsewhere open in the system browser. Unused by a browser.
    #[serde(default)]
    pub hosts: Vec<String>,
    /// Pause audio and video when the panel is hidden.
    #[serde(default)]
    pub pause_on_hide: bool,
    /// A browser: any site, an address bar, and links that stay in the panel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub browser: Option<BrowserSpec>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSpec {
    /// Search URL for what is typed in the address bar: `{query}` is replaced.
    pub search: String,
}

/// What to load for text typed in a browser's address bar: a web address as
/// is, a bare domain over `https`, anything else as a search.
pub fn resolve_input(input: &str, search: &str) -> String {
    let input = input.trim();
    let lower = input.to_ascii_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") {
        return input.to_owned();
    }
    if looks_like_address(input) {
        return format!("https://{input}");
    }
    let query = percent_encoding::utf8_percent_encode(input, percent_encoding::NON_ALPHANUMERIC)
        .to_string();
    search.replace("{query}", &query)
}

/// `example.com`, `example.com/path`, `localhost:8080`: no spaces, no other
/// scheme, and a host that is a dotted name or `localhost`.
fn looks_like_address(input: &str) -> bool {
    if input.is_empty() || input.contains(char::is_whitespace) || input.contains("://") {
        return false;
    }
    let authority = input.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.contains('@') {
        return false;
    }
    let mut parts = authority.splitn(2, ':');
    let host = parts.next().unwrap_or_default();
    if let Some(port) = parts.next()
        && (port.is_empty() || !port.bytes().all(|b| b.is_ascii_digit()))
    {
        return false;
    }
    host.eq_ignore_ascii_case("localhost")
        || (host.contains('.')
            && !host.starts_with('.')
            && !host.ends_with('.')
            && host
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-'))
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    /// One line about the plugin, shown in the settings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Entry HTML file of an iframe plugin. Exactly one of `entry` and `web`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web: Option<WebSpec>,
    #[serde(default)]
    pub panel: PanelSpec,
    #[serde(default)]
    pub permissions: Vec<Permission>,
    #[serde(default)]
    pub network: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ResolveError {
    /// Malformed path, or one that tries to leave the plugin folder.
    Forbidden,
    NotFound,
}

/// Plugin ids are reverse-DNS names: lowercase letters, digits, `.`, `-`, `_`.
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('.')
        && !id.contains("..")
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-' | '_'))
}

/// A host name such as `api.example.com`, nothing else.
fn is_valid_domain(domain: &str) -> bool {
    domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && domain
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-'))
}

/// Maps a request path (`/<id>/<file>`, still percent-encoded) to a plugin id
/// and a file inside that plugin's folder.
pub fn resolve(root: &Path, request_path: &str) -> Result<(String, PathBuf), ResolveError> {
    let decoded = percent_encoding::percent_decode_str(request_path)
        .decode_utf8()
        .map_err(|_| ResolveError::Forbidden)?;
    let mut segments = decoded.trim_start_matches('/').split('/');
    let id = segments.next().unwrap_or_default();
    if !is_valid_id(id) {
        return Err(ResolveError::Forbidden);
    }
    let mut relative = PathBuf::new();
    for segment in segments {
        if segment.is_empty() || segment == "." || segment == ".." || segment.contains('\\') {
            return Err(ResolveError::Forbidden);
        }
        relative.push(segment);
    }
    if relative.as_os_str().is_empty() {
        return Err(ResolveError::NotFound);
    }
    let folder = root
        .join(id)
        .canonicalize()
        .map_err(|_| ResolveError::NotFound)?;
    let file = folder
        .join(&relative)
        .canonicalize()
        .map_err(|_| ResolveError::NotFound)?;
    // Symlinks must not lead outside the folder either.
    if !file.starts_with(&folder) || !file.is_file() {
        return Err(ResolveError::Forbidden);
    }
    Ok((id.to_owned(), file))
}

pub fn load_manifest(root: &Path, id: &str) -> Option<Manifest> {
    let text = fs::read_to_string(root.join(id).join("manifest.json")).ok()?;
    let manifest: Manifest = serde_json::from_str(&text).ok()?;
    (manifest.id == id && is_coherent(&manifest)).then_some(manifest)
}

/// Exactly one of `entry` and `web`; a web panel must start on an `https` URL
/// whose host it declares.
fn is_coherent(manifest: &Manifest) -> bool {
    match (&manifest.entry, &manifest.web) {
        (Some(_), None) => true,
        (None, Some(web)) => match &web.browser {
            // A browser goes anywhere, but starts and searches over https.
            Some(browser) => {
                https_host(&web.url).is_some()
                    && https_host(&browser.search).is_some()
                    && browser.search.contains("{query}")
            }
            None => {
                !web.hosts.is_empty()
                    && web
                        .hosts
                        .iter()
                        .all(|pattern| is_valid_host_pattern(pattern))
                    && https_host(&web.url).is_some_and(|host| host_allowed(&host, &web.hosts))
            }
        },
        _ => false,
    }
}

fn is_valid_host_pattern(pattern: &str) -> bool {
    is_valid_domain(pattern.strip_prefix("*.").unwrap_or(pattern))
}

/// Host of an `https://` URL, lowercased; `None` for anything else.
pub fn https_host(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    // No credentials in the URL; drop the port.
    if authority.contains('@') {
        return None;
    }
    let host = authority.split(':').next()?.to_ascii_lowercase();
    (!host.is_empty()).then_some(host)
}

/// Whether `host` matches one of the patterns: `example.com` matches only
/// itself, `*.example.com` matches its subdomains (not `example.com`).
pub fn host_allowed(host: &str, patterns: &[String]) -> bool {
    patterns
        .iter()
        .any(|pattern| match pattern.strip_prefix("*.") {
            Some(domain) => host
                .strip_suffix(domain)
                .is_some_and(|prefix| prefix.ends_with('.') && prefix.len() > 1),
            None => host == pattern,
        })
}

/// Runs a call relayed by the host for `manifest`'s plugin, after checking it
/// against the manifest's permissions.
/// What a plugin call may act on beyond its own manifest.
pub struct Host<'a> {
    pub storage: &'a crate::plugin_storage::PluginStorage,
    /// Shows a desktop notification (title, body).
    pub notify: &'a dyn Fn(&str, &str) -> Result<(), String>,
    pub limiter: &'a RateLimiter,
}

/// At most `max` events per `window` for each plugin (notifications).
pub struct RateLimiter {
    max: usize,
    window: std::time::Duration,
    recent: std::sync::Mutex<std::collections::HashMap<String, Vec<std::time::Instant>>>,
}

impl RateLimiter {
    pub fn new(max: usize, window: std::time::Duration) -> Self {
        RateLimiter {
            max,
            window,
            recent: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }

    /// Records an event for `id` at `now`, if it is still allowed.
    pub fn allow(&self, id: &str, now: std::time::Instant) -> bool {
        let Ok(mut recent) = self.recent.lock() else {
            return false;
        };
        let times = recent.entry(id.to_owned()).or_default();
        times.retain(|time| now.saturating_duration_since(*time) < self.window);
        if times.len() >= self.max {
            return false;
        }
        times.push(now);
        true
    }
}

/// An optional string argument, trimmed, at most `max` characters long.
fn text_arg(args: &serde_json::Value, name: &str, max: usize) -> Result<Option<String>, String> {
    match args.get(name) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(text)) => {
            let text = text.trim();
            if text.chars().count() > max {
                return Err(format!("'{name}' is longer than {max} characters"));
            }
            Ok(Some(text.to_owned()))
        }
        Some(_) => Err(format!("'{name}' must be a string")),
    }
}

/// Longest notification title and body a plugin may send, in characters.
const MAX_TITLE: usize = 80;
const MAX_BODY: usize = 300;

pub fn call(
    manifest: &Manifest,
    host: &Host<'_>,
    method: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let storage = host.storage;
    use serde_json::Value;

    let required = match method {
        "echo" | "log" => None,
        "storage.get" | "storage.set" | "storage.remove" | "storage.keys" => {
            Some(Permission::Storage)
        }
        "notify" => Some(Permission::Notifications),
        other => return Err(format!("unknown method '{other}'")),
    };
    if let Some(permission) = required
        && !manifest.permissions.contains(&permission)
    {
        let name = serde_json::to_value(permission)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_default();
        return Err(format!(
            "'{method}' needs the {name} permission, which is not in the manifest"
        ));
    }
    let key = || {
        args.get("key")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("'{method}' needs a string 'key'"))
    };
    let id = manifest.id.as_str();
    match method {
        "echo" => Ok(serde_json::json!({ "pluginId": id, "args": args })),
        "log" => {
            eprintln!("[plugin {id}] {args}");
            Ok(Value::Null)
        }
        "storage.get" => Ok(storage.get(id, key()?)?.unwrap_or(Value::Null)),
        "storage.set" => {
            let value = args.get("value").cloned().unwrap_or(Value::Null);
            storage.set(id, key()?, value).map(|()| Value::Null)
        }
        "storage.remove" => storage.remove(id, key()?).map(|()| Value::Null),
        "storage.keys" => Ok(serde_json::json!(storage.keys(id)?)),
        "notify" => {
            let title = text_arg(args, "title", MAX_TITLE)?
                .filter(|title| !title.is_empty())
                .ok_or("'notify' needs a 'title'")?;
            let body = text_arg(args, "body", MAX_BODY)?.unwrap_or_default();
            if !host.limiter.allow(id, std::time::Instant::now()) {
                return Err("too many notifications: wait a minute".into());
            }
            // The plugin's name always heads the title: no plugin can pass
            // for another one, or for the system.
            (host.notify)(&format!("{} · {title}", manifest.name), &body).map(|()| Value::Null)
        }
        _ => unreachable!("methods are matched above"),
    }
}

/// Every valid plugin under `root` (sub-folder named after a matching manifest).
pub fn list(root: &Path) -> Vec<Manifest> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut manifests: Vec<Manifest> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|id| is_valid_id(id))
        .filter_map(|id| load_manifest(root, &id))
        .collect();
    manifests.sort_by(|a, b| a.id.cmp(&b.id));
    manifests
}

/// Plugins can live in several folders (the user's, then those shipped with
/// the app). For a given id, the first folder holding a valid plugin wins, so
/// a user plugin overrides a shipped one.
pub fn find(roots: &[PathBuf], id: &str) -> Option<(PathBuf, Manifest)> {
    roots
        .iter()
        .find_map(|root| load_manifest(root, id).map(|manifest| (root.clone(), manifest)))
}

/// Every plugin of every folder, each id once (first folder wins), by id.
pub fn list_all(roots: &[PathBuf]) -> Vec<Manifest> {
    let mut seen = std::collections::BTreeMap::new();
    for root in roots {
        for manifest in list(root) {
            seen.entry(manifest.id.clone()).or_insert(manifest);
        }
    }
    seen.into_values().collect()
}

/// Serves a request from the folder that holds the requested plugin.
pub fn serve_from(roots: &[PathBuf], request_path: &str) -> Response<Cow<'static, [u8]>> {
    let id = percent_encoding::percent_decode_str(request_path)
        .decode_utf8_lossy()
        .trim_start_matches('/')
        .split('/')
        .next()
        .unwrap_or_default()
        .to_owned();
    if !is_valid_id(&id) {
        return status(StatusCode::FORBIDDEN);
    }
    match find(roots, &id) {
        Some((root, _)) => serve(&root, request_path),
        None => status(StatusCode::NOT_FOUND),
    }
}

/// A network entry is a host name, optionally with a port or `*` for any port
/// (`api.example.com`, `example.com:8443`, `archipelago.gg:*`). It stays a CSP
/// source expression once checked: `None` for anything else.
fn network_source(entry: &str) -> Option<&str> {
    let (host, port) = match entry.split_once(':') {
        None => (entry, None),
        Some((host, port)) => (host, Some(port)),
    };
    let port_ok = match port {
        None | Some("*") => true,
        // Canonical numbers only: `8443`, not `08443` or `+8443`.
        Some(port) => {
            port.bytes().all(|b| b.is_ascii_digit())
                && !port.starts_with('0')
                && port.parse::<u16>().is_ok()
        }
    };
    (is_valid_domain(host) && port_ok).then_some(entry)
}

/// CSP of a plugin document: its own files, and the network domains it
/// declared, over `https` and secure WebSockets. Plain `http` and `ws` stay
/// blocked.
pub fn content_security_policy(id: &str, network: &[String]) -> String {
    let own = format!("{SCHEME}://localhost/{id}/");
    let connect: Vec<String> = network
        .iter()
        .filter_map(|entry| network_source(entry))
        .flat_map(|source| [format!("https://{source}"), format!("wss://{source}")])
        .collect();
    let connect = if connect.is_empty() {
        "'none'".to_owned()
    } else {
        connect.join(" ")
    };
    format!(
        "default-src 'none'; script-src {own}; style-src {own} 'unsafe-inline'; \
         img-src {own} data:; font-src {own}; media-src {own}; connect-src {connect}; \
         base-uri 'none'; form-action 'none'"
    )
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn status(code: StatusCode) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(code)
        .body(Cow::Borrowed(&[][..]))
        .expect("static response")
}

/// Handles one `overquid-plugin://` request.
pub fn serve(root: &Path, request_path: &str) -> Response<Cow<'static, [u8]>> {
    let (id, file) = match resolve(root, request_path) {
        Ok(found) => found,
        Err(ResolveError::Forbidden) => return status(StatusCode::FORBIDDEN),
        Err(ResolveError::NotFound) => return status(StatusCode::NOT_FOUND),
    };
    let Some(manifest) = load_manifest(root, &id) else {
        return status(StatusCode::NOT_FOUND);
    };
    let Ok(body) = fs::read(&file) else {
        return status(StatusCode::NOT_FOUND);
    };
    Response::builder()
        .header(header::CONTENT_TYPE, content_type(&file))
        .header(
            header::CONTENT_SECURITY_POLICY,
            content_security_policy(&id, &manifest.network),
        )
        // Sandboxed iframes have an opaque origin: module scripts and fetches
        // of their own files are cross-origin requests.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Cow::Owned(body))
        .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("overquid-plugins-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let plugin = root.join("com.example.notes");
        fs::create_dir_all(plugin.join("dist")).unwrap();
        fs::write(plugin.join("dist/index.html"), "<p>notes</p>").unwrap();
        fs::write(
            plugin.join("manifest.json"),
            r#"{"id":"com.example.notes","name":"Notes","version":"1.0.0","entry":"dist/index.html","network":["api.example.com"]}"#,
        )
        .unwrap();
        fs::write(root.join("secret.txt"), "secret").unwrap();
        root
    }

    #[test]
    fn resolves_files_inside_the_plugin() {
        let root = fixture("inside");
        let (id, file) = resolve(&root, "/com.example.notes/dist/index.html").unwrap();
        assert_eq!(id, "com.example.notes");
        assert!(file.ends_with("dist/index.html"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_to_leave_the_plugin_folder() {
        let root = fixture("escape");
        for path in [
            "/com.example.notes/../secret.txt",
            "/com.example.notes/%2e%2e/secret.txt",
            "/com.example.notes/dist/..%2F..%2Fsecret.txt",
            "/../secret.txt",
            "/com.example.notes//etc/passwd",
            "/com.example.notes/dist\\..\\..\\secret.txt",
            "/Com.Example/x",
        ] {
            assert_eq!(resolve(&root, path), Err(ResolveError::Forbidden), "{path}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_out_of_the_folder() {
        let root = fixture("symlink");
        std::os::unix::fs::symlink(
            root.join("secret.txt"),
            root.join("com.example.notes/link.txt"),
        )
        .unwrap();
        assert_eq!(
            resolve(&root, "/com.example.notes/link.txt"),
            Err(ResolveError::Forbidden)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn csp_limits_network_to_declared_domains() {
        let csp = content_security_policy(
            "com.example.notes",
            &[
                "api.example.com".into(),
                "https://evil.com".into(),
                "*.evil.com".into(),
            ],
        );
        assert!(csp.contains("connect-src https://api.example.com wss://api.example.com;"));
        assert!(!csp.contains("evil"));
        assert!(csp.contains("script-src overquid-plugin://localhost/com.example.notes/;"));
        assert!(content_security_policy("a.b", &[]).contains("connect-src 'none'"));
    }

    #[test]
    fn network_entries_may_carry_a_port() {
        let csp = content_security_policy(
            "a.b",
            &[
                "archipelago.gg:*".into(),
                "example.com:8443".into(),
                "port.zero:0".into(),
                "leading.zero:0443".into(),
                "too.big:65536".into(),
                "sign.ed:+443".into(),
                "no.port:".into(),
                "two.ports:1:2".into(),
                "path.example.com/x".into(),
            ],
        );
        assert!(csp.contains(
            "connect-src https://archipelago.gg:* wss://archipelago.gg:* \
             https://example.com:8443 wss://example.com:8443;"
        ));
        for rejected in ["zero", "big", "sign", "no.port", "two", "path"] {
            assert!(!csp.contains(rejected), "{rejected}");
        }
    }

    #[test]
    fn unknown_permission_rejects_the_manifest() {
        let root = fixture("permission");
        fs::create_dir_all(root.join("com.bad")).unwrap();
        fs::write(
            root.join("com.bad/manifest.json"),
            r#"{"id":"com.bad","name":"Bad","version":"1","entry":"i.html","permissions":["root"]}"#,
        )
        .unwrap();
        assert!(load_manifest(&root, "com.bad").is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn calls_are_checked_against_permissions() {
        use crate::plugin_storage::PluginStorage;
        use serde_json::json;

        let root = fixture("calls");
        let storage = PluginStorage::new(&root.join("data"));
        let notify = |_: &str, _: &str| Ok(());
        let limiter = RateLimiter::new(5, std::time::Duration::from_secs(60));
        let storage = Host {
            storage: &storage,
            notify: &notify,
            limiter: &limiter,
        };
        let mut manifest = load_manifest(&root, "com.example.notes").unwrap();
        let set = json!({ "key": "count", "value": 2 });

        let denied = call(&manifest, &storage, "storage.set", &set).unwrap_err();
        assert!(denied.contains("storage permission"), "{denied}");
        assert!(call(&manifest, &storage, "fs.read", &json!({})).is_err());
        assert_eq!(
            call(&manifest, &storage, "echo", &json!(1)).unwrap()["pluginId"],
            "com.example.notes"
        );

        manifest.permissions.push(Permission::Storage);
        call(&manifest, &storage, "storage.set", &set).unwrap();
        let got = call(
            &manifest,
            &storage,
            "storage.get",
            &json!({ "key": "count" }),
        )
        .unwrap();
        assert_eq!(got, json!(2));
        assert!(call(&manifest, &storage, "storage.get", &json!({})).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn notifications_are_checked_titled_and_limited() {
        use crate::plugin_storage::PluginStorage;
        use serde_json::json;
        use std::cell::RefCell;

        let root = fixture("notify");
        let storage = PluginStorage::new(&root.join("data"));
        let shown = RefCell::new(Vec::new());
        let notify = |title: &str, body: &str| {
            shown.borrow_mut().push((title.to_owned(), body.to_owned()));
            Ok(())
        };
        let limiter = RateLimiter::new(2, std::time::Duration::from_secs(60));
        let host = Host {
            storage: &storage,
            notify: &notify,
            limiter: &limiter,
        };
        let mut manifest = load_manifest(&root, "com.example.notes").unwrap();
        let message = json!({ "title": " Break time ", "body": "5 minutes" });

        let denied = call(&manifest, &host, "notify", &message).unwrap_err();
        assert!(denied.contains("notifications permission"), "{denied}");

        manifest.permissions.push(Permission::Notifications);
        call(&manifest, &host, "notify", &message).unwrap();
        assert_eq!(
            shown.borrow()[0],
            ("Notes · Break time".to_owned(), "5 minutes".to_owned())
        );
        assert!(call(&manifest, &host, "notify", &json!({ "body": "x" })).is_err());
        assert!(call(&manifest, &host, "notify", &json!({ "title": 3 })).is_err());
        let long = "x".repeat(MAX_TITLE + 1);
        assert!(call(&manifest, &host, "notify", &json!({ "title": long })).is_err());

        call(&manifest, &host, "notify", &json!({ "title": "two" })).unwrap();
        let limited = call(&manifest, &host, "notify", &json!({ "title": "three" })).unwrap_err();
        assert!(limited.contains("too many"), "{limited}");
        assert_eq!(shown.borrow().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rate_limits_per_plugin_and_window() {
        let limiter = RateLimiter::new(1, std::time::Duration::from_secs(60));
        let start = std::time::Instant::now();
        assert!(limiter.allow("a", start));
        assert!(!limiter.allow("a", start + std::time::Duration::from_secs(30)));
        assert!(limiter.allow("b", start));
        assert!(limiter.allow("a", start + std::time::Duration::from_secs(61)));
    }

    #[test]
    fn first_folder_wins_for_an_id() {
        let user = fixture("user");
        let shipped = fixture("shipped");
        fs::write(
            shipped.join("com.example.notes/manifest.json"),
            r#"{"id":"com.example.notes","name":"Shipped","version":"1.0.0","entry":"dist/index.html","panel":{"position":"top-right"}}"#,
        )
        .unwrap();
        let other = shipped.join("dev.other");
        fs::create_dir_all(&other).unwrap();
        fs::write(
            other.join("manifest.json"),
            r#"{"id":"dev.other","name":"Other","version":"1","entry":"i.html"}"#,
        )
        .unwrap();
        fs::write(other.join("i.html"), "other").unwrap();

        let roots = [user.clone(), shipped.clone()];
        let names: Vec<String> = list_all(&roots).into_iter().map(|m| m.name).collect();
        assert_eq!(names, ["Notes", "Other"]);
        assert_eq!(find(&roots, "com.example.notes").unwrap().0, user);
        assert_eq!(
            serve_from(&roots, "/dev.other/i.html").status(),
            StatusCode::OK
        );
        assert_eq!(
            serve_from(&roots, "/dev.missing/i.html").status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            serve_from(&roots, "/%2e%2e/secret.txt").status(),
            StatusCode::FORBIDDEN
        );
        let shipped_manifest = load_manifest(&shipped, "com.example.notes").unwrap();
        assert_eq!(
            shipped_manifest.panel.position,
            Some(PanelPosition::TopRight)
        );
        fs::remove_dir_all(user).unwrap();
        fs::remove_dir_all(shipped).unwrap();
    }

    #[test]
    fn matches_hosts_and_urls() {
        let hosts = vec!["discord.com".to_owned(), "*.discord.com".to_owned()];
        assert!(host_allowed("discord.com", &hosts));
        assert!(host_allowed("cdn.discord.com", &hosts));
        assert!(!host_allowed("evil-discord.com", &hosts));
        assert!(!host_allowed("discord.com.evil.net", &hosts));
        assert!(!host_allowed(".discord.com", &hosts));
        assert!(!host_allowed("example.com", &hosts));
        assert_eq!(
            https_host("https://Discord.com:443/app?x=1").as_deref(),
            Some("discord.com")
        );
        assert_eq!(https_host("http://discord.com/"), None);
        assert_eq!(https_host("https://user@evil.com/"), None);
    }

    #[test]
    fn splits_panel_ids() {
        assert_eq!(
            split_panel_id("dev.overquid.browser"),
            Some(("dev.overquid.browser", 1))
        );
        assert_eq!(
            split_panel_id("dev.overquid.browser#2"),
            Some(("dev.overquid.browser", 2))
        );
        assert_eq!(
            split_panel_id("dev.overquid.browser#12"),
            Some(("dev.overquid.browser", 12))
        );
        for bad in [
            "dev.overquid.browser#1",
            "dev.overquid.browser#02",
            "dev.overquid.browser#",
            "dev.overquid.browser#x",
            "a#2#3",
            "../x#2",
            "Bad#2",
        ] {
            assert_eq!(split_panel_id(bad), None, "{bad}");
        }
    }

    #[test]
    fn resolves_address_bar_input() {
        let search = "https://duckduckgo.com/?q={query}";
        let resolve = |input| resolve_input(input, search);
        assert_eq!(resolve("https://example.com/a"), "https://example.com/a");
        assert_eq!(resolve("  HTTP://example.com "), "HTTP://example.com");
        assert_eq!(resolve("example.com"), "https://example.com");
        assert_eq!(
            resolve("wiki.example.org/x?y=1"),
            "https://wiki.example.org/x?y=1"
        );
        assert_eq!(resolve("localhost:8080"), "https://localhost:8080");
        assert_eq!(resolve("rust"), "https://duckduckgo.com/?q=rust");
        assert_eq!(
            resolve("rust lang.org"),
            "https://duckduckgo.com/?q=rust%20lang%2Eorg"
        );
        // Other schemes are never loaded: they become searches.
        assert_eq!(
            resolve("javascript:alert(1)"),
            "https://duckduckgo.com/?q=javascript%3Aalert%281%29"
        );
        assert_eq!(
            resolve("file:///etc/passwd"),
            "https://duckduckgo.com/?q=file%3A%2F%2F%2Fetc%2Fpasswd"
        );
        assert_eq!(
            resolve("user@evil.com"),
            "https://duckduckgo.com/?q=user%40evil%2Ecom"
        );
        assert_eq!(
            resolve("example.com:abc"),
            "https://duckduckgo.com/?q=example%2Ecom%3Aabc"
        );
    }

    #[test]
    fn web_manifests_must_be_coherent() {
        let root = fixture("web");
        let write = |id: &str, body: &str| {
            fs::create_dir_all(root.join(id)).unwrap();
            fs::write(
                root.join(id).join("manifest.json"),
                format!(r#"{{"id":"{id}","name":"W","version":"1",{body}}}"#),
            )
            .unwrap();
        };
        write(
            "dev.ok",
            r#""web":{"url":"https://discord.com/app","hosts":["discord.com"]}"#,
        );
        write(
            "dev.both",
            r#""entry":"i.html","web":{"url":"https://discord.com/","hosts":["discord.com"]}"#,
        );
        write("dev.none", r#""permissions":[]"#);
        write(
            "dev.http",
            r#""web":{"url":"http://discord.com/","hosts":["discord.com"]}"#,
        );
        write(
            "dev.offlist",
            r#""web":{"url":"https://evil.com/","hosts":["discord.com"]}"#,
        );
        write(
            "dev.browser",
            r#""web":{"url":"https://duckduckgo.com/","browser":{"search":"https://duckduckgo.com/?q={query}"}}"#,
        );
        write("dev.nohosts", r#""web":{"url":"https://discord.com/"}"#);
        write(
            "dev.badsearch",
            r#""web":{"url":"https://duckduckgo.com/","browser":{"search":"https://duckduckgo.com/"}}"#,
        );
        write(
            "dev.badhost",
            r#""web":{"url":"https://discord.com/","hosts":["discord.com","https://x"]}"#,
        );
        assert!(load_manifest(&root, "dev.ok").unwrap().web.is_some());
        assert!(load_manifest(&root, "dev.browser").unwrap().web.is_some());
        for id in [
            "dev.nohosts",
            "dev.badsearch",
            "dev.both",
            "dev.none",
            "dev.http",
            "dev.offlist",
            "dev.badhost",
        ] {
            assert!(load_manifest(&root, id).is_none(), "{id}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lists_valid_plugins_only() {
        let root = fixture("list");
        fs::create_dir_all(root.join("Not-Valid")).unwrap();
        let ids: Vec<String> = list(&root).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["com.example.notes"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn manifest_id_must_match_its_folder() {
        let root = fixture("manifest");
        assert!(load_manifest(&root, "com.example.notes").is_some());
        fs::create_dir_all(root.join("com.other")).unwrap();
        fs::copy(
            root.join("com.example.notes/manifest.json"),
            root.join("com.other/manifest.json"),
        )
        .unwrap();
        assert!(load_manifest(&root, "com.other").is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn serves_with_security_headers() {
        let root = fixture("serve");
        let response = serve(&root, "/com.example.notes/dist/index.html");
        assert_eq!(response.status(), StatusCode::OK);
        let csp = response.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(csp.contains("connect-src https://api.example.com"));
        assert_eq!(
            serve(&root, "/com.example.notes/../secret.txt").status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            serve(&root, "/com.example.notes/missing.js").status(),
            StatusCode::NOT_FOUND
        );
        fs::remove_dir_all(root).unwrap();
    }
}
