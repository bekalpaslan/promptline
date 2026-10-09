//! The Windows-specific code: which window is in front (and which one
//! outside Promptline was last), bringing one to the front, sending Ctrl+V,
//! the mouse button for the resize-drag check, handing a URL to the shell,
//! and hearing that Windows is ending the session. Everything else in the crate is
//! portable; a macOS port reimplements this file (CGEventPost, plus the
//! Accessibility permission) and nothing else.

/// Windows that come to the front without being somewhere a paste could go:
/// the taskbar (primary and secondary), the desktop, and the Alt+Tab and
/// Task View switchers. Clicking the taskbar to reach the kept-open popup
/// must not make the taskbar its paste target.
#[cfg(any(windows, test))]
fn is_shell_class(class: &str) -> bool {
    matches!(
        class,
        "Shell_TrayWnd"
            | "Shell_SecondaryTrayWnd"
            | "Progman"
            | "WorkerW"
            | "ForegroundStaging"
            | "MultitaskingViewFrame"
            | "XamlExplorerHostIslandWindow"
            | "TaskSwitcherWnd"
    )
}

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use std::time::{Duration, Instant};

    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_LBUTTON, VK_MENU, VK_RETURN, VK_SHIFT, VK_V,
    };
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass, ShellExecuteW};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId,
        MsgWaitForMultipleObjects, PeekMessageW, PostQuitMessage, SetForegroundWindow,
        TranslateMessage, EVENT_SYSTEM_FOREGROUND, MSG, OBJID_WINDOW, PM_REMOVE, QS_ALLINPUT,
        SW_SHOWNORMAL, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_QUERYENDSESSION, WM_QUIT,
    };

    pub(crate) fn foreground_window() -> isize {
        unsafe { GetForegroundWindow().0 as isize }
    }

    // The last window outside Promptline that came to the front: where a
    // kept-open popup pastes. Written by the foreground hook below.
    static LAST_FOREIGN: AtomicIsize = AtomicIsize::new(0);

    /// The window a kept-open popup pastes into: the last one outside
    /// Promptline the user was in. 0 until one has come to the front since
    /// `track_foreground` started.
    pub(crate) fn last_foreign_window() -> isize {
        LAST_FOREIGN.load(Ordering::Relaxed)
    }

    /// Remember `hwnd` as the last foreign window, unless it is one of ours
    /// or the shell's. `show_popup` records the window it was summoned over
    /// the same way, so a hook that missed it (it started late) still has one.
    pub(crate) fn note_foreign(hwnd: isize) {
        if hwnd == 0 || is_ours_or_shell(HWND(hwnd as *mut core::ffi::c_void)) {
            return;
        }
        LAST_FOREIGN.store(hwnd, Ordering::Relaxed);
    }

    fn is_ours_or_shell(hwnd: HWND) -> bool {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == std::process::id() {
            return true;
        }
        let mut buf = [0u16; 64];
        let n = unsafe { GetClassNameW(hwnd, &mut buf) };
        n > 0 && super::is_shell_class(&String::from_utf16_lossy(&buf[..n as usize]))
    }

    /// Follow the foreground window for the life of the process. Out of
    /// context, so the callback runs on this thread (the main one, whose
    /// event loop pumps its messages) and nothing is injected anywhere; our
    /// own process's windows are skipped by the flag as well as by the check.
    /// False when Windows refused the hook: a kept-open popup then pastes
    /// into the window it was summoned over.
    pub(crate) fn track_foreground() -> bool {
        note_foreign(foreground_window());
        let hook = unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(on_foreground),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
        };
        !hook.is_invalid()
    }

    unsafe extern "system" fn on_foreground(
        _hook: HWINEVENTHOOK,
        _event: u32,
        hwnd: HWND,
        id_object: i32,
        _id_child: i32,
        _thread: u32,
        _time: u32,
    ) {
        if id_object == OBJID_WINDOW.0 {
            note_foreign(hwnd.0 as isize);
        }
    }

    /// Hand a URL to whatever the shell has registered for it (the default
    /// browser). `ShellExecuteW` answers with a value above 32 on success
    /// and an error code otherwise.
    pub(crate) fn open_url(url: &str) -> Result<(), String> {
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

    pub(crate) fn left_button_down() -> bool {
        unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0 }
    }

    /// Bring `hwnd` to the foreground; false when Windows refused (the
    /// window is elevated, or another process holds the foreground lock).
    pub(crate) fn focus_window(hwnd: isize) -> bool {
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
    pub(crate) fn send_ctrl_v() -> bool {
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

    /// Press Enter: a prompt set to Auto enter. False when SendInput
    /// inserted fewer events than asked, as for Ctrl+V.
    pub(crate) fn send_enter() -> bool {
        let inputs = [key(VK_RETURN, false), key(VK_RETURN, true)];
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        sent as usize == inputs.len()
    }

    /// What to do when Windows asks whether the session may end: `ask`
    /// starts the work and says whether there is anything to wait for,
    /// `done` says when it has finished.
    pub(crate) struct SessionEnd {
        pub(crate) ask: Box<dyn Fn() -> bool>,
        pub(crate) done: Box<dyn Fn() -> bool>,
        pub(crate) grace: Duration,
    }

    // Set while the reply to WM_QUERYENDSESSION waits, so a second one
    // arriving through the pump doesn't start a second wait inside it
    static WAITING: AtomicBool = AtomicBool::new(false);

    /// Claims the process's AppUserModelID before any window exists, so
    /// taskbar grouping and toast origin follow it rather than the exe's
    /// path. The Start Menu shortcut the installer made carries the same
    /// id, so the process, its windows and its toasts read as one app to
    /// Windows. Debug builds skip this (see `show_toast`): an uninstalled
    /// dev build has no shortcut for our id.
    #[cfg(feature = "updater")]
    pub(crate) fn claim_app_id(id: &str) {
        if let Err(e) = unsafe {
            windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(id))
        } {
            log::warn!("couldn't claim the AppUserModelID {id}: {e}");
        }
    }

    /// One Windows toast, shown under `app_id` (or PowerShell's own id in a
    /// debug build, which has no installed shortcut to claim `app_id` for).
    /// `on_click` fires when the toast is activated; the `Toast` is kept
    /// alive for the process (leaked — `Toast` isn't `Send`, so it can't
    /// live in a `Mutex` the way the update slot does, and one small leak
    /// per new version found is cheaper than tearing down and rebuilding
    /// this plumbing per toast).
    #[cfg(feature = "updater")]
    pub(crate) fn show_toast(
        app_id: &str,
        title: &str,
        body: &str,
        on_click: Box<dyn Fn() + Send + 'static>,
    ) -> Result<(), String> {
        use tauri_winrt_notification::Toast;
        let id = if cfg!(debug_assertions) {
            Toast::POWERSHELL_APP_ID
        } else {
            app_id
        };
        let toast = Toast::new(id)
            .title(title)
            .text1(body)
            .on_activated(move |_| {
                on_click();
                Ok(())
            });
        toast.show().map_err(|e| e.to_string())?;
        Box::leak(Box::new(toast));
        Ok(())
    }

    /// Shutdown, restart and sign-out send WM_QUERYENDSESSION, then
    /// WM_ENDSESSION, and the process can be killed as soon as that one is
    /// answered; tao turns it into Tauri's `RunEvent::Exit`, too late for a
    /// webview to send anything. So the query is caught here, on `window`'s
    /// own procedure: `ask` runs, and the reply waits for `done`, up to
    /// `grace`, while this thread keeps dispatching messages, because the
    /// webview's invokes reach Rust through this thread's queue. It always
    /// answers yes: Promptline never holds up a shutdown, and Windows starts
    /// warning about apps that do after five seconds.
    pub(crate) fn on_session_end(window: &tauri::WebviewWindow, hook: SessionEnd) -> bool {
        // Tauri's HWND is another `windows` version's; the handle is the same
        let Ok(hwnd) = window.hwnd() else {
            return false;
        };
        // Lives as long as the window, which is as long as the process
        let data = Box::into_raw(Box::new(hook)) as usize;
        unsafe { SetWindowSubclass(HWND(hwnd.0), Some(session_proc), 1, data).as_bool() }
    }

    unsafe extern "system" fn session_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        data: usize,
    ) -> LRESULT {
        if msg == WM_QUERYENDSESSION && !WAITING.swap(true, Ordering::SeqCst) {
            let hook = &*(data as *const SessionEnd);
            if (hook.ask)() {
                pump_until(&*hook.done, hook.grace);
            }
            WAITING.store(false, Ordering::SeqCst);
            return LRESULT(1);
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    /// Dispatch this thread's messages until `done` or `grace` runs out. A
    /// WM_QUIT met on the way is put back for the real loop and ends the wait.
    fn pump_until(done: &dyn Fn() -> bool, grace: Duration) {
        let deadline = Instant::now() + grace;
        let mut msg = MSG::default();
        while !done() {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return;
            }
            unsafe {
                MsgWaitForMultipleObjects(
                    None,
                    false,
                    left.as_millis().min(50) as u32,
                    QS_ALLINPUT,
                );
                while PeekMessageW(&mut msg, HWND::default(), 0, 0, PM_REMOVE).as_bool() {
                    if msg.message == WM_QUIT {
                        PostQuitMessage(msg.wParam.0 as i32);
                        return;
                    }
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub(crate) fn foreground_window() -> isize {
        0
    }
    pub(crate) fn last_foreign_window() -> isize {
        0
    }
    pub(crate) fn note_foreign(_hwnd: isize) {}
    pub(crate) fn track_foreground() -> bool {
        false
    }
    pub(crate) fn focus_window(_hwnd: isize) -> bool {
        false
    }
    pub(crate) fn send_ctrl_v() -> bool {
        false
    }
    pub(crate) fn send_enter() -> bool {
        false
    }
    pub(crate) fn left_button_down() -> bool {
        false
    }
    pub(crate) struct SessionEnd {
        pub(crate) ask: Box<dyn Fn() -> bool>,
        pub(crate) done: Box<dyn Fn() -> bool>,
        pub(crate) grace: std::time::Duration,
    }
    pub(crate) fn on_session_end(_window: &tauri::WebviewWindow, _hook: SessionEnd) -> bool {
        false
    }

    #[cfg(feature = "updater")]
    pub(crate) fn claim_app_id(_id: &str) {}

    #[cfg(feature = "updater")]
    pub(crate) fn show_toast(
        _app_id: &str,
        _title: &str,
        _body: &str,
        _on_click: Box<dyn Fn() + Send + 'static>,
    ) -> Result<(), String> {
        Err("no toast on this platform".into())
    }
}

#[cfg(windows)]
pub(crate) use imp::open_url;
#[cfg(feature = "updater")]
pub(crate) use imp::{claim_app_id, show_toast};
pub(crate) use imp::{
    focus_window, foreground_window, last_foreign_window, left_button_down, note_foreign,
    on_session_end, send_ctrl_v, send_enter, track_foreground, SessionEnd,
};

#[cfg(test)]
mod tests {
    use super::is_shell_class;

    #[test]
    fn the_taskbar_desktop_and_switchers_are_never_a_paste_target() {
        for class in [
            "Shell_TrayWnd",
            "Shell_SecondaryTrayWnd",
            "Progman",
            "WorkerW",
            "XamlExplorerHostIslandWindow",
        ] {
            assert!(is_shell_class(class), "{class}");
        }
        // An app's window is
        for class in [
            "CASCADIA_HOSTING_WINDOW_CLASS",
            "Chrome_WidgetWin_1",
            "Notepad",
        ] {
            assert!(!is_shell_class(class), "{class}");
        }
    }
}
