//! Data of each plugin (`storage` permission): one JSON object per plugin in
//! `<app data>/plugin-data/<id>.json`. A plugin only ever reaches its own
//! file: the id comes from the host's identification of the caller, never
//! from the plugin.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{Map, Value};

use crate::json_file;
use crate::plugins::is_valid_id;

/// Per plugin. Enough for settings, notes and caches, not for media.
pub const MAX_BYTES: usize = 1024 * 1024;
pub const MAX_KEY_LENGTH: usize = 256;

pub struct PluginStorage {
    dir: PathBuf,
    /// Writes are read-modify-write: serialise them.
    lock: Mutex<()>,
}

impl PluginStorage {
    pub fn new(dir: &Path) -> Self {
        Self {
            dir: dir.to_path_buf(),
            lock: Mutex::new(()),
        }
    }

    fn path(&self, id: &str) -> Result<PathBuf, String> {
        if !is_valid_id(id) {
            return Err(format!("invalid plugin id '{id}'"));
        }
        Ok(self.dir.join(format!("{id}.json")))
    }

    fn read(&self, id: &str) -> Result<Map<String, Value>, String> {
        Ok(json_file::read_object(&self.path(id)?).unwrap_or_default())
    }

    pub fn get(&self, id: &str, key: &str) -> Result<Option<Value>, String> {
        Ok(self.read(id)?.remove(key))
    }

    pub fn keys(&self, id: &str) -> Result<Vec<String>, String> {
        Ok(self.read(id)?.into_iter().map(|(key, _)| key).collect())
    }

    pub fn set(&self, id: &str, key: &str, value: Value) -> Result<(), String> {
        if key.is_empty() || key.chars().count() > MAX_KEY_LENGTH {
            return Err(format!("keys must be 1 to {MAX_KEY_LENGTH} characters"));
        }
        self.update(id, |data| {
            data.insert(key.to_owned(), value);
        })
    }

    pub fn remove(&self, id: &str, key: &str) -> Result<(), String> {
        self.update(id, |data| {
            data.remove(key);
        })
    }

    fn update(&self, id: &str, change: impl FnOnce(&mut Map<String, Value>)) -> Result<(), String> {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut data = self.read(id)?;
        change(&mut data);
        json_file::write(&self.path(id)?, &Value::Object(data), MAX_BYTES)
            .map_err(|error| format!("storage not saved: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn store(name: &str) -> (PluginStorage, PathBuf) {
        let dir =
            std::env::temp_dir().join(format!("overquid-storage-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        (PluginStorage::new(&dir), dir)
    }

    #[test]
    fn round_trips_json_values_per_plugin() {
        let (storage, dir) = store("roundtrip");
        storage.set("com.a", "count", json!(3)).unwrap();
        storage
            .set("com.a", "draft", json!({ "text": "hi" }))
            .unwrap();
        storage.set("com.b", "count", json!(10)).unwrap();
        assert_eq!(storage.get("com.a", "count").unwrap(), Some(json!(3)));
        assert_eq!(storage.get("com.b", "count").unwrap(), Some(json!(10)));
        assert_eq!(storage.get("com.a", "missing").unwrap(), None);
        let mut keys = storage.keys("com.a").unwrap();
        keys.sort();
        assert_eq!(keys, ["count", "draft"]);
        storage.remove("com.a", "count").unwrap();
        assert_eq!(storage.get("com.a", "count").unwrap(), None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_bad_ids_keys_and_oversized_data() {
        let (storage, dir) = store("limits");
        assert!(storage.set("../escape", "k", json!(1)).is_err());
        assert!(storage.get("Bad", "k").is_err());
        assert!(storage.set("com.a", "", json!(1)).is_err());
        assert!(
            storage
                .set("com.a", &"k".repeat(MAX_KEY_LENGTH + 1), json!(1))
                .is_err()
        );
        assert!(
            storage
                .set("com.a", "big", json!("x".repeat(MAX_BYTES)))
                .is_err()
        );
        assert_eq!(storage.keys("com.a").unwrap(), Vec::<String>::new());
        let _ = fs::remove_dir_all(dir);
    }
}
