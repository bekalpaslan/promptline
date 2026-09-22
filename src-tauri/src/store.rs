//! The data files: atomic writes, typed loads with quarantine, the
//! library and the config with their revision, the intent-level merges the
//! snippet commands apply, and the notices Rust raises for the user.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::migrations::apply_snippet_migrations;
use crate::packs::{normalize_pack_paths, PackMeta};
use crate::AppState;

/// The library plus the revision it was read at — what every snippet
/// command returns, so a window's state and the disk never drift apart.
#[derive(Serialize)]
pub(crate) struct Library {
    pub(crate) snippets: Vec<Snippet>,
    pub(crate) revision: u64,
}

/// Why a write was refused, typed so the frontend can tell "someone else
/// wrote first" from "the disk failed".
#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum StoreError {
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
pub(crate) struct Notice {
    pub(crate) kind: String,
    pub(crate) message: String,
}

pub(crate) fn notify(app: &AppHandle, kind: &str, message: String) {
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
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
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

/// Time since the Unix epoch, for every stamp the app writes (a pin's
/// order in ms, a quarantined or generated file's name in s); zero if the
/// clock is before 1970.
pub(crate) fn since_epoch() -> Duration {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
}

/// The first path of a numbered series that is not `taken`: `name(1)`,
/// which callers give no suffix, then `name(2)`, `name(3)`, … Retired
/// pack files, quarantined files, generated files and pack files are all
/// numbered this way, so a repeat never overwrites an earlier one.
pub(crate) fn first_free(name: impl Fn(u32) -> PathBuf, taken: impl Fn(&Path) -> bool) -> PathBuf {
    let mut i = 1;
    loop {
        let path = name(i);
        if !taken(&path) {
            return path;
        }
        i += 1;
    }
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
    let stamp = since_epoch().as_secs();
    let base = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let dest = first_free(
        |i| match i {
            1 => path.with_file_name(format!("{base}.corrupt-{stamp}")),
            i => path.with_file_name(format!("{base}.corrupt-{stamp}-{i}")),
        },
        |p| p.exists(),
    );
    fs::rename(path, &dest).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(dest)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct Snippet {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) tags: Vec<String>,
    #[serde(default)]
    pub(crate) pack: String,
    // Optional group within the pack; empty = ungrouped. A label, not an
    // entity: naming a group on a prompt is what creates it.
    #[serde(default)]
    pub(crate) group: String,
    // Last-entered values for runtime {field}s; the popup pre-fills from these
    #[serde(default, rename = "fieldValues")]
    pub(crate) field_values: HashMap<String, String>,
    // Saved values for {{config}} parameters; expanded silently at paste time
    #[serde(default, rename = "configValues")]
    pub(crate) config_values: HashMap<String, String>,
    // Legacy v2 field, migrated into `tags` on load
    #[serde(default, skip_serializing)]
    pub(crate) category: String,
    #[serde(default)]
    pub(crate) uses: u64,
    #[serde(default)]
    pub(crate) pinned: bool,
    // When the prompt was pinned (ms since epoch), so pins keep the order they
    // were pinned in — their Ctrl+1..5 slots must not move as uses change.
    // 0 = not pinned, or a pin made before this was recorded.
    #[serde(default, rename = "pinnedAt")]
    pub(crate) pinned_at: u64,
}

// A fresh install follows Windows; a config written before the theme field
// existed gets the same. "sand" and "sundown" are what older builds wrote
// for their dark themes and still read as dark.
fn default_theme() -> String {
    "system".into()
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
pub(crate) struct Config {
    // Defaulted like every other field: a hand-edited config.json without it
    // used to fail to parse and be quarantined, taking every pack's lock and
    // file path with it
    #[serde(default = "default_hotkey")]
    pub(crate) hotkey: String,
    // Explicit pack registry: allows empty packs and per-pack lock state.
    // Packs referenced by snippets but absent here are implicit and unlocked.
    #[serde(default)]
    pub(crate) packs: Vec<PackMeta>,
    // UI preferences live here (not localStorage) so they export and survive
    // webview profile changes; the manager mirrors them for the popup.
    #[serde(default = "default_theme")]
    pub(crate) theme: String,
    #[serde(default = "default_density")]
    pub(crate) density: String,
    // UI scale percentage ("90" | "100" | "110" | "125"); rem tokens follow it
    #[serde(default = "default_scale")]
    pub(crate) scale: String,
    // UI font id ("outfit" | "system" | "serif" | "mono"); stacks live in the frontend
    #[serde(default = "default_font")]
    pub(crate) font: String,
    // First-run flag: has the popup ever been summoned?
    #[serde(default, rename = "popupSeen")]
    pub(crate) popup_seen: bool,
    // Popup window size in logical px, saved when the user resizes; 0 = default
    #[serde(default, rename = "popupWidth")]
    pub(crate) popup_width: f64,
    #[serde(default, rename = "popupHeight")]
    pub(crate) popup_height: f64,
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

pub(crate) fn data_dir(app: &AppHandle) -> PathBuf {
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

pub(crate) fn config_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("config.json")
}

pub(crate) fn packs_dir(app: &AppHandle) -> PathBuf {
    let dir = data_dir(app).join("packs");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub(crate) fn snip(title: &str, tag: &str, text: &str) -> Snippet {
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

pub(crate) fn default_snippets() -> Vec<Snippet> {
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

/// The library as on disk. A missing file is a first run and yields the
/// starter pack; a file that won't parse is quarantined, reported, and
/// replaced by an *empty* library — never by the starters, which would look
/// like a reset rather than a loss. An I/O error is an `Err` and writes
/// nothing: the file may still be good.
pub(crate) fn load_snippets_from_disk(app: &AppHandle) -> Result<Vec<Snippet>, String> {
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

pub(crate) fn write_snippets(app: &AppHandle, snippets: &[Snippet]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(snippets).map_err(|e| e.to_string())?;
    write_atomic(&snippets_path(app), json.as_bytes()).map_err(|e| e.to_string())?;
    if let Some(state) = app.try_state::<AppState>() {
        *state.revision.lock().unwrap() += 1;
    }
    Ok(())
}

pub(crate) fn current_revision(app: &AppHandle) -> u64 {
    app.try_state::<AppState>()
        .map(|s| *s.revision.lock().unwrap())
        .unwrap_or(0)
}

pub(crate) fn library(app: &AppHandle) -> Result<Library, String> {
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
pub(crate) struct SnippetEdit {
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
pub(crate) struct SnippetPatch {
    pinned: Option<bool>,
    #[serde(rename = "fieldValues")]
    field_values: Option<HashMap<String, String>>,
}

/// Append, or replace an existing snippet with the same id (a retried add
/// must not duplicate).
pub(crate) fn merge_add(list: &mut Vec<Snippet>, snippet: Snippet) {
    match list.iter_mut().find(|s| s.id == snippet.id) {
        Some(existing) => *existing = snippet,
        None => list.push(snippet),
    }
}

pub(crate) fn merge_patch(list: &mut [Snippet], id: &str, patch: SnippetPatch) -> bool {
    let Some(s) = list.iter_mut().find(|s| s.id == id) else {
        return false;
    };
    if let Some(p) = patch.pinned {
        s.pinned = p;
        // Stamp the pin order once; re-pinning an already-pinned row keeps it
        s.pinned_at = match (p, s.pinned_at) {
            (false, _) => 0,
            (true, 0) => since_epoch().as_millis() as u64,
            (true, at) => at,
        };
    }
    if let Some(v) = patch.field_values {
        s.field_values = v;
    }
    true
}

pub(crate) fn merge_update(list: &mut [Snippet], id: &str, edit: SnippetEdit) -> bool {
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

pub(crate) fn merge_delete(list: &mut Vec<Snippet>, id: &str) -> bool {
    let before = list.len();
    list.retain(|s| s.id != id);
    list.len() != before
}

/// Same policy as `load_snippets_from_disk`: missing is a first run,
/// unparseable is quarantined and reported (lock flags and pack paths are in
/// the quarantined file), unreadable is an `Err`.
pub(crate) fn load_config_from_disk(app: &AppHandle) -> Result<Config, String> {
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

/// The stale gate: a save based on `base` may go ahead only if the file
/// is still at that revision. `None` skips the check (startup GC,
/// migrations); the error carries the current revision so the caller can
/// reload to it.
pub(crate) fn check_revision(base: Option<u64>, current: u64) -> Result<(), StoreError> {
    match base {
        Some(base) if base != current => Err(StoreError::Stale { revision: current }),
        _ => Ok(()),
    }
}

pub(crate) fn save_config(app: &AppHandle, config: &Config) -> Result<(), String> {
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    write_atomic(&config_path(app), json.as_bytes()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{sample, temp_dir};

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
        assert_eq!(c.theme, "system");
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
    fn pack_meta_path_defaults_for_older_configs() {
        let c: Config =
            serde_json::from_str(r#"{"hotkey": "x", "packs": [{"name": "Old", "locked": true}]}"#)
                .unwrap();
        assert_eq!(c.packs[0].path, "");
        assert!(c.packs[0].locked);
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
