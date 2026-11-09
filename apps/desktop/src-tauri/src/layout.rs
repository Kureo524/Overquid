//! Storage of the panel layout (`layout.json` in the user config directory).
//!
//! The core keeps the document opaque: the web view owns its schema and
//! validates it when loading. The core only guarantees that what is stored is
//! a JSON object of reasonable size, written atomically, and that a corrupt
//! file is set aside rather than silently overwritten.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::json_file;

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
        json_file::read_object(&self.path).map(Value::Object)
    }

    pub fn save(&self, layout: &Value) -> Result<(), String> {
        if !layout.is_object() {
            return Err("layout must be a JSON object".into());
        }
        json_file::write(&self.path, layout, MAX_BYTES)
            .map_err(|error| format!("layout not saved: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

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
