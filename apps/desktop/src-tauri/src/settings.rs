//! Storage of the user's settings (`settings.json` in the user config directory).
//!
//! Like the layout, the document belongs to the web view, which validates it
//! when loading; the core only keeps it safe on disk.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::json_file;

const MAX_BYTES: usize = 64 * 1024;

pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("settings.json"),
        }
    }

    /// The saved settings, or `None` if there are none or they are unreadable.
    pub fn load(&self) -> Option<Value> {
        json_file::read_object(&self.path).map(Value::Object)
    }

    pub fn save(&self, settings: &Value) -> Result<(), String> {
        if !settings.is_object() {
            return Err("settings must be a JSON object".into());
        }
        json_file::write(&self.path, settings, MAX_BYTES)
            .map_err(|error| format!("settings not saved: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn save_then_load_round_trips() {
        let dir = std::env::temp_dir().join(format!("overquid-settings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = SettingsStore::new(&dir);
        assert_eq!(store.load(), None);
        let settings = json!({ "version": 1 });
        store.save(&settings).unwrap();
        assert_eq!(store.load(), Some(settings));
        assert!(store.save(&json!([1])).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
