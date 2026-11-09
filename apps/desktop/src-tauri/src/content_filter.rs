//! Content filter for web panels (ADR 0005): Brave's engine (adblock-rust)
//! with community lists. Off by default; the user switches it on.
//!
//! This module downloads and caches the lists, builds the engine and the
//! blocking rules, and answers what to inject in a page. Applying it to the
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

/// The user's choices, saved in `content-filter.json`.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
    /// Sites where the filter is off (see `site_of`), with their subdomains.
    #[serde(default)]
    pub disabled_sites: Vec<String>,
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        crate::json_file::read_object(path)
            .and_then(|object| serde_json::from_value(object.into()).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        let value = serde_json::to_value(self).map_err(|error| error.to_string())?;
        crate::json_file::write(path, &value, 256 * 1024)
    }

    /// Switches the filter off (or back on) for `site`.
    pub fn set_site(&mut self, site: &str, filtered: bool) {
        self.disabled_sites.retain(|known| known != site);
        if !filtered {
            self.disabled_sites.push(site.to_owned());
            self.disabled_sites.sort();
        }
    }
}

/// The site an exception is kept for: the host, without a leading `www.`.
pub fn site_of(host: &str) -> String {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host.strip_prefix("www.").map(str::to_owned).unwrap_or(host)
}

/// Whether the filter is off on `host`: an exception for it or a parent domain.
pub fn is_excepted(host: &str, sites: &[String]) -> bool {
    let host = site_of(host);
    sites.iter().any(|site| {
        host == *site
            || host
                .strip_suffix(site.as_str())
                .is_some_and(|prefix| prefix.ends_with('.'))
    })
}

/// Host of an `http(s)` URL, lowercased.
pub fn host_of(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?.split(':').next()?;
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

/// Whether a list is missing from the cache or older than a day.
pub fn lists_stale(cache: &Path) -> bool {
    LISTS
        .iter()
        .any(|list| !is_fresh(&cache.join(format!("{}.txt", list.name))))
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

/// The engine and WebKit's blocking rules, built from the lists.
pub struct Compiled {
    pub engine: Engine,
    /// Network rules for WebKit's content blocker (Safari's JSON).
    pub blocker_rules: String,
    /// Elements hidden on every site.
    pub generic: Generic,
    /// Identifies `blocker_rules`: WebKit keeps compiled rules under it.
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

/// Builds the engine (scriptlets and site rules, for pages), the network
/// rules (compiled by WebKit) and the generic hiding rules.
pub fn compile(
    lists: Vec<(&'static List, String)>,
    scriptlets: Vec<Resource>,
) -> Result<Compiled, String> {
    let count = lists.len();
    let generic = Generic::from_lists(lists.iter().map(|(_, text)| text.as_str()));
    let mut full = FilterSet::new(false);
    // Debug mode keeps the raw rules, which the conversion needs.
    let mut blocker = FilterSet::new(true);
    for (list, text) in lists {
        let permissions = if list.trusted {
            TRUSTED
        } else {
            PermissionMask::default()
        };
        // Network rules only: WebKit groups hiding rules into large CSS
        // rules, where one selector it does not support voids the whole
        // group. Hiding rules go in style sheets of their own (`Generic`).
        blocker.add_filter_list(
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
    let (rules, _) = blocker
        .into_content_blocking()
        .map_err(|()| "cannot convert the blocking rules".to_owned())?;
    let blocker_rules = serde_json::to_string(&rules).map_err(|error| error.to_string())?;
    Ok(Compiled {
        engine,
        generic,
        id: rules_id(&blocker_rules),
        blocker_rules,
        lists: count,
        scriptlets: scriptlet_count,
    })
}

/// Elements hidden on every site (`##selector`), minus the generic exceptions
/// (`#@#selector`). Procedural rules (uBlock Origin's `:has-text()` and the
/// like) are left out: they are not CSS.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Generic {
    pub selectors: Vec<String>,
}

/// Markers of uBlock Origin and Adblock Plus extensions to CSS selectors.
const PROCEDURAL: &[&str] = &[
    ":-abp-",
    ":has-text(",
    ":contains(",
    ":upward(",
    ":xpath(",
    ":matches-",
    ":style(",
    ":remove(",
    ":remove-attr(",
    ":remove-class(",
    ":min-text-length(",
    ":watch-attr(",
    ":others(",
    ":if(",
    ":if-not(",
    ":nth-ancestor(",
    ":spath(",
];

impl Generic {
    fn from_lists<'a>(lists: impl Iterator<Item = &'a str>) -> Generic {
        let mut hide = std::collections::BTreeSet::new();
        let mut unhide = std::collections::HashSet::new();
        for line in lists.flat_map(str::lines) {
            let line = line.trim();
            if let Some(selector) = line.strip_prefix("##") {
                if is_plain_selector(selector) {
                    hide.insert(selector);
                }
            } else if let Some(selector) = line.strip_prefix("#@#") {
                unhide.insert(selector);
            }
        }
        Generic {
            selectors: hide
                .into_iter()
                .filter(|selector| !unhide.contains(selector))
                .map(str::to_owned)
                .collect(),
        }
    }

    /// One rule per selector, so that a selector the engine does not support
    /// only voids its own rule. `except` lists selectors the site unhides.
    pub fn style(&self, except: &std::collections::HashSet<String>) -> String {
        self.selectors
            .iter()
            .filter(|selector| !except.contains(*selector))
            .map(|selector| format!("{selector} {{ display: none !important; }}\n"))
            .collect()
    }
}

fn is_plain_selector(selector: &str) -> bool {
    !selector.is_empty()
        // Scriptlets (`+js`) and HTML filters (`^`) are not selectors.
        && !selector.starts_with('+')
        && !selector.starts_with('^')
        // Never let a rule close the style sheet's block.
        && !selector.contains(['{', '}'])
        && !PROCEDURAL.iter().any(|marker| selector.contains(marker))
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
    /// Whether the generic hiding rules apply (`$generichide` turns them off).
    pub generic: bool,
    /// Generic selectors this site unhides (`site#@#selector`).
    pub generic_exceptions: std::collections::HashSet<String>,
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
        generic: !resources.generichide,
        generic_exceptions: resources.exceptions,
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
        let other = page_resources(&compiled.engine, "https://other.org/");
        assert!(other.script.is_empty() && other.style.is_empty());
        assert!(
            compiled.blocker_rules.contains("ads"),
            "{}",
            compiled.blocker_rules
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
    fn keeps_generic_hiding_rules_out_of_the_blocker() {
        let lists = vec![(
            &OTHER_LIST,
            "##.sponsored-tile\n##.ad:has-text(Ad)\n##+js(noop)\n##.gone\n#@#.gone\n##a{}\n"
                .to_owned(),
        )];
        let compiled = compile(lists, Vec::new()).unwrap();
        assert!(!compiled.blocker_rules.contains("css-display-none"));
        assert_eq!(compiled.generic.selectors, [".sponsored-tile"]);
        let none = std::collections::HashSet::new();
        assert_eq!(
            compiled.generic.style(&none),
            ".sponsored-tile { display: none !important; }\n"
        );
        let except = [".sponsored-tile".to_owned()].into();
        assert_eq!(compiled.generic.style(&except), "");
    }

    #[test]
    fn sites_can_turn_generic_hiding_off() {
        let rules = "##.banner\nexample.com#@#.banner\n@@||other.org^$generichide\n";
        let compiled = compile(vec![(&OTHER_LIST, rules.to_owned())], Vec::new()).unwrap();
        let elsewhere = page_resources(&compiled.engine, "https://news.net/");
        assert!(elsewhere.generic && elsewhere.generic_exceptions.is_empty());
        let example = page_resources(&compiled.engine, "https://example.com/");
        assert!(
            example.generic_exceptions.contains(".banner"),
            "{example:?}"
        );
        assert!(!page_resources(&compiled.engine, "https://other.org/").generic);
    }

    #[test]
    fn exceptions_cover_a_site_and_its_subdomains() {
        let sites = vec![site_of("www.YouTube.com")];
        assert_eq!(sites, ["youtube.com"]);
        assert!(is_excepted("youtube.com", &sites));
        assert!(is_excepted("www.youtube.com", &sites));
        assert!(is_excepted("m.youtube.com", &sites));
        assert!(!is_excepted("notyoutube.com", &sites));
        assert!(!is_excepted("youtube.com.evil.net", &sites));

        let mut settings = Settings::default();
        settings.set_site("b.org", false);
        settings.set_site("a.org", false);
        settings.set_site("a.org", false);
        assert_eq!(settings.disabled_sites, ["a.org", "b.org"]);
        settings.set_site("a.org", true);
        assert_eq!(settings.disabled_sites, ["b.org"]);
    }

    #[test]
    fn reads_hosts_of_web_addresses_only() {
        assert_eq!(
            host_of("https://www.youtube.com/watch?v=1").as_deref(),
            Some("www.youtube.com")
        );
        assert_eq!(
            host_of("http://user@Example.org:8080/").as_deref(),
            Some("example.org")
        );
        assert_eq!(host_of("about:blank"), None);
    }

    #[test]
    fn lists_are_stale_when_missing_or_a_day_old() {
        let dir = std::env::temp_dir().join(format!("overquid-stale-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert!(lists_stale(&dir));
        for list in LISTS {
            fs::write(dir.join(format!("{}.txt", list.name)), "! list").unwrap();
        }
        assert!(!lists_stale(&dir));
        let old = SystemTime::now() - MAX_AGE - Duration::from_secs(60);
        let file = fs::File::options()
            .write(true)
            .open(dir.join(format!("{}.txt", LISTS[0].name)))
            .unwrap();
        file.set_modified(old).unwrap();
        assert!(lists_stale(&dir));
        fs::remove_dir_all(dir).unwrap();
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
        let settings = Settings {
            enabled: true,
            disabled_sites: vec!["example.com".into()],
        };
        settings.save(&path).unwrap();
        assert_eq!(Settings::load(&path), settings);
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
        let scriptlets = load_scriptlets(Path::new("resources/ubo-scriptlets.json"));
        let compiled = compile(lists, scriptlets).unwrap();
        let rules: Vec<serde_json::Value> = serde_json::from_str(&compiled.blocker_rules).unwrap();
        println!(
            "{} lists, {} blocking rules ({} KB) in {:?}",
            compiled.lists,
            rules.len(),
            compiled.blocker_rules.len() / 1024,
            start.elapsed()
        );
        let none = std::collections::HashSet::new();
        println!(
            "generic hiding: {} selectors, {} KB",
            compiled.generic.selectors.len(),
            compiled.generic.style(&none).len() / 1024
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
