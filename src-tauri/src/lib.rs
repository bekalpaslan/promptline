use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WindowEvent};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Default)]
struct AppState {
    // HWND of the window that was focused before the popup was summoned
    prev_window: Mutex<isize>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Snippet {
    id: String,
    title: String,
    text: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    pack: String,
    // Last-entered values for runtime {field}s; the popup pre-fills from these
    #[serde(default, rename = "fieldValues")]
    field_values: HashMap<String, String>,
    // Saved values for {{config}} parameters; expanded silently at paste time
    #[serde(default, rename = "configValues")]
    config_values: HashMap<String, String>,
    // Legacy v2 field, migrated into `tags` on load
    #[serde(default, skip_serializing)]
    category: String,
    #[serde(default)]
    uses: u64,
    #[serde(default)]
    pinned: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct PackMeta {
    name: String,
    #[serde(default)]
    locked: bool,
    // File-backed packs: absolute path of the pack's own .json file. The app
    // auto-writes shareable content there on every save; empty = not file-backed.
    #[serde(default)]
    path: String,
}

fn default_theme() -> String {
    "sand".into()
}

fn default_density() -> String {
    "comfortable".into()
}

fn default_scale() -> String {
    "100".into()
}

fn default_font() -> String {
    "outfit".into()
}

#[derive(Serialize, Deserialize, Clone)]
struct Config {
    hotkey: String,
    // Explicit pack registry: allows empty packs and per-pack lock state.
    // Packs referenced by snippets but absent here are implicit and unlocked.
    #[serde(default)]
    packs: Vec<PackMeta>,
    // UI preferences live here (not localStorage) so they export and survive
    // webview profile changes; the manager mirrors them for the popup.
    #[serde(default = "default_theme")]
    theme: String,
    #[serde(default = "default_density")]
    density: String,
    // UI scale percentage ("90" | "100" | "110" | "125"); rem tokens follow it
    #[serde(default = "default_scale")]
    scale: String,
    // UI font id ("outfit" | "system" | "serif" | "mono"); stacks live in the frontend
    #[serde(default = "default_font")]
    font: String,
    // First-run flag: has the popup ever been summoned?
    #[serde(default, rename = "popupSeen")]
    popup_seen: bool,
    // Popup window size in logical px, saved when the user resizes; 0 = default
    #[serde(default, rename = "popupWidth")]
    popup_width: f64,
    #[serde(default, rename = "popupHeight")]
    popup_height: f64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            hotkey: "ctrl+shift+v".into(),
            packs: Vec::new(),
            theme: default_theme(),
            density: default_density(),
            scale: default_scale(),
            font: default_font(),
            popup_seen: false,
            popup_width: 0.0,
            popup_height: 0.0,
        }
    }
}

fn data_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("no app config dir available");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn snippets_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("snippets.json")
}

fn config_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("config.json")
}

fn packs_dir(app: &AppHandle) -> PathBuf {
    let dir = data_dir(app).join("packs");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn sanitize_pack_filename(name: &str) -> String {
    let mut s = String::new();
    for c in name.chars() {
        if c.is_alphanumeric() {
            s.extend(c.to_lowercase());
        } else {
            s.push('-');
        }
    }
    let s = s.trim_matches('-').to_string();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if s.is_empty() { "pack".into() } else { s }
}

/// Create a pack's .json file and return its absolute path, without touching
/// any file that already exists.
fn new_pack_file(app: &AppHandle, name: &str) -> Result<String, String> {
    let dir = packs_dir(app);
    let base = sanitize_pack_filename(name);
    let mut path = dir.join(format!("{base}.json"));
    let mut i = 2;
    while path.exists() {
        path = dir.join(format!("{base}-{i}.json"));
        i += 1;
    }
    let doc = serde_json::json!({ "name": name, "prompts": [] });
    let json = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

// Give every pack that exists a PackMeta and a file of its own, whatever route
// it came into being by. A pack needs no metadata to exist — naming one on a
// prompt conjures it, which is how imports and moves create them — so backing
// files can't be handled at the point of creation alone.
fn ensure_packs_backed(app: &AppHandle) {
    let mut config = load_config_from_disk(app);
    let snippets = load_snippets_from_disk(app);

    // Every name in play: declared metadata, plus whatever prompts reference.
    // Migrations have already filled in empty pack fields by this point.
    let mut names: Vec<String> = config.packs.iter().map(|p| p.name.clone()).collect();
    for s in &snippets {
        if !names.contains(&s.pack) {
            names.push(s.pack.clone());
        }
    }

    let mut changed = false;
    for name in names {
        match config.packs.iter_mut().find(|p| p.name == name) {
            // Known pack, already backed
            Some(pm) if !pm.path.is_empty() => {}
            // Known pack that predates this, or whose file creation failed before
            Some(pm) => {
                if let Ok(path) = new_pack_file(app, &name) {
                    pm.path = path;
                    changed = true;
                }
            }
            // Exists only as a name on a prompt — give it real metadata
            None => {
                let path = new_pack_file(app, &name).unwrap_or_default();
                config.packs.push(PackMeta { name, locked: false, path });
                changed = true;
            }
        }
    }
    if changed {
        let _ = save_config(app, &config);
    }
}

// Write each file-backed pack's shareable content (title/tags/text only —
// never personal state like uses, pins, or config values) to its file.
fn sync_pack_files(app: &AppHandle) {
    ensure_packs_backed(app);
    let config = load_config_from_disk(app);
    if config.packs.iter().all(|p| p.path.is_empty()) {
        return;
    }
    let snippets = load_snippets_from_disk(app);
    for pm in config.packs.iter().filter(|p| !p.path.is_empty()) {
        let prompts: Vec<serde_json::Value> = snippets
            .iter()
            .filter(|s| s.pack == pm.name)
            .map(|s| serde_json::json!({ "title": s.title, "tags": s.tags, "text": s.text }))
            .collect();
        // Never write an empty pack over its file: an agent may have just
        // written prompts there that haven't been imported yet, and clobbering
        // that with the library's (still empty) view would destroy them.
        if prompts.is_empty() {
            continue;
        }
        let doc = serde_json::json!({ "name": pm.name, "prompts": prompts });
        if let Ok(json) = serde_json::to_string_pretty(&doc) {
            let _ = fs::write(&pm.path, json);
        }
    }
}

/// One-time migration from the v1 EasyPaste data directory: keep user-created
/// snippets (dropping the v1 samples) and merge in the new starter pack.
fn migrate_v1_data(app: &AppHandle) {
    let new_dir = data_dir(app);
    let old_dir = match new_dir.parent() {
        Some(p) => p.join("com.easypaste.app"),
        None => return,
    };

    let new_config = new_dir.join("config.json");
    let old_config = old_dir.join("config.json");
    if !new_config.exists() && old_config.exists() {
        let _ = fs::copy(&old_config, &new_config);
    }

    let new_snippets = new_dir.join("snippets.json");
    let old_snippets = old_dir.join("snippets.json");
    if !new_snippets.exists() && old_snippets.exists() {
        let user_made: Vec<Snippet> = fs::read_to_string(&old_snippets)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<Snippet>>(&s).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|s| !s.id.starts_with("sample-"))
            .collect();
        let mut merged = default_snippets();
        merged.extend(user_made);
        let _ = write_snippets(app, &merged);
    }
}

fn snip(title: &str, tag: &str, text: &str) -> Snippet {
    Snippet {
        id: format!("starter-{}", title.to_lowercase().replace(' ', "-")),
        title: title.into(),
        text: text.into(),
        tags: vec![tag.to_lowercase()],
        pack: "Starter".into(),
        field_values: HashMap::new(),
        config_values: HashMap::new(),
        category: String::new(),
        uses: 0,
        pinned: false,
    }
}

fn default_snippets() -> Vec<Snippet> {
    vec![
        snip("Root cause first", "Debug",
            "Here's the error:\n\n{clipboard}\n\nFind the root cause before proposing any fix. Explain what's actually happening, then suggest the minimal fix."),
        snip("Reproduce before fixing", "Debug",
            "Before fixing, write a minimal reproduction or failing test for this bug: {bug}"),
        snip("Diff review, bugs only", "Review",
            "Review this diff for correctness bugs only — no style or naming comments:\n\n{clipboard}"),
        snip("Security pass", "Review",
            "Review this code for security issues (injection, authz, leaked secrets, unsafe deserialization):\n\n{clipboard}"),
        snip("Plan before code", "Plan",
            "Don't write code yet. Propose a short implementation plan for: {goal}\n\nList the files you'd touch and the main risks, then wait for my approval."),
        snip("Options with tradeoffs", "Plan",
            "Give me 2-3 approaches for {goal}, with tradeoffs, and recommend one."),
        snip("Minimal refactor", "Refactor",
            "Refactor this for clarity without changing behavior. Keep the diff small:\n\n{clipboard}"),
        snip("Scope guard", "Guardrails",
            "Constraints: don't refactor unrelated code, don't add new dependencies without asking, keep changes minimal, and ask before anything destructive.\n\n"),
        snip("Ask, don't assume", "Guardrails",
            "If anything is ambiguous, ask me instead of assuming."),
        snip("Context handoff", "Meta",
            "Summarize where we are: what's done, what's in progress, what's left, and any decisions made so far. I'll use this to continue in a fresh session."),
        snip("Explain before edit", "Meta",
            "Before editing, explain what the current code does and why your change is correct."),
        snip("TLDR first", "Meta",
            "Give me the TLDR first, then the details."),
        snip("Test first", "Test",
            "Write failing tests for {feature} first and show them to me. Only implement after I confirm."),
        snip("Add tests for change", "Test",
            "Add tests covering the change you just made, including edge cases."),
        snip("Commit message", "General",
            "Write a conventional commit message for these changes:\n\n{clipboard}"),
        snip("Explain this code", "General",
            "Explain what this code does, at a level for someone new to the codebase:\n\n{clipboard}"),
    ]
}

// Migrate older on-disk formats: v2 category becomes the first tag,
// packless prompts get default packs. Pure, so it's unit-testable.
fn apply_snippet_migrations(snippets: &mut [Snippet]) {
    for s in snippets {
        if s.tags.is_empty() && !s.category.is_empty() {
            s.tags.push(s.category.to_lowercase());
        }
        if s.pack.is_empty() {
            s.pack = if s.id.starts_with("starter-") {
                "Starter".into()
            } else {
                "My prompts".into()
            };
        }
    }
}

fn load_snippets_from_disk(app: &AppHandle) -> Vec<Snippet> {
    let mut snippets: Vec<Snippet> = fs::read_to_string(snippets_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(default_snippets);
    apply_snippet_migrations(&mut snippets);
    snippets
}

fn write_snippets(app: &AppHandle, snippets: &[Snippet]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(snippets).map_err(|e| e.to_string())?;
    fs::write(snippets_path(app), json).map_err(|e| e.to_string())
}

fn load_config_from_disk(app: &AppHandle) -> Config {
    fs::read_to_string(config_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn get_snippets(app: AppHandle) -> Vec<Snippet> {
    load_snippets_from_disk(&app)
}

// The manager caches snippets in memory; when another window writes, tell it
fn notify_manager_snippets_changed(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.emit("snippets-changed", ());
    }
}

#[tauri::command]
fn save_snippets(
    app: AppHandle,
    window: tauri::WebviewWindow,
    snippets: Vec<Snippet>,
) -> Result<(), String> {
    write_snippets(&app, &snippets)?;
    sync_pack_files(&app);
    if window.label() != "main" {
        notify_manager_snippets_changed(&app);
    }
    Ok(())
}

#[tauri::command]
fn get_config(app: AppHandle) -> Config {
    load_config_from_disk(&app)
}

fn save_config(app: &AppHandle, config: &Config) -> Result<(), String> {
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(config_path(app), json).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    let shortcut: Shortcut = hotkey
        .parse()
        .map_err(|e| format!("Invalid hotkey \"{hotkey}\": {e}"))?;
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    gs.register(shortcut).map_err(|e| e.to_string())?;
    let mut config = load_config_from_disk(&app);
    config.hotkey = hotkey;
    save_config(&app, &config)
}

#[tauri::command]
fn save_packs(app: AppHandle, packs: Vec<PackMeta>) -> Result<(), String> {
    let mut config = load_config_from_disk(&app);

    // A pack whose file is no longer claimed by any pack has been deleted, so
    // its file goes to packs/deleted/. Compared by path, not by name: renaming
    // a pack drops its old name from this list while keeping the same file.
    for old in &config.packs {
        if !old.path.is_empty() && !packs.iter().any(|p| p.path == old.path) {
            retire_pack_file(&app, &old.path);
        }
    }

    config.packs = packs;
    save_config(&app, &config)?;
    sync_pack_files(&app);
    Ok(())
}

/// Move a deleted pack's file into packs/deleted/ rather than unlinking it. The
/// file can hold prompts an agent wrote that were never imported — the same
/// content sync_pack_files refuses to clobber — so deleting a pack in the app
/// must not be able to destroy them.
fn retire_pack_file(app: &AppHandle, path: &str) {
    let src = PathBuf::from(path);
    if !src.is_file() {
        return;
    }
    let dir = packs_dir(app).join("deleted");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let stem = src.file_stem().unwrap_or_default().to_string_lossy().into_owned();
    let mut dest = dir.join(format!("{stem}.json"));
    let mut i = 2;
    // Deleting, recreating and deleting the same pack again must not overwrite
    // the first retirement
    while dest.exists() {
        dest = dir.join(format!("{stem}-{i}.json"));
        i += 1;
    }
    let _ = fs::rename(&src, &dest);
}

/// Create a fresh file-backed pack file and return its absolute path.
#[tauri::command]
fn create_pack_file(app: AppHandle, name: String) -> Result<String, String> {
    new_pack_file(&app, &name)
}

#[tauri::command]
fn read_pack_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn show_in_folder(path: String) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn();
    }
    #[cfg(not(windows))]
    let _ = path;
}

/// Open an https URL in the user's default browser. Restricted to https so a
/// URL can never turn into a command or a local executable.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https links can be opened".into());
    }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn save_prefs(
    app: AppHandle,
    theme: String,
    density: String,
    scale: String,
    font: String,
) -> Result<(), String> {
    let mut config = load_config_from_disk(&app);
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
async fn import_pack_file() -> Result<Option<String>, String> {
    match rfd::AsyncFileDialog::new()
        .add_filter("JSON pack", &["json"])
        .pick_file()
        .await
    {
        Some(f) => fs::read_to_string(f.path()).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

/// Open the manager focused on a specific prompt (from the popup's action panel).
#[tauri::command]
fn edit_in_manager(app: AppHandle, id: String) {
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.hide();
    }
    show_main(&app);
    let _ = app.emit("edit-prompt", id);
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())
    } else {
        autolaunch.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn get_clipboard_text() -> String {
    arboard::Clipboard::new()
        .ok()
        .and_then(|mut c| c.get_text().ok())
        .unwrap_or_default()
}

#[tauri::command]
fn set_clipboard_text(text: String) -> Result<(), String> {
    let mut c = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    c.set_text(text).map_err(|e| e.to_string())
}

// Starting a border-resize drag steals focus from the webview, which would
// trigger the hide-on-blur handler and close the popup mid-resize. Detect it:
// left button held with the cursor on (or just outside) the popup frame.
fn is_resize_drag(window: &tauri::Window) -> bool {
    if !platform::left_button_down() {
        return false;
    }
    let (Ok(cursor), Ok(pos), Ok(size)) = (
        window.app_handle().cursor_position(),
        window.outer_position(),
        window.outer_size(),
    ) else {
        return false;
    };
    // Slop for the invisible resize border around an undecorated window
    let m = 12.0;
    cursor.x >= pos.x as f64 - m
        && cursor.x <= pos.x as f64 + size.width as f64 + m
        && cursor.y >= pos.y as f64 - m
        && cursor.y <= pos.y as f64 + size.height as f64 + m
}

// The popup is user-resizable; remember its size so it survives restarts.
// Called from every hide path — cheap, and only writes when the size changed.
fn persist_popup_size(app: &AppHandle) {
    let Some(w) = app.get_webview_window("popup") else {
        return;
    };
    let (Ok(size), Ok(scale)) = (w.inner_size(), w.scale_factor()) else {
        return;
    };
    let logical = size.to_logical::<f64>(scale);
    let mut config = load_config_from_disk(app);
    if (config.popup_width - logical.width).abs() < 1.0
        && (config.popup_height - logical.height).abs() < 1.0
    {
        return;
    }
    config.popup_width = logical.width;
    config.popup_height = logical.height;
    let _ = save_config(app, &config);
}

#[tauri::command]
fn hide_popup(app: AppHandle) {
    persist_popup_size(&app);
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.hide();
    }
}

/// Copy `text` to the clipboard (expanding `{clipboard}` with its current
/// contents); if `paste` is set, refocus the previously active window, send
/// Ctrl+V, then restore the previous clipboard. Bumps the snippet's use count.
#[tauri::command]
fn paste_snippet(
    app: AppHandle,
    state: State<AppState>,
    text: String,
    paste: bool,
    id: Option<String>,
) -> Result<(), String> {
    persist_popup_size(&app);
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.hide();
    }
    let prev_window = *state.prev_window.lock().unwrap();
    let prev_clipboard = arboard::Clipboard::new()
        .ok()
        .and_then(|mut c| c.get_text().ok());

    let text = if text.contains("{clipboard}") {
        text.replace("{clipboard}", prev_clipboard.as_deref().unwrap_or(""))
    } else {
        text
    };

    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())?;
    drop(clipboard);

    if let Some(id) = id {
        let mut snippets = load_snippets_from_disk(&app);
        if let Some(s) = snippets.iter_mut().find(|s| s.id == id) {
            s.uses += 1;
            let _ = write_snippets(&app, &snippets);
            notify_manager_snippets_changed(&app);
        }
    }

    // The prompt stays on the clipboard afterwards, deliberately. Ctrl+V only
    // lands if the window we return to has a focused text field; when it
    // doesn't, leaving the text there is the fallback — click into a field and
    // paste it yourself. Restoring the old clipboard would silently discard it.
    if paste {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(80));
            platform::focus_window(prev_window);
            std::thread::sleep(Duration::from_millis(80));
            platform::send_ctrl_v();
        });
    }
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn show_popup(app: &AppHandle) {
    let state = app.state::<AppState>();
    *state.prev_window.lock().unwrap() = platform::foreground_window();

    // First-run: record that the user found the hotkey, tell the manager
    let mut config = load_config_from_disk(app);
    if !config.popup_seen {
        config.popup_seen = true;
        let _ = save_config(app, &config);
        let _ = app.emit("first-popup", ());
    }

    if let Some(w) = app.get_webview_window("popup") {
        if let Ok(cursor) = app.cursor_position() {
            let mut x = cursor.x;
            let mut y = cursor.y;
            if let (Ok(Some(monitor)), Ok(size)) =
                (app.monitor_from_point(cursor.x, cursor.y), w.outer_size())
            {
                let mpos = monitor.position();
                let msize = monitor.size();
                let max_x = (mpos.x + msize.width as i32 - size.width as i32) as f64;
                let max_y = (mpos.y + msize.height as i32 - size.height as i32) as f64;
                x = x.min(max_x).max(mpos.x as f64);
                y = y.min(max_y).max(mpos.y as f64);
            }
            let _ = w.set_position(PhysicalPosition::new(x, y));
        }
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit("popup-shown", ());
    }
}

#[cfg(windows)]
mod platform {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
        KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_LBUTTON, VK_MENU,
        VK_SHIFT, VK_V,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

    pub fn foreground_window() -> isize {
        unsafe { GetForegroundWindow().0 as isize }
    }

    pub fn left_button_down() -> bool {
        unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0 }
    }

    pub fn focus_window(hwnd: isize) {
        if hwnd != 0 {
            unsafe {
                let _ = SetForegroundWindow(HWND(hwnd as *mut core::ffi::c_void));
            }
        }
    }

    fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up {
                        KEYEVENTF_KEYUP
                    } else {
                        KEYBD_EVENT_FLAGS(0)
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    pub fn send_ctrl_v() {
        // Release modifiers the user may still be holding from the hotkey,
        // then send a clean Ctrl+V.
        let inputs = [
            key(VK_SHIFT, true),
            key(VK_MENU, true),
            key(VK_CONTROL, true),
            key(VK_CONTROL, false),
            key(VK_V, false),
            key(VK_V, true),
            key(VK_CONTROL, true),
        ];
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn foreground_window() -> isize {
        0
    }
    pub fn focus_window(_hwnd: isize) {}
    pub fn send_ctrl_v() {}
    pub fn left_button_down() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v2_category_migrates_to_tag_and_packs_get_defaults() {
        let mut snippets: Vec<Snippet> = serde_json::from_str(
            r#"[
                {"id": "starter-root-cause-first", "title": "Root cause", "text": "x", "category": "Debug"},
                {"id": "abc-123", "title": "Mine", "text": "y", "category": "Review"},
                {"id": "def-456", "title": "Tagged", "text": "z", "tags": ["kept"], "pack": "Custom"}
            ]"#,
        )
        .unwrap();
        apply_snippet_migrations(&mut snippets);

        assert_eq!(snippets[0].tags, vec!["debug"]);
        assert_eq!(snippets[0].pack, "Starter");
        assert_eq!(snippets[1].tags, vec!["review"]);
        assert_eq!(snippets[1].pack, "My prompts");
        // Already-migrated data is untouched
        assert_eq!(snippets[2].tags, vec!["kept"]);
        assert_eq!(snippets[2].pack, "Custom");
    }

    #[test]
    fn snippet_deserializes_with_all_new_fields_defaulted() {
        let s: Snippet =
            serde_json::from_str(r#"{"id": "a", "title": "t", "text": "b"}"#).unwrap();
        assert!(s.tags.is_empty());
        assert!(s.pack.is_empty());
        assert!(s.field_values.is_empty());
        assert!(s.config_values.is_empty());
        assert_eq!(s.uses, 0);
        assert!(!s.pinned);
    }

    #[test]
    fn legacy_category_field_is_not_reserialized() {
        let s: Snippet = serde_json::from_str(
            r#"{"id": "a", "title": "t", "text": "b", "category": "Debug"}"#,
        )
        .unwrap();
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("category"));
    }

    #[test]
    fn config_deserializes_older_versions_with_defaults() {
        let c: Config = serde_json::from_str(r#"{"hotkey": "ctrl+alt+v"}"#).unwrap();
        assert_eq!(c.hotkey, "ctrl+alt+v");
        assert!(c.packs.is_empty());
        assert_eq!(c.theme, "sand");
        assert_eq!(c.density, "comfortable");
        assert_eq!(c.scale, "100");
        assert_eq!(c.font, "outfit");
        assert!(!c.popup_seen);
        assert_eq!(c.popup_width, 0.0);
        assert_eq!(c.popup_height, 0.0);

        let with_packs: Config = serde_json::from_str(
            r#"{"hotkey": "x", "packs": [{"name": "Starter", "locked": true}, {"name": "Open"}]}"#,
        )
        .unwrap();
        assert!(with_packs.packs[0].locked);
        assert!(!with_packs.packs[1].locked);

        let sized: Config = serde_json::from_str(
            r#"{"hotkey": "x", "popupWidth": 480.0, "popupHeight": 620.5}"#,
        )
        .unwrap();
        assert_eq!(sized.popup_width, 480.0);
        assert_eq!(sized.popup_height, 620.5);
    }

    #[test]
    fn pack_filenames_are_sanitized_and_stable() {
        assert_eq!(sanitize_pack_filename("Beekon Routine Injections"), "beekon-routine-injections");
        assert_eq!(sanitize_pack_filename("Rust + Tauri!!"), "rust-tauri");
        assert_eq!(sanitize_pack_filename("---"), "pack");
        assert_eq!(sanitize_pack_filename("Ünïcode Pack"), "ünïcode-pack");
    }

    #[test]
    fn pack_meta_path_defaults_for_older_configs() {
        let c: Config = serde_json::from_str(
            r#"{"hotkey": "x", "packs": [{"name": "Old", "locked": true}]}"#,
        )
        .unwrap();
        assert_eq!(c.packs[0].path, "");
        assert!(c.packs[0].locked);
    }

    #[test]
    fn starter_pack_ids_are_unique_and_tagged() {
        let snippets = default_snippets();
        let mut ids: Vec<_> = snippets.iter().map(|s| s.id.clone()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), snippets.len());
        assert!(snippets.iter().all(|s| !s.tags.is_empty() && s.pack == "Starter"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
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
            get_snippets,
            save_snippets,
            get_config,
            set_hotkey,
            save_packs,
            save_prefs,
            import_pack_file,
            create_pack_file,
            read_pack_file,
            show_in_folder,
            open_url,
            edit_in_manager,
            get_autostart,
            set_autostart,
            get_clipboard_text,
            set_clipboard_text,
            hide_popup,
            paste_snippet
        ])
        .setup(|app| {
            let handle = app.handle();

            migrate_v1_data(handle);
            // Catches packs that predate file backing, so they get their file
            // without waiting for the next save to touch them
            ensure_packs_backed(handle);

            // Register the configured global hotkey (fall back to default on bad config)
            let config = load_config_from_disk(handle);
            let shortcut: Shortcut = config
                .hotkey
                .parse()
                .unwrap_or_else(|_| Config::default().hotkey.parse().unwrap());
            handle.global_shortcut().register(shortcut)?;

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
                    "quit" => app.exit(0),
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

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) if window.label() == "popup" => {
                if is_resize_drag(window) {
                    // Reclaim focus so the next real blur still hides the popup
                    let _ = window.set_focus();
                } else {
                    persist_popup_size(window.app_handle());
                    let _ = window.hide();
                }
            }
            // Closing the main window hides to tray instead of quitting
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running Promptline");
}
