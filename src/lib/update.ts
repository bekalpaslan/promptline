// The manager's side of update.rs: Rust makes the one request (a GitHub
// build checks https://promptline.cc/latest.json once at startup, then
// daily), never the webview, so the CSP's connect-src stays the IPC only.
// See `UpdateInfo` / `UpdateState` in update.rs for the Rust shapes these
// mirror, and `update-available` / `update-offer` for the events it emits.
import { invoke } from "@tauri-apps/api/core"

export interface UpdateInfo {
  version: string
  notes: string
}

/** What Settings' About card and the offer dialog need; see `UpdateState` in update.rs */
export interface UpdateState {
  supported: boolean
  autoCheck: boolean
  available: UpdateInfo | null
}

/** A check (automatic or by hand) found a newer version */
export const UPDATE_AVAILABLE = "update-available"
/** The toast or the tray item was clicked: open the manager's offer */
export const UPDATE_OFFER = "update-offer"

export const getUpdateState = () => invoke<UpdateState>("get_update_state")
export const setUpdateCheck = (enabled: boolean) => invoke<void>("set_update_check", { enabled })
export const checkForUpdates = () => invoke<UpdateInfo | null>("check_for_updates")
export const installUpdate = () => invoke<void>("install_update")
export const dismissUpdate = (version: string) => invoke<void>("dismiss_update", { version })
