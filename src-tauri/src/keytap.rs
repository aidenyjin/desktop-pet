//! System-wide keystroke and mouse-click *counting*.
//!
//! On macOS this installs a listen-only `CGEventTap` for key-down and
//! mouse-down events and increments an atomic counter. The event itself is
//! never inspected beyond its auto-repeat flag and is never stored, logged, or
//! forwarded. Nothing here can see *which* key was pressed, or *where* a click
//! landed, in any place that outlives the callback — the cursor position is
//! never read at all.
//!
//! The counter is a lifetime total (persisted by `store::KeyLedger`) so the
//! frontend can pull it at its own pace and never miss a keystroke, even if
//! the webview was suspended or the app was quit mid-typing.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // `Unsupported` is only built off macOS
pub enum Permission {
    Granted,
    Denied,
    /// Platform without a system-wide counter; only in-panel typing counts.
    Unsupported,
}

impl Permission {
    pub fn as_str(self) -> &'static str {
        match self {
            Permission::Granted => "granted",
            Permission::Denied => "denied",
            Permission::Unsupported => "unsupported",
        }
    }
}

/// Shared keystroke counter. `total` is the lifetime count including the
/// persisted base loaded at startup.
#[derive(Debug)]
pub struct KeyCounter {
    total: AtomicU64,
    running: AtomicBool,
}

impl KeyCounter {
    pub fn new(base: u64) -> Arc<Self> {
        Arc::new(Self {
            total: AtomicU64::new(base),
            running: AtomicBool::new(false),
        })
    }

    pub fn total(&self) -> u64 {
        self.total.load(Ordering::Relaxed)
    }

    /// Adds keystrokes counted by the frontend itself (typing inside the
    /// panel while no system-wide tap is available).
    pub fn add(&self, n: u64) -> u64 {
        self.total.fetch_add(n, Ordering::Relaxed) + n
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
    use core_graphics::event::{
        CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
        CallbackResult, EventField,
    };
    use std::sync::atomic::AtomicPtr;
    use std::sync::mpsc;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightListenEventAccess() -> bool;
        fn CGRequestListenEventAccess() -> bool;
        fn CGEventTapEnable(tap: core_foundation::mach_port::CFMachPortRef, enable: bool);
    }

    pub fn permission() -> Permission {
        // Available since macOS 10.15; we require 12+.
        if unsafe { CGPreflightListenEventAccess() } {
            Permission::Granted
        } else {
            Permission::Denied
        }
    }

    /// Shows the system prompt the first time; afterwards macOS only returns
    /// the current state and the user has to flip the switch in
    /// System Settings.
    pub fn request_permission() -> bool {
        unsafe { CGRequestListenEventAccess() }
    }

    /// Installs the tap on a dedicated thread and blocks until it is either
    /// running or has failed. Idempotent.
    pub fn start(counter: Arc<KeyCounter>) -> Result<(), String> {
        if counter.is_running() {
            return Ok(());
        }
        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        let thread_counter = counter.clone();
        std::thread::Builder::new()
            .name("sonatina-keytap".into())
            .spawn(move || {
                // The raw mach port is stashed so the callback can re-enable the
                // tap if the system disables it (e.g. after sleep).
                let port: Arc<AtomicPtr<std::ffi::c_void>> =
                    Arc::new(AtomicPtr::new(std::ptr::null_mut()));
                let cb_port = port.clone();
                let cb_counter = thread_counter.clone();

                let tap = CGEventTap::new(
                    CGEventTapLocation::Session,
                    CGEventTapPlacement::HeadInsertEventTap,
                    CGEventTapOptions::ListenOnly,
                    vec![
                        CGEventType::KeyDown,
                        // Clicks are notes too. Only the *down* edge counts, so
                        // a single click is a single note, and a drag (down,
                        // move, up) is not a flurry of them.
                        CGEventType::LeftMouseDown,
                        CGEventType::RightMouseDown,
                        CGEventType::OtherMouseDown,
                        CGEventType::TapDisabledByTimeout,
                        CGEventType::TapDisabledByUserInput,
                    ],
                    move |_proxy, kind, event| {
                        match kind {
                            CGEventType::KeyDown => {
                                // Holding a key down produces auto-repeat events;
                                // those are not typing.
                                if event.get_integer_value_field(EventField::KEYBOARD_EVENT_AUTOREPEAT)
                                    == 0
                                {
                                    cb_counter.total.fetch_add(1, Ordering::Relaxed);
                                }
                            }
                            CGEventType::LeftMouseDown
                            | CGEventType::RightMouseDown
                            | CGEventType::OtherMouseDown => {
                                cb_counter.total.fetch_add(1, Ordering::Relaxed);
                            }
                            CGEventType::TapDisabledByTimeout
                            | CGEventType::TapDisabledByUserInput => {
                                let p = cb_port.load(Ordering::Acquire);
                                if !p.is_null() {
                                    unsafe { CGEventTapEnable(p as _, true) };
                                }
                            }
                            _ => {}
                        }
                        CallbackResult::Keep
                    },
                );

                let tap = match tap {
                    Ok(t) => t,
                    Err(()) => {
                        let _ = tx.send(Err("event tap could not be created".into()));
                        return;
                    }
                };
                let source = match tap.mach_port().create_runloop_source(0) {
                    Ok(s) => s,
                    Err(_) => {
                        let _ = tx.send(Err("run loop source could not be created".into()));
                        return;
                    }
                };
                use core_foundation::base::TCFType;
                port.store(
                    tap.mach_port().as_concrete_TypeRef() as *mut std::ffi::c_void,
                    Ordering::Release,
                );
                CFRunLoop::get_current().add_source(&source, unsafe { kCFRunLoopCommonModes });
                tap.enable();
                thread_counter.running.store(true, Ordering::Relaxed);
                let _ = tx.send(Ok(()));
                CFRunLoop::run_current();
                // Only reached if the run loop is stopped, which we never do.
                thread_counter.running.store(false, Ordering::Relaxed);
                drop(tap);
            })
            .map_err(|e| e.to_string())?;

        rx.recv().map_err(|_| "key tap thread died".to_string())?
    }

    pub fn open_settings() {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
            .spawn();
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;

    pub fn permission() -> Permission {
        Permission::Unsupported
    }
    pub fn request_permission() -> bool {
        false
    }
    pub fn start(_counter: Arc<KeyCounter>) -> Result<(), String> {
        Err("system-wide key counting is only available on macOS".into())
    }
    pub fn open_settings() {}
}

pub use imp::{open_settings, permission, request_permission, start};
