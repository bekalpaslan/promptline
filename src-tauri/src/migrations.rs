//! What older installs carry over: the v1 EasyPaste folder, the
//! pre-0.2.9 data folder and its absolute pack paths, the v2 snippet
//! shape, and the hotkey default that changed after 0.2.16. Old data must
//! keep opening.

use std::fs;
use std::path::Path;

use tauri::AppHandle;

use crate::store::{
    data_dir, default_snippets, notify, write_atomic, write_snippets, Config, Snippet,
};

/// The default of every release up to 0.2.16. An install from then that
/// never recorded a hotkey keeps it; only a genuinely fresh install takes
/// the new default in `store::default_hotkey`.
pub(crate) const LEGACY_HOTKEY: &str = "ctrl+shift+v";

/// True only for a data folder with no earlier evidence of a run: no
/// `config.json`, no `snippets.json`, and no pack file under `packs/`. The
/// log file does not count — the log plugin creates it before this runs.
///
/// Fails toward "existing": a lock or permission error while looking is not
/// evidence of absence. Wrongly calling an existing install fresh moves its
/// hotkey for good; wrongly calling a fresh one existing only costs it
/// Ctrl+Shift+V. Only a plain "not found" counts as nothing there.
pub(crate) fn is_fresh_install(dir: &Path) -> bool {
    for name in ["config.json", "snippets.json"] {
        if !matches!(dir.join(name).try_exists(), Ok(false)) {
            return false;
        }
    }
    match fs::read_dir(dir.join("packs")) {
        Ok(entries) => !entries.flatten().any(|e| {
            e.path()
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        }),
        Err(e) => e.kind() == std::io::ErrorKind::NotFound,
    }
}

/// Pin `LEGACY_HOTKEY` into `dir`'s config.json when it exists but lacks a
/// `hotkey` key, or write a config holding it when there is no library
/// config yet. Returns whether the file changed; only reached for an
/// existing install (the caller checks `is_fresh_install` first).
fn pin_legacy_hotkey(dir: &Path) -> std::io::Result<bool> {
    let path = dir.join("config.json");
    match fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(serde_json::Value::Object(mut map)) if !map.contains_key("hotkey") => {
                map.insert(
                    "hotkey".into(),
                    serde_json::Value::String(LEGACY_HOTKEY.into()),
                );
                let bytes = serde_json::to_vec_pretty(&serde_json::Value::Object(map))
                    .map_err(std::io::Error::other)?;
                write_atomic(&path, &bytes)?;
                Ok(true)
            }
            // Key present, not an object, or not JSON: leave it (the
            // typed parse and quarantine still apply later)
            _ => Ok(false),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let bytes = serde_json::to_vec_pretty(&Config {
                hotkey: LEGACY_HOTKEY.into(),
                ..Config::default()
            })
            .map_err(std::io::Error::other)?;
            write_atomic(&path, &bytes)?;
            Ok(true)
        }
        Err(e) => Err(e),
    }
}

/// The hotkey decision for the data folder at `dir`. True when startup may
/// go on to write config.json: a fresh install, or an existing one whose
/// hotkey is now recorded. False when an existing install could not be
/// pinned (config.json held or read-only), which the caller must treat as
/// "leave config.json alone this launch": a later save would otherwise
/// write the new default into it.
fn settle_in(dir: &Path) -> bool {
    if is_fresh_install(dir) {
        return true;
    }
    match pin_legacy_hotkey(dir) {
        Ok(_) => true,
        Err(e) => {
            log::warn!("couldn't pin the old default hotkey into config.json: {e}");
            false
        }
    }
}

/// Runs after the folder moves and before `ensure_packs_backed`, whose
/// first save would otherwise write the new default into an install that
/// never chose one. `data_moved` is `migrate_data_dir`'s result: after a
/// failed move the new folder is empty and looks fresh, but the library
/// and its hotkey are still in the old one, and writing a config.json
/// here would stop the next launch's move from carrying the old one over.
///
/// Returns whether startup may go on to save config.json. When it returns
/// false, skip `ensure_packs_backed` for this launch and register
/// `session_hotkey` instead of the loaded config's.
pub(crate) fn settle_default_hotkey(app: &AppHandle, data_moved: bool) -> bool {
    if !data_moved {
        log::warn!("the data folder move failed; leaving config.json alone this launch");
        return false;
    }
    settle_in(&data_dir(app))
}

/// The hotkey to register for a launch whose pin failed: the one
/// config.json records when it can still be read, else the old default.
/// Never the serde default, which is for fresh installs.
pub(crate) fn session_hotkey(app: &AppHandle) -> String {
    recorded_hotkey(&data_dir(app)).unwrap_or_else(|| LEGACY_HOTKEY.into())
}

fn recorded_hotkey(dir: &Path) -> Option<String> {
    let text = fs::read_to_string(dir.join("config.json")).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&text).ok()?;
    value.get("hotkey")?.as_str().map(str::to_owned)
}

/// One-time migration from the v1 EasyPaste data directory: keep user-created
/// snippets (dropping the v1 samples) and merge in the new starter pack.
/// 0.2.9 changed the bundle identifier from `com.promptline.app` (a domain
/// the project never owned) to `io.github.bekalpaslan.promptline`, which
/// moves the data folder. Everything under the old folder is moved into
/// the new one before anything else reads it; a failure is a notice, and
/// the library stays where it was. Returns false for that failure, so the
/// hotkey decision can treat the install as an existing one.
pub(crate) fn migrate_data_dir(app: &AppHandle) -> bool {
    let new_dir = data_dir(app);
    let Some(parent) = new_dir.parent() else {
        return true;
    };
    let old_dir = parent.join("com.promptline.app");
    if !old_dir.is_dir() {
        return true;
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
        return false;
    }
    true
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

pub(crate) fn migrate_v1_data(app: &AppHandle) {
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

// Migrate older on-disk formats: v2 category becomes the first tag,
// packless prompts get default packs. Pure, so it's unit-testable.
pub(crate) fn apply_snippet_migrations(snippets: &mut [Snippet]) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packs::{resolve_pack_path, PackMeta};
    use crate::testing::temp_dir;

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
    fn an_empty_data_folder_is_a_fresh_install() {
        let dir = temp_dir("fresh-install");
        fs::create_dir_all(dir.join("packs")).unwrap();
        fs::write(dir.join("promptline.log"), "started\n").unwrap();

        assert!(is_fresh_install(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn any_earlier_file_marks_an_existing_install() {
        let snippets_dir = temp_dir("existing-snippets");
        fs::write(snippets_dir.join("snippets.json"), "[]").unwrap();
        assert!(!is_fresh_install(&snippets_dir));
        let _ = fs::remove_dir_all(&snippets_dir);

        let config_dir = temp_dir("existing-config");
        fs::write(config_dir.join("config.json"), "{}").unwrap();
        assert!(!is_fresh_install(&config_dir));
        let _ = fs::remove_dir_all(&config_dir);

        let pack_dir = temp_dir("existing-pack");
        fs::create_dir_all(pack_dir.join("packs")).unwrap();
        fs::write(pack_dir.join("packs").join("work.json"), "{}").unwrap();
        assert!(!is_fresh_install(&pack_dir));
        let _ = fs::remove_dir_all(&pack_dir);
    }

    #[test]
    fn a_library_without_a_config_keeps_ctrl_shift_v() {
        let dir = temp_dir("library-no-config");
        fs::write(dir.join("snippets.json"), "[]").unwrap();

        assert!(pin_legacy_hotkey(&dir).unwrap());
        let config: Config =
            serde_json::from_str(&fs::read_to_string(dir.join("config.json")).unwrap()).unwrap();
        assert_eq!(config.hotkey, "ctrl+shift+v");

        assert!(!pin_legacy_hotkey(&dir).unwrap());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_config_without_a_hotkey_is_pinned_and_keeps_the_rest() {
        let dir = temp_dir("config-no-hotkey");
        fs::write(
            dir.join("config.json"),
            r#"{"packs": [{"name": "Work", "locked": true}], "theme": "light"}"#,
        )
        .unwrap();

        assert!(pin_legacy_hotkey(&dir).unwrap());
        let config: Config =
            serde_json::from_str(&fs::read_to_string(dir.join("config.json")).unwrap()).unwrap();
        assert_eq!(config.hotkey, "ctrl+shift+v");
        assert_eq!(config.packs.len(), 1);
        assert!(config.packs[0].locked);
        assert_eq!(config.theme, "light");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_recorded_hotkey_is_never_touched() {
        for existing in [
            r#"{"hotkey": "ctrl+alt+space"}"#,
            r#"{"hotkey": "ctrl+shift+v"}"#,
        ] {
            let dir = temp_dir("recorded-hotkey");
            fs::write(dir.join("config.json"), existing).unwrap();

            assert!(!pin_legacy_hotkey(&dir).unwrap());
            assert_eq!(
                fs::read_to_string(dir.join("config.json")).unwrap(),
                existing
            );
            let _ = fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn an_unreadable_config_is_left_for_the_quarantine() {
        let dir = temp_dir("truncated-config");
        let truncated = r#"{"hotkey": "#;
        fs::write(dir.join("config.json"), truncated).unwrap();

        assert!(!pin_legacy_hotkey(&dir).unwrap());
        assert_eq!(
            fs::read_to_string(dir.join("config.json")).unwrap(),
            truncated
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wr02_a_packs_folder_that_cannot_be_listed_is_not_a_fresh_install() {
        // read_dir fails with something other than NotFound (here: packs is
        // a file); "unsure" must count as an existing install
        let dir = temp_dir("wr02-unlistable-packs");
        fs::write(dir.join("packs"), "not a folder").unwrap();
        assert!(!is_fresh_install(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wr02_a_config_that_cannot_be_checked_is_not_a_fresh_install() {
        // A directory where config.json should be: it exists, whatever it is
        let dir = temp_dir("wr02-odd-config");
        fs::create_dir_all(dir.join("config.json")).unwrap();
        assert!(!is_fresh_install(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wr02_a_pack_file_counts_whatever_the_case_of_its_extension() {
        let dir = temp_dir("wr02-upper-extension");
        fs::create_dir_all(dir.join("packs")).unwrap();
        fs::write(dir.join("packs").join("work.JSON"), "{}").unwrap();
        assert!(!is_fresh_install(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wr02_a_folder_with_only_other_files_in_packs_is_still_fresh() {
        let dir = temp_dir("wr02-packs-notes");
        fs::create_dir_all(dir.join("packs")).unwrap();
        fs::write(dir.join("packs").join("notes.txt"), "x").unwrap();
        assert!(is_fresh_install(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wr01_a_fresh_install_may_write_its_config_and_nothing_is_pinned() {
        let dir = temp_dir("wr01-fresh");
        assert!(settle_in(&dir));
        assert!(!dir.join("config.json").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wr01_an_existing_install_is_pinned_and_may_go_on() {
        let dir = temp_dir("wr01-existing");
        fs::write(dir.join("snippets.json"), "[]").unwrap();
        assert!(settle_in(&dir));
        assert_eq!(recorded_hotkey(&dir).as_deref(), Some("ctrl+shift+v"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wr01_a_failed_pin_tells_startup_to_leave_config_alone() {
        // A directory where config.json should be makes the read fail with
        // something other than NotFound, the way a held file does
        let dir = temp_dir("wr01-unpinnable");
        fs::write(dir.join("snippets.json"), "[]").unwrap();
        fs::create_dir_all(dir.join("config.json")).unwrap();

        assert!(!settle_in(&dir));
        assert!(dir.join("config.json").is_dir(), "nothing was written");
        // And no recorded hotkey means the session runs on the old default
        assert_eq!(recorded_hotkey(&dir), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wr01_the_session_hotkey_is_the_recorded_one_when_it_can_be_read() {
        let dir = temp_dir("wr01-recorded");
        fs::write(dir.join("config.json"), r#"{"hotkey": "ctrl+alt+space"}"#).unwrap();
        assert_eq!(recorded_hotkey(&dir).as_deref(), Some("ctrl+alt+space"));

        fs::write(dir.join("config.json"), r#"{"theme": "light"}"#).unwrap();
        assert_eq!(recorded_hotkey(&dir), None);
        fs::write(dir.join("config.json"), "{ truncated").unwrap();
        assert_eq!(recorded_hotkey(&dir), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
