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

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub entry: String,
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

/// A network entry is a bare host name (`api.example.com`), nothing else.
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
    (manifest.id == id).then_some(manifest)
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

/// CSP of a plugin document: its own files, and the network domains it declared.
pub fn content_security_policy(id: &str, network: &[String]) -> String {
    let own = format!("{SCHEME}://localhost/{id}/");
    let connect: Vec<String> = network
        .iter()
        .filter(|domain| is_valid_domain(domain))
        .map(|domain| format!("https://{domain}"))
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
        assert!(csp.contains("connect-src https://api.example.com;"));
        assert!(!csp.contains("evil"));
        assert!(csp.contains("script-src overquid-plugin://localhost/com.example.notes/;"));
        assert!(content_security_policy("a.b", &[]).contains("connect-src 'none'"));
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
