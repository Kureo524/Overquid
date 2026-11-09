//! Web panels (ADR 0004): official web apps (Discord, YouTube) shown in
//! native WebKitGTK views placed over a plugin's panel.
//!
//! These sites refuse to be framed, so they cannot live in a plugin iframe.
//! The core creates one `WebKitWebView` per web plugin inside a `gtk::Overlay`
//! slipped under the overlay window, and moves it with the panel. The views
//! get no Tauri IPC bridge: they run like pages of a browser, each with its own
//! browsing data.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Where a web plugin keeps its cookies, storage and cache.
pub struct DataDirs {
    pub data: PathBuf,
    pub cache: PathBuf,
}

/// What a web panel shows, sent to the overlay on every change (a browser's
/// address bar and buttons follow it).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageState {
    pub plugin_id: String,
    pub url: String,
    pub title: String,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub loading: bool,
}

/// A browser button or address bar entry.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Navigation {
    /// Text typed in the address bar: an address or a search.
    Load {
        input: String,
    },
    Back,
    Forward,
    Reload,
    Stop,
    Home,
}

/// Pauses every audio and video element of the page.
const PAUSE_MEDIA: &str = "document.querySelectorAll('video, audio').forEach((m) => m.pause())";

#[cfg(target_os = "linux")]
pub use linux::{install, navigate, place, unload_all};

#[cfg(not(target_os = "linux"))]
pub fn unload_all(done: impl FnOnce() + 'static) {
    done();
}

#[cfg(not(target_os = "linux"))]
pub fn place(
    _id: &str,
    _spec: &crate::plugins::WebSpec,
    _dirs: DataDirs,
    _rect: Option<crate::state::Rect>,
    _on_change: impl Fn(PageState) + 'static,
) -> Result<(), String> {
    Err("web panels are only supported on Linux for now".into())
}

#[cfg(not(target_os = "linux"))]
pub fn navigate(
    _id: &str,
    _spec: &crate::plugins::WebSpec,
    _navigation: Navigation,
) -> Result<(), String> {
    Err("web panels are only supported on Linux for now".into())
}

#[cfg(target_os = "linux")]
mod linux {
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;
    use std::rc::Rc;
    use std::time::Duration;

    use gtk::glib;
    use gtk::prelude::*;
    use webkit2gtk::{
        CookieManagerExt, CookiePersistentStorage, LoadEvent, NavigationPolicyDecision,
        NavigationPolicyDecisionExt, NavigationType, PolicyDecisionExt, PolicyDecisionType,
        SettingsExt, URIRequestExt, WebContext, WebView, WebViewExt, WebsiteDataManager,
        WebsiteDataManagerExt,
    };

    use super::{DataDirs, Navigation, PAUSE_MEDIA, PageState};
    use crate::plugins::{WebSpec, host_allowed, https_host, resolve_input};
    use crate::state::Rect;

    struct State {
        overlay: gtk::Overlay,
        views: HashMap<String, WebView>,
    }

    // GTK objects live on the main thread only; so does this state.
    thread_local! {
        static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
        /// Exact rectangle of each view in the overlay. Kept apart from
        /// `STATE`: GTK reads it while laying out, possibly during `place`.
        static RECTS: RefCell<Vec<(gtk::Widget, gtk::gdk::Rectangle)>> =
            const { RefCell::new(Vec::new()) };
    }

    /// Slips a `gtk::Overlay` between the window and its content (Tao's box
    /// holding the overlay's own web view), so web views can be laid over it.
    pub fn install(window: &gtk::ApplicationWindow) {
        let Some(content) = window.child() else {
            eprintln!("overquid: no window content, web panels disabled");
            return;
        };
        let overlay = gtk::Overlay::new();
        // Views get exactly their panel's rectangle. Margins plus a size
        // request would only set a minimum: a view could grow, never shrink.
        overlay.connect_get_child_position(|_, widget| {
            RECTS.with(|rects| {
                rects
                    .borrow()
                    .iter()
                    .find(|(view, _)| view == widget)
                    .map(|(_, rect)| *rect)
            })
        });
        window.remove(&content);
        overlay.add(&content);
        window.add(&overlay);
        overlay.show();
        STATE.with(|state| {
            *state.borrow_mut() = Some(State {
                overlay,
                views: HashMap::new(),
            });
        });
    }

    /// Shows the plugin's web view over `rect` (creating it the first time),
    /// or hides it when `rect` is `None`. Main thread only.
    pub fn place(
        id: &str,
        spec: &WebSpec,
        dirs: DataDirs,
        rect: Option<Rect>,
        on_change: impl Fn(PageState) + 'static,
    ) -> Result<(), String> {
        STATE.with(|state| {
            let mut state = state.borrow_mut();
            let state = state.as_mut().ok_or("web panels are not available")?;
            let Some(rect) = rect.and_then(Rect::to_pixels) else {
                if let Some(view) = state.views.get(id)
                    && view.is_visible()
                {
                    view.hide();
                    if spec.pause_on_hide {
                        view.evaluate_javascript(
                            PAUSE_MEDIA,
                            None,
                            None,
                            None::<&gio::Cancellable>,
                            |_| {},
                        );
                    }
                }
                return Ok(());
            };
            let view = state.views.entry(id.to_owned()).or_insert_with(|| {
                let view = create(spec, &dirs);
                watch(&view, id, on_change);
                view.load_uri(&spec.url);
                state.overlay.add_overlay(&view);
                view
            });
            let (x, y, width, height) = rect;
            let rect = gtk::gdk::Rectangle::new(x, y, width, height);
            let widget = view.clone().upcast::<gtk::Widget>();
            RECTS.with(|rects| {
                let mut rects = rects.borrow_mut();
                match rects.iter_mut().find(|(known, _)| *known == widget) {
                    Some(entry) => entry.1 = rect,
                    None => rects.push((widget, rect)),
                }
            });
            view.show();
            view.queue_resize();
            Ok(())
        })
    }

    /// Runs a browser button or address bar entry. Browsers only: other web
    /// panels stay on their app.
    pub fn navigate(id: &str, spec: &WebSpec, navigation: Navigation) -> Result<(), String> {
        let browser = spec.browser.as_ref().ok_or("not a browser")?;
        let view = STATE
            .with(|state| {
                state
                    .borrow()
                    .as_ref()
                    .and_then(|state| state.views.get(id).cloned())
            })
            .ok_or("this web panel is not open")?;
        match navigation {
            Navigation::Load { input } => view.load_uri(&resolve_input(&input, &browser.search)),
            Navigation::Back => view.go_back(),
            Navigation::Forward => view.go_forward(),
            Navigation::Reload => view.reload(),
            Navigation::Stop => view.stop_loading(),
            Navigation::Home => view.load_uri(&spec.url),
        }
        Ok(())
    }

    /// Reports the page's address, title, history and loading state on every change.
    fn watch(view: &WebView, id: &str, on_change: impl Fn(PageState) + 'static) {
        let id = id.to_owned();
        let report = Rc::new(move |view: &WebView| {
            on_change(PageState {
                plugin_id: id.clone(),
                url: view.uri().map(String::from).unwrap_or_default(),
                title: view.title().map(String::from).unwrap_or_default(),
                can_go_back: view.can_go_back(),
                can_go_forward: view.can_go_forward(),
                loading: view.is_loading(),
            });
        });
        let on = |report: &Rc<dyn Fn(&WebView)>| {
            let report = report.clone();
            move |view: &WebView| report(view)
        };
        let report: Rc<dyn Fn(&WebView)> = report;
        view.connect_uri_notify(on(&report));
        view.connect_title_notify(on(&report));
        view.connect_is_loading_notify(on(&report));
        let report_load = on(&report);
        view.connect_load_changed(move |view, _| report_load(view));
    }

    /// Unloads every web page, then calls `done` once their storage had time
    /// to be written. Sites run their unload handlers only then: Discord, for
    /// one, keeps its login token out of `localStorage` while the page is open
    /// and writes it back on unload, so quitting without this logs the user out.
    pub fn unload_all(done: impl FnOnce() + 'static) {
        let views: Vec<WebView> = STATE.with(|state| {
            state
                .borrow()
                .as_ref()
                .map(|state| state.views.values().cloned().collect())
                .unwrap_or_default()
        });
        if views.is_empty() {
            done();
            return;
        }
        let done = Rc::new(Cell::new(Some(done)));
        // Called when every page is unloaded, or on timeout: whichever comes first.
        let finish = {
            let done = done.clone();
            move || {
                if let Some(done) = done.take() {
                    glib::timeout_add_local_once(STORAGE_FLUSH, done);
                }
            }
        };
        let remaining = Rc::new(Cell::new(views.len()));
        for view in views {
            let remaining = remaining.clone();
            let finish = finish.clone();
            view.connect_load_changed(move |view, event| {
                if event == LoadEvent::Finished && view.uri().as_deref() == Some("about:blank") {
                    remaining.set(remaining.get().saturating_sub(1));
                    if remaining.get() == 0 {
                        finish();
                    }
                }
            });
            view.load_uri("about:blank");
        }
        glib::timeout_add_local_once(UNLOAD_TIMEOUT, finish);
    }

    /// Longest wait for pages to unload when quitting.
    const UNLOAD_TIMEOUT: Duration = Duration::from_secs(3);
    /// Time left to WebKit to write storage once pages are unloaded.
    const STORAGE_FLUSH: Duration = Duration::from_millis(500);

    fn create(spec: &WebSpec, dirs: &DataDirs) -> WebView {
        let manager = WebsiteDataManager::builder()
            .base_data_directory(dirs.data.to_string_lossy().as_ref())
            .base_cache_directory(dirs.cache.to_string_lossy().as_ref())
            .build();
        if let Some(cookies) = manager.cookie_manager() {
            let file = dirs.data.join("cookies.sqlite");
            cookies
                .set_persistent_storage(&file.to_string_lossy(), CookiePersistentStorage::Sqlite);
        }
        let context = WebContext::with_website_data_manager(&manager);
        let view = WebView::with_context(&context);
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_developer_extras(false);
            settings.set_javascript_can_open_windows_automatically(false);
        }

        let hosts = spec.hosts.clone();
        let browser = spec.browser.is_some();
        view.connect_decide_policy(move |view, decision, kind| {
            let Some(navigation) = decision.downcast_ref::<NavigationPolicyDecision>() else {
                return false;
            };
            let Some(action) = navigation.navigation_action() else {
                return false;
            };
            let Some(uri) = action.request().and_then(|request| request.uri()) else {
                return false;
            };
            let new_window = kind == PolicyDecisionType::NewWindowAction;
            if browser {
                // A browser keeps everything in its panel: one page at a time.
                if new_window {
                    decision.ignore();
                    if uri.starts_with("https://") || uri.starts_with("http://") {
                        view.load_uri(&uri);
                    }
                    return true;
                }
                return false;
            }
            let leaves = !https_host(&uri).is_some_and(|host| host_allowed(&host, &hosts));
            let user_link = kind == PolicyDecisionType::NavigationAction
                && action.navigation_type() == NavigationType::LinkClicked
                && leaves;
            if new_window || user_link {
                // Not this app's page: the user's browser handles it.
                decision.ignore();
                open_externally(&uri);
                return true;
            }
            false
        });
        // A crashed web process leaves the view blank: log why and reload it,
        // a few times at most, so a page that always crashes does not loop.
        let reloads = std::cell::Cell::new(0u8);
        view.connect_web_process_terminated(move |view, reason| {
            eprintln!(
                "overquid: web panel process ended ({reason:?}) on {}",
                view.uri().unwrap_or_default()
            );
            if reloads.get() < MAX_RELOADS {
                reloads.set(reloads.get() + 1);
                view.reload();
            } else {
                view.load_html(CRASHED_PAGE, None);
            }
        });
        view
    }

    /// How many times a crashed web panel is reloaded before giving up.
    const MAX_RELOADS: u8 = 3;

    /// Shown instead of a page that keeps crashing. The usual cause on Linux is
    /// a missing GStreamer plugin: WebKit aborts when a page plays sound and
    /// `autoaudiosink` (gst-plugins-good) is not installed.
    const CRASHED_PAGE: &str = r#"<!doctype html><meta charset="utf-8">
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0c11;color:#a2a6b4;font:14px/1.5 system-ui,sans-serif;text-align:center">
<div style="max-width:32em;padding:16px"><p style="color:#e8e9ee;font-weight:600">This page keeps crashing.</p>
<p>On Linux, this usually means GStreamer plugins are missing. Install <code>gst-plugins-good</code> (and <code>gst-libav</code> for video), then restart Overquid.</p></div>"#;

    fn open_externally(uri: &str) {
        if !(uri.starts_with("https://") || uri.starts_with("http://")) {
            return;
        }
        if let Err(error) =
            gio::AppInfo::launch_default_for_uri(uri, None::<&gio::AppLaunchContext>)
        {
            eprintln!("overquid: cannot open {uri}: {error}");
        }
    }
}
