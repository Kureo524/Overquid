//! Content filter for web panels (ADR 0005): Brave's engine (adblock-rust)
//! with community lists. Off by default; the user switches it on.
//!
//! This module downloads and caches the lists, builds the engine and the
//! network rules, and answers what to inject in a page. Applying it to the
//! web views is `web_panels`' job.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use adblock::Engine;
use adblock::lists::{FilterSet, ParseOptions, RuleTypes};
use adblock::resources::{PermissionMask, Resource};
use serde::{Deserialize, Serialize};

/// A filter list, downloaded from its maintainers.
pub struct List {
    pub name: &'static str,
    pub url: &'static str,
    /// uBlock Origin's own lists may use its trusted scriptlets.
    pub trusted: bool,
}

/// The lists, in uBlock Origin's default selection.
pub const LISTS: &[List] = &[
    List {
        name: "ublock-filters",
        url: "https://ublockorigin.github.io/uAssets/filters/filters.txt",
        trusted: true,
    },
    List {
        name: "ublock-quick-fixes",
        url: "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt",
        trusted: true,
    },
    List {
        name: "ublock-privacy",
        url: "https://ublockorigin.github.io/uAssets/filters/privacy.txt",
        trusted: true,
    },
    List {
        name: "ublock-unbreak",
        url: "https://ublockorigin.github.io/uAssets/filters/unbreak.txt",
        trusted: true,
    },
    List {
        name: "easylist",
        url: "https://easylist.to/easylist/easylist.txt",
        trusted: false,
    },
    List {
        name: "easyprivacy",
        url: "https://easylist.to/easylist/easyprivacy.txt",
        trusted: false,
    },
];

/// Permission granted to trusted lists, required by trusted scriptlets
/// (`permission` in the scriptlet resources, see `scripts/ubo-scriptlets.mjs`).
const TRUSTED: PermissionMask = PermissionMask::from_bits(1);

/// Lists are downloaded again once older than this.
const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);
/// No list is anywhere near this size (EasyList: ~2 MB).
const MAX_LIST_BYTES: u64 = 32 * 1024 * 1024;

/// Whether the user switched the filter on, saved in `content-filter.json`.
#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
pub struct Settings {
    pub enabled: bool,
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        crate::json_file::read_object(path)
            .and_then(|object| serde_json::from_value(object.into()).ok())
            .unwrap_or_default()
    }

    pub fn save(self, path: &Path) -> Result<(), String> {
        let value = serde_json::to_value(self).map_err(|error| error.to_string())?;
        crate::json_file::write(path, &value, 1024)
    }
}

/// What the interface shows about the filter.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Status {
    Off,
    /// Lists are being downloaded or compiled.
    Loading,
    On {
        lists: usize,
        scriptlets: usize,
    },
    Error {
        message: String,
    },
}

/// The engine and the network rules built from the lists.
pub struct Compiled {
    pub engine: Engine,
    /// Network rules in WebKit's content blocker format (Safari's JSON).
    pub network_rules: String,
    /// Identifies `network_rules`: WebKit keeps compiled rules under it.
    pub id: String,
    pub lists: usize,
    pub scriptlets: usize,
}

/// Downloads the lists older than a day, and reads the others from the cache.
/// A list that cannot be downloaded falls back to its cached copy, if any.
pub fn fetch_lists(cache: &Path) -> Result<Vec<(&'static List, String)>, String> {
    fs::create_dir_all(cache).map_err(|error| error.to_string())?;
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .build()
        .into();
    let mut lists = Vec::new();
    for list in LISTS {
        let path = cache.join(format!("{}.txt", list.name));
        let cached = fs::read_to_string(&path).ok();
        if cached.is_some() && is_fresh(&path) {
            lists.extend(cached.map(|text| (list, text)));
            continue;
        }
        match download(&agent, list.url) {
            Ok(text) => {
                if let Err(error) = write_atomically(&path, &text) {
                    eprintln!("overquid: cannot cache {}: {error}", list.name);
                }
                lists.push((list, text));
            }
            Err(error) => {
                eprintln!("overquid: cannot download {}: {error}", list.name);
                lists.extend(cached.map(|text| (list, text)));
            }
        }
    }
    if lists.is_empty() {
        return Err("no filter list could be downloaded".into());
    }
    Ok(lists)
}

fn is_fresh(path: &Path) -> bool {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age < MAX_AGE)
}

fn download(agent: &ureq::Agent, url: &str) -> Result<String, String> {
    let mut response = agent.get(url).call().map_err(|error| error.to_string())?;
    let text = response
        .body_mut()
        .with_config()
        .limit(MAX_LIST_BYTES)
        .read_to_string()
        .map_err(|error| error.to_string())?;
    // A captive portal or an error page is not a filter list.
    if !looks_like_a_list(&text) {
        return Err("not a filter list".into());
    }
    Ok(text)
}

/// Filter lists start with a `[Adblock Plus …]` header or `!` comments.
fn looks_like_a_list(text: &str) -> bool {
    let start = text.trim_start();
    start.starts_with('[') || start.starts_with('!')
}

fn write_atomically(path: &Path, text: &str) -> std::io::Result<()> {
    let partial = path.with_extension("part");
    fs::write(&partial, text)?;
    fs::rename(partial, path)
}

/// Scriptlet resources built from uBlock Origin (`ubo-scriptlets.json`,
/// shipped with the app). Missing or broken: no scriptlets, the rest works.
pub fn load_scriptlets(path: &Path) -> Vec<Resource> {
    #[derive(Deserialize)]
    struct File {
        resources: Vec<Resource>,
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<File>(&text).ok())
        .map(|file| file.resources)
        .unwrap_or_default()
}

/// Builds the engine (every rule, for pages) and the network rules (for WebKit).
pub fn compile(
    lists: Vec<(&'static List, String)>,
    scriptlets: Vec<Resource>,
) -> Result<Compiled, String> {
    let count = lists.len();
    let mut full = FilterSet::new(false);
    // Debug mode keeps the raw rules, which the conversion needs.
    let mut network = FilterSet::new(true);
    for (list, text) in lists {
        let permissions = if list.trusted {
            TRUSTED
        } else {
            PermissionMask::default()
        };
        network.add_filter_list(
            text.clone(),
            ParseOptions {
                rule_types: RuleTypes::NetworkOnly,
                permissions,
                ..ParseOptions::default()
            },
        );
        full.add_filter_list(
            text,
            ParseOptions {
                permissions,
                ..ParseOptions::default()
            },
        );
    }
    let scriptlet_count = scriptlets.len();
    let mut engine = Engine::new_with_filter_set(full);
    engine.use_resources(scriptlets);
    let (rules, _) = network
        .into_content_blocking()
        .map_err(|()| "cannot convert the network rules".to_owned())?;
    let network_rules = serde_json::to_string(&rules).map_err(|error| error.to_string())?;
    Ok(Compiled {
        engine,
        id: rules_id(&network_rules),
        network_rules,
        lists: count,
        scriptlets: scriptlet_count,
    })
}

/// Short, stable identifier of a rule set.
fn rules_id(rules: &str) -> String {
    let mut hasher = DefaultHasher::new();
    rules.hash(&mut hasher);
    format!("overquid-{:016x}", hasher.finish())
}

/// What to inject in a page at `url`, before its own scripts run.
#[derive(Debug, Default, PartialEq)]
pub struct PageResources {
    /// Scriptlets (`##+js(...)`), with their dependencies.
    pub script: String,
    /// Elements to hide on this site (`##selector`).
    pub style: String,
}

pub fn page_resources(engine: &Engine, url: &str) -> PageResources {
    let resources = engine.url_cosmetic_resources(url);
    let mut selectors: Vec<&String> = resources.hide_selectors.iter().collect();
    selectors.sort();
    // One rule per selector: one invalid selector must not void the others.
    let style = selectors
        .iter()
        .map(|selector| format!("{selector} {{ display: none !important; }}\n"))
        .collect();
    PageResources {
        script: resources.injected_script,
        style,
    }
}

/// Where the lists are cached.
pub fn cache_dir(app_cache: &Path) -> PathBuf {
    app_cache.join("filters")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scriptlet(name: &str, code: &str, permission: u8) -> Resource {
        serde_json::from_value(serde_json::json!({
            "name": name,
            "aliases": [],
            "kind": { "mime": "application/javascript" },
            "content": base64(code),
            "permission": permission,
        }))
        .unwrap()
    }

    fn base64(text: &str) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let bytes = text.as_bytes();
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
            for i in 0..4 {
                if i <= chunk.len() {
                    out.push(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize] as char);
                } else {
                    out.push('=');
                }
            }
        }
        out
    }

    static TRUSTED_LIST: List = List {
        name: "trusted",
        url: "",
        trusted: true,
    };
    static OTHER_LIST: List = List {
        name: "other",
        url: "",
        trusted: false,
    };

    #[test]
    fn injects_scriptlets_and_hides_elements_per_site() {
        let lists = vec![(
            &TRUSTED_LIST,
            "example.com##+js(say, hi)\nexample.com##.ad-banner\n||ads.example.net^\n".to_owned(),
        )];
        let compiled = compile(
            lists,
            vec![scriptlet(
                "say.js",
                "function say(word) { console.log(word); }",
                0,
            )],
        )
        .unwrap();
        let page = page_resources(&compiled.engine, "https://example.com/watch");
        assert!(page.script.contains("function say(word)"));
        assert!(page.script.contains("say(\"hi\")"), "{}", page.script);
        assert_eq!(page.style, ".ad-banner { display: none !important; }\n");
        assert_eq!(
            page_resources(&compiled.engine, "https://other.org/"),
            PageResources::default()
        );
        assert!(
            compiled.network_rules.contains("ads"),
            "{}",
            compiled.network_rules
        );
        assert!(compiled.id.starts_with("overquid-"));
    }

    #[test]
    fn trusted_scriptlets_only_run_from_trusted_lists() {
        let rules = "example.com##+js(edit, x)\n";
        let resources = || vec![scriptlet("edit.js", "function edit(a) {}", 1)];
        let trusted = compile(vec![(&TRUSTED_LIST, rules.to_owned())], resources()).unwrap();
        let other = compile(vec![(&OTHER_LIST, rules.to_owned())], resources()).unwrap();
        assert!(
            page_resources(&trusted.engine, "https://example.com/")
                .script
                .contains("edit(")
        );
        assert!(
            !page_resources(&other.engine, "https://example.com/")
                .script
                .contains("edit(")
        );
    }

    #[test]
    fn recognises_filter_lists() {
        assert!(looks_like_a_list("[Adblock Plus 2.0]\n! Title: EasyList"));
        assert!(looks_like_a_list("\n! Title: uBlock filters"));
        assert!(!looks_like_a_list("<!doctype html><title>Login</title>"));
    }

    #[test]
    fn settings_round_trip_and_default_to_off() {
        let dir = std::env::temp_dir().join(format!("overquid-filter-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("content-filter.json");
        assert!(!Settings::load(&path).enabled);
        Settings { enabled: true }.save(&path).unwrap();
        assert!(Settings::load(&path).enabled);
        fs::remove_dir_all(dir).unwrap();
    }
}

/// Measures the real lists: `OVERQUID_LISTS_DIR=… cargo test --release real_lists -- --ignored --nocapture`.
#[cfg(test)]
mod real_lists {
    use super::*;

    #[test]
    #[ignore = "needs downloaded lists"]
    fn real_lists() {
        let dir = PathBuf::from(std::env::var("OVERQUID_LISTS_DIR").unwrap());
        let lists = LISTS
            .iter()
            .filter_map(|list| {
                let file = list.url.rsplit('/').next().unwrap();
                fs::read_to_string(dir.join(file))
                    .ok()
                    .map(|text| (list, text))
            })
            .collect::<Vec<_>>();
        let start = std::time::Instant::now();
        let compiled = compile(lists, Vec::new()).unwrap();
        let rules: Vec<serde_json::Value> = serde_json::from_str(&compiled.network_rules).unwrap();
        println!(
            "{} lists, {} network rules ({} KB) in {:?}",
            compiled.lists,
            rules.len(),
            compiled.network_rules.len() / 1024,
            start.elapsed()
        );
        let page = page_resources(&compiled.engine, "https://www.youtube.com/watch?v=x");
        println!(
            "youtube: style {} bytes, script {} bytes",
            page.style.len(),
            page.script.len()
        );
        let start = std::time::Instant::now();
        for _ in 0..100 {
            page_resources(&compiled.engine, "https://www.youtube.com/watch?v=x");
        }
        println!("page_resources: {:?} each", start.elapsed() / 100);
    }
}
