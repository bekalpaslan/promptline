//! The Windows-specific code: which window is in front, bringing one to
//! the front, sending Ctrl+V, the mouse button for the resize-drag check,
//! handing a URL to the shell, and hearing that Windows is ending the
//! session. Everything else in the crate is
//! portable; a macOS port reimplements this file (CGEventPost, plus the
//! Accessibility permission) and nothing else.

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};

    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_LBUTTON, VK_MENU, VK_SHIFT, VK_V,
    };
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass, ShellExecuteW};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetForegroundWindow, MsgWaitForMultipleObjects, PeekMessageW,
        PostQuitMessage, SetForegroundWindow, TranslateMessage, MSG, PM_REMOVE, QS_ALLINPUT,
        SW_SHOWNORMAL, WM_QUERYENDSESSION, WM_QUIT,
    };

    pub(crate) fn foreground_window() -> isize {
        unsafe { GetForegroundWindow().0 as isize }
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
    pub(crate) fn focus_window(_hwnd: isize) -> bool {
        false
    }
    pub(crate) fn send_ctrl_v() -> bool {
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
}

#[cfg(windows)]
pub(crate) use imp::open_url;
pub(crate) use imp::{
    focus_window, foreground_window, left_button_down, on_session_end, send_ctrl_v, SessionEnd,
};
