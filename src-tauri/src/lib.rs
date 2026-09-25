//! Promptline's Rust core: one process, two webviews and a tray icon over
//! the data files. This file holds the app state, the tray and the window
//! events; the rest is by concern: `store` (the files), `packs` (their
//! files), `commands` (what the webviews invoke), `paste` (the pipeline),
//! `platform` (Win32) and `migrations` (older installs).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod commands;
mod migrations;
mod packs;
mod paste;
mod platform;
mod store;

use commands::resolve_hotkey;
use migrations::{migrate_data_dir, migrate_v1_data};
use packs::ensure_packs_backed;
use paste::{is_resize_drag, persist_popup_size, show_popup};
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
}

/// Ask the manager to run a pending autosave, the editor's 600 ms debounce;
/// it answers `quit-requested` with `quit_now`. False when there is no
/// manager to ask.
fn ask_to_flush(app: &AppHandle) -> bool {
    app.get_webview_window("main")
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
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
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

pub fn run() {
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
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        show_popup(app);
                    }
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
            commands::arrange_packs,
            commands::delete_pack,
            commands::add_pack,
            commands::add_pack_file,
            commands::rename_pack,
            commands::save_prefs,
            commands::import_pack_file,
            commands::create_pack_file,
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
            // the tray. The window is declared visible so a normal launch
            // shows it without a flash of nothing; hiding it here is early
            // enough that it never paints.
            if std::env::args().any(|a| a == HIDDEN_ARG) {
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            migrate_data_dir(handle);
            migrate_v1_data(handle);
            // Catches packs that predate file backing, so they get their file
            // without waiting for the next save to touch them
            ensure_packs_backed(handle);

            // Register the configured global hotkey (fall back to default on bad
            // config). A refusal — another program owns the combination — must
            // not abort startup: without the tray and the manager the user
            // could never reach Settings to pick another one.
            let config = load_config_from_disk(handle).unwrap_or_default();
            handle
                .state::<AppState>()
                .popup_seen
                .store(config.popup_seen, Ordering::Relaxed);
            let shortcut = resolve_hotkey(&config.hotkey);
            if let Err(e) = handle.global_shortcut().register(shortcut) {
                notify(
                    handle,
                    "hotkey-failed",
                    format!(
                        "Couldn't register the hotkey {} ({e}). Another program probably owns it — choose a different combination under Settings → Global hotkey.",
                        config.hotkey
                    ),
                );
            }

            // Restore the saved popup size (0 = never resized, keep the default)
            if config.popup_width >= 200.0 && config.popup_height >= 200.0 {
                if let Some(w) = handle.get_webview_window("popup") {
                    let _ = w.set_size(LogicalSize::new(config.popup_width, config.popup_height));
                }
            }

            let open = MenuItem::with_id(app, "open", "Open Promptline", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Promptline")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => request_quit(app),
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

            // Shutdown, restart and sign-out get the same flush as Quit, and
            // Windows does the exiting (see `platform::on_session_end`)
            if let Some(w) = handle.get_webview_window("main") {
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
                if is_resize_drag(window) {
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
            // Closing a window hides it. The main window lives in the tray; the
            // popup must survive Alt+F4 too — it is created once at startup, so
            // destroying it leaves `show_popup` with no window to show and the
            // hotkey dead until the app is restarted.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if window.label() == "popup" {
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    let _guard = state.store.lock().unwrap();
                    persist_popup_size(app);
                }
                let _ = window.hide();
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
