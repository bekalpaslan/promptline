//! The Windows-specific code: which window is in front, bringing one to
//! the front, sending Ctrl+V, the mouse button for the resize-drag check,
//! and handing a URL to the shell. Everything else in the crate is
//! portable; a macOS port reimplements this file (CGEventPost, plus the
//! Accessibility permission) and nothing else.

#[cfg(windows)]
mod imp {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_LBUTTON, VK_MENU, VK_SHIFT, VK_V,
    };
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, SetForegroundWindow, SW_SHOWNORMAL,
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
}

#[cfg(windows)]
pub(crate) use imp::open_url;
pub(crate) use imp::{focus_window, foreground_window, left_button_down, send_ctrl_v};
