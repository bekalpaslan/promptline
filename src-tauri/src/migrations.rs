//! What older installs carry over: the v1 EasyPaste folder, the
//! pre-0.2.9 data folder and its absolute pack paths, and the v2 snippet
//! shape. Old data must keep opening.

use std::fs;
use std::path::Path;

use tauri::AppHandle;

use crate::store::{
    data_dir, default_snippets, notify, write_atomic, write_snippets, Config, Snippet,
};

/// One-time migration from the v1 EasyPaste data directory: keep user-created
/// snippets (dropping the v1 samples) and merge in the new starter pack.
/// 0.2.9 changed the bundle identifier from `com.promptline.app` (a domain
/// the project never owned) to `io.github.bekalpaslan.promptline`, which
/// moves the data folder. Everything under the old folder is moved into
/// the new one before anything else reads it; a failure is a notice, and
/// the library stays where it was.
pub(crate) fn migrate_data_dir(app: &AppHandle) {
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
}
