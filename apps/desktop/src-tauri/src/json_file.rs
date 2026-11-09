//! JSON files owned by the core: read leniently, written atomically.

use std::fs;
use std::io;
use std::path::Path;

use serde_json::{Map, Value};

/// The JSON object stored at `path`, or `None` if there is none.
///
/// A file that is not a JSON object is moved to `<name>.corrupt` and treated as
/// missing, so the next write does not destroy what may be hand-edited data.
pub fn read_object(path: &Path) -> Option<Map<String, Value>> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return None,
        Err(error) => {
            eprintln!("overquid: cannot read {}: {error}", path.display());
            return None;
        }
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(object)) => Some(object),
        _ => {
            let aside = path.with_extension("json.corrupt");
            eprintln!(
                "overquid: {} is not a valid JSON object, moved to {}",
                path.display(),
                aside.display()
            );
            if let Err(error) = fs::rename(path, &aside) {
                eprintln!("overquid: cannot move it: {error}");
            }
            None
        }
    }
}

/// Serialises `value` and writes it to a temporary file renamed over `path`:
/// a crash mid-write never leaves a truncated file. Fails above `max_bytes`.
pub fn write(path: &Path, value: &Value, max_bytes: usize) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    if text.len() > max_bytes {
        return Err(format!("larger than {max_bytes} bytes"));
    }
    let write = || -> io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, text)?;
        fs::rename(&tmp, path)
    };
    write().map_err(|error| format!("cannot write {}: {error}", path.display()))
}
