//! The update check: `Config`'s switch, and the five commands the manager
//! calls to read its state, check by hand, install, or dismiss an offer.
//! The GitHub build fetches one fixed URL (`plugins.updater.endpoints` in
//! `tauri.conf.json`) through `tauri-plugin-updater`, which also verifies
//! the signature before anything installs; the startup + daily loop that
//! runs this on its own and offers it in the tray follows in a later
//! commit. A store build (`--no-default-features`) compiles the network
//! half out entirely — no plugin, no request — and answers
//! `supported: false`, so the manager shows no update controls.

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::store::{load_config_from_disk, save_config};
use crate::AppState;

/// The AUMID and the bundle identifier (`tauri.conf.json`'s `identifier`):
/// the toast is shown under this id, and the Start Menu shortcut the
/// installer made carries the same one, so the process, its windows and
/// its toasts are one app to Windows.
pub(crate) const APP_ID: &str = "io.github.bekalpaslan.promptline";

/// What the manager shows in the offer: the version found and its release
/// notes (the same ones on the GitHub release).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct UpdateInfo {
    pub(crate) version: String,
    pub(crate) notes: String,
}

/// What Settings' About card and the offer dialog need: whether this build
/// can update at all, whether the daily check is on, and what it last found.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateState {
    pub(crate) supported: bool,
    pub(crate) auto_check: bool,
    pub(crate) available: Option<UpdateInfo>,
}

#[tauri::command]
pub(crate) fn get_update_state(app: AppHandle) -> Result<UpdateState, String> {
    let state = app.state::<AppState>();
    let _guard = state.store.lock().unwrap();
    let config = load_config_from_disk(&app)?;
    Ok(UpdateState {
        supported: imp::SUPPORTED,
        auto_check: config.update_check,
        available: imp::pending_info(&app),
    })
}

#[tauri::command]
pub(crate) fn set_update_check(app: AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _guard = state.store.lock().unwrap();
    let mut config = load_config_from_disk(&app)?;
    config.update_check = enabled;
    save_config(&app, &config)
}

/// Later (D-07): silence the toast for this version only. The tray item and
/// the About card keep offering it; a newer version notifies again.
#[tauri::command]
pub(crate) fn dismiss_update(app: AppHandle, version: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _guard = state.store.lock().unwrap();
    let mut config = load_config_from_disk(&app)?;
    config.update_notified = version;
    save_config(&app, &config)
}

#[tauri::command]
pub(crate) async fn check_for_updates(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    imp::check_by_hand(&app).await
}

#[tauri::command]
pub(crate) async fn install_update(app: AppHandle) -> Result<(), String> {
    imp::install(&app).await
}

#[cfg(feature = "updater")]
mod imp {
    use std::sync::Mutex;
    use std::time::SystemTime;

    use tauri::{AppHandle, Emitter, Manager};
    use tauri_plugin_updater::UpdaterExt;

    use crate::store::{load_config_from_disk, save_config};
    use crate::AppState;

    use super::UpdateInfo;

    pub(crate) const SUPPORTED: bool = true;

    /// The update the plugin found, held so `install` doesn't have to check
    /// again: a second network round trip right before installing would
    /// only add a place for the check to disagree with itself.
    #[derive(Default)]
    pub(crate) struct UpdateSlot {
        pending: Mutex<Option<tauri_plugin_updater::Update>>,
    }

    pub(crate) fn pending_info(app: &AppHandle) -> Option<UpdateInfo> {
        let slot = app.try_state::<UpdateSlot>()?;
        let pending = slot.pending.lock().unwrap();
        pending.as_ref().map(|u| UpdateInfo {
            version: u.version.clone(),
            notes: u.body.clone().unwrap_or_default(),
        })
    }

    /// A version notifies once: `found` is announced only when it differs
    /// from the last one the user was told about (shown, dismissed, or
    /// found by hand). A newer version after that one notifies again.
    pub(crate) fn should_notify(found: &str, notified: &str) -> bool {
        found != notified
    }

    /// Due for a check: never checked before, or at least a day of
    /// wall-clock time has passed since `last`. A clock moved backwards
    /// makes `duration_since` fail, which is also treated as due — waiting
    /// out a full day again over a clock change would be the wrong kind of
    /// patient.
    pub(crate) fn due(last: Option<SystemTime>, now: SystemTime) -> bool {
        const DAY: std::time::Duration = std::time::Duration::from_secs(24 * 3600);
        match last {
            None => true,
            Some(t) => match now.duration_since(t) {
                Ok(elapsed) => elapsed >= DAY,
                Err(_) => true,
            },
        }
    }

    pub(crate) async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
        let update = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?;
        let Some(update) = update else {
            return Ok(None);
        };
        let info = UpdateInfo {
            version: update.version.clone(),
            notes: update.body.clone().unwrap_or_default(),
        };
        if let Some(slot) = app.try_state::<UpdateSlot>() {
            *slot.pending.lock().unwrap() = Some(update);
        }
        let _ = app.emit("update-available", &info);
        Ok(Some(info))
    }

    /// The manual button (Settings' About card): unlike the automatic loop
    /// it marks the version notified regardless, since the user has now
    /// seen it here.
    pub(crate) async fn check_by_hand(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
        let result = check(app).await;
        if let Err(e) = &result {
            log::warn!("update check failed: {e}");
        }
        if let Ok(Some(info)) = &result {
            let state = app.state::<AppState>();
            let _guard = state.store.lock().unwrap();
            if let Ok(mut config) = load_config_from_disk(app) {
                config.update_notified = info.version.clone();
                let _ = save_config(app, &config);
            }
        }
        result
    }

    pub(crate) async fn install(app: &AppHandle) -> Result<(), String> {
        let update = app
            .try_state::<UpdateSlot>()
            .and_then(|slot| slot.pending.lock().unwrap().take())
            .ok_or_else(|| "No update is waiting".to_string())?;
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        // On Windows the plugin exits the process before this returns; the
        // installer's passive mode relaunches Promptline itself (D-08). This
        // covers the platforms where it doesn't.
        app.restart()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn a_version_notifies_once_and_a_newer_one_notifies_again() {
            assert!(should_notify("0.2.18", ""));
            assert!(!should_notify("0.2.18", "0.2.18"));
            assert!(should_notify("0.2.19", "0.2.18"));
        }

        #[test]
        fn the_daily_check_is_due_on_first_run_and_after_a_day() {
            let now = SystemTime::now();
            assert!(due(None, now));
            assert!(!due(
                Some(now - std::time::Duration::from_secs(23 * 3600)),
                now
            ));
            assert!(due(
                Some(now - std::time::Duration::from_secs(24 * 3600)),
                now
            ));
            // A clock moved back makes `duration_since` fail; treated as due
            // rather than waiting out a full day again
            assert!(due(Some(now + std::time::Duration::from_secs(3600)), now));
        }

        #[test]
        fn the_app_id_matches_the_bundle_identifier() {
            let conf: serde_json::Value =
                serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
            assert_eq!(conf["identifier"].as_str().unwrap(), super::super::APP_ID);
        }
    }
}

#[cfg(not(feature = "updater"))]
mod imp {
    use tauri::AppHandle;

    use super::UpdateInfo;

    pub(crate) const SUPPORTED: bool = false;

    pub(crate) fn pending_info(_app: &AppHandle) -> Option<UpdateInfo> {
        None
    }

    pub(crate) async fn check_by_hand(_app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
        Err("This copy is updated by the store".into())
    }

    pub(crate) async fn install(_app: &AppHandle) -> Result<(), String> {
        Err("This copy is updated by the store".into())
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn a_store_build_reports_unsupported() {
            assert!(!super::SUPPORTED);
        }
    }
}
