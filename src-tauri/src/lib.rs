//! Sonatina — a little composer who lives in your menu bar.
//!
//! The Rust side is deliberately small: it owns the tray icon, the floating
//! panel, system-wide keystroke *counting*, persistence, launch-at-login and
//! notifications. Everything about the game lives in the webview.

mod keytap;
mod panel;
mod store;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, State, WindowEvent};
use tauri_plugin_autostart::ManagerExt as _;
#[cfg(feature = "notifications")]
use tauri_plugin_notification::NotificationExt as _;

use keytap::KeyCounter;
use panel::PanelState;
use store::KeyLedger;

const TRAY_ID: &str = "sonatina-tray";
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray.png");
const TRAY_ICON_BADGE: &[u8] = include_bytes!("../icons/tray-badge.png");

struct App {
    keys: Arc<KeyCounter>,
    ledger: KeyLedger,
    save_path: std::path::PathBuf,
    badge: AtomicBool,
    /// Set once the frontend has flushed its save during quit.
    flushed_for_quit: AtomicBool,
    quitting: AtomicBool,
    tray: Mutex<Option<TrayIcon>>,
    autostart_item: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
}

// ───────────────────────── commands ─────────────────────────

#[tauri::command]
fn key_total(app: State<'_, App>) -> u64 {
    app.keys.total()
}

/// Typing inside the panel counts when no system-wide tap is running.
#[tauri::command]
fn add_local_keys(app: State<'_, App>, n: u64) -> u64 {
    if app.keys.is_running() {
        app.keys.total()
    } else {
        app.keys.add(n.min(64))
    }
}

#[tauri::command]
fn input_permission() -> &'static str {
    keytap::permission().as_str()
}

#[tauri::command]
fn request_input_permission() -> bool {
    keytap::request_permission()
}

#[tauri::command]
fn start_key_listener(app: State<'_, App>) -> Result<bool, String> {
    match keytap::start(app.keys.clone()) {
        Ok(()) => Ok(true),
        Err(e) => {
            log::info!("key listener not started: {e}");
            Ok(false)
        }
    }
}

#[tauri::command]
fn key_listener_running(app: State<'_, App>) -> bool {
    app.keys.is_running()
}

#[tauri::command]
fn open_input_monitoring_settings() {
    keytap::open_settings();
}

#[tauri::command]
fn load_save(app: State<'_, App>) -> Option<String> {
    store::read_json_with_fallback(&app.save_path)
}

#[tauri::command]
fn write_save(app: State<'_, App>, json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("refusing to save invalid JSON: {e}"))?;
    store::write_atomic(&app.save_path, json.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_dir(app: State<'_, App>) -> String {
    app.save_path
        .parent()
        .map(|p| p.display().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn set_pinned(panel: State<'_, PanelState>, pinned: bool) {
    panel.pinned.store(pinned, Ordering::Relaxed);
}

#[tauri::command]
fn hide_panel(app: AppHandle) {
    panel::hide(&app);
}

#[tauri::command]
fn panel_visible(app: AppHandle) -> bool {
    panel::is_visible(&app)
}

#[tauri::command]
fn set_badge(app: AppHandle, state: State<'_, App>, on: bool) {
    if state.badge.swap(on, Ordering::Relaxed) == on {
        return;
    }
    if let Ok(guard) = state.tray.lock() {
        if let Some(tray) = guard.as_ref() {
            let bytes = if on { TRAY_ICON_BADGE } else { TRAY_ICON };
            if let Ok(img) = Image::from_bytes(bytes) {
                let _ = tray.set_icon_with_as_template(Some(img), true);
            }
        }
    }
    let _ = app;
}

/// Hovering the menu bar icon shows what the composer is up to.
#[tauri::command]
fn set_tooltip(state: State<'_, App>, text: String) {
    if let Ok(guard) = state.tray.lock() {
        if let Some(tray) = guard.as_ref() {
            let text = text.trim().chars().take(120).collect::<String>();
            let _ = tray.set_tooltip(if text.is_empty() { None } else { Some(text) });
        }
    }
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, state: State<'_, App>, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let r = if enabled { launcher.enable() } else { launcher.disable() };
    r.map_err(|e| e.to_string())?;
    if let Ok(guard) = state.autostart_item.lock() {
        if let Some(item) = guard.as_ref() {
            let _ = item.set_checked(enabled);
        }
    }
    Ok(())
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) {
    #[cfg(feature = "notifications")]
    {
        if let Err(e) = app.notification().builder().title(title).body(body).show() {
            log::warn!("notification: {e}");
        }
    }
    #[cfg(not(feature = "notifications"))]
    {
        log::info!("notification (disabled at build time): {title} — {body}");
        let _ = app;
    }
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) links can be opened".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        log::info!("open_url is a no-op off macOS: {url}");
    }
    Ok(())
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn quit(app: AppHandle) {
    flush_keys(&app);
    app.exit(0);
}

/// The frontend calls this once its save is on disk during quit.
#[tauri::command]
fn quit_ready(app: State<'_, App>) {
    app.flushed_for_quit.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn relaunch(app: AppHandle) {
    flush_keys(&app);
    app.restart();
}

// ───────────────────────── wiring ─────────────────────────

fn flush_keys<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<App>();
    state.ledger.flush(state.keys.total());
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    let open = MenuItemBuilder::with_id("open", "Open Sonatina").build(app)?;
    let autostart = CheckMenuItemBuilder::with_id("autostart", "Launch at Login")
        .checked(handle.autolaunch().is_enabled().unwrap_or(false))
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit Sonatina")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&open, &PredefinedMenuItem::separator(app)?, &autostart, &PredefinedMenuItem::separator(app)?, &quit])
        .build()?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(TRAY_ICON)?)
        .icon_as_template(true)
        .tooltip("Sonatina")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                let rect = app.tray_by_id(TRAY_ID).and_then(|t| t.rect().ok().flatten());
                panel::show(app, rect.as_ref());
            }
            "autostart" => {
                let launcher = app.autolaunch();
                let enabled = launcher.is_enabled().unwrap_or(false);
                let r = if enabled { launcher.disable() } else { launcher.enable() };
                if let Err(e) = r {
                    log::warn!("launch at login: {e}");
                }
                let now = launcher.is_enabled().unwrap_or(false);
                if let Ok(guard) = app.state::<App>().autostart_item.lock() {
                    if let Some(item) = guard.as_ref() {
                        let _ = item.set_checked(now);
                    }
                }
            }
            "quit" => {
                flush_keys(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            match event {
                TrayIconEvent::Click { rect, button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => {
                    app.state::<PanelState>().remember_tray_rect(rect);
                    panel::toggle(app, Some(&rect));
                }
                TrayIconEvent::Click { rect, .. }
                | TrayIconEvent::Enter { rect, .. }
                | TrayIconEvent::Move { rect, .. } => {
                    app.state::<PanelState>().remember_tray_rect(rect);
                }
                _ => {}
            }
        })
        .build(app)?;

    let state = app.state::<App>();
    if let Ok(mut g) = state.tray.lock() {
        *g = Some(tray);
    }
    if let Ok(mut g) = state.autostart_item.lock() {
        *g = Some(autostart);
    }
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "notifications")]
    let builder = builder.plugin(tauri_plugin_notification::init());
    builder
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(PanelState::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let data_dir = app
                .path()
                .app_data_dir()
                .expect("application data directory");
            let ledger = KeyLedger::open(data_dir.join("keys.json"));
            let keys = KeyCounter::new(ledger.base());
            app.manage(App {
                keys: keys.clone(),
                ledger,
                save_path: data_dir.join("save.json"),
                badge: AtomicBool::new(false),
                flushed_for_quit: AtomicBool::new(false),
                quitting: AtomicBool::new(false),
                tray: Mutex::new(None),
                autostart_item: Mutex::new(None),
            });

            build_tray(app)?;

            // First launch: open the panel so the welcome is not missed.
            if !data_dir.join("save.json").exists() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(900));
                    let rect = handle.tray_by_id(TRAY_ID).and_then(|t| t.rect().ok().flatten());
                    panel::show(&handle, rect.as_ref());
                });
            }

            // Start counting right away if permission was granted earlier.
            if keytap::permission() == keytap::Permission::Granted {
                if let Err(e) = keytap::start(keys.clone()) {
                    log::warn!("key listener: {e}");
                }
            }

            // Periodic ledger flush so a crash can lose at most a few seconds.
            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("sonatina-ledger".into())
                .spawn(move || loop {
                    std::thread::sleep(Duration::from_secs(5));
                    flush_keys(&handle);
                })?;

            // Hide on blur unless pinned.
            if let Some(win) = panel::window(app.handle()) {
                let handle = app.handle().clone();
                win.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        let panel_state = handle.state::<PanelState>();
                        if !panel_state.pinned.load(Ordering::Relaxed) && panel::is_visible(&handle) {
                            panel_state.note_blur_hide();
                            panel::hide(&handle);
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            key_total,
            add_local_keys,
            input_permission,
            request_input_permission,
            start_key_listener,
            key_listener_running,
            open_input_monitoring_settings,
            load_save,
            write_save,
            save_dir,
            set_pinned,
            hide_panel,
            panel_visible,
            set_badge,
            set_tooltip,
            get_autostart,
            set_autostart,
            notify,
            open_url,
            app_version,
            quit,
            quit_ready,
            relaunch,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Sonatina")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                flush_keys(app);
                let state = app.state::<App>();
                if state.quitting.swap(true, Ordering::Relaxed) {
                    return; // second pass: let it go
                }
                // Give the webview a moment to write its save, then leave.
                api.prevent_exit();
                use tauri::Emitter as _;
                let _ = app.emit_to(panel::WINDOW_LABEL, "app:quit", ());
                let handle = app.clone();
                std::thread::spawn(move || {
                    let deadline = std::time::Instant::now() + Duration::from_millis(600);
                    while std::time::Instant::now() < deadline {
                        if handle.state::<App>().flushed_for_quit.load(Ordering::Relaxed) {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    flush_keys(&handle);
                    handle.exit(0);
                });
            }
            tauri::RunEvent::Exit => flush_keys(app),
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                let rect = app.tray_by_id(TRAY_ID).and_then(|t| t.rect().ok().flatten());
                panel::show(app, rect.as_ref());
            }
            _ => {}
        });
}
