//! The paste pipeline: `show_popup` records the window to paste into and
//! places the popup, `paste_snippet` writes the clipboard and sends Ctrl+V
//! from a detached thread, and the popup's hide paths persist its size.
//! The two commands here are the pipeline's own; the rest are in
//! `commands.rs`.

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State};

use crate::commands::notify_manager_snippets_changed;
use crate::store::{load_config_from_disk, load_snippets_from_disk, save_config, write_snippets};
use crate::{platform, AppState};

// Starting a border-resize drag steals focus from the webview, which would
// trigger the hide-on-blur handler and close the popup mid-resize. Detect it:
// left button held with the cursor on (or just outside) the popup frame.
pub(crate) fn is_resize_drag(window: &tauri::Window) -> bool {
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
pub(crate) fn persist_popup_size(app: &AppHandle) {
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
pub(crate) fn hide_popup(app: AppHandle, state: State<AppState>) {
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
pub(crate) fn paste_snippet(
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

pub(crate) fn show_popup(app: &AppHandle) {
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

    // First-run: record that the user found the hotkey, tell the manager.
    // The flag is cached in AppState (read once at startup), so config.json
    // is not parsed on every hotkey press to find out
    if !state.popup_seen.swap(true, Ordering::Relaxed) {
        let _guard = state.store.lock().unwrap();
        if let Ok(mut config) = load_config_from_disk(app) {
            config.popup_seen = true;
            if let Err(e) = save_config(app, &config) {
                log::warn!("couldn't record the first popup: {e}");
            }
        }
        let _ = app.emit("first-popup", ());
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
