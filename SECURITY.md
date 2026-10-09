# Security

## Reporting a problem

Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**), or email security@promptline.cc,
which reaches the maintainer. Say what you found, how to reproduce it and
which release you tested; a fix ships as a normal release. Please don't
open a public issue for something that could put other users' clipboards
or libraries at risk before a fix is out.

## What the app touches

Promptline is a local tool and its whole attack surface is on your own
machine:

- **The clipboard.** It reads the clipboard to expand `{clipboard}` and to
  show previews, and writes the chosen prompt to it before pasting. The
  prompt stays on the clipboard afterwards on purpose (see `BEHAVIOR.md`,
  "The paste pipeline").
- **Keystrokes into the previous window.** After you pick a prompt it
  refocuses the window you came from and sends one Ctrl+V with `SendInput`,
  first releasing any Shift, Alt or Ctrl still held from the hotkey, and
  one Enter after it only for a prompt set to Auto enter. It never sends
  anything else and never reads what other windows type; the
  global hotkey is a `RegisterHotKey` registration, not a keyboard hook.
- **Local JSON files** under `%APPDATA%\io.github.bekalpaslan.promptline\`:
  your prompts, packs and settings, plus `promptline.log`. Pack files are meant to
  be shared; they hold titles, tags and prompt text, never your fill-in
  values or config parameters.
- **The network.** No telemetry. At startup and once a day the app
  fetches a fixed URL, `https://promptline.cc/latest.json`, to see whether a
  newer release exists; the request carries nothing about the user (no
  version, no ID, no usage). An update installs only after the user accepts
  it, and only if its signature verifies against the public key built into
  the app. **Settings → About** turns the check off. The app opens one
  link, the "Buy me a coffee" button in Settings, in your browser. The
  command behind it (`open_url`) takes an address from the page but
  opens it only when it is on a short list in the code (that one address
  today), so a compromised page cannot use it to open anything else.

The webviews run under a Content Security Policy that allows only the app's
own scripts and the Tauri IPC (`BEHAVIOR.md`, "Content Security Policy"),
with one minimal capability for both windows.

## Supported versions

Only the latest release is supported. A copy installed from GitHub offers
new releases itself (**Settings → About → Check for updates**); please
update before reporting.
