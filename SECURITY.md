# Security

## Reporting a problem

Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**), or email the maintainer at
bekalpaslan@gmail.com. Say what you found, how to reproduce it and which
release you tested; a fix ships as a normal release. Please don't open a
public issue for something that could put other users' clipboards or
libraries at risk before a fix is out.

## What the app touches

Promptline is a local tool and its whole attack surface is on your own
machine:

- **The clipboard.** It reads the clipboard to expand `{clipboard}` and to
  show previews, and writes the chosen prompt to it before pasting. The
  prompt stays on the clipboard afterwards on purpose (see `BEHAVIOR.md`,
  "The paste pipeline").
- **Keystrokes into the previous window.** After you pick a prompt it
  refocuses the window you came from and sends one Ctrl+V with `SendInput`.
  It never sends anything else and never reads what other windows type; the
  global hotkey is a `RegisterHotKey` registration, not a keyboard hook.
- **Local JSON files** under `%APPDATA%\io.github.bekalpaslan.promptline\`:
  your prompts, packs and settings, plus `promptline.log`. Pack files are meant to
  be shared; they hold titles, tags and prompt text, never your fill-in
  values or config parameters.
- **No network.** The app has no network code and no telemetry. The only
  outbound link is the "Buy me a coffee" button in Settings, which opens a
  fixed https URL in your browser. Nothing is downloaded or uploaded, and
  there is no auto-update.

The webviews run under a Content Security Policy that allows only the app's
own scripts and the Tauri IPC (`BEHAVIOR.md`, "Content Security Policy"),
with one minimal capability for both windows.

## Supported versions

Only the latest release is supported. There is no auto-update, so please
check the [Releases page](https://github.com/bekalpaslan/promptline/releases)
before reporting.
