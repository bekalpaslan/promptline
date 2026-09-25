//! The `#[tauri::command]` functions the two webviews invoke, apart from
//! the paste pipeline's (`paste.rs`). Every read-modify-write takes the
//! store lock here, at the entry point; the helpers it calls never do.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::packs::{
    arrange_packs_in, back_pack_in, new_pack_file, packs_after_sync, relativize_pack_path,
    remove_pack_in, rename_pack_in, resolve_pack_path, retire_pack_file, set_pack_locked_in,
    sync_pack_files, validate_pack_name, with_resolved_pack_paths, PackMeta,
};
use crate::store::{
    check_revision, current_revision, data_dir, first_free, library, load_config_from_disk,
    load_snippets_from_disk, merge_add, merge_delete, merge_patch, merge_update, notify, packs_dir,
    save_config, since_epoch, write_atomic, write_snippets, Config, Library, Notice, Snippet,
    SnippetEdit, SnippetPatch, StoreError,
};
use crate::{platform, show_main, AppState};

/// Hand the manager everything collected so far; it shows each as a
/// persistent error toast.
#[tauri::command]
pub(crate) fn take_notices(state: State<AppState>) -> Vec<Notice> {
    std::mem::take(&mut *state.notices.lock().unwrap())
}

/// Load, apply `f`, write if it reports a change, sync pack files, tell the
/// other window. The store lock is the caller's.
fn mutate_library(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    f: impl FnOnce(&mut Vec<Snippet>) -> bool,
) -> Result<Library, String> {
    let mut snippets = load_snippets_from_disk(app)?;
    if f(&mut snippets) {
        write_snippets(app, &snippets)?;
        sync_pack_files(app, &snippets);
        notify_other_window(app, window);
    }
    Ok(Library {
        snippets,
        revision: current_revision(app),
    })
}

#[tauri::command]
pub(crate) fn add_snippet(
    app: AppHandle,
    state: State<AppState>,
    window: tauri::WebviewWindow,
    snippet: Snippet,
) -> Result<Library, String> {
    let _guard = state.store.lock().unwrap();
    mutate_library(&app, &window, |list| {
        merge_add(list, snippet);
        true
    })
}

#[tauri::command]
pub(crate) fn patch_snippet(
    app: AppHandle,
    state: State<AppState>,
    window: tauri::WebviewWindow,
    id: String,
    patch: SnippetPatch,
) -> Result<Library, String> {
    let _guard = state.store.lock().unwrap();
    mutate_library(&app, &window, |list| merge_patch(list, &id, patch))
}

#[tauri::command]
pub(crate) fn update_snippet(
    app: AppHandle,
    state: State<AppState>,
    window: tauri::WebviewWindow,
    id: String,
    edit: SnippetEdit,
) -> Result<Library, String> {
    let _guard = state.store.lock().unwrap();
    mutate_library(&app, &window, |list| merge_update(list, &id, edit))
}

#[tauri::command]
pub(crate) fn delete_snippet(
    app: AppHandle,
    state: State<AppState>,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<Library, String> {
    let _guard = state.store.lock().unwrap();
    mutate_library(&app, &window, |list| merge_delete(list, &id))
}

#[tauri::command]
pub(crate) fn get_snippets(app: AppHandle, state: State<AppState>) -> Result<Library, String> {
    let _guard = state.store.lock().unwrap();
    library(&app)
}

// Each window caches the library in memory; when the other one (or Rust
// itself) writes, tell the manager so it re-reads before saving over it.
// The payload is the new revision.
pub(crate) fn notify_manager_snippets_changed(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.emit("snippets-changed", current_revision(app));
    }
}

fn notify_other_window(app: &AppHandle, window: &tauri::WebviewWindow) {
    if window.label() != "main" {
        notify_manager_snippets_changed(app);
    }
}

/// Replace the whole library — the manager's bulk operations (move, tag,
/// reorder, delete with undo). `base_revision` is the revision the caller
/// loaded; if the file has moved on since, the save is refused as `Stale`
/// and nothing is written, so a stale snapshot can never overwrite an edit
/// it never saw. `None` skips the check; every caller today passes the
/// revision (the startup draft sweep included), the option stays for a
/// migration that has no revision to be based on.
#[tauri::command]
pub(crate) fn save_snippets(
    app: AppHandle,
    state: State<AppState>,
    window: tauri::WebviewWindow,
    snippets: Vec<Snippet>,
    base_revision: Option<u64>,
) -> Result<u64, StoreError> {
    let _guard = state.store.lock().unwrap();
    check_revision(base_revision, current_revision(&app))?;
    write_snippets(&app, &snippets)?;
    sync_pack_files(&app, &snippets);
    notify_other_window(&app, &window);
    Ok(current_revision(&app))
}

/// The config with every pack path resolved: the frontend displays it,
/// reads the file and shows it in its folder, and never sees the relative
/// on-disk form.
#[tauri::command]
pub(crate) fn get_config(app: AppHandle, state: State<AppState>) -> Result<Config, String> {
    let _guard = state.store.lock().unwrap();
    Ok(with_resolved_pack_paths(
        load_config_from_disk(&app)?,
        &packs_dir(&app),
    ))
}

/// Parse a hotkey, refusing one without a modifier: the parser accepts a
/// bare "a", and a hand-edited config would then capture that letter
/// system-wide. The recorder in Settings never emits one, so this guards
/// the file, not the UI.
fn parse_hotkey(text: &str) -> Result<Shortcut, String> {
    let shortcut: Shortcut = text
        .parse()
        .map_err(|e| format!("Invalid hotkey \"{text}\": {e}"))?;
    if shortcut.mods.is_empty() {
        return Err(format!(
            "Invalid hotkey \"{text}\": it needs a modifier (Ctrl, Alt, Shift or Win)"
        ));
    }
    Ok(shortcut)
}

/// The shortcut a config string stands for; unparseable or modifier-less
/// config falls back to the default rather than leaving the app without a
/// hotkey, or with a single letter as one.
pub(crate) fn resolve_hotkey(configured: &str) -> Shortcut {
    parse_hotkey(configured).unwrap_or_else(|_| Config::default().hotkey.parse().unwrap())
}

/// Change the global hotkey. The new combination is registered *before* the
/// old one is released: if the OS refuses it (another program owns it), the
/// old hotkey keeps working and the config is untouched, so the UI keeps
/// showing what is actually bound.
#[tauri::command]
pub(crate) fn set_hotkey(
    app: AppHandle,
    state: State<AppState>,
    hotkey: String,
) -> Result<(), String> {
    let shortcut = parse_hotkey(&hotkey)?;
    let _guard = state.store.lock().unwrap();
    let mut config = load_config_from_disk(&app)?;
    let old = resolve_hotkey(&config.hotkey);
    let gs = app.global_shortcut();
    if shortcut != old {
        gs.register(shortcut).map_err(|e| e.to_string())?;
        // Best effort: the old one may never have been registered (refused at
        // startup), in which case there is nothing to release
        let _ = gs.unregister(old);
    } else if !gs.is_registered(shortcut) {
        // Same combination as configured but not bound (refused at startup):
        // this is a retry
        gs.register(shortcut).map_err(|e| e.to_string())?;
    }
    config.hotkey = hotkey;
    save_config(&app, &config)
}

#[tauri::command]
pub(crate) fn set_pack_locked(
    app: AppHandle,
    state: State<AppState>,
    name: String,
    locked: bool,
) -> Result<Vec<PackMeta>, String> {
    let _guard = state.store.lock().unwrap();
    let mut config = load_config_from_disk(&app)?;
    set_pack_locked_in(&mut config, &name, locked);
    save_config(&app, &config)?;
    packs_after_sync(&app)
}

/// The user's order of the packs, as the manager's sidebar drew it after a
/// drag. An order, not a registry: locks and files stay as they are on
/// disk (`arrange_packs_in`). The popup reads it on its next show.
#[tauri::command]
pub(crate) fn arrange_packs(
    app: AppHandle,
    state: State<AppState>,
    names: Vec<String>,
) -> Result<Vec<PackMeta>, String> {
    let _guard = state.store.lock().unwrap();
    let mut config = load_config_from_disk(&app)?;
    arrange_packs_in(&mut config, &names);
    save_config(&app, &config)?;
    packs_after_sync(&app)
}

/// Delete a pack: its file goes to packs/deleted/ (never unlinked, see
/// `retire_pack_file`) and its metadata is dropped. The manager deletes
/// the pack's prompts first and calls this second: `ensure_packs_backed`
/// runs inside every save, and while a prompt still names the pack it
/// would put the metadata straight back.
#[tauri::command]
pub(crate) fn delete_pack(
    app: AppHandle,
    state: State<AppState>,
    name: String,
) -> Result<Vec<PackMeta>, String> {
    let _guard = state.store.lock().unwrap();
    let mut config = load_config_from_disk(&app)?;
    if let Some(path) = remove_pack_in(&mut config, &name) {
        if !path.is_empty() {
            retire_pack_file(&app, &resolve_pack_path(&packs_dir(&app), &path));
        }
    }
    save_config(&app, &config)?;
    packs_after_sync(&app)
}

/// A new pack: metadata and a file of its own. A name that reads as an
/// existing pack's is refused. The pack exists even when its file can't be
/// written (a pack is just a name): that is a notice, and the next sync
/// tries the file again.
#[tauri::command]
pub(crate) fn add_pack(
    app: AppHandle,
    state: State<AppState>,
    name: String,
) -> Result<Vec<PackMeta>, String> {
    let _guard = state.store.lock().unwrap();
    let mut config = load_config_from_disk(&app)?;
    let snippets = load_snippets_from_disk(&app)?;
    validate_pack_name(&config, &snippets, &name, None)?;
    let dir = packs_dir(&app);
    let path = match new_pack_file(&app, &name) {
        Ok(path) => relativize_pack_path(&dir, &path),
        Err(e) => {
            notify(
                &app,
                "pack-file-failed",
                format!("Pack \"{name}\" created, but its file couldn't be written ({e}). It will be tried again on the next save."),
            );
            String::new()
        }
    };
    config.packs.push(PackMeta {
        name,
        locked: false,
        path,
    });
    save_config(&app, &config)?;
    packs_after_sync(&app)
}

/// Give a pack without a file one ("Create pack file…"): the file is made,
/// recorded on the pack's metadata, and filled from the library by the
/// sync that follows. A pack that already has a file keeps it.
#[tauri::command]
pub(crate) fn add_pack_file(
    app: AppHandle,
    state: State<AppState>,
    name: String,
) -> Result<Vec<PackMeta>, String> {
    let _guard = state.store.lock().unwrap();
    let mut config = load_config_from_disk(&app)?;
    let backed = config
        .packs
        .iter()
        .any(|p| p.name == name && !p.path.is_empty());
    if !backed {
        let dir = packs_dir(&app);
        let path = new_pack_file(&app, &name)?;
        back_pack_in(&mut config, &name, relativize_pack_path(&dir, &path));
        save_config(&app, &config)?;
    }
    packs_after_sync(&app)
}

#[tauri::command]
pub(crate) fn rename_pack(
    app: AppHandle,
    state: State<AppState>,
    window: tauri::WebviewWindow,
    from: String,
    to: String,
) -> Result<Library, String> {
    let _guard = state.store.lock().unwrap();
    let mut config = load_config_from_disk(&app)?;
    let mut snippets = load_snippets_from_disk(&app)?;
    rename_pack_in(&mut config, &mut snippets, &from, &to)?;
    save_config(&app, &config)?;
    write_snippets(&app, &snippets)?;
    sync_pack_files(&app, &snippets);
    notify_other_window(&app, &window);
    Ok(Library {
        snippets,
        revision: current_revision(&app),
    })
}

/// Create a fresh file-backed pack file and return its absolute path.
#[tauri::command]
pub(crate) fn create_pack_file(app: AppHandle, name: String) -> Result<String, String> {
    new_pack_file(&app, &name).map(|p| p.to_string_lossy().into_owned())
}

/// Create an empty scratch file under packs/generated/ for an agent to fill
/// with several packs at once (a JSON array). It backs no pack of its own —
/// the packs inside get their own files on import — so it lives outside the
/// top-level packs/ that pack metadata points into.
#[tauri::command]
pub(crate) fn create_generated_file(app: AppHandle) -> Result<String, String> {
    let dir = packs_dir(&app).join("generated");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = since_epoch().as_secs();
    let path = first_free(
        |i| match i {
            1 => dir.join(format!("generated-{stamp}.json")),
            i => dir.join(format!("generated-{stamp}-{i}.json")),
        },
        |p| p.exists(),
    );
    write_atomic(&path, b"[]").map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// `path`, canonicalised, when it is an existing file under `base`; an error
/// naming the reason otherwise. Canonicalising first is what makes `..` and
/// a junction unable to escape. Windows' canonical form carries a `\\?\`
/// prefix that explorer.exe does not take, so it is stripped again.
fn path_within(base: &Path, path: &str) -> Result<PathBuf, String> {
    let full = fs::canonicalize(path).map_err(|e| format!("{path}: {e}"))?;
    let base = fs::canonicalize(base).map_err(|e| format!("{}: {e}", base.display()))?;
    if !full.starts_with(&base) {
        return Err(format!("{path} is outside the Promptline data folder"));
    }
    let text = full.to_string_lossy();
    Ok(PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text)))
}

/// A path the frontend hands back, admitted only when it is under the data
/// folder: every path it can know comes from there (`get_config`,
/// `create_pack_file`, `create_generated_file`), and a webview that had
/// been compromised must not be able to read or reveal anything else.
fn data_file(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    path_within(&data_dir(app), path)
}

#[tauri::command]
pub(crate) fn read_pack_file(app: AppHandle, path: String) -> Result<String, String> {
    let path = data_file(&app, &path)?;
    fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
pub(crate) fn show_in_folder(app: AppHandle, path: String) -> Result<(), String> {
    let path = data_file(&app, &path)?;
    open_in_explorer(&["/select,", &path.to_string_lossy()])
}

/// Open the data folder itself in Explorer (Settings → "Open folder"): the
/// library, the packs and the log file are all there to back up or
/// attach. No path comes from the frontend.
#[tauri::command]
pub(crate) fn open_data_dir(app: AppHandle) -> Result<(), String> {
    open_in_explorer(&[&data_dir(&app).to_string_lossy()])
}

fn open_in_explorer(args: &[&str]) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .args(args)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = args;
    Ok(())
}

/// Open an https URL in the user's default browser. Restricted to https so a
/// URL can never turn into a command or a local executable, and handed to
/// the shell as one string rather than to an `explorer` command line that
/// would parse it itself.
#[tauri::command]
pub(crate) fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https links can be opened".into());
    }
    #[cfg(windows)]
    platform::open_url(&url)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn save_prefs(
    app: AppHandle,
    state: State<AppState>,
    theme: String,
    density: String,
    scale: String,
    font: String,
) -> Result<(), String> {
    let _guard = state.store.lock().unwrap();
    let mut config = load_config_from_disk(&app)?;
    config.theme = theme;
    config.density = density;
    config.scale = scale;
    config.font = font;
    save_config(&app, &config)
}

/// Pick a JSON pack file and return its contents (None if the user cancels).
/// A byte-exact import path — clipboard transport corrupts when text is
/// copied out of terminals.
#[tauri::command]
pub(crate) async fn import_pack_file() -> Result<Option<String>, String> {
    match rfd::AsyncFileDialog::new()
        .add_filter("JSON pack", &["json"])
        .pick_file()
        .await
    {
        Some(f) => fs::read_to_string(f.path())
            .map(Some)
            .map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

/// Open the manager focused on a specific prompt (from the popup's action panel).
#[tauri::command]
pub(crate) fn edit_in_manager(app: AppHandle, id: String) {
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.hide();
    }
    show_main(&app);
    let _ = app.emit("edit-prompt", id);
}

#[tauri::command]
pub(crate) fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or_else(|e| {
        log::warn!("couldn't read the autostart entry: {e}");
        false
    })
}

#[tauri::command]
pub(crate) fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    let result = if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    result.map_err(|e| {
        log::warn!("couldn't set autostart to {enabled}: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub(crate) fn get_clipboard_text() -> String {
    arboard::Clipboard::new()
        .ok()
        .and_then(|mut c| c.get_text().ok())
        .unwrap_or_default()
}

#[tauri::command]
pub(crate) fn set_clipboard_text(text: String) -> Result<(), String> {
    let mut c = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    c.set_text(text).map_err(|e| e.to_string())
}

/// The manager's answer to `quit-requested`: its pending autosave is on
/// disk. Tray Quit exits here; when Windows is ending the session it only
/// says so, and Windows ends the process.
#[tauri::command]
pub(crate) fn quit_now(app: AppHandle) {
    let state = app.state::<AppState>();
    if state.session_ending.load(Ordering::SeqCst) {
        state.flushed.store(true, Ordering::SeqCst);
    } else {
        app.exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::temp_dir;

    #[test]
    fn only_files_under_the_data_folder_are_admitted() {
        let root = temp_dir("within");
        let data = root.join("data");
        fs::create_dir_all(data.join("packs")).unwrap();
        fs::write(data.join("packs").join("work.json"), "{}").unwrap();
        fs::write(root.join("outside.json"), "{}").unwrap();
        let inside = data.join("packs").join("work.json");
        // A file under the folder comes back as a plain path explorer takes
        let admitted = path_within(&data, &inside.to_string_lossy()).unwrap();
        assert!(
            !admitted.to_string_lossy().starts_with(r"\\?\"),
            "{}",
            admitted.display()
        );
        assert_eq!(fs::read_to_string(&admitted).unwrap(), "{}");
        // A sibling of the folder, and a traversal out of it, are refused
        let outside = root.join("outside.json");
        assert!(path_within(&data, &outside.to_string_lossy())
            .unwrap_err()
            .contains("outside"));
        let traversal = data
            .join("packs")
            .join("..")
            .join("..")
            .join("outside.json");
        assert!(path_within(&data, &traversal.to_string_lossy())
            .unwrap_err()
            .contains("outside"));
        // A file that isn't there is an error naming it, not a false refusal
        let missing = data.join("packs").join("missing.json");
        assert!(path_within(&data, &missing.to_string_lossy())
            .unwrap_err()
            .contains("missing.json"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn hotkey_config_falls_back_to_the_default_when_unparseable() {
        let default: Shortcut = Config::default().hotkey.parse().unwrap();
        assert_eq!(resolve_hotkey("not a hotkey"), default);
        assert_eq!(resolve_hotkey(""), default);
        assert_eq!(
            resolve_hotkey("ctrl+alt+v"),
            "ctrl+alt+v".parse::<Shortcut>().unwrap()
        );
        assert_ne!(resolve_hotkey("ctrl+alt+v"), default);
    }

    #[test]
    fn a_hotkey_without_a_modifier_is_refused_everywhere() {
        // The parser itself takes a bare letter; a hand-edited config with
        // one would capture it system-wide
        assert!("a".parse::<Shortcut>().is_ok());
        let err = parse_hotkey("a").unwrap_err();
        assert!(err.contains("modifier"), "{err}");
        assert!(parse_hotkey("f5").is_err());
        assert!(parse_hotkey("").is_err());
        assert!(parse_hotkey("ctrl+shift+v").is_ok());
        assert!(parse_hotkey("alt+f5").is_ok());
        // From the config it falls back to the default; from Settings it is
        // an error the user sees
        let default: Shortcut = Config::default().hotkey.parse().unwrap();
        assert_eq!(resolve_hotkey("a"), default);
        assert_eq!(resolve_hotkey("f5"), default);
    }

    #[test]
    fn every_key_the_recorder_can_emit_parses_as_a_hotkey() {
        // The vocabulary of hotkeyKeyName in ui/core.js, kept in step by
        // hand: the recorder refuses anything outside it, so Apply can never
        // be refused for a key the recorder handed over
        let mut keys: Vec<String> = ('a'..='z').map(String::from).collect();
        keys.extend(('0'..='9').map(String::from));
        keys.extend((1..=12).map(|n| format!("f{n}")));
        keys.extend(",.;/-='`[]\\".chars().map(String::from));
        keys.extend(
            [
                "space",
                "enter",
                "backspace",
                "delete",
                "insert",
                "home",
                "end",
                "pageup",
                "pagedown",
                "arrowup",
                "arrowdown",
                "arrowleft",
                "arrowright",
            ]
            .map(String::from),
        );
        assert_eq!(keys.len(), 26 + 10 + 12 + 11 + 13);
        for key in &keys {
            for mods in ["ctrl", "alt", "shift", "super", "ctrl+alt+shift+super"] {
                let combo = format!("{mods}+{key}");
                assert!(parse_hotkey(&combo).is_ok(), "{combo}");
            }
        }
        // What the recorder refuses (Shift+1 arrives as "!", a dead key as
        // "Dead") would have been refused here
        for combo in ["ctrl+!", "ctrl+<", "ctrl+dead", "ctrl+ü", "ctrl+tab+"] {
            assert!(parse_hotkey(combo).is_err(), "{combo}");
        }
    }
}
