//! Promptline's Rust core: one process, two webviews and a tray icon over
//! the data files. This file holds the app state, the tray and the window
//! events; the rest is by concern: `store` (the files), `packs` (their
//! files), `commands` (what the webviews invoke), `paste` (the pipeline),
//! `platform` (Win32) and `migrations` (older installs).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod commands;
mod migrations;
mod packs;
mod paste;
mod platform;
mod store;
mod update;

use commands::{resolve_hotkey, warn_hotkey_layout};
use migrations::{
    enable_autostart_once, is_fresh_install, migrate_data_dir, migrate_v1_data, session_hotkey,
    settle_default_hotkey,
};
use packs::ensure_packs_backed;
use paste::{is_resize_drag, note_hotkey_released, on_hotkey, persist_popup_size};
use store::{data_dir, load_config_from_disk, notify, Notice};

#[derive(Default)]
pub(crate) struct AppState {
    // HWND of the window that was focused before the popup was summoned
    pub(crate) prev_window: Mutex<isize>,
    // Things that went wrong that the user must see: a quarantined data file,
    // a hotkey the OS refused. Collected here because they can happen before
    // the manager's webview is listening; the manager takes them on startup
    // and receives later ones through the `notice` event.
    pub(crate) notices: Mutex<Vec<Notice>>,
    // Held for the duration of every read-modify-write of the data files, so
    // two commands can never interleave a load and a save. Locked only at
    // command / event-handler entry points; helpers never lock it. Released
    // before anything that fires a window event (hiding the popup): the
    // Focused(false) handler takes it too.
    pub(crate) store: Mutex<()>,
    // Bumped on every write of snippets.json. A full-array save carries the
    // revision it was based on; if the file moved on since, the save is
    // refused rather than allowed to overwrite what it never saw.
    pub(crate) revision: Mutex<u64>,
    // A pack file that can't be written is reported once per session, not
    // on every autosave: the failure repeats on every write until the user
    // fixes the folder, and a toast per keystroke would bury the manager.
    pub(crate) pack_write_reported: AtomicBool,
    // Whether the popup has ever been summoned (`Config.popup_seen`), read
    // once at startup: `show_popup` used to parse config.json on every
    // hotkey press to find out.
    pub(crate) popup_seen: AtomicBool,
    // Set while Windows is ending the session: the manager's `quit_now`
    // then only reports its flush done (`flushed`) and Windows does the
    // exiting. Tray Quit clears it, so a late answer can't strand a Quit.
    pub(crate) session_ending: AtomicBool,
    pub(crate) flushed: AtomicBool,
    // The popup's Keep open: it stays up when it loses focus and after a
    // paste, and pastes into the last window outside Promptline
    // (`platform::last_foreign_window`) rather than the one it was summoned
    // over. Cleared by every `hide_popup`, so Esc both closes and ends it,
    // and never saved: a restart starts without it.
    pub(crate) keep_open: AtomicBool,
    // Bumped by every `open_manager`, so a release scheduled when the
    // manager closed can tell it was opened again in the meantime
    pub(crate) manager_opened: AtomicU64,
    // Set while a thread is building the manager, so a second click in the
    // fraction of a second that takes doesn't build a second one
    pub(crate) manager_building: AtomicBool,
}

/// The manager's label. `tauri.conf.json` declares the window with
/// `"create": false`: it is built from that entry the first time it is
/// opened (`open_manager`), and let go a while after it is closed
/// (`release_manager_later`), so a user who only ever presses the hotkey
/// never carries its webview.
pub(crate) const MANAGER: &str = "main";

/// How long a closed manager stays hidden, and so reopens as it was left,
/// before its webview is destroyed. Its renderer is about 40 MB (measured
/// on 0.2.25); five minutes covers closing it to try a prompt and coming
/// back.
const MANAGER_RELEASE: Duration = Duration::from_secs(5 * 60);

/// Why the manager is being opened. A window that is already there hears
/// the same thing as an event; one built for the occasion reads it from
/// `window.__PROMPTLINE_OPENING__`, set before its scripts run, since it
/// is not yet listening for events.
pub(crate) enum Opening {
    Plain,
    /// Open this prompt in the editor (the popup's Edit)
    Edit(String),
    /// Open the update offer (the toast or the tray item)
    Offer(update::UpdateInfo),
}

/// What a manager built for `opening` finds in `window.__PROMPTLINE_OPENING__`.
fn opening_script(opening: &Opening) -> String {
    let value = match opening {
        Opening::Plain => serde_json::json!({}),
        Opening::Edit(id) => serde_json::json!({ "edit": id }),
        Opening::Offer(_) => serde_json::json!({ "offer": true }),
    };
    format!("window.__PROMPTLINE_OPENING__ = {value};")
}

/// Show the manager, building it first when it isn't there.
pub(crate) fn open_manager(app: &AppHandle, opening: Opening) {
    let state = app.state::<AppState>();
    state.manager_opened.fetch_add(1, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window(MANAGER) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        match opening {
            Opening::Plain => {}
            Opening::Edit(id) => {
                let _ = w.emit("edit-prompt", id);
            }
            Opening::Offer(info) => {
                let _ = w.emit("update-offer", info);
            }
        }
        return;
    }
    if state.manager_building.swap(true, Ordering::SeqCst) {
        return;
    }
    // Off this thread: building a webview from a synchronous command or an
    // event handler (the tray's, the single-instance callback) deadlocks on
    // Windows, Tauri's docs and the WebView2 issue they cite
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = build_manager(&app, &opening) {
            log::warn!("couldn't open the manager: {e}");
        }
        app.state::<AppState>()
            .manager_building
            .store(false, Ordering::SeqCst);
    });
}

fn build_manager(app: &AppHandle, opening: &Opening) -> Result<(), String> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MANAGER)
        .ok_or("tauri.conf.json declares no manager window")?;
    let w = WebviewWindowBuilder::from_config(app, config)
        .map_err(|e| e.to_string())?
        .initialization_script(opening_script(opening))
        .build()
        .map_err(|e| e.to_string())?;
    let _ = w.set_focus();
    Ok(())
}

/// Closing the manager hides it; if it is still hidden and wasn't opened
/// again `MANAGER_RELEASE` later, its webview goes. By then the editor's
/// 600 ms autosave has long run, and every other write (a delete, a move,
/// a setting) is on disk when its control answers, so there is nothing to
/// flush first.
fn release_manager_later(app: &AppHandle) {
    let opened = app
        .state::<AppState>()
        .manager_opened
        .load(Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(MANAGER_RELEASE);
        if app
            .state::<AppState>()
            .manager_opened
            .load(Ordering::SeqCst)
            != opened
        {
            return;
        }
        if let Some(w) = app.get_webview_window(MANAGER) {
            if !w.is_visible().unwrap_or(true) {
                if let Err(e) = w.destroy() {
                    log::warn!("couldn't let the closed manager go: {e}");
                }
            }
        }
    });
}

/// Ask the manager to run a pending autosave, the editor's 600 ms debounce;
/// it answers `quit-requested` with `quit_now`. False when there is no
/// manager to ask.
fn ask_to_flush(app: &AppHandle) -> bool {
    app.get_webview_window(MANAGER)
        .map(|w| w.emit("quit-requested", ()).is_ok())
        .unwrap_or(false)
}

/// Quit, but let the manager flush a pending autosave first: Quit from the
/// tray right after typing used to drop the last edit. If the manager
/// doesn't answer (webview gone or hung) we exit anyway after a grace
/// period, so Quit can never hang.
fn request_quit(app: &AppHandle) {
    app.state::<AppState>()
        .session_ending
        .store(false, Ordering::SeqCst);
    if !ask_to_flush(app) {
        app.exit(0);
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        handle.exit(0);
    });
}

pub(crate) fn show_main(app: &AppHandle) {
    open_manager(app, Opening::Plain);
}

/// The argument the autostart entry passes so a login launch stays in the
/// tray; a launch from the Start menu or the installer has no arguments and
/// opens the manager as before.
const HIDDEN_ARG: &str = "--hidden";

/// Warnings and errors go to `<data dir>/promptline.log`, the file a bug
/// report can attach: a release build has no console, so everything the
/// code used to `let _ =` away was unobservable. Paths and error text only,
/// never prompt content. One file, started over past half a megabyte; in a
/// debug build the same lines also reach stdout.
const LOG_FILE_STEM: &str = "promptline";

fn log_plugin<R: tauri::Runtime>(dir: PathBuf) -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{Builder, RotationStrategy, Target, TargetKind, TimezoneStrategy};
    let mut targets = vec![Target::new(TargetKind::Folder {
        path: dir,
        file_name: Some(LOG_FILE_STEM.into()),
    })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    Builder::new()
        .level(log::LevelFilter::Warn)
        .max_file_size(512 * 1024)
        .rotation_strategy(RotationStrategy::KeepOne)
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .targets(targets)
        .build()
}

/// The tray icon's id, so `offer_update_in_tray` can find it again to swap
/// in the "Update to X.Y.Z" item.
const TRAY_ID: &str = "tray";

/// "Open Promptline", then "Update to X.Y.Z" when `update` names a version
/// waiting to install, then "Quit" — built fresh each time the update item
/// appears or the tray is first set up, since `Menu` has no single-item
/// update of its own label text through this API.
fn tray_menu(
    app: &impl Manager<tauri::Wry>,
    update: Option<&str>,
) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, "open", "Open Promptline", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    match update {
        Some(version) => {
            let update_item = MenuItem::with_id(
                app,
                "update",
                format!("Update to {version}"),
                true,
                None::<&str>,
            )?;
            Menu::with_items(app, &[&open, &update_item, &quit])
        }
        None => Menu::with_items(app, &[&open, &quit]),
    }
}

/// Swaps the tray menu to offer the version found: called once a check (by
/// hand or automatic) finds one. Stays offered until the update installs
/// and the process restarts.
pub(crate) fn offer_update_in_tray(app: &AppHandle, version: &str) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let menu = match tray_menu(app, Some(version)) {
        Ok(menu) => menu,
        Err(e) => {
            log::warn!("couldn't build the tray menu with the update item: {e}");
            return;
        }
    };
    if let Err(e) = tray.set_menu(Some(menu)) {
        log::warn!("couldn't offer the update in the tray menu: {e}");
    }
}

pub fn run() {
    // Before any window exists, so taskbar grouping and toast origin follow
    // it. A debug build stays unclaimed: it has no Start Menu shortcut to
    // agree with, so the toast falls back to PowerShell's id instead
    // (`platform::show_toast`).
    if !cfg!(debug_assertions) {
        platform::claim_app_id(update::APP_ID);
    }

    tauri::Builder::default()
        // A second launch (autostart plus a Start-menu click, or the installer
        // starting the app that was already running) hands its arguments to
        // the first instance and exits. Two processes would each keep their
        // own revision counter over the same files, so the stale-write check
        // could not see the other's writes; and the second one would show a
        // second tray icon and lose the hotkey to the first.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args.iter().any(|a| a == HIDDEN_ARG) {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_ARG]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                // A press summons, re-focuses or hides the popup; the
                // release (reported by the plugin from a polling thread of
                // its own) only arms the hide, see `paste::on_hotkey`
                .with_handler(|app, _shortcut, event| match event.state() {
                    ShortcutState::Pressed => on_hotkey(app),
                    ShortcutState::Released => note_hotkey_released(),
                })
                .build(),
        )
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_snippets,
            commands::save_snippets,
            commands::add_snippet,
            commands::patch_snippet,
            commands::update_snippet,
            commands::delete_snippet,
            commands::get_config,
            commands::take_notices,
            commands::set_hotkey,
            commands::set_pack_locked,
            commands::set_pack_color,
            commands::arrange_packs,
            commands::delete_pack,
            commands::add_pack,
            commands::add_pack_file,
            commands::rename_pack,
            commands::save_prefs,
            commands::import_pack_file,
            commands::export_pack_file,
            commands::create_generated_file,
            commands::read_pack_file,
            commands::show_in_folder,
            commands::open_data_dir,
            commands::open_url,
            commands::edit_in_manager,
            commands::get_autostart,
            commands::set_autostart,
            commands::get_clipboard_text,
            commands::set_clipboard_text,
            paste::hide_popup,
            paste::paste_snippet,
            paste::set_keep_open,
            update::get_update_state,
            update::set_update_check,
            update::check_for_updates,
            update::install_update,
            update::dismiss_update,
            commands::quit_now
        ])
        .setup(|app| {
            let handle = app.handle();

            // Registered here rather than on the builder because the log file
            // lives in the data dir, which needs the app handle to locate.
            // First, so every step below can write to it.
            if let Err(e) = handle.plugin(log_plugin(data_dir(handle))) {
                eprintln!("[promptline] couldn't start the log file: {e}");
            }

            // Launched at login (the autostart entry passes --hidden): stay in
            // the tray, and build no manager until it is asked for. Any other
            // launch opens it, declared visible so it shows as it paints.
            if !std::env::args().any(|a| a == HIDDEN_ARG) {
                show_main(handle);
            }

            let data_moved = migrate_data_dir(handle);
            migrate_v1_data(handle);
            // Read before anything below saves config.json, which ends
            // "fresh". A failed move leaves an empty folder that looks it
            let first_launch = data_moved && is_fresh_install(&data_dir(handle));
            // Before anything saves config.json: an install that never
            // recorded a hotkey keeps the old default (the new one is for
            // fresh installs)
            let hotkey_settled = settle_default_hotkey(handle, data_moved);
            if hotkey_settled {
                // Catches packs that predate file backing, so they get their
                // file without waiting for the next save to touch them
                ensure_packs_backed(handle);
            } else {
                // An existing install whose old hotkey couldn't be pinned:
                // its first save would write the new default over it, so
                // this launch saves nothing here. Next launch tries again.
                log::warn!("startup left config.json and pack backing for the next launch");
            }
            if first_launch {
                enable_autostart_once(handle);
            }

            // Register the configured global hotkey (fall back to default on bad
            // config). A refusal — another program owns the combination — must
            // not abort startup: without the tray and the manager the user
            // could never reach Settings to pick another one. A combination
            // that registers but is how one of the user's keyboard layouts
            // types a character (AltGr+V is @ on Czech) is a notice too.
            let config = load_config_from_disk(handle).unwrap_or_default();
            handle
                .state::<AppState>()
                .popup_seen
                .store(config.popup_seen, Ordering::Relaxed);
            let hotkey = if hotkey_settled {
                config.hotkey.clone()
            } else {
                session_hotkey(handle)
            };
            let shortcut = resolve_hotkey(&hotkey);
            if let Err(e) = handle.global_shortcut().register(shortcut) {
                notify(
                    handle,
                    "hotkey-failed",
                    format!(
                        "Couldn't register the hotkey {} ({e}). Another program probably owns it — choose a different combination under Settings → Global hotkey.",
                        hotkey
                    ),
                );
            } else {
                warn_hotkey_layout(handle, &hotkey);
            }

            // Restore the saved popup size (0 = never resized, keep the default)
            if config.popup_width >= 200.0 && config.popup_height >= 200.0 {
                if let Some(w) = handle.get_webview_window("popup") {
                    let _ = w.set_size(LogicalSize::new(config.popup_width, config.popup_height));
                }
            }

            let menu = tray_menu(app, None)?;
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Promptline")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => request_quit(app),
                    "update" => update::open_offer(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // Keep open pastes into the last window outside Promptline; the
            // hook that follows it runs on this thread for the process's life
            if !platform::track_foreground() {
                log::warn!("couldn't follow the foreground window; a kept-open popup pastes where it was summoned");
            }

            // The update check: startup + daily, wired up once the tray
            // exists so it has somewhere to offer a find.
            update::start(handle);

            // Shutdown, restart and sign-out get the same flush as Quit, and
            // Windows does the exiting (see `platform::on_session_end`). The
            // query reaches every top-level window, hidden ones included, so
            // the popup, which lives as long as the process, takes it for the
            // manager, which may not exist
            if let Some(w) = handle.get_webview_window("popup") {
                let (ask, done) = (handle.clone(), handle.clone());
                platform::on_session_end(
                    &w,
                    platform::SessionEnd {
                        ask: Box::new(move || {
                            let state = ask.state::<AppState>();
                            state.flushed.store(false, Ordering::SeqCst);
                            state.session_ending.store(true, Ordering::SeqCst);
                            ask_to_flush(&ask)
                        }),
                        done: Box::new(move || done.state::<AppState>().flushed.load(Ordering::SeqCst)),
                        grace: Duration::from_millis(2000),
                    },
                );
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) if window.label() == "popup" => {
                let app = window.app_handle();
                if app.state::<AppState>().keep_open.load(Ordering::SeqCst) {
                    // Kept open: losing focus is the point (a paste hands it
                    // to the target), so nothing hides; the size is kept as
                    // on any other way out
                    let state = app.state::<AppState>();
                    let _guard = state.store.lock().unwrap();
                    persist_popup_size(app);
                } else if is_resize_drag(window) {
                    // Reclaim focus so the next real blur still hides the popup
                    let _ = window.set_focus();
                } else {
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    {
                        let _guard = state.store.lock().unwrap();
                        persist_popup_size(app);
                    }
                    let _ = window.hide();
                }
            }
            // Closing a window hides it. The manager goes to the tray, and
            // its webview a while later if it stays there; the popup must
            // survive Alt+F4 — it is created once at startup, so destroying
            // it leaves `show_popup` with no window to show and the hotkey
            // dead until the app is restarted.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if window.label() == "popup" {
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    let _guard = state.store.lock().unwrap();
                    persist_popup_size(app);
                }
                let _ = window.hide();
                if window.label() == MANAGER {
                    release_manager_later(window.app_handle());
                }
            }
            // The notices a manager took or was sent are its own: the next
            // one built takes only what came while there was none, rather
            // than every notice since launch again
            WindowEvent::Destroyed if window.label() == MANAGER => {
                window
                    .app_handle()
                    .state::<AppState>()
                    .notices
                    .lock()
                    .unwrap()
                    .clear();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running Promptline");
}

/// What the modules' tests share: a scratch folder per test, and a
/// snippet carrying every kind of personal state.
#[cfg(test)]
pub(crate) mod testing {
    use std::fs;
    use std::path::PathBuf;

    use crate::store::{snip, Snippet};

    pub(crate) fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("promptline-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    pub(crate) fn sample(id: &str) -> Snippet {
        let mut s = snip(id, "tag", "body {goal}");
        s.id = id.into();
        s.uses = 7;
        s.pinned = true;
        s.config_values.insert("cfg".into(), "v".into());
        s
    }
}

#[cfg(test)]
mod tests {
    use super::{opening_script, Opening};
    use crate::update::UpdateInfo;

    #[test]
    fn a_manager_built_for_an_edit_or_the_offer_is_told_so_before_its_scripts_run() {
        assert_eq!(
            opening_script(&Opening::Plain),
            "window.__PROMPTLINE_OPENING__ = {};"
        );
        // The id is JSON, so a quote in it can't end the string early
        assert_eq!(
            opening_script(&Opening::Edit("a\"b</script>".into())),
            r#"window.__PROMPTLINE_OPENING__ = {"edit":"a\"b</script>"};"#
        );
        let info = UpdateInfo {
            version: "0.2.30".into(),
            notes: String::new(),
        };
        assert_eq!(
            opening_script(&Opening::Offer(info)),
            r#"window.__PROMPTLINE_OPENING__ = {"offer":true};"#
        );
    }
}
