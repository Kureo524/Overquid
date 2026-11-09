//! WebKit's native content blocker (`WebKitUserContentFilterStore`), which
//! the Rust bindings do not cover: a thin, safe layer over the C functions.
//!
//! Network rules (Safari's JSON format) are compiled once by WebKit and kept
//! on disk under an identifier; loading them again later is fast.

use std::ffi::CString;
use std::path::Path;
use std::ptr;

use gtk::glib::{self, translate::*};
use webkit2gtk::UserContentManager;
use webkit2gtk::ffi;

/// Compiled rules, ready to add to a view's content manager.
pub struct Filter(ptr::NonNull<ffi::WebKitUserContentFilter>);

impl Clone for Filter {
    fn clone(&self) -> Self {
        // SAFETY: `self.0` is a valid filter we hold a reference to.
        unsafe { ffi::webkit_user_content_filter_ref(self.0.as_ptr()) };
        Filter(self.0)
    }
}

impl Drop for Filter {
    fn drop(&mut self) {
        // SAFETY: releases the reference this value owns.
        unsafe { ffi::webkit_user_content_filter_unref(self.0.as_ptr()) };
    }
}

/// Where compiled rules are kept.
pub struct Store(ptr::NonNull<ffi::WebKitUserContentFilterStore>);

impl Drop for Store {
    fn drop(&mut self) {
        // SAFETY: the store is a GObject this value owns a reference to. A
        // pending operation keeps its own reference.
        unsafe { glib::gobject_ffi::g_object_unref(self.0.as_ptr().cast()) };
    }
}

type Done = Box<dyn FnOnce(Result<Filter, glib::Error>)>;

impl Store {
    pub fn new(path: &Path) -> Option<Store> {
        let path = CString::new(path.to_string_lossy().as_bytes()).ok()?;
        // SAFETY: `path` is a valid C string; the store is returned owned.
        let store = unsafe { ffi::webkit_user_content_filter_store_new(path.as_ptr()) };
        ptr::NonNull::new(store).map(Store)
    }

    /// Loads rules compiled earlier under `id`.
    pub fn load(&self, id: &str, done: impl FnOnce(Result<Filter, glib::Error>) + 'static) {
        let Ok(id) = CString::new(id) else { return };
        let done: Box<Done> = Box::new(Box::new(done));
        // SAFETY: `on_load` takes back `done` exactly once.
        unsafe {
            ffi::webkit_user_content_filter_store_load(
                self.0.as_ptr(),
                id.as_ptr(),
                ptr::null_mut(),
                Some(on_load),
                Box::into_raw(done).cast(),
            );
        }
    }

    /// Compiles `rules` (Safari's JSON) and keeps them under `id`.
    pub fn save(
        &self,
        id: &str,
        rules: &str,
        done: impl FnOnce(Result<Filter, glib::Error>) + 'static,
    ) {
        let Ok(id) = CString::new(id) else { return };
        let bytes = glib::Bytes::from(rules.as_bytes());
        let done: Box<Done> = Box::new(Box::new(done));
        // SAFETY: `bytes` is a valid GBytes (WebKit takes its own reference);
        // `on_save` takes back `done` exactly once.
        unsafe {
            ffi::webkit_user_content_filter_store_save(
                self.0.as_ptr(),
                id.as_ptr(),
                bytes.to_glib_none().0,
                ptr::null_mut(),
                Some(on_save),
                Box::into_raw(done).cast(),
            );
        }
    }
}

/// Ownership of a returned filter, or of the error.
///
/// # Safety
/// `filter` and `error` come from a `_finish` function: at most one is set.
unsafe fn finish(
    filter: *mut ffi::WebKitUserContentFilter,
    error: *mut glib::ffi::GError,
) -> Result<Filter, glib::Error> {
    if !error.is_null() {
        // SAFETY: the caller hands over the error.
        return Err(unsafe { from_glib_full(error) });
    }
    ptr::NonNull::new(filter)
        .map(Filter)
        .ok_or_else(|| glib::Error::new(glib::FileError::Failed, "no content filter returned"))
}

unsafe extern "C" fn on_load(
    source: *mut glib::gobject_ffi::GObject,
    result: *mut gio::ffi::GAsyncResult,
    data: glib::ffi::gpointer,
) {
    // SAFETY: `data` is the `Box<Done>` given to `load`, used once here.
    let done = unsafe { Box::from_raw(data.cast::<Done>()) };
    let mut error = ptr::null_mut();
    // SAFETY: `source` is the store and `result` this operation's result.
    let filter = unsafe {
        ffi::webkit_user_content_filter_store_load_finish(source.cast(), result, &mut error)
    };
    done(unsafe { finish(filter, error) });
}

unsafe extern "C" fn on_save(
    source: *mut glib::gobject_ffi::GObject,
    result: *mut gio::ffi::GAsyncResult,
    data: glib::ffi::gpointer,
) {
    // SAFETY: `data` is the `Box<Done>` given to `save`, used once here.
    let done = unsafe { Box::from_raw(data.cast::<Done>()) };
    let mut error = ptr::null_mut();
    // SAFETY: `source` is the store and `result` this operation's result.
    let filter = unsafe {
        ffi::webkit_user_content_filter_store_save_finish(source.cast(), result, &mut error)
    };
    done(unsafe { finish(filter, error) });
}

/// Applies `filter` to every page later loaded with `manager`.
pub fn add(manager: &UserContentManager, filter: &Filter) {
    // SAFETY: both pointers are valid; WebKit takes its own reference.
    unsafe {
        ffi::webkit_user_content_manager_add_filter(manager.to_glib_none().0, filter.0.as_ptr())
    };
}

pub fn remove_all(manager: &UserContentManager) {
    // SAFETY: `manager` is valid.
    unsafe { ffi::webkit_user_content_manager_remove_all_filters(manager.to_glib_none().0) };
}
