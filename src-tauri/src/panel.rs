//! The floating panel: placed under the menu bar icon, shown on click, hidden
//! on blur unless pinned.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position, Rect, Runtime, Size, WebviewWindow};

pub const WINDOW_LABEL: &str = "main";

/// Gap between the menu bar and the top of the window, in logical pixels.
/// The window itself carries a transparent margin for its CSS shadow, so the
/// visible card sits a little lower than this.
const GAP_LOGICAL: f64 = 2.0;

#[derive(Debug, Default)]
pub struct PanelState {
    pub pinned: AtomicBool,
    /// Millisecond timestamp of the last blur-triggered hide. Used to make a
    /// tray click that *caused* the blur behave as "close" rather than
    /// "close and immediately reopen".
    last_blur_hide_ms: AtomicU64,
    /// Last known tray icon rectangle so the panel can be positioned even
    /// when shown without a click (e.g. `Reopen`).
    tray_rect: std::sync::Mutex<Option<Rect>>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl PanelState {
    pub fn remember_tray_rect(&self, rect: Rect) {
        if let Ok(mut r) = self.tray_rect.lock() {
            *r = Some(rect);
        }
    }

    pub fn tray_rect(&self) -> Option<Rect> {
        self.tray_rect.lock().ok().and_then(|r| *r)
    }

    pub fn note_blur_hide(&self) {
        self.last_blur_hide_ms.store(now_ms(), Ordering::Relaxed);
    }

    pub fn blur_hid_just_now(&self) -> bool {
        now_ms().saturating_sub(self.last_blur_hide_ms.load(Ordering::Relaxed)) < 350
    }
}

pub fn window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(WINDOW_LABEL)
}

/// Converts a tray rectangle into physical pixels using the scale factor of
/// the monitor it sits on.
fn rect_physical<R: Runtime>(win: &WebviewWindow<R>, rect: &Rect) -> (f64, f64, f64, f64) {
    // First pass: a scale guess so we can find the right monitor.
    let guess_scale = win.scale_factor().unwrap_or(1.0);
    let (px, py) = match rect.position {
        Position::Physical(p) => (p.x as f64, p.y as f64),
        Position::Logical(p) => (p.x * guess_scale, p.y * guess_scale),
    };
    let scale = monitor_at(win, px, py)
        .map(|m| m.scale_factor())
        .unwrap_or(guess_scale);
    let (x, y) = match rect.position {
        Position::Physical(p) => (p.x as f64, p.y as f64),
        Position::Logical(p) => (p.x * scale, p.y * scale),
    };
    let (w, h) = match rect.size {
        Size::Physical(s) => (s.width as f64, s.height as f64),
        Size::Logical(s) => (s.width * scale, s.height * scale),
    };
    (x, y, w, h)
}

fn monitor_at<R: Runtime>(win: &WebviewWindow<R>, x: f64, y: f64) -> Option<tauri::Monitor> {
    let monitors = win.available_monitors().ok()?;
    monitors
        .iter()
        .find(|m| {
            let p = m.position();
            let s = m.size();
            x >= p.x as f64
                && x < (p.x as f64 + s.width as f64)
                && y >= p.y as f64
                && y < (p.y as f64 + s.height as f64)
        })
        .cloned()
        .or_else(|| win.primary_monitor().ok().flatten())
}

/// Positions the panel centred under the tray icon and shows it.
pub fn show<R: Runtime>(app: &AppHandle<R>, tray: Option<&Rect>) {
    let Some(win) = window(app) else { return };
    let state = app.state::<PanelState>();
    let rect = tray.cloned().or_else(|| state.tray_rect());

    if let Some(rect) = rect {
        let (tx, ty, tw, th) = rect_physical(&win, &rect);
        let scale = monitor_at(&win, tx, ty)
            .map(|m| m.scale_factor())
            .unwrap_or_else(|| win.scale_factor().unwrap_or(1.0));
        let size = win.outer_size().unwrap_or(tauri::PhysicalSize::new(396, 512));
        let (ww, wh) = (size.width as f64, size.height as f64);

        let mut x = tx + tw / 2.0 - ww / 2.0;
        let mut y = ty + th + GAP_LOGICAL * scale;

        if let Some(m) = monitor_at(&win, tx, ty) {
            let area = m.work_area();
            let (ax, ay) = (area.position.x as f64, area.position.y as f64);
            let (aw, ah) = (area.size.width as f64, area.size.height as f64);
            // Keep the card on screen with a little breathing room.
            let pad = 6.0 * scale;
            x = x.max(ax + pad).min(ax + aw - ww - pad);
            if y + wh > ay + ah {
                y = (ay + ah - wh).max(ay);
            }
        }
        let _ = win.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    } else {
        let _ = win.center();
    }

    // `hide` deactivates the whole app; make sure it is back before showing.
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }
    let _ = win.show();
    let _ = win.set_focus();
    let _ = app.emit_to(WINDOW_LABEL, "panel:shown", ());
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    let Some(win) = window(app) else { return };
    let _ = win.hide();
    let _ = app.emit_to(WINDOW_LABEL, "panel:hidden", ());
    // Hand focus back to whatever the user was doing.
    #[cfg(target_os = "macos")]
    {
        let _ = app.hide();
    }
}

pub fn is_visible<R: Runtime>(app: &AppHandle<R>) -> bool {
    window(app)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

pub fn toggle<R: Runtime>(app: &AppHandle<R>, tray: Option<&Rect>) {
    let state = app.state::<PanelState>();
    if is_visible(app) {
        hide(app);
    } else if state.blur_hid_just_now() {
        // The click on the tray icon is what blurred (and hid) the panel.
        // The user wanted it closed; leave it closed.
    } else {
        show(app, tray);
    }
}
