//! The official plugin catalog (ADR 0009): a list of plugins published from
//! the official repository, which the user can install from the settings.
//!
//! `index.json` lists each plugin's manifest and files with their hashes. A
//! plugin is downloaded to a staging folder, checked file by file and against
//! the same rules as any other manifest, then moved in place: a failed install
//! leaves what was there untouched.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::plugins::{self, Manifest};

/// Where the catalog is published (the `plugin-catalog` branch).
pub const OFFICIAL_URL: &str = "https://raw.githubusercontent.com/Kureo524/Overquid/plugin-catalog";

const MAX_INDEX_BYTES: usize = 2 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PLUGIN_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FILES: usize = 2000;
/// Staging folder under the user's plugins; its name is not a valid plugin id.
const STAGING: &str = ".staging";

/// `index.json`'s schema version this build reads.
const INDEX_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize)]
struct Index {
    version: u32,
    plugins: Vec<Entry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Entry {
    pub manifest: Manifest,
    pub files: Vec<FileEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

/// Downloads a URL into memory, at most `max` bytes.
pub type Fetch<'a> = &'a dyn Fn(&str, u64) -> Result<Vec<u8>, String>;

/// The catalog's base URL. `OVERQUID_CATALOG_URL` replaces it for testing.
pub fn base_url() -> String {
    std::env::var("OVERQUID_CATALOG_URL").unwrap_or_else(|_| OFFICIAL_URL.to_owned())
}

/// Plugins of the catalog, only those this build can run.
pub fn fetch_index(base: &str, fetch: Fetch<'_>) -> Result<Vec<Entry>, String> {
    let bytes = fetch(&format!("{base}/index.json"), MAX_INDEX_BYTES as u64)?;
    parse_index(&bytes)
}

fn parse_index(bytes: &[u8]) -> Result<Vec<Entry>, String> {
    let index: Index =
        serde_json::from_slice(bytes).map_err(|error| format!("bad catalog: {error}"))?;
    if index.version != INDEX_VERSION {
        return Err("this catalog needs a newer version of Overquid".into());
    }
    Ok(index
        .plugins
        .into_iter()
        .filter(|entry| plugins::is_valid_id(&entry.manifest.id))
        .collect())
}

/// A relative path inside a plugin, or `None` if it could leave the folder.
fn safe_relative(path: &str) -> Option<PathBuf> {
    let mut relative = PathBuf::new();
    for segment in path.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." || segment.contains('\\') {
            return None;
        }
        relative.push(segment);
    }
    (!relative.as_os_str().is_empty()).then_some(relative)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Downloads `entry` into `root`, replacing what is there.
pub fn install(root: &Path, base: &str, entry: &Entry, fetch: Fetch<'_>) -> Result<(), String> {
    let id = entry.manifest.id.as_str();
    if !plugins::is_valid_id(id) {
        return Err(format!("invalid plugin id '{id}'"));
    }
    if entry.files.len() > MAX_FILES {
        return Err("too many files".into());
    }
    let staging = root.join(STAGING);
    let target = staging.join(id);
    let old = staging.join(format!("{id}.old"));
    for leftover in [&target, &old] {
        remove_if_present(leftover)?;
    }
    let result = download(&target, base, entry, fetch)
        .and_then(|()| check_manifest(&staging, id))
        .and_then(|()| swap_in(&root.join(id), &target, &old));
    let _ = fs::remove_dir_all(&staging);
    result
}

fn download(target: &Path, base: &str, entry: &Entry, fetch: Fetch<'_>) -> Result<(), String> {
    let id = entry.manifest.id.as_str();
    let mut total = 0u64;
    for file in &entry.files {
        let relative = safe_relative(&file.path)
            .ok_or_else(|| format!("unsafe path in the catalog: {}", file.path))?;
        if file.size > MAX_FILE_BYTES {
            return Err(format!("{} is too large", file.path));
        }
        total += file.size;
        if total > MAX_PLUGIN_BYTES {
            return Err("plugin is too large".into());
        }
        let bytes = fetch(&format!("{base}/{id}/{}", file.path), file.size)?;
        if bytes.len() as u64 != file.size || hex(&Sha256::digest(&bytes)) != file.sha256 {
            return Err(format!("{} does not match the catalog", file.path));
        }
        let path = target.join(relative);
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|error| error.to_string())?;
        }
        fs::write(&path, bytes).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// The downloaded manifest obeys the same rules as an installed one.
fn check_manifest(staging: &Path, id: &str) -> Result<(), String> {
    plugins::load_manifest(staging, id)
        .map(|_| ())
        .ok_or_else(|| format!("'{id}' has an invalid manifest, or needs a newer Overquid"))
}

fn swap_in(destination: &Path, source: &Path, old: &Path) -> Result<(), String> {
    let error = |error: std::io::Error| error.to_string();
    if destination.exists() {
        fs::rename(destination, old).map_err(error)?;
    }
    if let Err(failure) = fs::rename(source, destination) {
        // Put the previous version back.
        let _ = fs::rename(old, destination);
        return Err(failure.to_string());
    }
    Ok(())
}

fn remove_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        _ => Ok(()),
    }
}

/// Deletes an installed plugin. Plugins shipped with the app are not in `root`.
pub fn uninstall(root: &Path, id: &str) -> Result<(), String> {
    if !plugins::is_valid_id(id) {
        return Err(format!("invalid plugin id '{id}'"));
    }
    remove_if_present(&root.join(id))
}

/// Downloads over HTTPS, or anything `OVERQUID_CATALOG_URL` points to.
pub fn http_fetch(url: &str, max: u64) -> Result<Vec<u8>, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(60)))
        .build()
        .into();
    agent
        .get(url)
        .call()
        .map_err(|error| error.to_string())?
        .body_mut()
        .with_config()
        // ureq refuses a body that reaches the limit: one byte more for a
        // body of exactly `max` bytes.
        .limit(max.saturating_add(1))
        .read_to_vec()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::{Read, Write};

    /// Serves one response with a body of `size` bytes on a local port.
    fn serve_once(size: usize) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            let _ = stream.read(&mut request);
            let head =
                format!("HTTP/1.1 200 OK\r\nContent-Length: {size}\r\nConnection: close\r\n\r\n");
            stream.write_all(head.as_bytes()).unwrap();
            stream.write_all(&vec![b'x'; size]).unwrap();
        });
        format!("http://127.0.0.1:{port}/file")
    }

    #[test]
    fn downloads_a_body_of_exactly_the_announced_size() {
        assert_eq!(http_fetch(&serve_once(100), 100).unwrap().len(), 100);
    }

    #[test]
    fn refuses_a_larger_body() {
        assert!(http_fetch(&serve_once(101), 100).is_err());
    }

    const MANIFEST: &str =
        r#"{"id":"dev.a","name":"A","version":"2.0.0","entry":"dist/index.html"}"#;
    const PAGE: &str = "<p>a</p>";

    fn sha(text: &str) -> String {
        hex(&Sha256::digest(text.as_bytes()))
    }

    fn entry(manifest: &str, page: &str) -> Entry {
        Entry {
            manifest: serde_json::from_str(MANIFEST).unwrap(),
            files: vec![
                FileEntry {
                    path: "manifest.json".into(),
                    size: manifest.len() as u64,
                    sha256: sha(manifest),
                },
                FileEntry {
                    path: "dist/index.html".into(),
                    size: page.len() as u64,
                    sha256: sha(page),
                },
            ],
        }
    }

    fn server(files: &[(&str, &str)]) -> HashMap<String, Vec<u8>> {
        files
            .iter()
            .map(|(path, text)| (format!("http://c/{path}"), text.as_bytes().to_vec()))
            .collect()
    }

    fn root(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("overquid-catalog-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn run(root: &Path, files: &HashMap<String, Vec<u8>>, entry: &Entry) -> Result<(), String> {
        install(root, "http://c", entry, &|url, _| {
            files.get(url).cloned().ok_or_else(|| format!("404 {url}"))
        })
    }

    #[test]
    fn installs_and_replaces_a_plugin() {
        let root = root("install");
        fs::create_dir_all(root.join("dev.a")).unwrap();
        fs::write(root.join("dev.a/stale.txt"), "old").unwrap();
        let files = server(&[
            ("dev.a/manifest.json", MANIFEST),
            ("dev.a/dist/index.html", PAGE),
        ]);
        run(&root, &files, &entry(MANIFEST, PAGE)).unwrap();
        assert_eq!(
            plugins::load_manifest(&root, "dev.a").unwrap().version,
            "2.0.0"
        );
        assert!(root.join("dev.a/dist/index.html").is_file());
        assert!(!root.join("dev.a/stale.txt").exists());
        assert!(!root.join(STAGING).exists());
        uninstall(&root, "dev.a").unwrap();
        assert!(!root.join("dev.a").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_bad_download_leaves_the_plugin_untouched() {
        let root = root("tamper");
        fs::create_dir_all(root.join("dev.a")).unwrap();
        fs::write(root.join("dev.a/keep.txt"), "kept").unwrap();
        let files = server(&[
            ("dev.a/manifest.json", MANIFEST),
            ("dev.a/dist/index.html", "<p>tampered</p>"),
        ]);
        let error = run(&root, &files, &entry(MANIFEST, PAGE)).unwrap_err();
        assert!(error.contains("does not match"), "{error}");
        assert!(root.join("dev.a/keep.txt").is_file());
        assert!(!root.join(STAGING).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_unsafe_paths_and_invalid_manifests() {
        for bad in ["../evil", "a//b", "/etc/x", "a/../../b", "a\\b", ""] {
            assert_eq!(safe_relative(bad), None, "{bad}");
        }
        let root = root("invalid");
        let mut sneaky = entry(MANIFEST, PAGE);
        sneaky.files[1].path = "../../evil".into();
        let files = server(&[("dev.a/manifest.json", MANIFEST)]);
        assert!(run(&root, &files, &sneaky).is_err());
        assert!(!root.parent().unwrap().join("evil").exists());

        // A valid download whose manifest is not coherent is refused too.
        let bad = r#"{"id":"dev.a","name":"A","version":"1","entry":"x","web":{"url":"https://a.b/","hosts":["a.b"]}}"#;
        let files = server(&[
            ("dev.a/manifest.json", bad),
            ("dev.a/dist/index.html", PAGE),
        ]);
        assert!(run(&root, &files, &entry(bad, PAGE)).is_err());
        assert!(!root.join("dev.a").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_the_index() {
        let index = format!(
            r#"{{"version":1,"plugins":[{{"manifest":{MANIFEST},"files":[]}},
            {{"manifest":{{"id":"Bad/Id","name":"x","version":"1","entry":"x"}},"files":[]}}]}}"#
        );
        let entries = parse_index(index.as_bytes()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].manifest.id, "dev.a");
        assert!(parse_index(br#"{"version":9,"plugins":[]}"#).is_err());
        assert!(parse_index(b"nope").is_err());
    }
}
