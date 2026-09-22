use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::de::DeserializeOwned;
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
    // Things that went wrong that the user must see: a quarantined data file,
    // a hotkey the OS refused. Collected here because they can happen before
    // the manager's webview is listening; the manager takes them on startup
    // and receives later ones through the `notice` event.
    notices: Mutex<Vec<Notice>>,
    // Held for the duration of every read-modify-write of the data files, so
    // two commands can never interleave a load and a save. Locked only at
    // command / event-handler entry points; helpers never lock it.
    store: Mutex<()>,
    // Bumped on every write of snippets.json. A full-array save carries the
    // revision it was based on; if the file moved on since, the save is
    // refused rather than allowed to overwrite what it never saw.
    revision: Mutex<u64>,
    // A pack file that can't be written is reported once per session, not
    // on every autosave: the failure repeats on every write until the user
    // fixes the folder, and a toast per keystroke would bury the manager.
    pack_write_reported: AtomicBool,
}

/// The library plus the revision it was read at — what every snippet
/// command returns, so a window's state and the disk never drift apart.
#[derive(Serialize)]
struct Library {
    snippets: Vec<Snippet>,
    revision: u64,
}

/// Why a write was refused, typed so the frontend can tell "someone else
/// wrote first" from "the disk failed".
#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum StoreError {
    /// The caller's `base_revision` is behind the file; nothing was written
    Stale { revision: u64 },
    Failed { message: String },
}

impl From<String> for StoreError {
    fn from(message: String) -> Self {
        StoreError::Failed { message }
    }
}

/// A problem the user has to know about; `kind` is stable for the frontend.
#[derive(Serialize, Clone, Debug, PartialEq)]
struct Notice {
    kind: String,
    message: String,
}

fn notify(app: &AppHandle, kind: &str, message: String) {
    log::warn!("{kind}: {message}");
    let notice = Notice { kind: kind.into(), message };
    if let Some(state) = app.try_state::<AppState>() {
        state.notices.lock().unwrap().push(notice.clone());
    }
    let _ = app.emit("notice", notice);
}

/// Hand the manager everything collected so far; it shows each as a
/// persistent error toast.
#[tauri::command]
fn take_notices(state: State<AppState>) -> Vec<Notice> {
    std::mem::take(&mut *state.notices.lock().unwrap())
}

// ---- Data files: atomic writes, typed loads, quarantine -------------------

/// Write `bytes` to `path` by way of a sibling temp file and a rename, so a
/// crash or power loss mid-write leaves the previous file intact rather than
/// a truncated one. `rename` replaces the destination on Windows and POSIX.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = tmp_path(path);
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

/// What a data file held, or why it couldn't be used.
#[derive(Debug)]
enum Loaded<T> {
    Present(T),
    /// No file at all: a first run, never an error.
    Missing,
    /// The file exists but isn't valid JSON of the expected shape. It has been
    /// moved to `moved_to` untouched so nothing can overwrite it; the caller
    /// decides what to start from. `error` is serde's message.
    Quarantined { moved_to: PathBuf, error: String },
}

/// Read and parse a JSON data file. An I/O failure other than "not found"
/// (a lock, a permission problem) is an `Err`: the file may be perfectly good,
/// so the caller must not write anything over it.
fn load_json_file<T: DeserializeOwned>(path: &Path) -> Result<Loaded<T>, String> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Loaded::Missing),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    match serde_json::from_str::<T>(&text) {
        Ok(v) => Ok(Loaded::Present(v)),
        Err(e) => {
            let moved_to = quarantine(path)?;
            Ok(Loaded::Quarantined { moved_to, error: e.to_string() })
        }
    }
}

/// Move an unreadable file to `<name>.corrupt-<unix seconds>` beside it,
/// never overwriting an earlier quarantine.
fn quarantine(path: &Path) -> Result<PathBuf, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let base = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let mut dest = path.with_file_name(format!("{base}.corrupt-{stamp}"));
    let mut i = 2;
    while dest.exists() {
        dest = path.with_file_name(format!("{base}.corrupt-{stamp}-{i}"));
        i += 1;
    }
    fs::rename(path, &dest).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(dest)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Snippet {
    id: String,
    title: String,
    text: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    pack: String,
    // Optional group within the pack; empty = ungrouped. A label, not an
    // entity: naming a group on a prompt is what creates it.
    #[serde(default)]
    group: String,
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
    // When the prompt was pinned (ms since epoch), so pins keep the order they
    // were pinned in — their Ctrl+1..5 slots must not move as uses change.
    // 0 = not pinned, or a pin made before this was recorded.
    #[serde(default, rename = "pinnedAt")]
    pinned_at: u64,
}

#[derive(Serialize, Deserialize, Clone)]
struct PackMeta {
    name: String,
    #[serde(default)]
    locked: bool,
    // File-backed packs: the pack's own .json file. On disk this is relative
    // to `packs/` (`work.json`) so a restored, moved or roamed profile keeps
    // every pack's file; a path outside `packs/` stays absolute. The frontend
    // only ever sees it resolved (`get_config`) and may hand it back either
    // way (`save_packs`). Empty = not file-backed.
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
    "system".into()
}

fn default_hotkey() -> String {
    "ctrl+shift+v".into()
}

#[derive(Serialize, Deserialize, Clone)]
struct Config {
    // Defaulted like every other field: a hand-edited config.json without it
    // used to fail to parse and be quarantined, taking every pack's lock and
    // file path with it
    #[serde(default = "default_hotkey")]
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

/// The file a `PackMeta.path` points at, as a path to open: a relative
/// path lives under `packs/`, an absolute one is used as is, and an empty
/// one (not file-backed) stays empty.
fn resolve_pack_path(packs_dir: &Path, stored: &str) -> PathBuf {
    let path = Path::new(stored);
    if stored.is_empty() || path.is_absolute() {
        path.to_path_buf()
    } else {
        packs_dir.join(path)
    }
}

/// The on-disk form of a pack file path: relative to `packs/` when the file
/// lives there, absolute otherwise. Absolute paths used to be stored, and a
/// profile restored under another user name or moved to another drive
/// pointed every pack at a folder that no longer existed.
fn relativize_pack_path(packs_dir: &Path, path: &Path) -> String {
    match path.strip_prefix(packs_dir) {
        Ok(rel) if !rel.as_os_str().is_empty() => rel.to_string_lossy().into_owned(),
        _ => path.to_string_lossy().into_owned(),
    }
}

/// Bring every pack path in `config` to its on-disk form. Returns whether
/// anything changed, so a config written before 0.2.9 (absolute paths) is
/// rewritten once and then left alone.
fn normalize_pack_paths(config: &mut Config, packs_dir: &Path) -> bool {
    let mut changed = false;
    for pack in config.packs.iter_mut().filter(|p| !p.path.is_empty()) {
        let stored = relativize_pack_path(packs_dir, &resolve_pack_path(packs_dir, &pack.path));
        if stored != pack.path {
            pack.path = stored;
            changed = true;
        }
    }
    changed
}

/// `config` as the frontend sees it: every pack path resolved to an
/// absolute one it can display, read and show in a folder.
fn with_resolved_pack_paths(mut config: Config, packs_dir: &Path) -> Config {
    for pack in config.packs.iter_mut().filter(|p| !p.path.is_empty()) {
        pack.path = resolve_pack_path(packs_dir, &pack.path).to_string_lossy().into_owned();
    }
    config
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
    if s.is_empty() {
        return "pack".into();
    }
    // "con.json" is the console device on Windows, whatever the extension;
    // a pack named "Con" would hang or fail every write of its file
    if is_reserved_device_name(&s) {
        return format!("{s}-pack");
    }
    s
}

fn is_reserved_device_name(stem: &str) -> bool {
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.len() == 4
            && upper.as_bytes()[3].is_ascii_digit()
            && upper.as_bytes()[3] != b'0')
}

/// Create a pack's .json file and return its absolute path, without touching
/// any file that already exists.
fn new_pack_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let claimed = claimed_pack_paths(app);
    let (path, adopted) = pack_file_slot(&packs_dir(app), name, &claimed);
    // An adopted file already holds this pack's document, and may hold prompts
    // an agent wrote that are not in the library yet: never write over it
    if !adopted {
        let json = pack_doc_json(name, Vec::new()).map_err(|e| e.to_string())?;
        write_atomic(&path, json.as_bytes()).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(path)
}

/// Every file some pack's metadata already points at, resolved.
fn claimed_pack_paths(app: &AppHandle) -> Vec<String> {
    let dir = packs_dir(app);
    load_config_from_disk(app)
        .map(|c| {
            c.packs
                .iter()
                .filter(|p| !p.path.is_empty())
                .map(|p| resolve_pack_path(&dir, &p.path).to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

/// The file that backs a pack named `name`, and whether it was already there.
///
/// An existing file in the `<base>.json`, `<base>-2.json`, … series that holds
/// a document for this very pack and backs no other pack is adopted. The
/// Generate dialog creates a pack's file *before* the pack exists — the agent
/// writes into it and the pack is conjured by the import — so without this the
/// import's `ensure_packs_backed` would step over the agent's file and back
/// the pack with `<base>-2.json`, leaving the real content orphaned.
/// Anything else gets the first free name in the series.
fn pack_file_slot(dir: &Path, name: &str, claimed: &[String]) -> (PathBuf, bool) {
    let base = sanitize_pack_filename(name);
    let mut path = dir.join(format!("{base}.json"));
    let mut i = 2;
    while path.exists() {
        let free = !claimed.iter().any(|c| Path::new(c) == path);
        if free && pack_file_name(&path).as_deref() == Some(name) {
            return (path, true);
        }
        path = dir.join(format!("{base}-{i}.json"));
        i += 1;
    }
    (path, false)
}

/// The pack name a file declares, or None if it isn't a readable pack document.
fn pack_file_name(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let doc: serde_json::Value = serde_json::from_str(&text).ok()?;
    doc.get("name")?.as_str().map(|s| s.to_owned())
}

/// The manager's untouched "New prompt" draft: title as created, no body,
/// never used (the same test `isEmptyDraft` makes in core.js).
fn is_empty_draft(s: &Snippet) -> bool {
    s.title == "New prompt" && s.text.trim().is_empty() && s.uses == 0
}

/// Every pack in play: declared metadata, plus whatever prompts reference.
/// Migrations have already filled in empty pack fields by this point. An
/// empty draft references no pack for this purpose: "New prompt" lands in
/// the default pack, and declaring that pack the moment the draft is written
/// left a permanent empty "My prompts" behind once the draft was moved to
/// the pack the user meant, or swept. The pack is declared by the first save
/// that gives the draft a body or a title, like any other prompt's pack.
fn packs_in_play(config: &Config, snippets: &[Snippet]) -> Vec<String> {
    let mut names: Vec<String> = config.packs.iter().map(|p| p.name.clone()).collect();
    for s in snippets.iter().filter(|s| !is_empty_draft(s)) {
        if !names.contains(&s.pack) {
            names.push(s.pack.clone());
        }
    }
    names
}

// Give every pack that exists a PackMeta and a file of its own, whatever route
// it came into being by. A pack needs no metadata to exist — naming one on a
// prompt conjures it, which is how imports and moves create them — so backing
// files can't be handled at the point of creation alone.
fn ensure_packs_backed(app: &AppHandle) {
    // An unreadable file is no reason to invent metadata over it
    let (Ok(mut config), Ok(snippets)) = (load_config_from_disk(app), load_snippets_from_disk(app)) else {
        return;
    };

    let dir = packs_dir(app);
    let mut changed = false;
    for name in packs_in_play(&config, &snippets) {
        match config.packs.iter_mut().find(|p| p.name == name) {
            // Known pack, already backed
            Some(pm) if !pm.path.is_empty() => {}
            // Known pack that predates this, or whose file creation failed before
            Some(pm) => match new_pack_file(app, &name) {
                Ok(path) => {
                    pm.path = relativize_pack_path(&dir, &path);
                    changed = true;
                }
                Err(e) => log::warn!("couldn't create the file for pack \"{name}\": {e}"),
            },
            // Exists only as a name on a prompt — give it real metadata
            None => {
                let path = match new_pack_file(app, &name) {
                    Ok(path) => relativize_pack_path(&dir, &path),
                    Err(e) => {
                        log::warn!("couldn't create the file for pack \"{name}\": {e}");
                        String::new()
                    }
                };
                config.packs.push(PackMeta { name, locked: false, path });
                changed = true;
            }
        }
    }
    if changed {
        if let Err(e) = save_config(app, &config) {
            log::error!("couldn't save the pack registry to config.json: {e}");
        }
    }
}

// Write each file-backed pack's shareable content (title/tags/text only —
// never personal state like uses, pins, or config values) to its file.
fn sync_pack_files(app: &AppHandle) {
    ensure_packs_backed(app);
    let Ok(config) = load_config_from_disk(app) else {
        return;
    };
    if config.packs.iter().all(|p| p.path.is_empty()) {
        return;
    }
    let Ok(snippets) = load_snippets_from_disk(app) else {
        return;
    };
    let dir = packs_dir(app);
    let result = write_pack_files(&dir, &config.packs, &snippets);
    if result.failed.is_empty() {
        return;
    }
    for failure in &result.failed {
        log::warn!("pack file not written: {failure}");
    }
    // Once per session: the failure repeats on every autosave until the
    // folder is fixed, and the library itself is safe in snippets.json
    let reported = app
        .try_state::<AppState>()
        .map(|s| s.pack_write_reported.swap(true, Ordering::Relaxed))
        .unwrap_or(true);
    if !reported {
        notify(
            app,
            "pack-write-failed",
            format!(
                "Couldn't write {} pack file(s) under {} ({}). Your prompts are safe in the library; the pack files are out of date until the folder can be written to.",
                result.failed.len(),
                dir.display(),
                result.failed[0]
            ),
        );
    }
}

/// What one pass of `write_pack_files` did: how many files changed, and
/// which could not be written (`path: error`, for the log and the notice).
#[derive(Default, Debug)]
struct PackWrites {
    written: usize,
    failed: Vec<String>,
}

/// The shareable JSON for one pack, or None when the pack is empty.
fn pack_file_json(pm: &PackMeta, snippets: &[Snippet]) -> Option<String> {
    let prompts: Vec<serde_json::Value> = snippets
        .iter()
        .filter(|s| s.pack == pm.name)
        .map(|s| {
            let mut v = serde_json::json!({ "title": s.title, "tags": s.tags, "text": s.text });
            if !s.group.is_empty() {
                v["group"] = serde_json::Value::String(s.group.clone());
            }
            v
        })
        .collect();
    // Never write an empty pack over its file: an agent may have just
    // written prompts there that haven't been imported yet, and clobbering
    // that with the library's (still empty) view would destroy them.
    if prompts.is_empty() {
        return None;
    }
    pack_doc_json(&pm.name, prompts).ok()
}

fn pack_doc_json(name: &str, prompts: Vec<serde_json::Value>) -> serde_json::Result<String> {
    serde_json::to_string_pretty(&serde_json::json!({ "name": name, "prompts": prompts }))
}

/// True when a pack file holds nothing but the manager's own abandoned
/// "+ New" drafts (default title, empty body). That is content the library
/// wrote itself and has since swept, never an agent's work, so it is the one
/// empty-pack case that is safe to write over.
fn pack_file_holds_only_drafts(path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    let Some(prompts) = doc.get("prompts").and_then(|p| p.as_array()) else {
        return false;
    };
    !prompts.is_empty()
        && prompts.iter().all(|p| {
            p.get("title").and_then(|t| t.as_str()) == Some("New prompt")
                && p.get("text").and_then(|t| t.as_str()).is_none_or(|t| t.trim().is_empty())
        })
}

/// Write every file-backed pack whose shareable content differs from what
/// its file already holds. An autosave touches one prompt, so rewriting
/// every pack file on every save only fed file watchers (the Generate
/// dialog polls, editors and sync clients watch). A file that can't be
/// written is reported back, never silently skipped: the caller decides
/// how loudly to say so.
fn write_pack_files(packs_dir: &Path, packs: &[PackMeta], snippets: &[Snippet]) -> PackWrites {
    let mut result = PackWrites::default();
    for pm in packs.iter().filter(|p| !p.path.is_empty()) {
        let path = resolve_pack_path(packs_dir, &pm.path);
        let json = match pack_file_json(pm, snippets) {
            Some(json) => json,
            // The pack is empty in the library. Leave the file alone (see
            // pack_file_json) unless all it holds is swept drafts, which
            // would otherwise linger there for good.
            None => match pack_file_holds_only_drafts(&path) {
                true => match pack_doc_json(&pm.name, Vec::new()) {
                    Ok(json) => json,
                    Err(_) => continue,
                },
                false => continue,
            },
        };
        if fs::read(&path).map(|cur| cur == json.as_bytes()).unwrap_or(false) {
            continue;
        }
        match write_atomic(&path, json.as_bytes()) {
            Ok(()) => result.written += 1,
            Err(e) => result.failed.push(format!("{}: {e}", path.display())),
        }
    }
    result
}

/// One-time migration from the v1 EasyPaste data directory: keep user-created
/// snippets (dropping the v1 samples) and merge in the new starter pack.
/// 0.2.9 changed the bundle identifier from `com.promptline.app` (a domain
/// the project never owned) to `io.github.bekalpaslan.promptline`, which
/// moves the data folder. Everything under the old folder is moved into
/// the new one before anything else reads it; a failure is a notice, and
/// the library stays where it was.
fn migrate_data_dir(app: &AppHandle) {
    let new_dir = data_dir(app);
    let Some(parent) = new_dir.parent() else {
        return;
    };
    let old_dir = parent.join("com.promptline.app");
    if !old_dir.is_dir() {
        return;
    }
    if let Err(e) = move_data_dir(&old_dir, &new_dir) {
        notify(
            app,
            "data-dir-move-failed",
            format!(
                "Couldn't move the library from {} to {} ({e}). It is still in the old folder — copy its contents over by hand.",
                old_dir.display(),
                new_dir.display()
            ),
        );
    }
}

/// Move every entry of `old_dir` into `new_dir`, skipping names the new
/// folder already has (a second run, or a fresh library started before the
/// move), then bring the moved config's pack file paths, which a config from
/// before 0.2.9 stores absolute under the old folder, to their on-disk form
/// (relative to `packs/`, see `relativize_pack_path`). The old folder goes
/// only once it is empty.
fn move_data_dir(old_dir: &Path, new_dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(new_dir)?;
    for entry in fs::read_dir(old_dir)? {
        let entry = entry?;
        let target = new_dir.join(entry.file_name());
        if target.exists() {
            continue;
        }
        fs::rename(entry.path(), &target)?;
    }
    let config_path = new_dir.join("config.json");
    if let Ok(text) = fs::read_to_string(&config_path) {
        if let Ok(mut config) = serde_json::from_str::<Config>(&text) {
            let old_packs = old_dir.join("packs");
            let old_prefix = old_dir.to_string_lossy().to_string();
            let new_prefix = new_dir.to_string_lossy().to_string();
            let mut changed = false;
            for pack in &mut config.packs {
                if let Ok(rel) = Path::new(&pack.path).strip_prefix(&old_packs) {
                    pack.path = rel.to_string_lossy().into_owned();
                    changed = true;
                } else if let Some(rest) = pack.path.strip_prefix(&old_prefix) {
                    // A file under the old folder but outside packs/ keeps an
                    // absolute path, pointed at where it now is
                    pack.path = format!("{new_prefix}{rest}");
                    changed = true;
                }
            }
            if changed {
                let bytes = serde_json::to_vec_pretty(&config).map_err(std::io::Error::other)?;
                write_atomic(&config_path, &bytes)?;
            }
        }
    }
    let _ = fs::remove_dir(old_dir);
    Ok(())
}

fn migrate_v1_data(app: &AppHandle) {
    let new_dir = data_dir(app);
    let old_dir = match new_dir.parent() {
        Some(p) => p.join("com.easypaste.app"),
        None => return,
    };

    let new_config = new_dir.join("config.json");
    let old_config = old_dir.join("config.json");
    if !new_config.exists() && old_config.exists() {
        if let Err(e) = fs::copy(&old_config, &new_config) {
            log::warn!("v1 migration: couldn't copy {}: {e}", old_config.display());
        }
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
        if let Err(e) = write_snippets(app, &merged) {
            log::error!("v1 migration: couldn't write the merged library: {e}");
        }
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
        group: String::new(),
        uses: 0,
        pinned: false,
        pinned_at: 0,
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

/// The library as on disk. A missing file is a first run and yields the
/// starter pack; a file that won't parse is quarantined, reported, and
/// replaced by an *empty* library — never by the starters, which would look
/// like a reset rather than a loss. An I/O error is an `Err` and writes
/// nothing: the file may still be good.
fn load_snippets_from_disk(app: &AppHandle) -> Result<Vec<Snippet>, String> {
    let path = snippets_path(app);
    let mut snippets = match load_json_file::<Vec<Snippet>>(&path)? {
        Loaded::Present(s) => s,
        Loaded::Missing => default_snippets(),
        Loaded::Quarantined { moved_to, error } => {
            notify(
                app,
                "library-recovered",
                format!(
                    "Your prompt library couldn't be read ({error}). The file was moved to {} and the library starts empty — copy it back over snippets.json to recover it.",
                    moved_to.display()
                ),
            );
            // Pin the empty state so the next load isn't a "first run"
            write_snippets(app, &[])?;
            Vec::new()
        }
    };
    apply_snippet_migrations(&mut snippets);
    Ok(snippets)
}

fn write_snippets(app: &AppHandle, snippets: &[Snippet]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(snippets).map_err(|e| e.to_string())?;
    write_atomic(&snippets_path(app), json.as_bytes()).map_err(|e| e.to_string())?;
    if let Some(state) = app.try_state::<AppState>() {
        *state.revision.lock().unwrap() += 1;
    }
    Ok(())
}

fn current_revision(app: &AppHandle) -> u64 {
    app.try_state::<AppState>().map(|s| *s.revision.lock().unwrap()).unwrap_or(0)
}

fn library(app: &AppHandle) -> Result<Library, String> {
    Ok(Library { snippets: load_snippets_from_disk(app)?, revision: current_revision(app) })
}

// ---- Intent-level edits: read-modify-write on disk, so a window never has
// to send the whole library from a snapshot that may already be stale. Pure
// on the array so they are unit-testable.

/// Fields the manager's editor owns. Everything else on a snippet (`uses`,
/// `pinned`, `fieldValues`) is written by the popup and must survive an edit.
#[derive(Deserialize, Clone)]
struct SnippetEdit {
    title: String,
    text: String,
    tags: Vec<String>,
    pack: String,
    group: String,
    #[serde(rename = "configValues")]
    config_values: HashMap<String, String>,
}

/// What the popup changes about a snippet: pin state, remembered fill-ins.
#[derive(Deserialize, Clone, Default)]
struct SnippetPatch {
    pinned: Option<bool>,
    #[serde(rename = "fieldValues")]
    field_values: Option<HashMap<String, String>>,
}

/// Append, or replace an existing snippet with the same id (a retried add
/// must not duplicate).
fn merge_add(list: &mut Vec<Snippet>, snippet: Snippet) {
    match list.iter_mut().find(|s| s.id == snippet.id) {
        Some(existing) => *existing = snippet,
        None => list.push(snippet),
    }
}

fn merge_patch(list: &mut [Snippet], id: &str, patch: SnippetPatch) -> bool {
    let Some(s) = list.iter_mut().find(|s| s.id == id) else {
        return false;
    };
    if let Some(p) = patch.pinned {
        s.pinned = p;
        // Stamp the pin order once; re-pinning an already-pinned row keeps it
        s.pinned_at = match (p, s.pinned_at) {
            (false, _) => 0,
            (true, 0) => now_millis(),
            (true, at) => at,
        };
    }
    if let Some(v) = patch.field_values {
        s.field_values = v;
    }
    true
}

fn merge_update(list: &mut [Snippet], id: &str, edit: SnippetEdit) -> bool {
    let Some(s) = list.iter_mut().find(|s| s.id == id) else {
        return false;
    };
    s.title = edit.title;
    s.text = edit.text;
    s.tags = edit.tags;
    s.pack = edit.pack;
    s.group = edit.group;
    s.config_values = edit.config_values;
    true
}

fn merge_delete(list: &mut Vec<Snippet>, id: &str) -> bool {
    let before = list.len();
    list.retain(|s| s.id != id);
    list.len() != before
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
        sync_pack_files(app);
        notify_other_window(app, window);
    }
    Ok(Library { snippets, revision: current_revision(app) })
}

#[tauri::command]
fn add_snippet(
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
fn patch_snippet(
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
fn update_snippet(
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
fn delete_snippet(
    app: AppHandle,
    state: State<AppState>,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<Library, String> {
    let _guard = state.store.lock().unwrap();
    mutate_library(&app, &window, |list| merge_delete(list, &id))
}

/// Same policy as `load_snippets_from_disk`: missing is a first run,
/// unparseable is quarantined and reported (lock flags and pack paths are in
/// the quarantined file), unreadable is an `Err`.
fn load_config_from_disk(app: &AppHandle) -> Result<Config, String> {
    let path = config_path(app);
    match load_json_file::<Config>(&path)? {
        Loaded::Present(mut c) => {
            // A config from before 0.2.9 stores absolute pack paths; bring
            // them to the relative form once, so the next move of the
            // profile needs no rewrite at all
            if normalize_pack_paths(&mut c, &packs_dir(app)) {
                save_config(app, &c)?;
            }
            Ok(c)
        }
        Loaded::Missing => Ok(Config::default()),
        Loaded::Quarantined { moved_to, error } => {
            notify(
                app,
                "config-recovered",
                format!(
                    "Your settings couldn't be read ({error}). The file was moved to {} and defaults apply — hotkey, pack locks and pack file paths are in that file.",
                    moved_to.display()
                ),
            );
            let config = Config::default();
            save_config(app, &config)?;
            Ok(config)
        }
    }
}

#[tauri::command]
fn get_snippets(app: AppHandle, state: State<AppState>) -> Result<Library, String> {
    let _guard = state.store.lock().unwrap();
    library(&app)
}

// Each window caches the library in memory; when the other one (or Rust
// itself) writes, tell the manager so it re-reads before saving over it.
// The payload is the new revision.
fn notify_manager_snippets_changed(app: &AppHandle) {
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
/// it never saw. `None` skips the check (startup GC, migrations).
#[tauri::command]
fn save_snippets(
    app: AppHandle,
    state: State<AppState>,
    window: tauri::WebviewWindow,
    snippets: Vec<Snippet>,
    base_revision: Option<u64>,
) -> Result<u64, StoreError> {
    let _guard = state.store.lock().unwrap();
    let current = current_revision(&app);
    if let Some(base) = base_revision {
        if base != current {
            return Err(StoreError::Stale { revision: current });
        }
    }
    write_snippets(&app, &snippets)?;
    sync_pack_files(&app);
    notify_other_window(&app, &window);
    Ok(current_revision(&app))
}

/// The config with every pack path resolved: the frontend displays it,
/// reads the file and shows it in its folder, and never sees the relative
/// on-disk form.
#[tauri::command]
fn get_config(app: AppHandle, state: State<AppState>) -> Result<Config, String> {
    let _guard = state.store.lock().unwrap();
    Ok(with_resolved_pack_paths(load_config_from_disk(&app)?, &packs_dir(&app)))
}

fn save_config(app: &AppHandle, config: &Config) -> Result<(), String> {
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    write_atomic(&config_path(app), json.as_bytes()).map_err(|e| e.to_string())
}

/// The shortcut a config string stands for; unparseable config falls back to
/// the default rather than leaving the app without a hotkey.
fn resolve_hotkey(configured: &str) -> Shortcut {
    configured
        .parse()
        .unwrap_or_else(|_| Config::default().hotkey.parse().unwrap())
}

/// Change the global hotkey. The new combination is registered *before* the
/// old one is released: if the OS refuses it (another program owns it), the
/// old hotkey keeps working and the config is untouched, so the UI keeps
/// showing what is actually bound.
#[tauri::command]
fn set_hotkey(app: AppHandle, state: State<AppState>, hotkey: String) -> Result<(), String> {
    let shortcut: Shortcut = hotkey
        .parse()
        .map_err(|e| format!("Invalid hotkey \"{hotkey}\": {e}"))?;
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
fn save_packs(app: AppHandle, state: State<AppState>, packs: Vec<PackMeta>) -> Result<(), String> {
    let _guard = state.store.lock().unwrap();
    let mut config = load_config_from_disk(&app)?;
    let dir = packs_dir(&app);
    // The frontend hands paths back as it got them (resolved) or as
    // `create_pack_file` returned them (absolute); store the on-disk form
    let packs: Vec<PackMeta> = packs
        .into_iter()
        .map(|mut p| {
            if !p.path.is_empty() {
                p.path = relativize_pack_path(&dir, &resolve_pack_path(&dir, &p.path));
            }
            p
        })
        .collect();

    // A pack whose file is no longer claimed by any pack has been deleted, so
    // its file goes to packs/deleted/. Compared by path, not by name: renaming
    // a pack drops its old name from this list while keeping the same file.
    for old in &config.packs {
        if !old.path.is_empty() && !packs.iter().any(|p| p.path == old.path) {
            retire_pack_file(&app, &resolve_pack_path(&dir, &old.path));
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
fn retire_pack_file(app: &AppHandle, src: &Path) {
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
    if let Err(e) = fs::rename(src, &dest) {
        log::warn!("couldn't retire {} to {}: {e}", src.display(), dest.display());
    }
}

/// Rename a pack on its metadata and on every prompt in one step. Done in
/// two frontend writes, `ensure_packs_backed` ran in between and saw prompts
/// still carrying the old name (or already carrying the new one) and
/// conjured a second pack for it.
fn rename_pack_in(config: &mut Config, snippets: &mut [Snippet], from: &str, to: &str) -> Result<(), String> {
    if from == to {
        return Ok(());
    }
    if to.trim().is_empty() {
        return Err("A pack needs a name".into());
    }
    // Names differing only by case would read as one pack (and share a file
    // name on Windows), so they count as taken — except the pack's own,
    // which a case-only rename ("general" to "General") is allowed to keep
    let taken = |name: &str| name != from && name.eq_ignore_ascii_case(to);
    if config.packs.iter().any(|p| taken(&p.name)) || snippets.iter().any(|s| taken(&s.pack)) {
        return Err(format!("Pack \"{to}\" already exists"));
    }
    let mut renamed = false;
    for p in config.packs.iter_mut().filter(|p| p.name == from) {
        p.name = to.to_string();
        renamed = true;
    }
    if !renamed {
        // A pack that existed only as a name on prompts: give it metadata now
        config.packs.push(PackMeta { name: to.to_string(), locked: false, path: String::new() });
    }
    for s in snippets.iter_mut().filter(|s| s.pack == from) {
        s.pack = to.to_string();
    }
    Ok(())
}

#[tauri::command]
fn rename_pack(
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
    sync_pack_files(&app);
    notify_other_window(&app, &window);
    Ok(Library { snippets, revision: current_revision(&app) })
}

/// Create a fresh file-backed pack file and return its absolute path.
#[tauri::command]
fn create_pack_file(app: AppHandle, name: String) -> Result<String, String> {
    new_pack_file(&app, &name).map(|p| p.to_string_lossy().into_owned())
}

/// Create an empty scratch file under packs/generated/ for an agent to fill
/// with several packs at once (a JSON array). It backs no pack of its own —
/// the packs inside get their own files on import — so it lives outside the
/// top-level packs/ that pack metadata points into.
#[tauri::command]
fn create_generated_file(app: AppHandle) -> Result<String, String> {
    let dir = packs_dir(&app).join("generated");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut path = dir.join(format!("generated-{stamp}.json"));
    let mut i = 2;
    while path.exists() {
        path = dir.join(format!("generated-{stamp}-{i}.json"));
        i += 1;
    }
    write_atomic(&path, b"[]").map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
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
    app.autolaunch().is_enabled().unwrap_or_else(|e| {
        log::warn!("couldn't read the autostart entry: {e}");
        false
    })
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    let result = if enabled { autolaunch.enable() } else { autolaunch.disable() };
    result.map_err(|e| {
        log::warn!("couldn't set autostart to {enabled}: {e}");
        e.to_string()
    })
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
    let Ok(mut config) = load_config_from_disk(app) else {
        return;
    };
    if (config.popup_width - logical.width).abs() < 1.0
        && (config.popup_height - logical.height).abs() < 1.0
    {
        return;
    }
    config.popup_width = logical.width;
    config.popup_height = logical.height;
    if let Err(e) = save_config(app, &config) {
        log::warn!("couldn't save the popup size: {e}");
    }
}

#[tauri::command]
fn hide_popup(app: AppHandle, state: State<AppState>) {
    let _guard = state.store.lock().unwrap();
    persist_popup_size(&app);
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.hide();
    }
}

/// Copy `text` to the clipboard (expanding `{clipboard}` from its current
/// contents); if `paste` is set, refocus the previously active window and
/// send Ctrl+V. The prompt stays on the clipboard afterwards (see the note in
/// the body and BEHAVIOR.md). Bumps the snippet's use count.
#[tauri::command]
fn paste_snippet(
    app: AppHandle,
    state: State<AppState>,
    text: String,
    paste: bool,
    id: Option<String>,
) -> Result<(), String> {
    let _guard = state.store.lock().unwrap();
    let prev_window = *state.prev_window.lock().unwrap();
    let prev_clipboard = arboard::Clipboard::new()
        .ok()
        .and_then(|mut c| c.get_text().ok());

    let text = if text.contains("{clipboard}") {
        text.replace("{clipboard}", prev_clipboard.as_deref().unwrap_or(""))
    } else {
        text
    };

    // The clipboard is written *before* the popup is hidden: if the write
    // fails (another program holding the clipboard open), the error returns
    // to a window that is still on screen and can show it.
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Couldn't open the clipboard: {e}"))?;
    clipboard
        .set_text(text)
        .map_err(|e| format!("Couldn't write to the clipboard: {e}"))?;
    drop(clipboard);

    persist_popup_size(&app);
    // Copy-only leaves the popup up for a moment so it can confirm the copy;
    // the popup hides itself afterwards
    if paste {
        if let Some(w) = app.get_webview_window("popup") {
            let _ = w.hide();
        }
    }

    // The use count is best effort, all of it: the popup is already hidden
    // here, so an error would reach nobody, and a library that is momentarily
    // unreadable (a sync client or scanner holding the file) must not turn
    // into a paste that never happens with the prompt sitting on the clipboard
    if let Some(id) = id {
        if let Ok(mut snippets) = load_snippets_from_disk(&app) {
            if let Some(s) = snippets.iter_mut().find(|s| s.id == id) {
                s.uses += 1;
                if let Err(e) = write_snippets(&app, &snippets) {
                    log::warn!("couldn't save the use count: {e}");
                }
                notify_manager_snippets_changed(&app);
            }
        }
    }

    // The prompt stays on the clipboard afterwards, deliberately. Ctrl+V only
    // lands if the window we return to has a focused text field; when it
    // doesn't, leaving the text there is the fallback — click into a field and
    // paste it yourself. Restoring the old clipboard would silently discard it.
    if paste {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(80));
            if !platform::focus_window(prev_window) {
                log::warn!("SetForegroundWindow refused window {prev_window:#x}");
            }
            std::thread::sleep(Duration::from_millis(80));
            platform::send_ctrl_v();
        });
    }
    Ok(())
}

/// Quit, but let the manager flush a pending autosave first: the editor
/// saves on a 600 ms debounce, so Quit from the tray right after typing
/// used to drop the last edit. The manager answers `quit-requested` with
/// `quit_now`; if it doesn't (webview gone or hung) we exit anyway after a
/// grace period, so Quit can never hang.
fn request_quit(app: &AppHandle) {
    let asked = app
        .get_webview_window("main")
        .map(|w| w.emit("quit-requested", ()).is_ok())
        .unwrap_or(false);
    if !asked {
        app.exit(0);
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        handle.exit(0);
    });
}

#[tauri::command]
fn quit_now(app: AppHandle) {
    app.exit(0);
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn show_popup(app: &AppHandle) {
    let Some(w) = app.get_webview_window("popup") else {
        return;
    };
    // The hotkey fires again while the popup is already up whenever the keys
    // are held (RegisterHotKey has no autorepeat suppression) or tapped twice.
    // Recording the foreground window then would make the popup its own paste
    // target, so a repeat only makes sure the popup has focus (D1: ignore,
    // not toggle). The same guard covers the foreground HWND being ours.
    if w.is_visible().unwrap_or(false) {
        let _ = w.set_focus();
        return;
    }
    let fg = platform::foreground_window();
    let own = w.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    let state = app.state::<AppState>();
    if fg != own {
        *state.prev_window.lock().unwrap() = fg;
    }

    // First-run: record that the user found the hotkey, tell the manager
    {
        let _guard = state.store.lock().unwrap();
        if let Ok(mut config) = load_config_from_disk(app) {
            if !config.popup_seen {
                config.popup_seen = true;
                if let Err(e) = save_config(app, &config) {
                    log::warn!("couldn't record the first popup: {e}");
                }
                let _ = app.emit("first-popup", ());
            }
        }
    }

    if let Ok(cursor) = app.cursor_position() {
        let mut x = cursor.x;
        let mut y = cursor.y;
        if let (Ok(Some(monitor)), Ok(size)) =
            (app.monitor_from_point(cursor.x, cursor.y), w.outer_size())
        {
            // Clamp to the work area, not the monitor: the taskbar would
            // otherwise cover the last rows and the hint bar
            let area = monitor.work_area();
            let (apos, asize) = (area.position, area.size);
            let max_x = (apos.x + asize.width as i32 - size.width as i32) as f64;
            let max_y = (apos.y + asize.height as i32 - size.height as i32) as f64;
            x = x.min(max_x).max(apos.x as f64);
            y = y.min(max_y).max(apos.y as f64);
        }
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
    let _ = w.show();
    let _ = w.set_focus();
    let _ = app.emit("popup-shown", ());
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

    /// Bring `hwnd` to the foreground; false when Windows refused (the
    /// window is elevated, or another process holds the foreground lock).
    pub fn focus_window(hwnd: isize) -> bool {
        if hwnd == 0 {
            return false;
        }
        unsafe { SetForegroundWindow(HWND(hwnd as *mut core::ffi::c_void)).as_bool() }
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
    pub fn focus_window(_hwnd: isize) -> bool {
        false
    }
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
        assert_eq!(s.pinned_at, 0);
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
        assert_eq!(c.font, "system");
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
    fn reserved_windows_device_names_never_become_pack_filenames() {
        for name in ["Con", "CON", "nul", "aux", "PRN", "com1", "LPT9"] {
            let s = sanitize_pack_filename(name);
            assert!(s.ends_with("-pack"), "{name} -> {s}");
            assert!(!is_reserved_device_name(&s));
        }
        // Not reserved: longer names, COM0, prefixes with more characters
        assert_eq!(sanitize_pack_filename("Console"), "console");
        assert_eq!(sanitize_pack_filename("com0"), "com0");
        assert_eq!(sanitize_pack_filename("com10"), "com10");
        assert_eq!(sanitize_pack_filename("Con Air"), "con-air");
    }

    #[test]
    fn backing_a_pack_adopts_the_file_an_agent_already_wrote_for_it() {
        let dir = temp_dir("packadopt");
        // The Generate dialog's file for pack "Agent Pack", filled by the agent
        let agent_file = dir.join("agent-pack.json");
        fs::write(&agent_file, pack_doc_json("Agent Pack", vec![serde_json::json!({
            "title": "A", "tags": ["t"], "text": "body"
        })]).unwrap()).unwrap();
        // The import conjures the pack; backing it must land on that same file
        let (path, adopted) = pack_file_slot(&dir, "Agent Pack", &[]);
        assert!(adopted);
        assert_eq!(path, agent_file);
        // Once a pack claims it, the next same-named pack file gets its own name
        let claimed = vec![agent_file.to_string_lossy().into_owned()];
        let (path, adopted) = pack_file_slot(&dir, "Agent Pack", &claimed);
        assert!(!adopted);
        assert_eq!(path, dir.join("agent-pack-2.json"));
        // A file of another pack's, or one that isn't a pack document, is never taken
        fs::write(dir.join("other.json"), pack_doc_json("Other", Vec::new()).unwrap()).unwrap();
        assert_eq!(pack_file_slot(&dir, "Other pack", &[]).0, dir.join("other-pack.json"));
        fs::write(dir.join("junk.json"), b"not json").unwrap();
        let (path, adopted) = pack_file_slot(&dir, "Junk", &[]);
        assert!(!adopted);
        assert_eq!(path, dir.join("junk-2.json"));
        // Nothing there at all: the plain name
        assert_eq!(pack_file_slot(&dir, "Fresh", &[]), (dir.join("fresh.json"), false));
    }

    #[test]
    fn pack_files_are_written_only_when_their_content_changed() {
        let dir = temp_dir("packsync");
        // P is stored the on-disk way, relative to packs/; the file is resolved
        let path = dir.join("p.json");
        let packs = vec![
            PackMeta { name: "P".into(), locked: false, path: "p.json".into() },
            PackMeta { name: "Empty".into(), locked: false, path: dir.join("empty.json").to_string_lossy().into_owned() },
            PackMeta { name: "Unbacked".into(), locked: false, path: String::new() },
        ];
        let mut a = snip("A", "t", "body");
        a.pack = "P".into();
        let mut snippets = vec![a];
        // First sync writes P; the empty pack never gets a file written
        assert_eq!(write_pack_files(&dir, &packs, &snippets).written, 1);
        assert!(!dir.join("empty.json").exists());
        let first = fs::read_to_string(&path).unwrap();
        assert!(first.contains("\"title\": \"A\""));
        // Nothing changed: nothing written
        assert_eq!(write_pack_files(&dir, &packs, &snippets).written, 0);
        assert_eq!(fs::read_to_string(&path).unwrap(), first);
        // A change to a P prompt writes P again (and only P)
        snippets[0].text = "changed".into();
        assert_eq!(write_pack_files(&dir, &packs, &snippets).written, 1);
        assert!(fs::read_to_string(&path).unwrap().contains("changed"));
        // Personal state never reaches the file
        snippets[0].uses = 9;
        snippets[0].pinned = true;
        assert_eq!(write_pack_files(&dir, &packs, &snippets).written, 0);
    }

    #[test]
    fn a_pack_file_left_holding_only_swept_drafts_is_emptied() {
        let dir = temp_dir("packdrafts");
        let path = dir.join("d.json");
        let packs = vec![PackMeta { name: "D".into(), locked: false, path: "d.json".into() }];
        let mut draft = snip("New prompt", "", "");
        draft.pack = "D".into();
        draft.tags.clear();
        assert_eq!(write_pack_files(&dir, &packs, &[draft]).written, 1);
        assert!(fs::read_to_string(&path).unwrap().contains("New prompt"));
        // The manager's sweep removed the draft: the file follows
        assert_eq!(write_pack_files(&dir, &packs, &[]).written, 1);
        let after: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(after["prompts"].as_array().unwrap().len(), 0);
        assert_eq!(write_pack_files(&dir, &packs, &[]).written, 0);
        // But a file with real content (an agent's, or a user-emptied pack)
        // is still never overwritten by an empty library view
        let mut real = snip("Real", "t", "body");
        real.pack = "D".into();
        assert_eq!(write_pack_files(&dir, &packs, &[real]).written, 1);
        assert_eq!(write_pack_files(&dir, &packs, &[]).written, 0);
        assert!(fs::read_to_string(&path).unwrap().contains("Real"));
    }

    #[test]
    fn a_pack_file_that_cannot_be_written_is_reported_not_skipped() {
        let dir = temp_dir("packfail");
        // The pack's folder is gone (a moved profile, a deleted subfolder)
        let packs = vec![
            PackMeta { name: "Gone".into(), locked: false, path: dir.join("missing").join("gone.json").to_string_lossy().into_owned() },
            PackMeta { name: "Fine".into(), locked: false, path: "fine.json".into() },
        ];
        let mut gone = snip("A", "t", "body");
        gone.pack = "Gone".into();
        let mut fine = snip("B", "t", "body");
        fine.pack = "Fine".into();
        let result = write_pack_files(&dir, &packs, &[gone, fine]);
        // The good file is still written; the bad one is named with its error
        assert_eq!(result.written, 1);
        assert!(dir.join("fine.json").exists());
        assert_eq!(result.failed.len(), 1);
        assert!(result.failed[0].contains("gone.json"), "{}", result.failed[0]);
    }

    #[test]
    fn pack_paths_are_stored_relative_to_packs_and_resolved_back() {
        let packs = PathBuf::from(if cfg!(windows) { "C:\\data\\packs" } else { "/data/packs" });
        let elsewhere = PathBuf::from(if cfg!(windows) { "D:\\shared\\team.json" } else { "/shared/team.json" });
        // Under packs/: relative on disk, the same file when resolved
        assert_eq!(relativize_pack_path(&packs, &packs.join("work.json")), "work.json");
        assert_eq!(resolve_pack_path(&packs, "work.json"), packs.join("work.json"));
        let nested = packs.join("generated").join("g.json");
        let rel = relativize_pack_path(&packs, &nested);
        assert_eq!(resolve_pack_path(&packs, &rel), nested);
        // Elsewhere: absolute both ways
        assert_eq!(relativize_pack_path(&packs, &elsewhere), elsewhere.to_string_lossy());
        assert_eq!(resolve_pack_path(&packs, &elsewhere.to_string_lossy()), elsewhere);
        // Not file-backed stays empty, and packs/ itself is never "relative to itself"
        assert_eq!(resolve_pack_path(&packs, ""), PathBuf::new());
        assert_eq!(relativize_pack_path(&packs, &packs), packs.to_string_lossy());
    }

    #[test]
    fn absolute_pack_paths_under_packs_migrate_to_relative_once() {
        let packs = PathBuf::from(if cfg!(windows) { "C:\\data\\packs" } else { "/data/packs" });
        let elsewhere = if cfg!(windows) { "D:\\shared\\team.json" } else { "/shared/team.json" };
        let mut config = Config::default();
        config.packs.push(PackMeta { name: "Work".into(), locked: false, path: packs.join("work.json").to_string_lossy().into_owned() });
        config.packs.push(PackMeta { name: "Team".into(), locked: true, path: elsewhere.into() });
        config.packs.push(PackMeta { name: "Already".into(), locked: false, path: "already.json".into() });
        config.packs.push(PackMeta { name: "None".into(), locked: false, path: String::new() });
        // A config from before 0.2.9: the path under packs/ becomes relative,
        // the one elsewhere is kept absolute, the rest are untouched
        assert!(normalize_pack_paths(&mut config, &packs));
        assert_eq!(config.packs[0].path, "work.json");
        assert_eq!(config.packs[1].path, elsewhere);
        assert_eq!(config.packs[2].path, "already.json");
        assert_eq!(config.packs[3].path, "");
        // Once migrated, a load changes nothing (and so writes nothing)
        assert!(!normalize_pack_paths(&mut config, &packs));
        // The frontend always gets absolute paths, whatever is stored
        let resolved = with_resolved_pack_paths(config, &packs);
        assert_eq!(resolved.packs[0].path, packs.join("work.json").to_string_lossy());
        assert_eq!(resolved.packs[1].path, elsewhere);
        assert_eq!(resolved.packs[2].path, packs.join("already.json").to_string_lossy());
        assert_eq!(resolved.packs[3].path, "");
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

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("promptline-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn moving_the_data_dir_carries_files_and_rewrites_pack_paths() {
        let root = temp_dir("move");
        let old = root.join("com.promptline.app");
        let new = root.join("io.github.bekalpaslan.promptline");
        fs::create_dir_all(old.join("packs")).unwrap();
        fs::write(old.join("snippets.json"), "[]").unwrap();
        fs::write(old.join("packs").join("work.json"), "{}").unwrap();
        let old_pack = old.join("packs").join("work.json");
        let config = Config {
            packs: vec![PackMeta {
                name: "Work".into(),
                locked: false,
                path: old_pack.to_string_lossy().to_string(),
            }],
            ..Config::default()
        };
        fs::write(old.join("config.json"), serde_json::to_vec(&config).unwrap()).unwrap();

        move_data_dir(&old, &new).unwrap();

        assert!(new.join("snippets.json").exists());
        assert!(new.join("packs").join("work.json").exists());
        assert!(!old.exists(), "the emptied old folder goes");
        let moved: Config = serde_json::from_str(&fs::read_to_string(new.join("config.json")).unwrap()).unwrap();
        // The old absolute path becomes the on-disk form, which resolves to
        // the moved file
        assert_eq!(moved.packs[0].path, "work.json");
        assert_eq!(resolve_pack_path(&new.join("packs"), &moved.packs[0].path), new.join("packs").join("work.json"));

        // A second run never overwrites what the new folder already holds
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("snippets.json"), "[1]").unwrap();
        move_data_dir(&old, &new).unwrap();
        assert_eq!(fs::read_to_string(new.join("snippets.json")).unwrap(), "[]");
        assert!(old.join("snippets.json").exists(), "the skipped file stays put");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_atomic_replaces_the_file_and_leaves_no_temp_behind() {
        let dir = temp_dir("atomic");
        let path = dir.join("snippets.json");
        write_atomic(&path, b"[1]").unwrap();
        write_atomic(&path, b"[1,2]").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "[1,2]");
        assert!(!tmp_path(&path).exists());
        let names: Vec<_> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names.len(), 1);
    }

    #[test]
    fn load_json_file_missing_is_not_an_error() {
        let dir = temp_dir("missing");
        let loaded: Loaded<Vec<Snippet>> = load_json_file(&dir.join("snippets.json")).unwrap();
        assert!(matches!(loaded, Loaded::Missing));
    }

    #[test]
    fn load_json_file_parses_a_good_file() {
        let dir = temp_dir("good");
        let path = dir.join("snippets.json");
        fs::write(&path, r#"[{"id": "a", "title": "t", "text": "b"}]"#).unwrap();
        match load_json_file::<Vec<Snippet>>(&path).unwrap() {
            Loaded::Present(v) => assert_eq!(v[0].id, "a"),
            other => panic!("expected Present, got {other:?}"),
        }
    }

    #[test]
    fn unreadable_file_is_quarantined_intact_and_never_overwritten() {
        let dir = temp_dir("corrupt");
        let path = dir.join("snippets.json");
        // A write that died halfway through
        let truncated = r#"[{"id": "a", "title": "t", "te"#;
        fs::write(&path, truncated).unwrap();
        let moved_to = match load_json_file::<Vec<Snippet>>(&path).unwrap() {
            Loaded::Quarantined { moved_to, error } => {
                assert!(!error.is_empty());
                moved_to
            }
            other => panic!("expected Quarantined, got {other:?}"),
        };
        // The bytes survive under the quarantine name, and the original path
        // is free, so whatever gets written next cannot destroy them
        assert!(!path.exists());
        assert!(moved_to.file_name().unwrap().to_string_lossy().starts_with("snippets.json.corrupt-"));
        assert_eq!(fs::read_to_string(&moved_to).unwrap(), truncated);
        write_atomic(&path, b"[]").unwrap();
        assert_eq!(fs::read_to_string(&moved_to).unwrap(), truncated);
        // A second corruption in the same second gets its own file
        fs::write(&path, "{").unwrap();
        let again = match load_json_file::<Vec<Snippet>>(&path).unwrap() {
            Loaded::Quarantined { moved_to, .. } => moved_to,
            other => panic!("expected Quarantined, got {other:?}"),
        };
        assert_ne!(again, moved_to);
        assert_eq!(fs::read_to_string(&moved_to).unwrap(), truncated);
    }

    fn sample(id: &str) -> Snippet {
        let mut s = snip(id, "tag", "body {goal}");
        s.id = id.into();
        s.uses = 7;
        s.pinned = true;
        s.field_values.insert("goal".into(), "remembered".into());
        s.config_values.insert("cfg".into(), "v".into());
        s
    }

    #[test]
    fn merge_update_keeps_what_the_popup_owns() {
        let mut list = vec![sample("a"), sample("b")];
        let edit = SnippetEdit {
            title: "New title".into(),
            text: "new {goal}".into(),
            tags: vec!["x".into()],
            pack: "P".into(),
            group: "G".into(),
            config_values: HashMap::from([("cfg".into(), "w".into())]),
        };
        assert!(merge_update(&mut list, "a", edit.clone()));
        assert!(!merge_update(&mut list, "missing", edit));
        let a = &list[0];
        assert_eq!(a.title, "New title");
        assert_eq!(a.pack, "P");
        assert_eq!(a.group, "G");
        assert_eq!(a.config_values["cfg"], "w");
        // Popup-owned state survives a manager edit
        assert_eq!(a.uses, 7);
        assert!(a.pinned);
        assert_eq!(a.field_values["goal"], "remembered");
        assert_eq!(list[1].title, sample("b").title);
    }

    #[test]
    fn merge_patch_changes_only_what_is_given() {
        let mut list = vec![sample("a")];
        assert!(merge_patch(&mut list, "a", SnippetPatch { pinned: Some(false), field_values: None }));
        assert!(!list[0].pinned);
        assert_eq!(list[0].field_values["goal"], "remembered");
        let vals = HashMap::from([("goal".into(), "next".into())]);
        assert!(merge_patch(&mut list, "a", SnippetPatch { pinned: None, field_values: Some(vals) }));
        assert!(!list[0].pinned);
        assert_eq!(list[0].field_values["goal"], "next");
        assert_eq!(list[0].uses, 7);
        assert!(!merge_patch(&mut list, "missing", SnippetPatch::default()));
    }

    #[test]
    fn a_pin_is_stamped_once_and_cleared_on_unpin() {
        let mut list = vec![sample("a")];
        list[0].pinned = false;
        list[0].pinned_at = 0;
        assert!(merge_patch(&mut list, "a", SnippetPatch { pinned: Some(true), field_values: None }));
        let stamped = list[0].pinned_at;
        assert!(stamped > 0);
        // Re-pinning an already-pinned prompt keeps its place in the pin order
        assert!(merge_patch(&mut list, "a", SnippetPatch { pinned: Some(true), field_values: None }));
        assert_eq!(list[0].pinned_at, stamped);
        // Unpinning forgets the order; the next pin goes to the end
        assert!(merge_patch(&mut list, "a", SnippetPatch { pinned: Some(false), field_values: None }));
        assert_eq!(list[0].pinned_at, 0);
        // A patch that says nothing about pinning leaves the stamp alone
        assert!(merge_patch(&mut list, "a", SnippetPatch { pinned: Some(true), field_values: None }));
        let again = list[0].pinned_at;
        assert!(merge_patch(&mut list, "a", SnippetPatch { pinned: None, field_values: None }));
        assert_eq!(list[0].pinned_at, again);
    }

    #[test]
    fn merge_add_replaces_a_duplicate_id_and_merge_delete_reports_change() {
        let mut list = vec![sample("a")];
        let mut again = sample("a");
        again.title = "retried".into();
        merge_add(&mut list, again);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "retried");
        merge_add(&mut list, sample("b"));
        assert_eq!(list.len(), 2);
        assert!(merge_delete(&mut list, "a"));
        assert!(!merge_delete(&mut list, "a"));
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "b");
    }

    #[test]
    fn hotkey_config_falls_back_to_the_default_when_unparseable() {
        let default: Shortcut = Config::default().hotkey.parse().unwrap();
        assert_eq!(resolve_hotkey("not a hotkey"), default);
        assert_eq!(resolve_hotkey(""), default);
        assert_eq!(resolve_hotkey("ctrl+alt+v"), "ctrl+alt+v".parse::<Shortcut>().unwrap());
        assert_ne!(resolve_hotkey("ctrl+alt+v"), default);
    }

    #[test]
    fn an_empty_draft_backs_no_pack() {
        let mut config = Config::default();
        config.packs.push(PackMeta { name: "Work".into(), locked: false, path: String::new() });
        let mut draft = snip("New prompt", "", "");
        draft.pack = "My prompts".into();
        draft.uses = 0;
        let mut kept = snip("Kept", "", "");
        kept.pack = "Notes".into();
        // The draft's pack is not in play; a real prompt's is
        assert_eq!(packs_in_play(&config, &[draft.clone(), kept]), vec!["Work".to_string(), "Notes".to_string()]);
        // Typing a body (or a title) makes it a prompt like any other
        draft.text = "hello".into();
        assert_eq!(packs_in_play(&config, &[draft.clone()]), vec!["Work".to_string(), "My prompts".to_string()]);
        draft.text.clear();
        draft.title = "Standup".into();
        assert_eq!(packs_in_play(&config, &[draft]), vec!["Work".to_string(), "My prompts".to_string()]);
    }

    #[test]
    fn rename_pack_treats_case_variants_as_taken_except_its_own() {
        let mut config = Config::default();
        config.packs.push(PackMeta { name: "General".into(), locked: false, path: String::new() });
        let mut s = snip("A", "", "x");
        s.pack = "Other".into();
        let mut snippets = vec![s];
        assert!(rename_pack_in(&mut config, &mut snippets, "Other", "general").is_err());
        assert!(rename_pack_in(&mut config, &mut snippets, "Other", "OTHER").is_ok());
        assert_eq!(snippets[0].pack, "OTHER");
        assert!(rename_pack_in(&mut config, &mut snippets, "General", "GENERAL").is_ok());
        assert_eq!(config.packs[0].name, "GENERAL");
    }

    #[test]
    fn rename_pack_moves_metadata_and_prompts_together() {
        let mut config = Config::default();
        config.packs.push(PackMeta { name: "Old".into(), locked: true, path: "C:\\old.json".into() });
        config.packs.push(PackMeta { name: "Other".into(), locked: false, path: String::new() });
        let mut snippets = vec![sample("a"), sample("b"), sample("c")];
        snippets[0].pack = "Old".into();
        snippets[1].pack = "Old".into();
        snippets[2].pack = "Other".into();
        rename_pack_in(&mut config, &mut snippets, "Old", "New").unwrap();
        // One entry, same file, lock kept; every prompt follows
        assert_eq!(config.packs.iter().filter(|p| p.name == "New").count(), 1);
        assert!(!config.packs.iter().any(|p| p.name == "Old"));
        let new = config.packs.iter().find(|p| p.name == "New").unwrap();
        assert!(new.locked);
        assert_eq!(new.path, "C:\\old.json");
        assert_eq!(snippets.iter().filter(|s| s.pack == "New").count(), 2);
        assert_eq!(snippets[2].pack, "Other");
        // Collisions and empties are refused, nothing touched
        assert!(rename_pack_in(&mut config, &mut snippets, "New", "Other").is_err());
        assert!(rename_pack_in(&mut config, &mut snippets, "New", "  ").is_err());
        assert_eq!(snippets.iter().filter(|s| s.pack == "New").count(), 2);
        // A pack that was only a name on prompts gets metadata when renamed
        snippets[2].pack = "Nameless".into();
        rename_pack_in(&mut config, &mut snippets, "Nameless", "Named").unwrap();
        assert!(config.packs.iter().any(|p| p.name == "Named" && p.path.is_empty()));
        assert_eq!(snippets[2].pack, "Named");
    }

    #[test]
    fn config_without_a_hotkey_still_parses_with_the_default() {
        // A hand-edited or partially written config.json must not be
        // quarantined over a missing field: the packs and their paths live
        // in the same file
        let config: Config = serde_json::from_str(r#"{"packs": [{"name": "Work", "locked": true}]}"#).unwrap();
        assert_eq!(config.hotkey, Config::default().hotkey);
        assert_eq!(config.packs.len(), 1);
        let empty: Config = serde_json::from_str("{}").unwrap();
        assert_eq!(empty.hotkey, "ctrl+shift+v");
    }

    #[test]
    fn store_error_serializes_with_a_kind_tag() {
        let json = serde_json::to_string(&StoreError::Stale { revision: 4 }).unwrap();
        assert_eq!(json, r#"{"kind":"stale","revision":4}"#);
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
    let mut targets = vec![Target::new(TargetKind::Folder { path: dir, file_name: Some(LOG_FILE_STEM.into()) })];
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
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
            get_snippets,
            save_snippets,
            add_snippet,
            patch_snippet,
            update_snippet,
            delete_snippet,
            get_config,
            take_notices,
            set_hotkey,
            save_packs,
            rename_pack,
            save_prefs,
            import_pack_file,
            create_pack_file,
            create_generated_file,
            read_pack_file,
            show_in_folder,
            open_url,
            edit_in_manager,
            get_autostart,
            set_autostart,
            get_clipboard_text,
            set_clipboard_text,
            hide_popup,
            paste_snippet,
            quit_now
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
                    let _guard = state.store.lock().unwrap();
                    persist_popup_size(app);
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
