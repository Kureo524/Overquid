//! Storage of the panel layout (`layout.json` in the user config directory).
//!
//! The core keeps the document opaque: the web view owns its schema and
//! validates it when loading. The core only guarantees that what is stored is
//! a JSON object of reasonable size, written atomically, and that a corrupt
//! file is set aside rather than silently overwritten.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::Value;

/// Far above any real layout; guards against a runaway writer.
pub const MAX_BYTES: usize = 256 * 1024;

pub struct LayoutStore {
    path: PathBuf,
}

impl LayoutStore {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("layout.json"),
        }
    }

    /// The saved layout, or `None` if there is none or it is unreadable.
    pub fn load(&self) -> Option<Value> {
        let text = match fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return None,
            Err(error) => {
                eprintln!("overquid: cannot read {}: {error}", self.path.display());
                return None;
            }
        };
        match serde_json::from_str::<Value>(&text) {
            Ok(value) if value.is_object() => Some(value),
            _ => {
                self.set_aside();
                None
            }
        }
    }

    pub fn save(&self, layout: &Value) -> Result<(), String> {
        if !layout.is_object() {
            return Err("layout must be a JSON object".into());
        }
        let text = serde_json::to_string_pretty(layout).map_err(|error| error.to_string())?;
        if text.len() > MAX_BYTES {
            return Err(format!("layout is larger than {MAX_BYTES} bytes"));
        }
        self.write_atomically(&text)
            .map_err(|error| format!("cannot write {}: {error}", self.path.display()))
    }

    /// Write to a temporary file, then rename it over the real one: a crash
    /// mid-write never leaves a truncated layout behind.
    fn write_atomically(&self, text: &str) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, text)?;
        fs::rename(&tmp, &self.path)
    }

    /// Keeps a corrupt file as `layout.json.corrupt` so the next save does not
    /// destroy what may be a hand-edited layout.
    fn set_aside(&self) {
        let aside = self.path.with_extension("json.corrupt");
        eprintln!(
            "overquid: {} is not a valid layout, moved to {}",
            self.path.display(),
            aside.display()
        );
        if let Err(error) = fs::rename(&self.path, &aside) {
            eprintln!("overquid: cannot move it: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A fresh, empty directory under the system temp dir.
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("overquid-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn missing_file_loads_nothing() {
        assert_eq!(LayoutStore::new(&temp_dir("missing")).load(), None);
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = temp_dir("roundtrip");
        let store = LayoutStore::new(&dir);
        let layout = json!({ "version": 1, "panels": { "clock": { "pinned": true } } });
        store.save(&layout).unwrap();
        assert_eq!(store.load(), Some(layout));
        assert!(!dir.join("layout.json.tmp").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn corrupt_file_is_set_aside() {
        let dir = temp_dir("corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("layout.json"), "{ not json").unwrap();
        let store = LayoutStore::new(&dir);
        assert_eq!(store.load(), None);
        assert!(!dir.join("layout.json").exists());
        assert_eq!(
            fs::read_to_string(dir.join("layout.json.corrupt")).unwrap(),
            "{ not json"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_non_objects_and_oversized_layouts() {
        let dir = temp_dir("reject");
        let store = LayoutStore::new(&dir);
        assert!(store.save(&json!([1, 2])).is_err());
        let huge = json!({ "blob": "x".repeat(MAX_BYTES) });
        assert!(store.save(&huge).is_err());
        assert!(!dir.join("layout.json").exists());
    }
}
