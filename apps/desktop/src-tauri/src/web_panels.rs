//! Web panels (ADR 0004): official web apps (Discord, YouTube) shown in
//! native WebKitGTK views placed over a plugin's panel.
//!
//! These sites refuse to be framed, so they cannot live in a plugin iframe.
//! The core creates one `WebKitWebView` per web plugin inside a `gtk::Overlay`
//! slipped under the overlay window, and moves it with the panel. The views
//! get no Tauri IPC bridge: they run like pages of a browser, each with its own
//! browsing data.

use std::path::PathBuf;

/// Where a web plugin keeps its cookies, storage and cache.
pub struct DataDirs {
    pub data: PathBuf,
    pub cache: PathBuf,
}

/// Pauses every audio and video element of the page.
const PAUSE_MEDIA: &str = "document.querySelectorAll('video, audio').forEach((m) => m.pause())";

#[cfg(target_os = "linux")]
pub use linux::{install, place};

#[cfg(not(target_os = "linux"))]
pub fn place(
    _id: &str,
    _spec: &WebSpec,
    _dirs: DataDirs,
    _rect: Option<Rect>,
) -> Result<(), String> {
    Err("web panels are only supported on Linux for now".into())
}

#[cfg(target_os = "linux")]
mod linux {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use gtk::prelude::*;
    use webkit2gtk::{
        CookieManagerExt, CookiePersistentStorage, NavigationPolicyDecision,
        NavigationPolicyDecisionExt, NavigationType, PolicyDecisionExt, PolicyDecisionType,
        SettingsExt, URIRequestExt, WebContext, WebView, WebViewExt, WebsiteDataManager,
        WebsiteDataManagerExt,
    };

    use super::{DataDirs, PAUSE_MEDIA};
    use crate::plugins::{WebSpec, host_allowed, https_host};
    use crate::state::Rect;

    struct State {
        overlay: gtk::Overlay,
        views: HashMap<String, WebView>,
    }

    // GTK objects live on the main thread only; so does this state.
    thread_local! {
        static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    }

    /// Slips a `gtk::Overlay` between the window and its content (Tao's box
    /// holding the overlay's own web view), so web views can be laid over it.
    pub fn install(window: &gtk::ApplicationWindow) {
        let Some(content) = window.child() else {
            eprintln!("overquid: no window content, web panels disabled");
            return;
        };
        let overlay = gtk::Overlay::new();
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
                state.overlay.add_overlay(&view);
                view
            });
            let (x, y, width, height) = rect;
            view.set_margin_start(x);
            view.set_margin_top(y);
            view.set_size_request(width, height);
            view.show();
            Ok(())
        })
    }

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
        view.set_halign(gtk::Align::Start);
        view.set_valign(gtk::Align::Start);
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_developer_extras(false);
            settings.set_javascript_can_open_windows_automatically(false);
        }

        let hosts = spec.hosts.clone();
        view.connect_decide_policy(move |_, decision, kind| {
            let Some(navigation) = decision.downcast_ref::<NavigationPolicyDecision>() else {
                return false;
            };
            let Some(action) = navigation.navigation_action() else {
                return false;
            };
            let Some(uri) = action.request().and_then(|request| request.uri()) else {
                return false;
            };
            let leaves = !https_host(&uri).is_some_and(|host| host_allowed(&host, &hosts));
            let new_window = kind == PolicyDecisionType::NewWindowAction;
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
        view.load_uri(&spec.url);
        view
    }

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
