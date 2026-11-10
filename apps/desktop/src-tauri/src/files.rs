//! The user's files, for plugins with the `files` permission (ADR 0012).
//!
//! Plugins see names, sizes and dates and can organise files, always through
//! this module: they never read a file's content, and nothing is ever deleted
//! for good (the trash is the only way out).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use serde_json::{Value, json};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub dir: bool,
    pub link: bool,
    pub size: u64,
    /// Seconds since 1970, if the system reports it.
    pub modified: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct Listing {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<FileEntry>,
}

/// A folder and what weighs inside it.
#[derive(Debug, Serialize, PartialEq)]
pub struct Node {
    pub name: String,
    pub size: u64,
    pub dir: bool,
    pub children: Vec<Node>,
}

/// An absolute path, without `..` or symlinks left to interpret.
fn resolve(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err("the path must be absolute".into());
    }
    path.canonicalize().map_err(|error| error.to_string())
}

/// A single file name: nothing that could point elsewhere.
fn check_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\0') {
        return Err(format!("invalid name '{name}'"));
    }
    Ok(name)
}

fn string_of(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "this path is not valid text".to_owned())
}

pub fn list(path: &str) -> Result<Listing, String> {
    let folder = resolve(path)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&folder).map_err(|error| error.to_string())? {
        let Ok(entry) = entry else { continue };
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Ok(own) = entry.metadata() else { continue };
        // A link reports what it points to, so it opens like its target.
        let target = fs::metadata(entry.path()).unwrap_or_else(|_| own.clone());
        entries.push(FileEntry {
            name,
            dir: target.is_dir(),
            link: own.is_symlink(),
            size: target.len(),
            modified: target
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|time| time.as_secs()),
        });
    }
    Ok(Listing {
        path: string_of(&folder)?,
        parent: folder.parent().map(string_of).transpose()?,
        entries,
    })
}

pub fn rename(path: &str, name: &str) -> Result<(), String> {
    let source = resolve(path)?;
    let target = source
        .parent()
        .ok_or("cannot rename this")?
        .join(check_name(name)?);
    if target.exists() {
        return Err(format!("'{name}' already exists"));
    }
    fs::rename(source, target).map_err(|error| error.to_string())
}

pub fn make_folder(path: &str, name: &str) -> Result<(), String> {
    fs::create_dir(resolve(path)?.join(check_name(name)?)).map_err(|error| error.to_string())
}

fn trash(path: &str) -> Result<(), String> {
    let path = resolve(path)?;
    #[cfg(target_os = "linux")]
    {
        use gio::prelude::*;
        gio::File::for_path(&path)
            .trash(gio::Cancellable::NONE)
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        Err("not available on this system yet".into())
    }
}

/// Opens with the user's default application.
fn open(path: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(resolve(path)?)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("cannot open it: {error}"))
}

/// Most children kept for each folder: the largest ones, the rest added up.
const MAX_CHILDREN: usize = 48;
/// Depth of the tree returned; deeper folders still count in the sizes and are
/// scanned on their own when opened. With `MAX_CHILDREN`, this bounds the reply.
const MAX_DEPTH: usize = 3;
/// Files looked at before giving up on being exhaustive.
const MAX_VISITED: u64 = 4_000_000;

struct Scan {
    device: u64,
    visited: u64,
}

/// Size of everything under `path`. Stays on its filesystem and does not
/// follow links: `/proc`, mounted disks and loops do not count.
pub fn scan(path: &str) -> Result<Node, String> {
    use std::os::unix::fs::MetadataExt;
    let root = resolve(path)?;
    let metadata = fs::symlink_metadata(&root).map_err(|error| error.to_string())?;
    let mut state = Scan {
        device: metadata.dev(),
        visited: 0,
    };
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("/")
        .to_owned();
    Ok(measure(&root, name, &mut state, 0))
}

fn measure(path: &Path, name: String, state: &mut Scan, depth: usize) -> Node {
    use std::os::unix::fs::MetadataExt;
    let mut size = 0;
    let mut children: Vec<Node> = Vec::new();
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            state.visited += 1;
            if state.visited > MAX_VISITED {
                break;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            // Only folders can be mount points, and overlayfs gives its files
            // the device of their lower layer: comparing files would skip them.
            if metadata.is_symlink() || (metadata.is_dir() && metadata.dev() != state.device) {
                continue;
            }
            let child_name = entry.file_name().to_string_lossy().into_owned();
            let child = if metadata.is_dir() {
                measure(&entry.path(), child_name, state, depth + 1)
            } else {
                // What the file really occupies on disk (sparse files are small).
                Node {
                    name: child_name,
                    size: metadata.blocks() * 512,
                    dir: false,
                    children: Vec::new(),
                }
            };
            size += child.size;
            children.push(child);
        }
    }
    children.sort_by_key(|child| std::cmp::Reverse(child.size));
    children.truncate(MAX_CHILDREN);
    if depth + 1 >= MAX_DEPTH {
        children.clear();
    }
    Node {
        name,
        size,
        dir: true,
        children,
    }
}

fn text<'a>(args: &'a Value, name: &str) -> Result<&'a str, String> {
    args.get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("'{name}' must be a string"))
}

/// Runs a `files.*` call; the permission is already checked.
pub fn call(method: &str, args: &Value) -> Result<Value, String> {
    let done = |result: Result<(), String>| result.map(|()| Value::Null);
    match method {
        "files.home" => {
            let home = std::env::var("HOME").map_err(|_| "no home folder".to_owned())?;
            Ok(json!(home))
        }
        "files.list" => {
            serde_json::to_value(list(text(args, "path")?)?).map_err(|error| error.to_string())
        }
        "files.open" => done(open(text(args, "path")?)),
        "files.rename" => done(rename(text(args, "path")?, text(args, "name")?)),
        "files.mkdir" => done(make_folder(text(args, "path")?, text(args, "name")?)),
        "files.trash" => done(trash(text(args, "path")?)),
        "files.scan" => {
            serde_json::to_value(scan(text(args, "path")?)?).map_err(|error| error.to_string())
        }
        other => Err(format!("unknown method '{other}'")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("overquid-files-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn at(dir: &Path) -> &str {
        dir.to_str().unwrap()
    }

    #[test]
    fn lists_a_folder() {
        let dir = folder("list");
        fs::write(dir.join("a.txt"), "hello").unwrap();
        fs::create_dir(dir.join("sub")).unwrap();
        std::os::unix::fs::symlink(dir.join("sub"), dir.join("link")).unwrap();
        let listing = list(at(&dir)).unwrap();
        assert_eq!(listing.path, at(&dir));
        assert_eq!(
            listing.parent.as_deref(),
            dir.parent().and_then(Path::to_str)
        );
        let find = |name: &str| listing.entries.iter().find(|e| e.name == name).unwrap();
        assert_eq!((find("a.txt").dir, find("a.txt").size), (false, 5));
        assert!(find("sub").dir);
        assert!(find("link").link && find("link").dir);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_relative_paths() {
        assert!(list("relative/path").is_err());
        assert!(call("files.list", &json!({ "path": 3 })).is_err());
        assert!(call("files.nope", &json!({})).is_err());
    }

    #[test]
    fn renames_within_the_same_folder() {
        let dir = folder("rename");
        fs::write(dir.join("a"), "x").unwrap();
        fs::write(dir.join("b"), "y").unwrap();
        let file = dir.join("a");
        assert!(
            rename(at(&file), "b")
                .unwrap_err()
                .contains("already exists")
        );
        for bad in ["", ".", "..", "x/y", "../evil"] {
            assert!(rename(at(&file), bad).is_err(), "{bad}");
        }
        rename(at(&file), "c").unwrap();
        assert!(dir.join("c").exists() && !dir.join("a").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn makes_folders() {
        let dir = folder("mkdir");
        make_folder(at(&dir), "new").unwrap();
        assert!(dir.join("new").is_dir());
        assert!(make_folder(at(&dir), "new").is_err());
        assert!(make_folder(at(&dir), "../up").is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn scans_sizes_without_following_links() {
        let dir = folder("scan");
        fs::create_dir(dir.join("big")).unwrap();
        fs::write(dir.join("big/data"), vec![1u8; 64 * 1024]).unwrap();
        fs::write(dir.join("small"), vec![1u8; 4096]).unwrap();
        std::os::unix::fs::symlink(dir.join("big"), dir.join("again")).unwrap();
        let tree = scan(at(&dir)).unwrap();
        assert!(tree.dir);
        let big = tree.children.iter().find(|n| n.name == "big").unwrap();
        assert!(big.size >= 64 * 1024, "{}", big.size);
        assert_eq!(tree.children[0].name, "big");
        assert!(!tree.children.iter().any(|n| n.name == "again"));
        assert_eq!(tree.size, tree.children.iter().map(|n| n.size).sum::<u64>());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keeps_the_top_of_the_tree_and_counts_what_is_below() {
        let dir = folder("deep");
        fs::create_dir_all(dir.join("a/b/c")).unwrap();
        fs::write(dir.join("a/b/c/data"), vec![1u8; 64 * 1024]).unwrap();
        let tree = scan(at(&dir)).unwrap();
        let a = &tree.children[0];
        let b = &a.children[0];
        assert!(b.dir);
        assert!(b.children.is_empty());
        assert!(b.size >= 64 * 1024, "{}", b.size);
        assert_eq!(tree.size, b.size);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn keeps_only_the_largest_children() {
        let dir = folder("many");
        for index in 0..(MAX_CHILDREN + 10) {
            fs::write(dir.join(format!("f{index}")), vec![1u8; 4096]).unwrap();
        }
        let tree = scan(at(&dir)).unwrap();
        assert_eq!(tree.children.len(), MAX_CHILDREN);
        assert!(tree.size > tree.children.iter().map(|n| n.size).sum::<u64>());
        fs::remove_dir_all(dir).unwrap();
    }
}
