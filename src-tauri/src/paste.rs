//! The paste pipeline: `on_hotkey` answers the global hotkey (a summon, a
//! re-focus, or a hide on the second tap), `show_popup` records the window
//! to paste into and places the popup, `paste_snippet` writes the clipboard
//! and sends Ctrl+V from a detached thread, and the popup's hide paths
//! persist its size. The two commands here are the pipeline's own; the
//! rest are in `commands.rs`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State};

use crate::commands::notify_manager_snippets_changed;
use crate::platform::{ClipboardMarks, InputBlock};
use crate::store::{
    config_frozen, load_config_from_disk, load_snippets_from_disk, save_config, write_snippets,
};
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
    // Every hide comes through here; a launch that can't save says so once
    // at startup, not once per hide
    if config_frozen(app) {
        return;
    }
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
pub(crate) fn hide_popup(app: AppHandle) {
    dismiss_popup(&app);
}

/// Hide the popup on purpose: Esc and a copy's confirmation (the
/// `hide_popup` command) and the hotkey's second tap (`on_hotkey`) all
/// come through here.
pub(crate) fn dismiss_popup(app: &AppHandle) {
    let state = app.state::<AppState>();
    // Every way the popup is closed on purpose ends Keep open
    state.keep_open.store(false, Ordering::SeqCst);
    {
        let _guard = state.store.lock().unwrap();
        persist_popup_size(app);
    }
    // Hidden with the store lock released: hiding fires Focused(false), whose
    // handler takes the same lock. That the event arrives asynchronously is
    // what kept this from deadlocking; it is not something to rely on.
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.hide();
    }
}

// Whether the hotkey's key has come up since the popup was last summoned.
// `global-hotkey` registers with MOD_NOREPEAT, so Windows sends no repeat
// notifications while the keys stay down; this is the second line, for a
// press that arrives without a release before it. Written from the plugin's
// Released event, which `global-hotkey` derives by polling GetAsyncKeyState
// on a thread of its own, so an atomic rather than a field behind
// AppState's mutexes.
static HOTKEY_RELEASED: AtomicBool = AtomicBool::new(false);

/// The hotkey's key came up (`ShortcutState::Released`): the next press is
/// a deliberate tap, not a key held down. Called on the plugin's polling
/// thread; it touches no window.
pub(crate) fn note_hotkey_released() {
    HOTKEY_RELEASED.store(true, Ordering::SeqCst);
}

/// What a hotkey press does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HotkeyAction {
    /// The popup is hidden: summon it
    Show,
    /// The popup is up but the key never came up since the summon (a held
    /// key), or the popup is not in front (kept open beside the work):
    /// bring it to the front
    Focus,
    /// The popup is up, in front, and its key was released since the
    /// summon: a second tap puts it away
    Hide,
}

/// `visible`: the popup is shown; `focused`: it is the foreground window;
/// `released`: the hotkey's key came up since the last summon.
fn hotkey_action(visible: bool, focused: bool, released: bool) -> HotkeyAction {
    if !visible {
        HotkeyAction::Show
    } else if focused && released {
        HotkeyAction::Hide
    } else {
        HotkeyAction::Focus
    }
}

/// The global hotkey was pressed (`ShortcutState::Pressed`, on the main
/// thread): summon the popup, bring it to the front, or hide it, by
/// `hotkey_action`. Hiding takes the same path as Esc (`dismiss_popup`),
/// so Keep open ends and the size is persisted with the store lock
/// released before the window hides. Never records `prev_window`: only a
/// real summon (`show_popup`) does.
pub(crate) fn on_hotkey(app: &AppHandle) {
    let Some(w) = app.get_webview_window("popup") else {
        return;
    };
    let visible = w.is_visible().unwrap_or(false);
    // The foreground window rather than tao's focus bookkeeping: the
    // webview child holds the keyboard focus, GetForegroundWindow answers
    // with the top-level window either way
    let hwnd = w.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    let focused = hwnd != 0 && platform::foreground_window() == hwnd;
    let released = HOTKEY_RELEASED.load(Ordering::SeqCst);
    match hotkey_action(visible, focused, released) {
        HotkeyAction::Show => show_popup(app),
        HotkeyAction::Focus => {
            let _ = w.set_focus();
        }
        HotkeyAction::Hide => dismiss_popup(app),
    }
}

/// The popup's Keep open toggle (Ctrl+K, or its button): while on, the popup
/// stays up when it loses focus and after a paste, and pastes into the last
/// window outside Promptline. Answers the state it set.
#[tauri::command]
pub(crate) fn set_keep_open(state: State<AppState>, on: bool) -> bool {
    state.keep_open.store(on, Ordering::SeqCst);
    on
}

/// The window a paste goes to: the one the popup was summoned over, or,
/// kept open, the last one outside Promptline the user was in (falling back
/// to the summon's when none has come to the front since).
fn paste_window(keep_open: bool, summoned_over: isize, last_foreign: isize) -> isize {
    if keep_open && last_foreign != 0 {
        last_foreign
    } else {
        summoned_over
    }
}

/// Copy `text` to the clipboard (expanding `{clipboard}` from its current
/// contents, and keeping it out of Win+V history and the cloud clipboard
/// when those contents were marked so; see `marks_to_write`); if `paste`
/// is set and there is a window to paste into, refocus it and send Ctrl+V.
/// The prompt stays on the clipboard afterwards (see the note in the body
/// and BEHAVIOR.md). Bumps the snippet's use count. Returns
/// `"pasted"` when the paste thread was spawned and `"copied"` when it fell
/// back to copy-only (asked for, or no target), so the popup can say so.
/// `auto_enter`: press Enter after the Ctrl+V landed (a prompt set to Auto
/// enter); never on a copy.
#[tauri::command]
pub(crate) fn paste_snippet(
    app: AppHandle,
    state: State<AppState>,
    text: String,
    paste: bool,
    id: Option<String>,
    auto_enter: Option<bool>,
) -> Result<String, String> {
    let auto_enter = auto_enter.unwrap_or(false);
    let guard = state.store.lock().unwrap();
    let keep_open = state.keep_open.load(Ordering::SeqCst);
    let prev_window = paste_window(
        keep_open,
        *state.prev_window.lock().unwrap(),
        platform::last_foreign_window(),
    );
    let mode = paste_mode(paste, prev_window);
    // The marks are read only when the clipboard goes into the prompt: a
    // prompt without the token carries none of it and is written plainly
    let uses_clipboard = text.contains("{clipboard}");
    let (prev_clipboard, marks) = read_clipboard(uses_clipboard);
    let inserted = if uses_clipboard {
        prev_clipboard.as_deref()
    } else {
        None
    };
    let marks = marks_to_write(inserted, marks);
    let text = expand_clipboard(&text, prev_clipboard.as_deref());

    // The clipboard is written *before* the popup is hidden: if the write
    // fails (another program holding the clipboard open), the error returns
    // to a window that is still on screen and can show it.
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Couldn't open the clipboard: {e}"))?;
    set_text_marked(&mut clipboard, text, marks)
        .map_err(|e| format!("Couldn't write to the clipboard: {e}"))?;
    drop(clipboard);

    persist_popup_size(&app);
    // Released before the hide: hiding fires Focused(false), whose handler
    // takes the store lock (see hide_popup). The use count below takes it
    // again; the command is still the only place that locks.
    drop(guard);
    // Copy-only leaves the popup up for a moment so it can confirm the copy;
    // the popup hides itself afterwards. Kept open, it stays: the paste
    // thread hands the focus to the target and the popup waits beside it.
    if mode == PasteMode::Pasted && !keep_open {
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
            // Asked first: a Ctrl+V into a window above our level vanishes
            // with SendInput reporting success, so nothing below would notice
            let block = platform::input_block(prev_window);
            if block != InputBlock::Open {
                log::warn!(
                    "window {prev_window:#x} won't take input ({block:?}); the paste was not sent"
                );
                report_paste_failed(&app, paste_failed_message(block));
                return;
            }
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
            // Enter only after a Ctrl+V that was delivered: the input queue
            // keeps them in order, and the pause lets an app that takes a
            // large paste slowly (a terminal collapsing it) finish first
            if sent && auto_enter {
                std::thread::sleep(Duration::from_millis(120));
                if !platform::send_enter() {
                    log::warn!("SendInput did not deliver Enter to window {prev_window:#x}");
                }
            }
            if !sent {
                report_paste_failed(&app, PASTE_FAILED_MESSAGE);
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

/// The clipboard's text, and with `with_marks` its privacy marks, read so
/// that both describe the same content: Windows' change count is taken
/// before the text and after the marks, and a change in between counts as
/// private (`settled_marks`). Without `with_marks` the marks are none and
/// nothing beyond the text is asked.
fn read_clipboard(with_marks: bool) -> (Option<String>, ClipboardMarks) {
    let read_text = || {
        arboard::Clipboard::new()
            .ok()
            .and_then(|mut c| c.get_text().ok())
    };
    if !with_marks {
        return (read_text(), ClipboardMarks::default());
    }
    let before = platform::clipboard_sequence();
    let text = read_text();
    let marks = platform::clipboard_marks();
    let settled = platform::clipboard_sequence() == before;
    (text, settled_marks(marks, settled))
}

/// The marks as read, or, when the clipboard changed while the text and the
/// marks were being read, history and cloud excluded: the text may be a
/// secret whose marks we never saw, and the cost of guessing wrong is that
/// secret in Win+V history. Erring the other way only keeps one prompt out.
fn settled_marks(marks: ClipboardMarks, settled: bool) -> ClipboardMarks {
    if settled {
        marks
    } else {
        ClipboardMarks {
            history: true,
            cloud: true,
            ..marks
        }
    }
}

/// The marks the written prompt carries: none unless clipboard text went
/// into it (`inserted`, empty counting as none) and that text was marked;
/// then history and cloud both, whichever of them the source named, since
/// any mark says the copier meant it private, and the monitoring mark too
/// when the source had it. An ordinary prompt stays plain, so it is in
/// Win+V history to reuse like anything else copied.
fn marks_to_write(inserted: Option<&str>, marks: ClipboardMarks) -> ClipboardMarks {
    match inserted {
        Some(clip) if !clip.is_empty() && marks.any() => ClipboardMarks {
            monitoring: marks.monitoring,
            history: true,
            cloud: true,
        },
        _ => ClipboardMarks::default(),
    }
}

/// For text composed elsewhere: the manager's Copy expands `{clipboard}` in
/// the webview and sends the result, so Rust can't see the token. It sees
/// the clipboard about to be replaced, and when that is marked and the new
/// text contains it, the new text is marked the same way. Unmarked, which
/// is nearly always, it costs three format lookups and no text read.
pub(crate) fn marks_carried_into(text: &str) -> ClipboardMarks {
    if !platform::clipboard_marks().any() {
        return ClipboardMarks::default();
    }
    let (clip, marks) = read_clipboard(true);
    marks_to_write(clip.as_deref().filter(|c| text.contains(c)), marks)
}

/// `set_text` with the marks set beside the text, in the same open of the
/// clipboard, so a history or cloud listener never sees the text without
/// them. No marks is a plain `set_text`.
pub(crate) fn set_text_marked(
    clipboard: &mut arboard::Clipboard,
    text: String,
    marks: ClipboardMarks,
) -> Result<(), arboard::Error> {
    let set = clipboard.set();
    #[cfg(windows)]
    let set = {
        use arboard::SetExtWindows;
        let set = if marks.monitoring {
            set.exclude_from_monitoring()
        } else {
            set
        };
        let set = if marks.history {
            set.exclude_from_history()
        } else {
            set
        };
        if marks.cloud {
            set.exclude_from_cloud()
        } else {
            set
        }
    };
    #[cfg(not(windows))]
    let _ = marks;
    set.text(text)
}

/// What the popup shows when the paste thread could not deliver. The
/// popup listens for `paste-failed` with exactly this payload shape.
const PASTE_FAILED_MESSAGE: &str =
    "Couldn't paste into that window. The prompt is on your clipboard: press Ctrl+V there to paste it yourself.";

/// The same for a window known to run as administrator. The strip holds
/// three lines at the popup's 320 px minimum, about 110 characters.
const PASTE_ELEVATED_MESSAGE: &str =
    "That window runs as administrator. The prompt is on your clipboard: press Ctrl+V there to paste it yourself.";

/// Names administrator only when the window's level was read: a denied read
/// is most likely one, but saying so would be a guess.
fn paste_failed_message(block: InputBlock) -> &'static str {
    match block {
        InputBlock::Elevated => PASTE_ELEVATED_MESSAGE,
        InputBlock::Open | InputBlock::Unreadable => PASTE_FAILED_MESSAGE,
    }
}

/// The paste thread could not deliver (an elevated window, a foreground
/// lock held elsewhere, a blocked input queue): bring the popup back where
/// it was, without re-recording `prev_window` — the target is still the
/// one the user came from — and tell it, so the user learns the prompt is
/// on the clipboard rather than wondering why nothing happened.
fn report_paste_failed(app: &AppHandle, message: &str) {
    if let Some(w) = app.get_webview_window("popup") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    let payload = serde_json::json!({ "message": message });
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
    // `on_hotkey` only calls this for a hidden popup; a visible one here is
    // a race with a hide. Recording the foreground window then would make
    // the popup its own paste target, so it is only given the focus.
    if w.is_visible().unwrap_or(false) {
        let _ = w.set_focus();
        return;
    }
    // A real summon: the hotkey's key is down right now, and only its
    // release arms the second tap that hides (`on_hotkey`)
    HOTKEY_RELEASED.store(false, Ordering::SeqCst);
    // Summoned over one of our own windows (the manager, or the popup itself
    // in a race), there is nothing to paste into: Ctrl+V would land in the
    // editor's textarea and autosave would keep it. Record "no target" and
    // paste_snippet falls back to copy-only.
    let ours: Vec<isize> = ["popup", crate::MANAGER]
        .iter()
        .filter_map(|label| app.get_webview_window(label))
        .filter_map(|w| w.hwnd().ok())
        .map(|h| h.0 as isize)
        .collect();
    let state = app.state::<AppState>();
    let foreground = platform::foreground_window();
    *state.prev_window.lock().unwrap() = paste_target(foreground, &ours);
    platform::note_foreign(foreground);

    // First-run: record that the user found the hotkey, tell the manager.
    // The flag is cached in AppState (read once at startup), so config.json
    // is not parsed on every hotkey press to find out
    if !state.popup_seen.swap(true, Ordering::Relaxed) {
        let _guard = state.store.lock().unwrap();
        if config_frozen(app) {
            // Recorded on a launch that can save
        } else if let Ok(mut config) = load_config_from_disk(app) {
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
    fn the_message_says_administrator_only_when_the_level_was_read() {
        assert!(paste_failed_message(InputBlock::Elevated).contains("administrator"));
        assert!(!paste_failed_message(InputBlock::Unreadable).contains("administrator"));
    }

    #[test]
    fn both_failure_messages_fit_the_strip_and_name_the_recovery() {
        for message in [PASTE_FAILED_MESSAGE, PASTE_ELEVATED_MESSAGE] {
            assert!(message.chars().count() <= 110, "{message}");
            assert!(message.contains("press Ctrl+V there"), "{message}");
        }
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

    const NONE: ClipboardMarks = ClipboardMarks {
        monitoring: false,
        history: false,
        cloud: false,
    };
    const PRIVATE: ClipboardMarks = ClipboardMarks {
        monitoring: false,
        history: true,
        cloud: true,
    };

    #[test]
    fn a_prompt_wrapping_a_private_clipboard_is_kept_out_of_history_and_cloud() {
        assert_eq!(marks_to_write(Some("hunter2"), PRIVATE), PRIVATE);
        // Either mark alone makes the prompt private in both
        let history_only = ClipboardMarks {
            cloud: false,
            ..PRIVATE
        };
        let cloud_only = ClipboardMarks {
            history: false,
            ..PRIVATE
        };
        assert_eq!(marks_to_write(Some("hunter2"), history_only), PRIVATE);
        assert_eq!(marks_to_write(Some("hunter2"), cloud_only), PRIVATE);
        // The monitoring mark carries over, and brings the other two
        let monitoring = ClipboardMarks {
            monitoring: true,
            ..NONE
        };
        assert_eq!(
            marks_to_write(Some("hunter2"), monitoring),
            ClipboardMarks {
                monitoring: true,
                ..PRIVATE
            }
        );
    }

    #[test]
    fn a_prompt_without_private_clipboard_text_in_it_is_written_plainly() {
        // An ordinary clipboard: the prompt stays in Win+V history to reuse
        assert_eq!(marks_to_write(Some("error: E0308"), NONE), NONE);
        // No token, an empty or an unreadable clipboard: nothing went in
        assert_eq!(marks_to_write(None, PRIVATE), NONE);
        assert_eq!(marks_to_write(Some(""), PRIVATE), NONE);
    }

    #[test]
    fn a_clipboard_that_changed_during_the_read_counts_as_private() {
        assert_eq!(settled_marks(NONE, true), NONE);
        assert_eq!(settled_marks(PRIVATE, true), PRIVATE);
        assert_eq!(settled_marks(NONE, false), PRIVATE);
        let monitoring = ClipboardMarks {
            monitoring: true,
            ..NONE
        };
        assert_eq!(
            settled_marks(monitoring, false),
            ClipboardMarks {
                monitoring: true,
                ..PRIVATE
            }
        );
    }

    /// Against the real clipboard, which it overwrites: puts back the text
    /// that was there, with its marks, and loses anything that wasn't text.
    /// One test, so no other test races it for the clipboard.
    #[cfg(windows)]
    #[test]
    fn marks_written_beside_text_are_read_back_and_carried_into_the_prompt() {
        use arboard::SetExtWindows;
        let (saved, saved_marks) = read_clipboard(true);
        let mut clipboard = arboard::Clipboard::new().expect("open the clipboard");

        // A password manager's copy
        clipboard
            .set()
            .exclude_from_history()
            .exclude_from_cloud()
            .text("promptline-test-secret")
            .expect("write the marked text");
        let read = read_clipboard(true);
        let inserted_secret = read.0.clone();

        // The paste's write of a prompt that wrapped it
        let marks = marks_to_write(read.0.as_deref(), read.1);
        set_text_marked(
            &mut clipboard,
            "explain promptline-test-secret".into(),
            marks,
        )
        .expect("write the prompt");
        let prompt_marks = platform::clipboard_marks();
        // The manager's Copy of a prompt wrapping what is there now (the
        // marked prompt), composed in the webview
        let carried = marks_carried_into("see explain promptline-test-secret here");
        let unrelated = marks_carried_into("a pack's path");

        // A plain write carries nothing
        clipboard.set_text("promptline-test-plain").expect("write");
        let plain_marks = platform::clipboard_marks();

        if let Some(text) = saved {
            let _ = set_text_marked(&mut clipboard, text, saved_marks);
        }

        assert_eq!(inserted_secret.as_deref(), Some("promptline-test-secret"));
        assert_eq!(read.1, PRIVATE);
        assert_eq!(prompt_marks, PRIVATE);
        assert_eq!(carried, PRIVATE);
        assert_eq!(unrelated, NONE);
        assert_eq!(plain_marks, NONE);
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
    fn a_second_hotkey_tap_hides_the_popup_but_a_held_key_does_not() {
        use HotkeyAction::*;
        // Hidden: a press summons it, whatever the key did before
        assert_eq!(hotkey_action(false, false, false), Show);
        assert_eq!(hotkey_action(false, true, true), Show);
        // Up and in front, the key released since the summon: a deliberate
        // second tap puts it away
        assert_eq!(hotkey_action(true, true, true), Hide);
        // Up, but the key never came up since the summon (held down, a
        // repeat that got past MOD_NOREPEAT): only re-focus, never hide
        assert_eq!(hotkey_action(true, true, false), Focus);
        // Up but not in front (kept open beside the work, a paste handed
        // the focus to the target): bring it to the front, released or not
        assert_eq!(hotkey_action(true, false, true), Focus);
        assert_eq!(hotkey_action(true, false, false), Focus);
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
    fn kept_open_pastes_into_the_last_window_used() {
        // Not kept open: the window the popup was summoned over
        assert_eq!(paste_window(false, 0x30, 0x40), 0x30);
        // Kept open: the last one outside Promptline the user was in…
        assert_eq!(paste_window(true, 0x30, 0x40), 0x40);
        // …or the summon's while none has come to the front since
        assert_eq!(paste_window(true, 0x30, 0), 0x30);
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
