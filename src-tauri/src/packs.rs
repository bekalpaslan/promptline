//! Packs and their files: metadata and its on-disk paths, the reconciler
//! that backs every pack with a file, the sync that keeps the files
//! current, adoption of an agent's file, retirement instead of deletion,
//! and the pure halves of the pack commands.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::store::{
    first_free, load_config_from_disk, load_snippets_from_disk, notify, packs_dir, save_config,
    write_atomic, Config, Snippet,
};
use crate::AppState;

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct PackMeta {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) locked: bool,
    // File-backed packs: the pack's own .json file. On disk this is relative
    // to `packs/` (`work.json`) so a restored, moved or roamed profile keeps
    // every pack's file; a path outside `packs/` stays absolute. The frontend
    // only ever sees it resolved (`get_config`, the pack commands) and never
    // hands one back. Empty = not file-backed.
    #[serde(default)]
    pub(crate) path: String,
}

/// The file a `PackMeta.path` points at, as a path to open: a relative
/// path lives under `packs/`, an absolute one is used as is, and an empty
/// one (not file-backed) stays empty.
pub(crate) fn resolve_pack_path(packs_dir: &Path, stored: &str) -> PathBuf {
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
pub(crate) fn relativize_pack_path(packs_dir: &Path, path: &Path) -> String {
    match path.strip_prefix(packs_dir) {
        Ok(rel) if !rel.as_os_str().is_empty() => rel.to_string_lossy().into_owned(),
        _ => path.to_string_lossy().into_owned(),
    }
}

/// Bring every pack path in `config` to its on-disk form. Returns whether
/// anything changed, so a config written before 0.2.9 (absolute paths) is
/// rewritten once and then left alone.
pub(crate) fn normalize_pack_paths(config: &mut Config, packs_dir: &Path) -> bool {
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
pub(crate) fn with_resolved_pack_paths(mut config: Config, packs_dir: &Path) -> Config {
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
pub(crate) fn new_pack_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
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
    // An existing file is taken unless it is this pack's own, unclaimed
    let adoptable = |path: &Path| {
        !claimed.iter().any(|c| Path::new(c) == path)
            && pack_file_name(path).as_deref() == Some(name)
    };
    let path = first_free(
        |i| match i {
            1 => dir.join(format!("{base}.json")),
            i => dir.join(format!("{base}-{i}.json")),
        },
        |p| p.exists() && !adoptable(p),
    );
    let adopted = path.exists();
    (path, adopted)
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
pub(crate) fn ensure_packs_backed(app: &AppHandle) {
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
pub(crate) fn sync_pack_files(app: &AppHandle) {
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

// ---- Pack metadata: intent-level, like the snippet edits above. The manager
// used to hand back its whole pack list (`save_packs`), and a list that had
// gone stale retired and re-created pack files: a pack empty in the library
// saw its real content move to packs/deleted/ and a fresh empty file take
// its place. Each command here is one read-modify-write under the store
// lock and answers with the registry as the frontend sees it.

/// What every pack command answers with: the registry after the sync that
/// follows every write (it may have just backed a pack that got its
/// metadata here), with paths resolved the way `get_config` returns them.
pub(crate) fn packs_after_sync(app: &AppHandle) -> Result<Vec<PackMeta>, String> {
    sync_pack_files(app);
    Ok(with_resolved_pack_paths(load_config_from_disk(app)?, &packs_dir(app)).packs)
}

/// The name a new or renamed pack may not take: one that reads as an
/// existing pack's. Names differing only by case would show as one pack
/// (and share a file name on Windows), so they count as taken — except
/// `except`, the pack's own current name, which a case-only rename
/// ("general" to "General") is allowed to keep. Returns the existing name.
fn pack_name_taken(
    config: &Config,
    snippets: &[Snippet],
    name: &str,
    except: Option<&str>,
) -> Option<String> {
    config
        .packs
        .iter()
        .map(|p| p.name.as_str())
        .chain(snippets.iter().map(|s| s.pack.as_str()))
        .find(|n| Some(*n) != except && n.eq_ignore_ascii_case(name))
        .map(str::to_owned)
}

/// A name is usable for a new pack, or for renaming `except` to it.
pub(crate) fn validate_pack_name(
    config: &Config,
    snippets: &[Snippet],
    name: &str,
    except: Option<&str>,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("A pack needs a name".into());
    }
    match pack_name_taken(config, snippets, name, except) {
        Some(existing) => Err(format!("Pack \"{existing}\" already exists")),
        None => Ok(()),
    }
}

/// Lock or unlock a pack. A pack that exists only as a name on prompts
/// gets its metadata here (a file follows on the next sync), the way
/// `rename_pack_in` gives it one.
pub(crate) fn set_pack_locked_in(config: &mut Config, name: &str, locked: bool) {
    match config.packs.iter_mut().find(|p| p.name == name) {
        Some(p) => p.locked = locked,
        None => config.packs.push(PackMeta {
            name: name.into(),
            locked,
            path: String::new(),
        }),
    }
}

/// Drop a pack's metadata; the stored path of its file, for retiring.
pub(crate) fn remove_pack_in(config: &mut Config, name: &str) -> Option<String> {
    let at = config.packs.iter().position(|p| p.name == name)?;
    Some(config.packs.remove(at).path)
}

/// Record `path` as a pack's file, giving the pack metadata if it was only
/// a name on prompts.
pub(crate) fn back_pack_in(config: &mut Config, name: &str, path: String) {
    match config.packs.iter_mut().find(|p| p.name == name) {
        Some(p) => p.path = path,
        None => config.packs.push(PackMeta {
            name: name.into(),
            locked: false,
            path,
        }),
    }
}

/// Move a deleted pack's file into packs/deleted/ rather than unlinking it. The
/// file can hold prompts an agent wrote that were never imported — the same
/// content sync_pack_files refuses to clobber — so deleting a pack in the app
/// must not be able to destroy them.
pub(crate) fn retire_pack_file(app: &AppHandle, src: &Path) {
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
    let dest = first_free(
        |i| match i {
            1 => deleted_dir.join(format!("{stem}.json")),
            i => deleted_dir.join(format!("{stem}-{i}.json")),
        },
        |p| p.exists(),
    );
    fs::rename(src, &dest)?;
    Ok(Some(dest))
}

/// Put the registry in the order the user dragged the packs into. `names`
/// is the list as the manager drew it; a pack it doesn't name (one the
/// popup created meanwhile) keeps its place relative to the others at the
/// end, and a name without metadata is skipped rather than declared: an
/// empty draft's pack is listed but not yet real (`packs_in_play`). Locks
/// and files are untouched; only the order and `packs_arranged` change.
pub(crate) fn arrange_packs_in(config: &mut Config, names: &[String]) {
    let mut rest = std::mem::take(&mut config.packs);
    for name in names {
        if let Some(at) = rest.iter().position(|p| &p.name == name) {
            config.packs.push(rest.remove(at));
        }
    }
    config.packs.append(&mut rest);
    config.packs_arranged = true;
}

/// Rename a pack on its metadata and on every prompt in one step. Done in
/// two frontend writes, `ensure_packs_backed` ran in between and saw prompts
/// still carrying the old name (or already carrying the new one) and
/// conjured a second pack for it.
pub(crate) fn rename_pack_in(
    config: &mut Config,
    snippets: &mut [Snippet],
    from: &str,
    to: &str,
) -> Result<(), String> {
    if from == to {
        return Ok(());
    }
    // The pack's own name is not taken: a case-only rename ("general" to
    // "General") keeps it
    validate_pack_name(config, snippets, to, Some(from))?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::snip;
    use crate::testing::{sample, temp_dir};

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
    fn locking_a_pack_finds_its_metadata_or_makes_it() {
        let mut config = Config::default();
        config.packs.push(PackMeta {
            name: "Work".into(),
            locked: false,
            path: "work.json".into(),
        });
        set_pack_locked_in(&mut config, "Work", true);
        assert!(config.packs[0].locked);
        assert_eq!(config.packs[0].path, "work.json", "the file is kept");
        set_pack_locked_in(&mut config, "Work", false);
        assert!(!config.packs[0].locked);
        // A pack that was only a name on prompts gets metadata; the next
        // sync gives it a file
        set_pack_locked_in(&mut config, "Nameless", true);
        assert_eq!(config.packs.len(), 2);
        assert!(config.packs[1].locked && config.packs[1].path.is_empty());
    }

    #[test]
    fn removing_a_pack_drops_its_metadata_and_names_the_file_to_retire() {
        let mut config = Config::default();
        config.packs.push(PackMeta {
            name: "Work".into(),
            locked: true,
            path: "work.json".into(),
        });
        config.packs.push(PackMeta {
            name: "Unbacked".into(),
            locked: false,
            path: String::new(),
        });
        assert_eq!(
            remove_pack_in(&mut config, "Work"),
            Some("work.json".into())
        );
        assert_eq!(remove_pack_in(&mut config, "Unbacked"), Some(String::new()));
        assert!(config.packs.is_empty());
        // Nothing to drop for a pack that never had metadata
        assert_eq!(remove_pack_in(&mut config, "Ghost"), None);
    }

    #[test]
    fn a_new_pack_name_is_refused_when_it_reads_as_an_existing_one() {
        let mut config = Config::default();
        config.packs.push(PackMeta {
            name: "General".into(),
            locked: false,
            path: String::new(),
        });
        let mut s = snip("A", "", "x");
        s.pack = "Other".into();
        let snippets = vec![s];
        // Declared or only named on a prompt, in any case: taken, and the
        // error names the pack as it exists
        assert_eq!(
            validate_pack_name(&config, &snippets, "general", None).unwrap_err(),
            "Pack \"General\" already exists"
        );
        assert_eq!(
            validate_pack_name(&config, &snippets, "OTHER", None).unwrap_err(),
            "Pack \"Other\" already exists"
        );
        assert!(validate_pack_name(&config, &snippets, "  ", None).is_err());
        assert!(validate_pack_name(&config, &snippets, "Fresh", None).is_ok());
        // Renaming a pack onto its own case variant is allowed
        assert!(validate_pack_name(&config, &snippets, "GENERAL", Some("General")).is_ok());
        assert!(validate_pack_name(&config, &snippets, "general", Some("Other")).is_err());
    }

    #[test]
    fn backing_a_pack_records_the_file_on_new_or_existing_metadata() {
        let mut config = Config::default();
        config.packs.push(PackMeta {
            name: "Work".into(),
            locked: true,
            path: String::new(),
        });
        back_pack_in(&mut config, "Work", "work.json".into());
        assert_eq!(config.packs[0].path, "work.json");
        assert!(config.packs[0].locked, "the lock is kept");
        back_pack_in(&mut config, "Nameless", "nameless.json".into());
        assert_eq!(config.packs.len(), 2);
        assert_eq!(config.packs[1].name, "Nameless");
        assert_eq!(config.packs[1].path, "nameless.json");
        assert!(!config.packs[1].locked);
    }

    #[test]
    fn arranging_packs_reorders_the_registry_and_keeps_the_rest() {
        let meta = |name: &str, locked: bool| PackMeta {
            name: name.into(),
            locked,
            path: format!("{}.json", name.to_lowercase()),
        };
        let mut config = Config {
            packs: vec![
                meta("A", false),
                meta("B", true),
                meta("C", false),
                meta("New", false),
            ],
            ..Config::default()
        };
        assert!(!config.packs_arranged);
        // "New" was added by the other window after the manager drew the
        // list; "Draft" is listed there but has no metadata yet
        let names: Vec<String> = ["C", "Draft", "A", "B"].map(String::from).into();
        arrange_packs_in(&mut config, &names);
        let order: Vec<&str> = config.packs.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(order, ["C", "A", "B", "New"]);
        assert!(config.packs_arranged);
        assert!(config.packs[2].locked, "the lock moves with its pack");
        assert_eq!(config.packs[0].path, "c.json", "and so does the file");
    }
}
