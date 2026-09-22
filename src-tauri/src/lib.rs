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
    // command / event-handler entry points; helpers never lock it. Released
    // before anything that fires a window event (hiding the popup): the
    // Focused(false) handler takes it too.
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
    Stale {
        revision: u64,
    },
    Failed {
        message: String,
    },
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
    let notice = Notice {
        kind: kind.into(),
        message,
    };
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
///
/// The temp file is flushed to disk before the rename: the rename is only
/// as atomic as the bytes behind it, and on NTFS a rename can reach the
/// journal before the data does. The rename itself is retried briefly,
/// because on Windows a sync client, an indexer or a scanner holds a
/// just-changed file for tens of milliseconds and a rename in that window
/// fails with a sharing violation or "access denied"; an autosave that hit
/// it showed "Couldn't save" and threw the keystrokes away. If it still
/// fails, the temp file is removed so nothing is left behind.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = tmp_path(path);
    let result = write_synced(&tmp, bytes).and_then(|()| rename_with_retries(&tmp, path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn write_synced(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut file = fs::File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// Five tries, 20 ms then doubling: about 300 ms in all, longer than the
/// holds seen from OneDrive and Defender, short enough that the manager's
/// autosave never feels stuck.
const RENAME_ATTEMPTS: u32 = 5;

fn rename_with_retries(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut delay = Duration::from_millis(20);
    let mut attempt = 1;
    loop {
        match fs::rename(from, to) {
            Err(e) if attempt < RENAME_ATTEMPTS && is_transient_rename_error(&e) => {
                std::thread::sleep(delay);
                delay *= 2;
                attempt += 1;
            }
            other => return other,
        }
    }
}

/// What "another program is holding the file" looks like: PermissionDenied
/// (which is how std maps both), and on Windows the raw codes behind it,
/// ERROR_ACCESS_DENIED (5) and ERROR_SHARING_VIOLATION (32). Anything else
/// (a missing folder, a full disk) will not get better by waiting.
fn is_transient_rename_error(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::PermissionDenied
        || matches!(e.raw_os_error(), Some(5) | Some(32))
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
    Quarantined {
        moved_to: PathBuf,
        error: String,
    },
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
            Ok(Loaded::Quarantined {
                moved_to,
                error: e.to_string(),
            })
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
    let base = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
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
        pack.path = resolve_pack_path(packs_dir, &pack.path)
            .to_string_lossy()
            .into_owned();
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
    let s = s
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
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
                .map(|p| {
                    resolve_pack_path(&dir, &p.path)
                        .to_string_lossy()
                        .into_owned()
                })
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
    let (Ok(mut config), Ok(snippets)) = (load_config_from_disk(app), load_snippets_from_disk(app))
    else {
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
                config.packs.push(PackMeta {
                    name,
                    locked: false,
                    path,
                });
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
                && p.get("text")
                    .and_then(|t| t.as_str())
                    .is_none_or(|t| t.trim().is_empty())
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
        if fs::read(&path)
            .map(|cur| cur == json.as_bytes())
            .unwrap_or(false)
        {
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
    let (snippets, notice) = snippets_from_loaded(load_json_file(&snippets_path(app))?);
    if let Some(notice) = notice {
        notify(app, &notice.kind, notice.message);
        // Pin the empty state so the next load isn't a "first run"
        write_snippets(app, &snippets)?;
    }
    Ok(snippets)
}

/// The library a load result stands for, and what the user must hear.
/// Missing is a first run: the starters. Quarantined is a loss: an *empty*
/// library plus a notice naming where the file went, because the starters
/// would look like a reset rather than a loss and the first autosave would
/// have buried the only copy. Present gets the migrations.
fn snippets_from_loaded(loaded: Loaded<Vec<Snippet>>) -> (Vec<Snippet>, Option<Notice>) {
    match loaded {
        Loaded::Present(mut snippets) => {
            apply_snippet_migrations(&mut snippets);
            (snippets, None)
        }
        Loaded::Missing => (default_snippets(), None),
        Loaded::Quarantined { moved_to, error } => {
            let notice = Notice {
                kind: "library-recovered".into(),
                message: format!(
                    "Your prompt library couldn't be read ({error}). The file was moved to {} and the library starts empty — copy it back over snippets.json to recover it.",
                    moved_to.display()
                ),
            };
            (Vec::new(), Some(notice))
        }
    }
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
    app.try_state::<AppState>()
        .map(|s| *s.revision.lock().unwrap())
        .unwrap_or(0)
}

fn library(app: &AppHandle) -> Result<Library, String> {
    Ok(Library {
        snippets: load_snippets_from_disk(app)?,
        revision: current_revision(app),
    })
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
    Ok(Library {
        snippets,
        revision: current_revision(app),
    })
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
    check_revision(base_revision, current_revision(&app))?;
    write_snippets(&app, &snippets)?;
    sync_pack_files(&app);
    notify_other_window(&app, &window);
    Ok(current_revision(&app))
}

/// The stale gate: a save based on `base` may go ahead only if the file
/// is still at that revision. `None` skips the check (startup GC,
/// migrations); the error carries the current revision so the caller can
/// reload to it.
fn check_revision(base: Option<u64>, current: u64) -> Result<(), StoreError> {
    match base {
        Some(base) if base != current => Err(StoreError::Stale { revision: current }),
        _ => Ok(()),
    }
}

/// The config with every pack path resolved: the frontend displays it,
/// reads the file and shows it in its folder, and never sees the relative
/// on-disk form.
#[tauri::command]
fn get_config(app: AppHandle, state: State<AppState>) -> Result<Config, String> {
    let _guard = state.store.lock().unwrap();
    Ok(with_resolved_pack_paths(
        load_config_from_disk(&app)?,
        &packs_dir(&app),
    ))
}

fn save_config(app: &AppHandle, config: &Config) -> Result<(), String> {
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    write_atomic(&config_path(app), json.as_bytes()).map_err(|e| e.to_string())
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
fn resolve_hotkey(configured: &str) -> Shortcut {
    parse_hotkey(configured).unwrap_or_else(|_| Config::default().hotkey.parse().unwrap())
}

/// Change the global hotkey. The new combination is registered *before* the
/// old one is released: if the OS refuses it (another program owns it), the
/// old hotkey keeps working and the config is untouched, so the UI keeps
/// showing what is actually bound.
#[tauri::command]
fn set_hotkey(app: AppHandle, state: State<AppState>, hotkey: String) -> Result<(), String> {
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
    if let Err(e) = retire_into(&packs_dir(app).join("deleted"), src) {
        log::warn!("couldn't retire {}: {e}", src.display());
    }
}

/// Move `src` into `deleted_dir` under its own name, numbered when that
/// name is taken: deleting, recreating and deleting the same pack again
/// must not overwrite the first retirement. A source that isn't there is a
/// no-op (the pack never had a file, or it was already moved). Returns
/// where the file went.
fn retire_into(deleted_dir: &Path, src: &Path) -> std::io::Result<Option<PathBuf>> {
    if !src.is_file() {
        return Ok(None);
    }
    fs::create_dir_all(deleted_dir)?;
    let stem = src
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let mut dest = deleted_dir.join(format!("{stem}.json"));
    let mut i = 2;
    while dest.exists() {
        dest = deleted_dir.join(format!("{stem}-{i}.json"));
        i += 1;
    }
    fs::rename(src, &dest)?;
    Ok(Some(dest))
}

/// Rename a pack on its metadata and on every prompt in one step. Done in
/// two frontend writes, `ensure_packs_backed` ran in between and saw prompts
/// still carrying the old name (or already carrying the new one) and
/// conjured a second pack for it.
fn rename_pack_in(
    config: &mut Config,
    snippets: &mut [Snippet],
    from: &str,
    to: &str,
) -> Result<(), String> {
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
        config.packs.push(PackMeta {
            name: to.to_string(),
            locked: false,
            path: String::new(),
        });
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
    Ok(Library {
        snippets,
        revision: current_revision(&app),
    })
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
fn read_pack_file(app: AppHandle, path: String) -> Result<String, String> {
    let path = data_file(&app, &path)?;
    fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
fn show_in_folder(app: AppHandle, path: String) -> Result<(), String> {
    let path = data_file(&app, &path)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open an https URL in the user's default browser. Restricted to https so a
/// URL can never turn into a command or a local executable, and handed to
/// the shell as one string rather than to an `explorer` command line that
/// would parse it itself.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https links can be opened".into());
    }
    #[cfg(windows)]
    platform::open_url(&url)?;
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
        Some(f) => fs::read_to_string(f.path())
            .map(Some)
            .map_err(|e| e.to_string()),
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
    {
        let _guard = state.store.lock().unwrap();
        persist_popup_size(&app);
    }
    // Hidden with the store lock released: hiding fires Focused(false), whose
    // handler takes the same lock. That the event arrives asynchronously is
    // what kept this from deadlocking; it is not something to rely on.
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.hide();
    }
}

/// Copy `text` to the clipboard (expanding `{clipboard}` from its current
/// contents); if `paste` is set and there is a window to paste into, refocus
/// it and send Ctrl+V. The prompt stays on the clipboard afterwards (see the
/// note in the body and BEHAVIOR.md). Bumps the snippet's use count. Returns
/// `"pasted"` when the paste thread was spawned and `"copied"` when it fell
/// back to copy-only (asked for, or no target), so the popup can say so.
#[tauri::command]
fn paste_snippet(
    app: AppHandle,
    state: State<AppState>,
    text: String,
    paste: bool,
    id: Option<String>,
) -> Result<String, String> {
    let guard = state.store.lock().unwrap();
    let prev_window = *state.prev_window.lock().unwrap();
    let mode = paste_mode(paste, prev_window);
    let prev_clipboard = arboard::Clipboard::new()
        .ok()
        .and_then(|mut c| c.get_text().ok());
    let text = expand_clipboard(&text, prev_clipboard.as_deref());

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
    // Released before the hide: hiding fires Focused(false), whose handler
    // takes the store lock (see hide_popup). The use count below takes it
    // again; the command is still the only place that locks.
    drop(guard);
    // Copy-only leaves the popup up for a moment so it can confirm the copy;
    // the popup hides itself afterwards
    if mode == PasteMode::Pasted {
        if let Some(w) = app.get_webview_window("popup") {
            let _ = w.hide();
        }
    }

    // The use count is best effort, all of it: the popup is already hidden
    // here, so an error would reach nobody, and a library that is momentarily
    // unreadable (a sync client or scanner holding the file) must not turn
    // into a paste that never happens with the prompt sitting on the clipboard
    if let Some(id) = id {
        let _guard = state.store.lock().unwrap();
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
    if mode == PasteMode::Pasted {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(80));
            // No Ctrl+V without the focus: it would land in whatever window
            // happens to be in front, which is not the one the user meant
            let focused = platform::focus_window(prev_window);
            if !focused {
                log::warn!(
                    "SetForegroundWindow refused window {prev_window:#x}; the paste was not sent"
                );
            }
            let sent = focused && {
                std::thread::sleep(Duration::from_millis(80));
                platform::send_ctrl_v()
            };
            if focused && !sent {
                log::warn!("SendInput did not deliver Ctrl+V to window {prev_window:#x}");
            }
            if !sent {
                report_paste_failed(&app);
            }
        });
    }
    Ok(mode.tag().into())
}

/// `{clipboard}` replaced by what the clipboard holds, in one pass: a
/// clipboard that itself contains the token is pasted as text, never
/// expanded again. An empty or unreadable clipboard leaves a hole, which is
/// what every preview showed ("(clipboard is empty)"); text without the
/// token comes back as it was.
fn expand_clipboard(text: &str, clip: Option<&str>) -> String {
    text.replace("{clipboard}", clip.unwrap_or(""))
}

/// What the popup shows when the paste thread could not deliver. The
/// popup listens for `paste-failed` with exactly this payload shape.
const PASTE_FAILED_MESSAGE: &str =
    "Couldn't paste into that window — the prompt is on your clipboard";

/// The paste thread could not deliver (an elevated window, a foreground
/// lock held elsewhere, a blocked input queue): bring the popup back where
/// it was, without re-recording `prev_window` — the target is still the
/// one the user came from — and tell it, so the user learns the prompt is
/// on the clipboard rather than wondering why nothing happened.
fn report_paste_failed(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    let payload = serde_json::json!({ "message": PASTE_FAILED_MESSAGE });
    if let Err(e) = app.emit_to("popup", "paste-failed", payload) {
        log::warn!("couldn't tell the popup the paste failed: {e}");
    }
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

/// A rectangle in physical pixels: a monitor's work area.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Where a `w`×`h` window asked for at (`x`, `y`) goes so that it stays
/// inside `area`: pulled back by however much would hang out past the right
/// or bottom edge, never before the area's origin (monitors left of or above
/// the primary have negative coordinates). A window larger than the area
/// sits at the origin, since its top-left is the part that matters.
fn clamp_to_area(x: f64, y: f64, w: f64, h: f64, area: Area) -> (f64, f64) {
    let max_x = area.x + area.width - w;
    let max_y = area.y + area.height - h;
    (x.min(max_x).max(area.x), y.min(max_y).max(area.y))
}

/// The window a paste goes back to: the foreground window when it is
/// someone else's, 0 (no target) when it is one of ours.
fn paste_target(foreground: isize, ours: &[isize]) -> isize {
    if ours.contains(&foreground) {
        0
    } else {
        foreground
    }
}

/// What `paste_snippet` reports back, so the popup can say "Copied" when it
/// asked for a paste and none was possible.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PasteMode {
    /// The clipboard holds the text and the paste thread was spawned
    Pasted,
    /// The clipboard holds the text; the popup stays up to say so
    Copied,
}

impl PasteMode {
    fn tag(self) -> &'static str {
        match self {
            PasteMode::Pasted => "pasted",
            PasteMode::Copied => "copied",
        }
    }
}

/// Copy-only when the popup asked for it (Ctrl+Enter), and when there is
/// no window to paste into: `prev_window` is 0 after a summon over the
/// manager, so Ctrl+V would have landed in the editor.
fn paste_mode(paste: bool, prev_window: isize) -> PasteMode {
    if paste && prev_window != 0 {
        PasteMode::Pasted
    } else {
        PasteMode::Copied
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
    // not toggle).
    if w.is_visible().unwrap_or(false) {
        let _ = w.set_focus();
        return;
    }
    // Summoned over one of our own windows (the manager, or the popup itself
    // in a race), there is nothing to paste into: Ctrl+V would land in the
    // editor's textarea and autosave would keep it. Record "no target" and
    // paste_snippet falls back to copy-only.
    let ours: Vec<isize> = ["popup", "main"]
        .iter()
        .filter_map(|label| app.get_webview_window(label))
        .filter_map(|w| w.hwnd().ok())
        .map(|h| h.0 as isize)
        .collect();
    let state = app.state::<AppState>();
    *state.prev_window.lock().unwrap() = paste_target(platform::foreground_window(), &ours);

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
        let (mut x, mut y) = (cursor.x, cursor.y);
        if let (Ok(Some(monitor)), Ok(size)) =
            (app.monitor_from_point(cursor.x, cursor.y), w.outer_size())
        {
            // The size is in the pixels of the monitor the popup was last
            // on; a hidden window keeps that DPI until it moves, and Windows
            // rescales it on arrival. Clamping with the old size on a
            // 100% → 150% move left a third of the popup off-screen.
            let ratio = monitor.scale_factor() / w.scale_factor().unwrap_or(1.0);
            // Clamp to the work area, not the monitor: the taskbar would
            // otherwise cover the last rows and the hint bar
            let work = monitor.work_area();
            let area = Area {
                x: work.position.x as f64,
                y: work.position.y as f64,
                width: work.size.width as f64,
                height: work.size.height as f64,
            };
            (x, y) = clamp_to_area(
                x,
                y,
                size.width as f64 * ratio,
                size.height as f64 * ratio,
                area,
            );
        }
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
    let _ = w.show();
    let _ = w.set_focus();
    let _ = app.emit("popup-shown", ());
}

#[cfg(windows)]
mod platform {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_LBUTTON, VK_MENU, VK_SHIFT, VK_V,
    };
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, SetForegroundWindow, SW_SHOWNORMAL,
    };

    pub fn foreground_window() -> isize {
        unsafe { GetForegroundWindow().0 as isize }
    }

    /// Hand a URL to whatever the shell has registered for it (the default
    /// browser). `ShellExecuteW` answers with a value above 32 on success
    /// and an error code otherwise.
    pub fn open_url(url: &str) -> Result<(), String> {
        let url = HSTRING::from(url);
        let result = unsafe {
            ShellExecuteW(
                HWND::default(),
                w!("open"),
                &url,
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        let code = result.0 as usize;
        if code > 32 {
            Ok(())
        } else {
            Err(format!("The shell couldn't open the link (error {code})"))
        }
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

    /// Send Ctrl+V; false when SendInput inserted fewer events than asked
    /// (the input queue is blocked, or another thread holds it). UIPI drops
    /// input aimed at an elevated window without saying so, so a paste into
    /// one still comes back true.
    pub fn send_ctrl_v() -> bool {
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
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        sent as usize == inputs.len()
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
    pub fn send_ctrl_v() -> bool {
        false
    }
    pub fn left_button_down() -> bool {
        false
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
        let s: Snippet = serde_json::from_str(r#"{"id": "a", "title": "t", "text": "b"}"#).unwrap();
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
        let s: Snippet =
            serde_json::from_str(r#"{"id": "a", "title": "t", "text": "b", "category": "Debug"}"#)
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

        let sized: Config =
            serde_json::from_str(r#"{"hotkey": "x", "popupWidth": 480.0, "popupHeight": 620.5}"#)
                .unwrap();
        assert_eq!(sized.popup_width, 480.0);
        assert_eq!(sized.popup_height, 620.5);
    }

    #[test]
    fn pack_filenames_are_sanitized_and_stable() {
        assert_eq!(
            sanitize_pack_filename("Beekon Routine Injections"),
            "beekon-routine-injections"
        );
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
        fs::write(
            &agent_file,
            pack_doc_json(
                "Agent Pack",
                vec![serde_json::json!({
                    "title": "A", "tags": ["t"], "text": "body"
                })],
            )
            .unwrap(),
        )
        .unwrap();
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
        fs::write(
            dir.join("other.json"),
            pack_doc_json("Other", Vec::new()).unwrap(),
        )
        .unwrap();
        assert_eq!(
            pack_file_slot(&dir, "Other pack", &[]).0,
            dir.join("other-pack.json")
        );
        fs::write(dir.join("junk.json"), b"not json").unwrap();
        let (path, adopted) = pack_file_slot(&dir, "Junk", &[]);
        assert!(!adopted);
        assert_eq!(path, dir.join("junk-2.json"));
        // Nothing there at all: the plain name
        assert_eq!(
            pack_file_slot(&dir, "Fresh", &[]),
            (dir.join("fresh.json"), false)
        );
    }

    #[test]
    fn pack_files_are_written_only_when_their_content_changed() {
        let dir = temp_dir("packsync");
        // P is stored the on-disk way, relative to packs/; the file is resolved
        let path = dir.join("p.json");
        let packs = vec![
            PackMeta {
                name: "P".into(),
                locked: false,
                path: "p.json".into(),
            },
            PackMeta {
                name: "Empty".into(),
                locked: false,
                path: dir.join("empty.json").to_string_lossy().into_owned(),
            },
            PackMeta {
                name: "Unbacked".into(),
                locked: false,
                path: String::new(),
            },
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
        let packs = vec![PackMeta {
            name: "D".into(),
            locked: false,
            path: "d.json".into(),
        }];
        let mut draft = snip("New prompt", "", "");
        draft.pack = "D".into();
        draft.tags.clear();
        assert_eq!(write_pack_files(&dir, &packs, &[draft]).written, 1);
        assert!(fs::read_to_string(&path).unwrap().contains("New prompt"));
        // The manager's sweep removed the draft: the file follows
        assert_eq!(write_pack_files(&dir, &packs, &[]).written, 1);
        let after: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
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
            PackMeta {
                name: "Gone".into(),
                locked: false,
                path: dir
                    .join("missing")
                    .join("gone.json")
                    .to_string_lossy()
                    .into_owned(),
            },
            PackMeta {
                name: "Fine".into(),
                locked: false,
                path: "fine.json".into(),
            },
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
        assert!(
            result.failed[0].contains("gone.json"),
            "{}",
            result.failed[0]
        );
    }

    #[test]
    fn pack_paths_are_stored_relative_to_packs_and_resolved_back() {
        let packs = PathBuf::from(if cfg!(windows) {
            "C:\\data\\packs"
        } else {
            "/data/packs"
        });
        let elsewhere = PathBuf::from(if cfg!(windows) {
            "D:\\shared\\team.json"
        } else {
            "/shared/team.json"
        });
        // Under packs/: relative on disk, the same file when resolved
        assert_eq!(
            relativize_pack_path(&packs, &packs.join("work.json")),
            "work.json"
        );
        assert_eq!(
            resolve_pack_path(&packs, "work.json"),
            packs.join("work.json")
        );
        let nested = packs.join("generated").join("g.json");
        let rel = relativize_pack_path(&packs, &nested);
        assert_eq!(resolve_pack_path(&packs, &rel), nested);
        // Elsewhere: absolute both ways
        assert_eq!(
            relativize_pack_path(&packs, &elsewhere),
            elsewhere.to_string_lossy()
        );
        assert_eq!(
            resolve_pack_path(&packs, &elsewhere.to_string_lossy()),
            elsewhere
        );
        // Not file-backed stays empty, and packs/ itself is never "relative to itself"
        assert_eq!(resolve_pack_path(&packs, ""), PathBuf::new());
        assert_eq!(
            relativize_pack_path(&packs, &packs),
            packs.to_string_lossy()
        );
    }

    #[test]
    fn absolute_pack_paths_under_packs_migrate_to_relative_once() {
        let packs = PathBuf::from(if cfg!(windows) {
            "C:\\data\\packs"
        } else {
            "/data/packs"
        });
        let elsewhere = if cfg!(windows) {
            "D:\\shared\\team.json"
        } else {
            "/shared/team.json"
        };
        let mut config = Config::default();
        config.packs.push(PackMeta {
            name: "Work".into(),
            locked: false,
            path: packs.join("work.json").to_string_lossy().into_owned(),
        });
        config.packs.push(PackMeta {
            name: "Team".into(),
            locked: true,
            path: elsewhere.into(),
        });
        config.packs.push(PackMeta {
            name: "Already".into(),
            locked: false,
            path: "already.json".into(),
        });
        config.packs.push(PackMeta {
            name: "None".into(),
            locked: false,
            path: String::new(),
        });
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
        assert_eq!(
            resolved.packs[0].path,
            packs.join("work.json").to_string_lossy()
        );
        assert_eq!(resolved.packs[1].path, elsewhere);
        assert_eq!(
            resolved.packs[2].path,
            packs.join("already.json").to_string_lossy()
        );
        assert_eq!(resolved.packs[3].path, "");
    }

    #[test]
    fn pack_meta_path_defaults_for_older_configs() {
        let c: Config =
            serde_json::from_str(r#"{"hotkey": "x", "packs": [{"name": "Old", "locked": true}]}"#)
                .unwrap();
        assert_eq!(c.packs[0].path, "");
        assert!(c.packs[0].locked);
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("promptline-test-{}-{name}", std::process::id()));
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
        fs::write(
            old.join("config.json"),
            serde_json::to_vec(&config).unwrap(),
        )
        .unwrap();

        move_data_dir(&old, &new).unwrap();

        assert!(new.join("snippets.json").exists());
        assert!(new.join("packs").join("work.json").exists());
        assert!(!old.exists(), "the emptied old folder goes");
        let moved: Config =
            serde_json::from_str(&fs::read_to_string(new.join("config.json")).unwrap()).unwrap();
        // The old absolute path becomes the on-disk form, which resolves to
        // the moved file
        assert_eq!(moved.packs[0].path, "work.json");
        assert_eq!(
            resolve_pack_path(&new.join("packs"), &moved.packs[0].path),
            new.join("packs").join("work.json")
        );

        // A second run never overwrites what the new folder already holds
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("snippets.json"), "[1]").unwrap();
        move_data_dir(&old, &new).unwrap();
        assert_eq!(fs::read_to_string(new.join("snippets.json")).unwrap(), "[]");
        assert!(
            old.join("snippets.json").exists(),
            "the skipped file stays put"
        );
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
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names.len(), 1);
    }

    #[test]
    fn only_a_held_file_is_worth_retrying_the_rename_for() {
        use std::io::{Error, ErrorKind};
        assert!(is_transient_rename_error(&Error::from(
            ErrorKind::PermissionDenied
        )));
        // ERROR_ACCESS_DENIED and ERROR_SHARING_VIOLATION, what Windows
        // answers while a sync client or a scanner holds the destination
        assert!(is_transient_rename_error(&Error::from_raw_os_error(5)));
        assert!(is_transient_rename_error(&Error::from_raw_os_error(32)));
        // A missing folder or a full disk will not get better by waiting
        assert!(!is_transient_rename_error(&Error::from(
            ErrorKind::NotFound
        )));
        assert!(!is_transient_rename_error(&Error::from_raw_os_error(2)));
    }

    #[test]
    fn a_write_that_cannot_land_leaves_no_temp_file_behind() {
        let dir = temp_dir("atomicfail");
        // A directory where the file should go: the rename can never succeed
        let path = dir.join("snippets.json");
        fs::create_dir_all(&path).unwrap();
        assert!(write_atomic(&path, b"[1]").is_err());
        assert!(!tmp_path(&path).exists(), "the temp file is cleaned up");
        assert!(path.is_dir(), "the obstacle is untouched");
    }

    #[cfg(windows)]
    #[test]
    fn a_write_outlasts_a_program_briefly_holding_the_file() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = temp_dir("atomicheld");
        let path = dir.join("snippets.json");
        write_atomic(&path, b"[1]").unwrap();
        // Something else (a sync client, a scanner) opens the file with no
        // sharing for 60 ms: a rename over it is a sharing violation
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        let holder = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(60));
            drop(held);
        });
        write_atomic(&path, b"[1,2]").unwrap();
        holder.join().unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "[1,2]");
        assert!(!tmp_path(&path).exists());
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
        assert!(moved_to
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("snippets.json.corrupt-"));
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
        assert!(merge_patch(
            &mut list,
            "a",
            SnippetPatch {
                pinned: Some(false),
                field_values: None
            }
        ));
        assert!(!list[0].pinned);
        assert_eq!(list[0].field_values["goal"], "remembered");
        let vals = HashMap::from([("goal".into(), "next".into())]);
        assert!(merge_patch(
            &mut list,
            "a",
            SnippetPatch {
                pinned: None,
                field_values: Some(vals)
            }
        ));
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
        assert!(merge_patch(
            &mut list,
            "a",
            SnippetPatch {
                pinned: Some(true),
                field_values: None
            }
        ));
        let stamped = list[0].pinned_at;
        assert!(stamped > 0);
        // Re-pinning an already-pinned prompt keeps its place in the pin order
        assert!(merge_patch(
            &mut list,
            "a",
            SnippetPatch {
                pinned: Some(true),
                field_values: None
            }
        ));
        assert_eq!(list[0].pinned_at, stamped);
        // Unpinning forgets the order; the next pin goes to the end
        assert!(merge_patch(
            &mut list,
            "a",
            SnippetPatch {
                pinned: Some(false),
                field_values: None
            }
        ));
        assert_eq!(list[0].pinned_at, 0);
        // A patch that says nothing about pinning leaves the stamp alone
        assert!(merge_patch(
            &mut list,
            "a",
            SnippetPatch {
                pinned: Some(true),
                field_values: None
            }
        ));
        let again = list[0].pinned_at;
        assert!(merge_patch(
            &mut list,
            "a",
            SnippetPatch {
                pinned: None,
                field_values: None
            }
        ));
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
    fn a_save_from_a_stale_revision_is_refused_with_the_current_one() {
        assert!(
            check_revision(None, 7).is_ok(),
            "no base: startup GC and migrations skip the check"
        );
        assert!(check_revision(Some(7), 7).is_ok());
        match check_revision(Some(6), 7) {
            Err(StoreError::Stale { revision }) => assert_eq!(revision, 7),
            other => panic!("expected Stale, got {other:?}"),
        }
        assert!(matches!(
            check_revision(Some(8), 7),
            Err(StoreError::Stale { revision: 7 })
        ));
    }

    #[test]
    fn a_retired_pack_file_is_numbered_on_repeats_and_missing_is_a_no_op() {
        let dir = temp_dir("retire");
        let deleted = dir.join("deleted");
        let src = dir.join("work.json");
        fs::write(&src, "first").unwrap();
        assert_eq!(
            retire_into(&deleted, &src).unwrap(),
            Some(deleted.join("work.json"))
        );
        assert!(!src.exists());
        assert_eq!(
            fs::read_to_string(deleted.join("work.json")).unwrap(),
            "first"
        );
        // The pack is recreated and deleted again: the first retirement stays
        fs::write(&src, "second").unwrap();
        assert_eq!(
            retire_into(&deleted, &src).unwrap(),
            Some(deleted.join("work-2.json"))
        );
        fs::write(&src, "third").unwrap();
        assert_eq!(
            retire_into(&deleted, &src).unwrap(),
            Some(deleted.join("work-3.json"))
        );
        assert_eq!(
            fs::read_to_string(deleted.join("work.json")).unwrap(),
            "first"
        );
        assert_eq!(
            fs::read_to_string(deleted.join("work-2.json")).unwrap(),
            "second"
        );
        // Nothing to retire (never backed, or already moved): nothing happens
        assert_eq!(retire_into(&deleted, &src).unwrap(), None);
        let fresh = temp_dir("retire-none");
        assert_eq!(
            retire_into(&fresh.join("deleted"), &fresh.join("ghost.json")).unwrap(),
            None
        );
        assert!(
            !fresh.join("deleted").exists(),
            "no folder is made for nothing"
        );
    }

    #[test]
    fn clipboard_expansion_is_one_pass_and_leaves_holes_when_empty() {
        // No token: the text comes back as it was
        assert_eq!(
            expand_clipboard("plain {goal}", Some("clip")),
            "plain {goal}"
        );
        // Every token takes the clipboard
        assert_eq!(
            expand_clipboard("a {clipboard} b {clipboard}", Some("X")),
            "a X b X"
        );
        // An empty or unreadable clipboard leaves a hole rather than the word
        assert_eq!(expand_clipboard("a {clipboard} b", Some("")), "a  b");
        assert_eq!(expand_clipboard("a {clipboard} b", None), "a  b");
        // A clipboard holding the token itself is text, never expanded again
        assert_eq!(
            expand_clipboard("see {clipboard}", Some("{clipboard} inside")),
            "see {clipboard} inside"
        );
    }

    #[test]
    fn a_quarantined_library_starts_empty_with_a_notice_and_a_missing_one_with_starters() {
        let (starters, notice) = snippets_from_loaded(Loaded::Missing);
        assert_eq!(starters.len(), default_snippets().len());
        assert!(notice.is_none());

        let moved_to = PathBuf::from("snippets.json.corrupt-1700000000");
        let (empty, notice) = snippets_from_loaded(Loaded::Quarantined {
            moved_to,
            error: "EOF while parsing".into(),
        });
        assert!(
            empty.is_empty(),
            "never the starters: that would look like a reset, not a loss"
        );
        let notice = notice.unwrap();
        assert_eq!(notice.kind, "library-recovered");
        assert!(notice.message.contains("snippets.json.corrupt-1700000000"));
        assert!(notice.message.contains("EOF while parsing"));

        // Present: the migrations run (v2 category becomes a tag, packs default)
        let v2: Vec<Snippet> = serde_json::from_str(
            r#"[{"id": "abc", "title": "t", "text": "x", "category": "Debug"}]"#,
        )
        .unwrap();
        let (present, notice) = snippets_from_loaded(Loaded::Present(v2));
        assert!(notice.is_none());
        assert_eq!(present[0].tags, vec!["debug"]);
        assert_eq!(present[0].pack, "My prompts");
    }

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
    fn the_popup_is_clamped_into_the_work_area() {
        // A 1920×1040 work area (a 40 px taskbar) left of the primary monitor
        let area = Area {
            x: -1920.0,
            y: 0.0,
            width: 1920.0,
            height: 1040.0,
        };
        let (w, h) = (400.0, 600.0);
        // Room to spare: the cursor position is used as is
        assert_eq!(clamp_to_area(-1000.0, 100.0, w, h, area), (-1000.0, 100.0));
        // Near the right and bottom edges: pulled back to fit, taskbar excluded
        assert_eq!(clamp_to_area(-100.0, 900.0, w, h, area), (-400.0, 440.0));
        // Before the origin (a cursor a pixel outside): the origin
        assert_eq!(clamp_to_area(-1921.0, -5.0, w, h, area), (-1920.0, 0.0));
        // The size is the target monitor's: at 150% the same popup is 600×900,
        // and what fit at 100% no longer does
        assert_eq!(
            clamp_to_area(-500.0, 200.0, w * 1.5, h * 1.5, area),
            (-600.0, 140.0)
        );
        // Larger than the area: the top-left stays visible
        assert_eq!(
            clamp_to_area(0.0, 0.0, 3000.0, 3000.0, area),
            (-1920.0, 0.0)
        );
    }

    #[test]
    fn a_summon_over_one_of_our_windows_records_no_paste_target() {
        let ours = [0x10, 0x20];
        assert_eq!(paste_target(0x30, &ours), 0x30);
        // The manager's window, or the popup's own: nothing to paste into
        assert_eq!(paste_target(0x10, &ours), 0);
        assert_eq!(paste_target(0x20, &ours), 0);
        assert_eq!(paste_target(0, &ours), 0);
    }

    #[test]
    fn a_paste_with_no_target_falls_back_to_copy_only() {
        assert_eq!(paste_mode(true, 0x30), PasteMode::Pasted);
        assert_eq!(paste_mode(true, 0), PasteMode::Copied);
        assert_eq!(paste_mode(false, 0x30), PasteMode::Copied);
        assert_eq!(paste_mode(false, 0), PasteMode::Copied);
        // The tags the popup switches on
        assert_eq!(PasteMode::Pasted.tag(), "pasted");
        assert_eq!(PasteMode::Copied.tag(), "copied");
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
    fn an_empty_draft_backs_no_pack() {
        let mut config = Config::default();
        config.packs.push(PackMeta {
            name: "Work".into(),
            locked: false,
            path: String::new(),
        });
        let mut draft = snip("New prompt", "", "");
        draft.pack = "My prompts".into();
        draft.uses = 0;
        let mut kept = snip("Kept", "", "");
        kept.pack = "Notes".into();
        // The draft's pack is not in play; a real prompt's is
        assert_eq!(
            packs_in_play(&config, &[draft.clone(), kept]),
            vec!["Work".to_string(), "Notes".to_string()]
        );
        // Typing a body (or a title) makes it a prompt like any other
        draft.text = "hello".into();
        assert_eq!(
            packs_in_play(&config, &[draft.clone()]),
            vec!["Work".to_string(), "My prompts".to_string()]
        );
        draft.text.clear();
        draft.title = "Standup".into();
        assert_eq!(
            packs_in_play(&config, &[draft]),
            vec!["Work".to_string(), "My prompts".to_string()]
        );
    }

    #[test]
    fn rename_pack_treats_case_variants_as_taken_except_its_own() {
        let mut config = Config::default();
        config.packs.push(PackMeta {
            name: "General".into(),
            locked: false,
            path: String::new(),
        });
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
        config.packs.push(PackMeta {
            name: "Old".into(),
            locked: true,
            path: "C:\\old.json".into(),
        });
        config.packs.push(PackMeta {
            name: "Other".into(),
            locked: false,
            path: String::new(),
        });
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
        assert!(config
            .packs
            .iter()
            .any(|p| p.name == "Named" && p.path.is_empty()));
        assert_eq!(snippets[2].pack, "Named");
    }

    #[test]
    fn config_without_a_hotkey_still_parses_with_the_default() {
        // A hand-edited or partially written config.json must not be
        // quarantined over a missing field: the packs and their paths live
        // in the same file
        let config: Config =
            serde_json::from_str(r#"{"packs": [{"name": "Work", "locked": true}]}"#).unwrap();
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
        assert!(snippets
            .iter()
            .all(|s| !s.tags.is_empty() && s.pack == "Starter"));
    }
}
