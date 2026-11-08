//! The Windows-specific code: which window is in front (and which one
//! outside Promptline was last), bringing one to the front, sending Ctrl+V,
//! the mouse button for the resize-drag check, handing a URL to the shell,
//! what the hotkey would have typed on the user's keyboard layouts, whether
//! Windows' Startup page has turned an entry off, whether a window will
//! accept our keystrokes, whether the clipboard's content is marked private,
//! and hearing that Windows is ending the session.
//! Everything else in the crate is
//! portable; a macOS port reimplements this file (CGEventPost, plus the
//! Accessibility permission) and nothing else.

use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

/// The character `hotkey` types on one of the user's keyboard layouts, with
/// that layout's name, when the layout reads Ctrl+Alt as AltGr: Czech,
/// Slovak, Hungarian, Croatian and Slovenian type `@` with AltGr+V, and a
/// Ctrl+Alt+V registration fires on that keystroke and swallows the
/// character. None for a combination without both Ctrl and Alt, with Win,
/// or whose key is not a letter or digit, and when no layout on the list
/// types anything printable with it (a dead key counts as nothing).
pub(crate) fn altgr_char_for(hotkey: &str) -> Option<(String, String)> {
    let shortcut: Shortcut = hotkey.parse().ok()?;
    let mods = shortcut.mods;
    if !mods.contains(Modifiers::CONTROL)
        || !mods.contains(Modifiers::ALT)
        || mods.intersects(Modifiers::SUPER | Modifiers::META)
    {
        return None;
    }
    let vk = virtual_key(shortcut.key)?;
    imp::altgr_char(vk, mods.contains(Modifiers::SHIFT))
}

/// The Windows virtual key of a letter or digit `Code` (`KeyV` → 0x56,
/// `Digit1` → 0x31: the ASCII codes); None for every other key.
fn virtual_key(code: Code) -> Option<u16> {
    let name = code.to_string();
    let key = name
        .strip_prefix("Key")
        .filter(|k| k.len() == 1 && k.as_bytes()[0].is_ascii_uppercase())
        .or_else(|| {
            name.strip_prefix("Digit")
                .filter(|k| k.len() == 1 && k.as_bytes()[0].is_ascii_digit())
        })?;
    Some(key.as_bytes()[0] as u16)
}

/// Text a keystroke produced that the user would have seen typed: not
/// empty, no control character (Ctrl+V alone yields U+0016) and no
/// whitespace.
#[cfg(any(windows, test))]
fn is_printable(text: &str) -> bool {
    !text.is_empty() && text.chars().all(|c| !c.is_control() && !c.is_whitespace())
}

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

/// Whether a window will take our keystrokes. Windows drops input sent to a
/// process above our integrity level, and `SendInput` still reports success,
/// so this has to be asked before the Ctrl+V and can't be learned after it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InputBlock {
    /// Send: at or below our level, or nothing to ask about
    Open,
    /// Above our level: an administrator's window, to a normal Promptline
    Elevated,
    /// We may not read its level, which most likely means another account's
    /// administrator window. A window at our own level that lands here costs
    /// one Ctrl+V by hand; a silent paste costs the user the reason
    Unreadable,
}

/// What asking for a window's integrity level found.
#[cfg(any(windows, test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TargetLevel {
    /// The level's RID: 0x2000 medium, 0x3000 high
    Read(u32),
    Denied,
    /// The window or its process went away, so there is nothing to protect
    Gone,
}

/// Compares levels rather than asking "elevated?", so a Promptline that was
/// itself run as administrator still pastes into administrator windows.
#[cfg(any(windows, test))]
fn judge_input(target: TargetLevel, own: u32) -> InputBlock {
    match target {
        TargetLevel::Read(level) if level > own => InputBlock::Elevated,
        TargetLevel::Read(_) | TargetLevel::Gone => InputBlock::Open,
        TargetLevel::Denied => InputBlock::Unreadable,
    }
}

/// What a StartupApproved value says: Windows' Startup page and Task
/// Manager write an odd first byte for off (03, then the time it was turned
/// off) and an even one for on. The bytes after it are no guide: `03` with
/// a zero time occurs, and auto-launch's `is_enabled`, which reads only
/// those, takes that for on.
#[cfg(any(windows, test))]
fn startup_value_off(value: &[u8]) -> bool {
    value.first().is_some_and(|b| b % 2 == 1)
}

/// The privacy marks on what the clipboard holds. A password manager copies
/// a secret with registered formats beside the text that keep it out of
/// Win+V history and the cloud clipboard; a program that reads the text
/// and writes it back plainly drops them. All false when there are none,
/// and always on other platforms.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ClipboardMarks {
    /// `ExcludeClipboardContentFromMonitorProcessing` is present: no
    /// clipboard monitor (history, cloud, a clipboard manager) should take it
    pub(crate) monitoring: bool,
    /// `CanIncludeInClipboardHistory` holds 0
    pub(crate) history: bool,
    /// `CanUploadToCloudClipboard` holds 0
    pub(crate) cloud: bool,
}

impl ClipboardMarks {
    pub(crate) fn any(self) -> bool {
        self.monitoring || self.history || self.cloud
    }
}

/// What one of the two `Can…` formats says, once it is present: a DWORD of
/// 0 excludes, 1 asks to be included. One we could not read counts as 0,
/// since the copier put the format there to say something and the cost of
/// guessing wrong is a secret in the history.
#[cfg(any(windows, test))]
fn can_format_excludes(value: Option<u32>) -> bool {
    !matches!(value, Some(v) if v != 0)
}

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use std::time::{Duration, Instant};

    use super::{judge_input, InputBlock, TargetLevel};
    use windows::core::{w, HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{
        CloseHandle, ERROR_ACCESS_DENIED, ERROR_FILE_NOT_FOUND, HANDLE, HWND, LPARAM, LRESULT,
        WPARAM,
    };
    use windows::Win32::Globalization::{
        GetLocaleInfoEx, LCIDToLocaleName, LOCALE_SLOCALIZEDDISPLAYNAME,
    };
    use windows::Win32::Security::{
        GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenIntegrityLevel,
        TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
    };
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER,
        HKEY_LOCAL_MACHINE, KEY_READ, RRF_RT_REG_BINARY, RRF_RT_REG_SZ,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, GetKeyboardLayoutList, MapVirtualKeyExW, SendInput, ToUnicodeEx, HKL,
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        MAPVK_VK_TO_VSC, VIRTUAL_KEY, VK_CONTROL, VK_LBUTTON, VK_LCONTROL, VK_MENU, VK_RETURN,
        VK_RMENU, VK_SHIFT, VK_V,
    };
    use windows::Win32::UI::Shell::{
        DefSubclassProc, SHLoadIndirectString, SetWindowSubclass, ShellExecuteW,
    };
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

    /// The integrity level's RID in `process`'s token, or None when it can't
    /// be read. The level is the last sub-authority of the label's SID.
    pub(crate) fn process_integrity(process: HANDLE) -> Option<u32> {
        let mut token = HANDLE::default();
        unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) }.ok()?;
        // u64s for the alignment TOKEN_MANDATORY_LABEL needs; a label and its
        // SID take about 30 bytes
        let mut buf = [0u64; 16];
        let mut needed = 0u32;
        let read = unsafe {
            GetTokenInformation(
                token,
                TokenIntegrityLevel,
                Some(buf.as_mut_ptr() as *mut _),
                std::mem::size_of_val(&buf) as u32,
                &mut needed,
            )
        };
        let level = read.ok().and_then(|()| unsafe {
            let sid = (*(buf.as_ptr() as *const TOKEN_MANDATORY_LABEL)).Label.Sid;
            let count = *GetSidSubAuthorityCount(sid);
            (count > 0).then(|| *GetSidSubAuthority(sid, u32::from(count) - 1))
        });
        let _ = unsafe { CloseHandle(token) };
        level
    }

    /// The level of the process behind `hwnd`. Asks only for the limited
    /// query right, which is the least there is, and reads nothing else.
    fn target_level(hwnd: isize) -> TargetLevel {
        let mut pid = 0u32;
        let window = HWND(hwnd as *mut core::ffi::c_void);
        unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
        if pid == 0 {
            return TargetLevel::Gone;
        }
        match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
            Ok(process) => {
                let level = process_integrity(process);
                let _ = unsafe { CloseHandle(process) };
                level.map_or(TargetLevel::Denied, TargetLevel::Read)
            }
            Err(e) if e.code() == ERROR_ACCESS_DENIED.to_hresult() => TargetLevel::Denied,
            Err(_) => TargetLevel::Gone,
        }
    }

    /// Whether `hwnd` will take our keystrokes. Our own level unread leaves
    /// nothing to compare, so the paste goes ahead as it always did.
    pub(crate) fn input_block(hwnd: isize) -> InputBlock {
        match process_integrity(unsafe { GetCurrentProcess() }) {
            Some(own) if hwnd != 0 => judge_input(target_level(hwnd), own),
            _ => InputBlock::Open,
        }
    }

    /// Bring `hwnd` to the foreground; false when Windows refused (another
    /// process holds the foreground lock).
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

    /// The events of one paste: release the modifiers the user may still be
    /// holding from the hotkey, then a clean Ctrl+V.
    ///
    /// Every event carries virtual-key codes only, with a scan code of 0, and
    /// that is load-bearing: mintty (Git Bash, wsltty) takes a Ctrl+V whose
    /// scan code is 0 as a paste, where a typed Ctrl+V goes to the program
    /// as ^V (wsltty#139). Filling in real scan codes would make the paste
    /// look typed and break Git Bash; `the_paste_sends_virtual_keys_with_no_scan_code`
    /// holds it.
    pub(crate) fn ctrl_v_inputs() -> [INPUT; 7] {
        [
            key(VK_SHIFT, true),
            key(VK_MENU, true),
            key(VK_CONTROL, true),
            key(VK_CONTROL, false),
            key(VK_V, false),
            key(VK_V, true),
            key(VK_CONTROL, true),
        ]
    }

    /// Send Ctrl+V; false when SendInput inserted fewer events than asked
    /// (the input queue is blocked, or another thread holds it). UIPI drops
    /// input aimed at an elevated window without saying so, so a paste into
    /// one would come back true: `input_block` is asked first.
    pub(crate) fn send_ctrl_v() -> bool {
        let inputs = ctrl_v_inputs();
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

    // ---- What the hotkey would have typed ---------------------------------

    /// ToUnicodeEx's "leave the keyboard state alone" flag (Windows 10 1607
    /// and later): without it the probe could leave a dead key pending in
    /// the thread's own state.
    const NO_STATE_CHANGE: u32 = 0x4;

    const LAYOUTS: &str = "SYSTEM\\CurrentControlSet\\Control\\Keyboard Layouts";

    /// The first of the user's layouts on which `vk` with Ctrl and Alt held
    /// (and Shift when `shift`) types printable text, with that text and the
    /// layout's name. See `altgr_char_for`.
    pub(crate) fn altgr_char(vk: u16, shift: bool) -> Option<(String, String)> {
        keyboard_layouts()
            .into_iter()
            .find_map(|hkl| altgr_text_on(hkl, vk, shift).map(|text| (text, layout_name(hkl))))
    }

    /// Every input locale the user has installed, in Windows' order.
    pub(crate) fn keyboard_layouts() -> Vec<HKL> {
        let n = unsafe { GetKeyboardLayoutList(None) };
        if n <= 0 {
            return Vec::new();
        }
        let mut list = vec![HKL::default(); n as usize];
        let got = unsafe { GetKeyboardLayoutList(Some(&mut list)) };
        list.truncate(got.max(0) as usize);
        list
    }

    /// What `vk` types on `hkl` with both Ctrl keys' and both Alt keys'
    /// bits set (how Windows sees AltGr) and Shift's when `shift`, if that
    /// is printable text. Nothing (0) and a dead key (negative) are None.
    pub(crate) fn altgr_text_on(hkl: HKL, vk: u16, shift: bool) -> Option<String> {
        let mut state = [0u8; 256];
        for key in [VK_CONTROL, VK_LCONTROL, VK_MENU, VK_RMENU] {
            state[key.0 as usize] = 0x80;
        }
        if shift {
            state[VK_SHIFT.0 as usize] = 0x80;
        }
        let scan = unsafe { MapVirtualKeyExW(vk as u32, MAPVK_VK_TO_VSC, hkl) };
        let mut buf = [0u16; 8];
        let n = unsafe { ToUnicodeEx(vk as u32, scan, &state, &mut buf, NO_STATE_CHANGE, hkl) };
        if n <= 0 {
            return None;
        }
        let text = String::from_utf16_lossy(&buf[..n as usize]);
        super::is_printable(&text).then_some(text)
    }

    /// The layout's name as the language bar shows it ("Czech", "United
    /// States-International"), from the registry's Keyboard Layouts key;
    /// the language's display name ("Czech (Czechia)") when the layout's id
    /// isn't found there, and the raw handle as a last resort.
    pub(crate) fn layout_name(hkl: HKL) -> String {
        let raw = hkl.0 as usize;
        let device = ((raw >> 16) & 0xFFFF) as u16;
        let lang = (raw & 0xFFFF) as u16;
        if let Some(name) = klid_for(device).and_then(|klid| registry_layout_name(&klid)) {
            return name;
        }
        locale_display_name(lang).unwrap_or_else(|| format!("{raw:08X}"))
    }

    /// The eight-digit layout id (KLID) behind an HKL's device word: the
    /// word itself for a language's first layout (0x0405 → "00000405"); for
    /// the others Windows stores a 0xF0xx tag whose low bits match a
    /// "Layout Id" value under the Keyboard Layouts key (US-International
    /// is 0xF001 → "00020409", whose Layout Id is 0001).
    fn klid_for(device: u16) -> Option<String> {
        if device & 0xF000 != 0xF000 {
            return Some(format!("{device:08X}"));
        }
        let wanted = device & 0x0FFF;
        let mut key = HKEY::default();
        unsafe {
            RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                &HSTRING::from(LAYOUTS),
                0,
                KEY_READ,
                &mut key,
            )
        }
        .ok()
        .ok()?;
        let mut found = None;
        let mut index = 0;
        loop {
            let mut name = [0u16; 32];
            let mut len = name.len() as u32;
            let err = unsafe {
                RegEnumKeyExW(
                    key,
                    index,
                    PWSTR(name.as_mut_ptr()),
                    &mut len,
                    None,
                    PWSTR::null(),
                    None,
                    None,
                )
            };
            if err.is_err() {
                break;
            }
            index += 1;
            let klid = String::from_utf16_lossy(&name[..len as usize]);
            let id = reg_string(&layout_key(&klid), w!("Layout Id"))
                .and_then(|id| u16::from_str_radix(&id, 16).ok());
            if id == Some(wanted) {
                found = Some(klid);
                break;
            }
        }
        unsafe {
            let _ = RegCloseKey(key);
        }
        found
    }

    fn layout_key(klid: &str) -> HSTRING {
        HSTRING::from(format!("{LAYOUTS}\\{klid}"))
    }

    /// "Layout Display Name" is an indirect string into input.dll, localised
    /// to the UI language; "Layout Text" is the English name.
    fn registry_layout_name(klid: &str) -> Option<String> {
        let subkey = layout_key(klid);
        if let Some(indirect) = reg_string(&subkey, w!("Layout Display Name")) {
            let mut buf = [0u16; 256];
            if unsafe { SHLoadIndirectString(&HSTRING::from(indirect), &mut buf, None) }.is_ok() {
                let text = utf16_until_nul(&buf);
                if !text.is_empty() {
                    return Some(text);
                }
            }
        }
        reg_string(&subkey, w!("Layout Text"))
    }

    /// A REG_SZ value under HKLM, or None when the key or value isn't there.
    fn reg_string(subkey: &HSTRING, value: PCWSTR) -> Option<String> {
        let mut buf = [0u16; 256];
        let mut size = (buf.len() * 2) as u32;
        let err = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                subkey,
                value,
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr() as *mut _),
                Some(&mut size),
            )
        };
        if err.is_err() {
            return None;
        }
        let text = utf16_until_nul(&buf[..(size as usize / 2).min(buf.len())]);
        (!text.is_empty()).then_some(text)
    }

    /// Whether the user has turned the startup entry `name` off in Windows'
    /// Startup page or Task Manager. Windows keeps that answer after the
    /// entry itself is gone, so it outlives an uninstall. Fails toward off:
    /// only a plain "not found" says nobody has refused, and a wrong "off"
    /// costs one checkbox while a wrong "on" overrides the user.
    pub(crate) fn startup_entry_off(name: &str) -> bool {
        let mut buf = [0u8; 64];
        let mut size = buf.len() as u32;
        let err = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run"),
                &HSTRING::from(name),
                RRF_RT_REG_BINARY,
                None,
                Some(buf.as_mut_ptr() as *mut _),
                Some(&mut size),
            )
        };
        if err == ERROR_FILE_NOT_FOUND {
            return false;
        }
        err.is_err() || super::startup_value_off(&buf[..(size as usize).min(buf.len())])
    }

    /// "Czech (Czechia)": the display name of the layout's language, for a
    /// layout the registry doesn't describe.
    fn locale_display_name(lang: u16) -> Option<String> {
        // LOCALE_NAME_MAX_LENGTH
        let mut name = [0u16; 85];
        if unsafe { LCIDToLocaleName(lang as u32, Some(&mut name), 0) } <= 0 {
            return None;
        }
        let mut display = [0u16; 256];
        let n = unsafe {
            GetLocaleInfoEx(
                PCWSTR(name.as_ptr()),
                LOCALE_SLOCALIZEDDISPLAYNAME,
                Some(&mut display),
            )
        };
        (n > 0).then(|| utf16_until_nul(&display))
    }

    fn utf16_until_nul(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
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

    /// The privacy marks on what the clipboard holds now (see
    /// `ClipboardMarks`). Asking whether a format is there needs no lock on
    /// the clipboard, so a clipboard without the two `Can…` formats, which
    /// is nearly every one, costs three lookups and never opens it.
    pub(crate) fn clipboard_marks() -> super::ClipboardMarks {
        use windows::Win32::System::DataExchange::{
            IsClipboardFormatAvailable, RegisterClipboardFormatW,
        };
        // Registering a name Windows already knows returns its id
        let present = |name: PCWSTR| {
            let format = unsafe { RegisterClipboardFormatW(name) };
            (format != 0 && unsafe { IsClipboardFormatAvailable(format) }.is_ok()).then_some(format)
        };
        let monitoring = present(w!("ExcludeClipboardContentFromMonitorProcessing")).is_some();
        let history = present(w!("CanIncludeInClipboardHistory"));
        let cloud = present(w!("CanUploadToCloudClipboard"));
        let (history, cloud) = if history.is_none() && cloud.is_none() {
            (false, false)
        } else {
            // Unopenable (another program holding it) reads as unreadable
            let values =
                with_clipboard_open(|| (history.map(clipboard_dword), cloud.map(clipboard_dword)))
                    .unwrap_or((history.map(|_| None), cloud.map(|_| None)));
            (
                values.0.is_some_and(super::can_format_excludes),
                values.1.is_some_and(super::can_format_excludes),
            )
        };
        super::ClipboardMarks {
            monitoring,
            history,
            cloud,
        }
    }

    /// Windows' count of clipboard changes. The same number before and after
    /// two reads means they read the same content.
    pub(crate) fn clipboard_sequence() -> u32 {
        unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() }
    }

    /// `read` with the clipboard opened for this thread, or None when another
    /// program held it through a few tries (as arboard tries).
    fn with_clipboard_open<T>(read: impl FnOnce() -> T) -> Option<T> {
        use windows::Win32::System::DataExchange::{CloseClipboard, OpenClipboard};
        for _ in 0..5 {
            if unsafe { OpenClipboard(HWND::default()) }.is_ok() {
                let out = read();
                let _ = unsafe { CloseClipboard() };
                return Some(out);
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        None
    }

    /// The DWORD a registered format holds; the clipboard must be open.
    fn clipboard_dword(format: u32) -> Option<u32> {
        use windows::Win32::Foundation::HGLOBAL;
        use windows::Win32::System::DataExchange::GetClipboardData;
        use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
        let mem = HGLOBAL(unsafe { GetClipboardData(format) }.ok()?.0);
        if unsafe { GlobalSize(mem) } < 4 {
            return None;
        }
        let ptr = unsafe { GlobalLock(mem) } as *const u8;
        if ptr.is_null() {
            return None;
        }
        let mut bytes = [0u8; 4];
        unsafe { std::ptr::copy_nonoverlapping(ptr, bytes.as_mut_ptr(), 4) };
        // Errs on the last unlock with no error to report; nothing to do
        let _ = unsafe { GlobalUnlock(mem) };
        Some(u32::from_ne_bytes(bytes))
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
    pub(crate) fn altgr_char(_vk: u16, _shift: bool) -> Option<(String, String)> {
        None
    }
    pub(crate) fn startup_entry_off(_name: &str) -> bool {
        false
    }
    pub(crate) fn input_block(_hwnd: isize) -> super::InputBlock {
        super::InputBlock::Open
    }
    pub(crate) struct SessionEnd {
        pub(crate) ask: Box<dyn Fn() -> bool>,
        pub(crate) done: Box<dyn Fn() -> bool>,
        pub(crate) grace: std::time::Duration,
    }
    pub(crate) fn on_session_end(_window: &tauri::WebviewWindow, _hook: SessionEnd) -> bool {
        false
    }

    pub(crate) fn claim_app_id(_id: &str) {}

    pub(crate) fn show_toast(
        _app_id: &str,
        _title: &str,
        _body: &str,
        _on_click: Box<dyn Fn() + Send + 'static>,
    ) -> Result<(), String> {
        Err("no toast on this platform".into())
    }

    pub(crate) fn clipboard_marks() -> super::ClipboardMarks {
        super::ClipboardMarks::default()
    }
    pub(crate) fn clipboard_sequence() -> u32 {
        0
    }
}

#[cfg(windows)]
pub(crate) use imp::open_url;
pub(crate) use imp::{
    claim_app_id, focus_window, foreground_window, input_block, last_foreign_window,
    left_button_down, note_foreign, on_session_end, send_ctrl_v, send_enter, show_toast,
    startup_entry_off, track_foreground, SessionEnd,
};
pub(crate) use imp::{clipboard_marks, clipboard_sequence};

#[cfg(test)]
mod tests {
    use super::{
        is_printable, is_shell_class, judge_input, startup_value_off, virtual_key, InputBlock,
        TargetLevel,
    };

    const MEDIUM: u32 = 0x2000;
    const HIGH: u32 = 0x3000;

    #[test]
    fn a_can_format_excludes_at_zero_and_when_unreadable_and_includes_at_one() {
        assert!(super::can_format_excludes(Some(0)));
        assert!(super::can_format_excludes(None));
        assert!(!super::can_format_excludes(Some(1)));
    }

    #[test]
    fn a_window_above_our_level_refuses_input_and_one_at_it_or_below_takes_it() {
        assert_eq!(
            judge_input(TargetLevel::Read(HIGH), MEDIUM),
            InputBlock::Elevated
        );
        assert_eq!(
            judge_input(TargetLevel::Read(MEDIUM), MEDIUM),
            InputBlock::Open
        );
        // An app container runs low
        assert_eq!(
            judge_input(TargetLevel::Read(0x1000), MEDIUM),
            InputBlock::Open
        );
    }

    #[test]
    fn a_promptline_run_as_administrator_still_pastes_into_administrator_windows() {
        assert_eq!(judge_input(TargetLevel::Read(HIGH), HIGH), InputBlock::Open);
    }

    #[test]
    fn a_denied_read_counts_as_blocked_and_a_window_that_went_away_does_not() {
        assert_eq!(
            judge_input(TargetLevel::Denied, MEDIUM),
            InputBlock::Unreadable
        );
        assert_eq!(judge_input(TargetLevel::Gone, MEDIUM), InputBlock::Open);
    }

    #[test]
    fn an_odd_first_byte_is_a_startup_entry_turned_off() {
        // Read from a real StartupApproved key: off with its time, off with
        // none, and on
        assert!(startup_value_off(&[
            3, 0, 0, 0, 0x0A, 0x52, 0xF9, 0x9F, 0xA7, 0xBC, 0xD8, 1
        ]));
        assert!(startup_value_off(&[3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert!(!startup_value_off(&[2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        assert!(!startup_value_off(&[]));
    }

    #[test]
    fn only_a_visible_character_counts_as_what_the_hotkey_typed() {
        // What AltGr+V types on a Czech, Hungarian or Slovak layout
        assert!(is_printable("@"));
        assert!(is_printable("€"));
        assert!(is_printable("đ"));
        // Ctrl+V on a layout without an AltGr column: the SYN control character
        assert!(!is_printable("\u{16}"));
        assert!(!is_printable(""));
        assert!(!is_printable(" "));
        assert!(!is_printable("\t"));
    }

    #[test]
    fn letters_and_digits_map_to_their_virtual_keys_and_nothing_else_does() {
        let vk = |s: &str| virtual_key(s.parse().unwrap());
        assert_eq!(vk("KeyV"), Some(0x56));
        assert_eq!(vk("KeyA"), Some(0x41));
        assert_eq!(vk("Digit1"), Some(0x31));
        assert_eq!(vk("Digit0"), Some(0x30));
        for other in ["F1", "Space", "ArrowUp", "Comma", "Enter"] {
            assert_eq!(vk(other), None, "{other}");
        }
    }

    #[test]
    fn only_a_ctrl_alt_letter_or_digit_can_be_an_altgr_character() {
        // Nothing to look up: these never reach the layouts. (On Windows a
        // Ctrl+Alt+letter does, and what it finds depends on the machine's
        // layouts, so the positive case is the Czech-layout test below.)
        for hotkey in [
            "ctrl+shift+v",
            "alt+v",
            "ctrl+alt+super+v",
            "ctrl+alt+f1",
            "ctrl+alt+space",
            "nonsense",
        ] {
            assert_eq!(super::altgr_char_for(hotkey), None, "{hotkey}");
        }
    }

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

/// Against the real layouts: loads Czech for this process (not activated,
/// and `KLF_NOTELLSHELL` keeps the language bar out of it), probes it, and
/// unloads it again unless the user had it already. Loading takes the
/// layout into the session's list, which is why nothing asserts before
/// the unload.
#[cfg(all(test, windows))]
mod windows_tests {
    use windows::core::w;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        LoadKeyboardLayoutW, UnloadKeyboardLayout, KLF_NOTELLSHELL,
    };

    use windows::Win32::System::Threading::GetCurrentProcess;

    use super::imp::{altgr_text_on, keyboard_layouts, layout_name, process_integrity};

    #[test]
    fn the_paste_sends_virtual_keys_with_no_scan_code() {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            INPUT_KEYBOARD, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE, VK_CONTROL, VK_MENU, VK_SHIFT,
            VK_V,
        };
        let inputs = super::imp::ctrl_v_inputs();
        let mut seen = Vec::new();
        for input in &inputs {
            assert_eq!(input.r#type, INPUT_KEYBOARD);
            // SAFETY: every event is built as a keyboard input, asserted above
            let ki = unsafe { input.Anonymous.ki };
            // mintty pastes a Ctrl+V only when its scan code is 0 (Git Bash)
            assert_eq!(ki.wScan, 0);
            assert!(!ki.dwFlags.contains(KEYEVENTF_SCANCODE));
            seen.push((ki.wVk, ki.dwFlags.contains(KEYEVENTF_KEYUP)));
        }
        assert_eq!(
            seen,
            [
                (VK_SHIFT, true),
                (VK_MENU, true),
                (VK_CONTROL, true),
                (VK_CONTROL, false),
                (VK_V, false),
                (VK_V, true),
                (VK_CONTROL, true),
            ]
        );
    }

    use super::{input_block, InputBlock};

    #[test]
    fn this_process_reads_its_own_integrity_level() {
        let level = process_integrity(unsafe { GetCurrentProcess() });
        assert!(level.is_some_and(|l| (0x1000..=0x4000).contains(&l)));
    }

    #[test]
    fn no_window_is_nothing_to_block() {
        assert_eq!(input_block(0), InputBlock::Open);
    }

    #[test]
    fn the_czech_layout_types_at_with_ctrl_alt_v() {
        let before = keyboard_layouts();
        let hkl = unsafe { LoadKeyboardLayoutW(w!("00000405"), KLF_NOTELLSHELL) }
            .expect("the Czech layout ships with Windows");
        let had_it = before.contains(&hkl);
        let at = altgr_text_on(hkl, b'V' as u16, false);
        let shifted = altgr_text_on(hkl, b'V' as u16, true);
        let name = layout_name(hkl);
        let for_hotkey = super::altgr_char_for("ctrl+alt+v");
        if !had_it {
            unsafe { UnloadKeyboardLayout(hkl) }.expect("unload the Czech layout again");
        }
        assert_eq!(at.as_deref(), Some("@"));
        // Shift+AltGr+V has no character on the Czech layout
        assert_eq!(shifted, None);
        assert!(
            !name.chars().all(|c| c.is_ascii_hexdigit()),
            "the layout's name should come from the registry, not the handle: {name}"
        );
        eprintln!("Czech layout is named {name:?}");
        // With Czech on the list, some layout (at least that one) types
        // something with the default hotkey
        assert!(for_hotkey.is_some(), "{for_hotkey:?}");
    }

    #[test]
    fn a_layout_without_an_altgr_column_types_nothing_with_ctrl_alt_v() {
        let before = keyboard_layouts();
        let hkl = unsafe { LoadKeyboardLayoutW(w!("00000409"), KLF_NOTELLSHELL) }
            .expect("the US layout ships with Windows");
        let had_it = before.contains(&hkl);
        let text = altgr_text_on(hkl, b'V' as u16, false);
        let name = layout_name(hkl);
        if !had_it {
            unsafe { UnloadKeyboardLayout(hkl) }.expect("unload the US layout again");
        }
        assert_eq!(text, None);
        assert!(
            name.starts_with("US") || name.contains("United States"),
            "{name}"
        );
    }
}
