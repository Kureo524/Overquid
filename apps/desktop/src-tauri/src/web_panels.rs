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

/// A panel in front of a web panel, in CSS pixels of the overlay window: the
/// part of the web page to cut out (ADR 0004).
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Hole {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Corner radius of the panel: its rounded corners leave the page visible.
    #[serde(default)]
    pub radius: f64,
}

/// Height of the bands that approximate a rounded corner.
const CORNER_STEP: i32 = 2;

/// A rounded rectangle as a few plain rectangles `(x, y, width, height)`: one
/// band per `CORNER_STEP` rows in the corners, one for the straight middle.
/// Each corner band is as wide as the curve at its middle row.
pub fn rounded_rectangles(
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    radius: f64,
) -> Vec<(i32, i32, i32, i32)> {
    let radius = radius.max(0.0).min(f64::from(width.min(height)) / 2.0);
    let r = radius.floor() as i32;
    if r < CORNER_STEP {
        return vec![(x, y, width, height)];
    }
    let mut parts = Vec::new();
    let mut row = 0;
    while row < r {
        let band = CORNER_STEP.min(r - row);
        // Distance from the corner circle's centre to the band's middle row.
        let dy = radius - (f64::from(row) + f64::from(band) / 2.0);
        let inset = (radius - (radius * radius - dy * dy).max(0.0).sqrt()).round() as i32;
        let w = width - 2 * inset;
        parts.push((x + inset, y + row, w, band));
        parts.push((x + inset, y + height - row - band, w, band));
        row += band;
    }
    parts.push((x, y + r, width, height - 2 * r));
    parts
}

/// What a web panel reports to the overlay.
pub struct Hooks {
    /// The page changed (address, title, history, loading).
    pub on_change: Box<dyn Fn(PageState)>,
    /// The user pressed a mouse button in the view: its panel comes to the front.
    pub on_press: Box<dyn Fn()>,
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
    _holes: &[Hole],
    _hooks: Hooks,
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

    use super::{DataDirs, Hole, Hooks, Navigation, PAUSE_MEDIA, PageState, rounded_rectangles};
    use crate::plugins::{WebSpec, host_allowed, https_host, resolve_input};
    use crate::state::Rect;

    struct State {
        overlay: gtk::Overlay,
        views: HashMap<String, WebView>,
    }

    // GTK objects live on the main thread only; so does this state.
    thread_local! {
        static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
        /// Exact rectangle of each view in the overlay, and the parts of it
        /// covered by panels in front (view coordinates). Kept apart from
        /// `STATE`: GTK reads it while laying out, possibly during `place`.
        static RECTS: RefCell<Vec<Placed>> = const { RefCell::new(Vec::new()) };
        /// Set while a covered view draws its visible parts one by one.
        static NESTED_DRAW: Cell<bool> = const { Cell::new(false) };
    }

    struct Placed {
        view: gtk::Widget,
        rect: gtk::gdk::Rectangle,
        holes: Vec<gtk::cairo::RectangleInt>,
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
                    .find(|placed| placed.view == *widget)
                    .map(|placed| placed.rect)
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
        holes: &[Hole],
        hooks: Hooks,
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
                watch(&view, id, hooks);
                view.load_uri(&spec.url);
                state.overlay.add_overlay(&view);
                view
            });
            let (x, y, width, height) = rect;
            let holes = holes
                .iter()
                .filter_map(|hole| {
                    let area = Rect {
                        x: hole.x,
                        y: hole.y,
                        width: hole.width,
                        height: hole.height,
                    };
                    Some((area.to_pixels()?, hole.radius))
                })
                .flat_map(|((hx, hy, hw, hh), radius)| {
                    rounded_rectangles(hx - x, hy - y, hw, hh, radius)
                })
                .map(|(hx, hy, hw, hh)| gtk::cairo::RectangleInt::new(hx, hy, hw, hh))
                .collect();
            let placed = Placed {
                view: view.clone().upcast(),
                rect: gtk::gdk::Rectangle::new(x, y, width, height),
                holes,
            };
            RECTS.with(|rects| {
                let mut rects = rects.borrow_mut();
                match rects.iter_mut().find(|known| known.view == placed.view) {
                    Some(entry) => *entry = placed,
                    None => rects.push(placed),
                }
            });
            view.show();
            view.queue_resize();
            cut(view.upcast_ref());
            Ok(())
        })
    }

    /// Cuts the panels in front out of the view for clicks: they reach the
    /// overlay page under it. (Drawing is cut in the view's draw handler.)
    /// Native views are drawn over the whole overlay page: without this, a
    /// panel in front of a web panel would show behind its page.
    fn cut(view: &gtk::Widget) {
        let region = visible_region(view).or_else(|| {
            RECTS.with(|rects| {
                let rects = rects.borrow();
                let placed = rects.iter().find(|placed| placed.view == *view)?;
                Some(gtk::cairo::Region::create_rectangle(
                    &gtk::cairo::RectangleInt::new(0, 0, placed.rect.width(), placed.rect.height()),
                ))
            })
        });
        let Some(region) = region else { return };
        // Both the view's window and the one `gtk::Overlay` holds it in.
        for window in [view.window(), view.parent_window()].into_iter().flatten() {
            window.input_shape_combine_region(&region, 0, 0);
        }
        view.queue_draw();
    }

    /// The part of the view not covered by panels in front, or `None` when
    /// nothing covers it.
    fn visible_region(view: &gtk::Widget) -> Option<gtk::cairo::Region> {
        RECTS.with(|rects| {
            let rects = rects.borrow();
            let placed = rects.iter().find(|placed| placed.view == *view)?;
            if placed.holes.is_empty() {
                return None;
            }
            let full =
                gtk::cairo::RectangleInt::new(0, 0, placed.rect.width(), placed.rect.height());
            let region = gtk::cairo::Region::create_rectangle(&full);
            for hole in &placed.holes {
                let _ = region.subtract_rectangle(hole);
            }
            Some(region)
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
    fn watch(view: &WebView, id: &str, hooks: Hooks) {
        let Hooks {
            on_change,
            on_press,
        } = hooks;
        view.connect_button_press_event(move |_, _| {
            on_press();
            glib::Propagation::Proceed
        });
        // The view's windows exist once it is allocated.
        view.connect_size_allocate(|view, _| cut(view.upcast_ref()));
        // Drawing: WebKit copies its frame clipped to the bounding box of the
        // clip only, and GDK window shapes do not apply to it. When panels
        // cover the view, its visible part is split into rectangles and
        // WebKit draws once per rectangle, each its own clip.
        view.connect_draw(|view, cr| {
            if NESTED_DRAW.get() {
                return glib::Propagation::Proceed;
            }
            let Some(visible) = visible_region(view.upcast_ref()) else {
                return glib::Propagation::Proceed;
            };
            NESTED_DRAW.set(true);
            for index in 0..visible.num_rectangles() {
                let part = visible.rectangle(index);
                let _ = cr.save();
                cr.rectangle(
                    f64::from(part.x()),
                    f64::from(part.y()),
                    f64::from(part.width()),
                    f64::from(part.height()),
                );
                cr.clip();
                view.draw(cr);
                let _ = cr.restore();
            }
            NESTED_DRAW.set(false);
            glib::Propagation::Stop
        });
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

#[cfg(test)]
mod tests {
    use super::rounded_rectangles;

    fn covers(parts: &[(i32, i32, i32, i32)], px: i32, py: i32) -> bool {
        parts
            .iter()
            .any(|&(x, y, w, h)| px >= x && px < x + w && py >= y && py < y + h)
    }

    #[test]
    fn square_corners_stay_one_rectangle() {
        assert_eq!(rounded_rectangles(5, 6, 100, 50, 0.0), [(5, 6, 100, 50)]);
        assert_eq!(rounded_rectangles(5, 6, 100, 50, 1.0), [(5, 6, 100, 50)]);
    }

    #[test]
    fn rounded_corners_leave_the_corner_out() {
        let parts = rounded_rectangles(0, 0, 200, 100, 18.0);
        // Centre and edge midpoints are covered, the very corners are not.
        assert!(covers(&parts, 100, 50));
        assert!(covers(&parts, 100, 0));
        assert!(covers(&parts, 0, 50));
        assert!(covers(&parts, 199, 99 - 18));
        for (x, y) in [(0, 0), (199, 0), (0, 99), (199, 99)] {
            assert!(!covers(&parts, x, y), "corner {x},{y}");
        }
        // Bands never overlap the middle and stay inside the rectangle.
        for &(x, y, w, h) in &parts {
            assert!(x >= 0 && y >= 0 && x + w <= 200 && y + h <= 100 && w > 0 && h > 0);
        }
    }

    #[test]
    fn radius_is_capped_by_the_smaller_side() {
        let parts = rounded_rectangles(0, 0, 40, 10, 99.0);
        assert!(covers(&parts, 20, 5));
        assert!(!covers(&parts, 0, 0));
    }
}
