# Promptline

**[promptline.cc](https://promptline.cc)** · [Download](https://github.com/bekalpaslan/promptline/releases/latest) · [Buy me a coffee](https://buymeacoffee.com/hurryupbob)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/clip/clip-dark.gif">
    <img src="docs/clip/clip-light.gif" width="720" alt="Copy a failing test's stack trace in a terminal running Claude Code, press Ctrl+Alt+V, pick Root cause first, and the prompt with the trace inside fills Claude Code's input">
  </picture>
</p>

**Copy the error. Hit the hotkey. Paste a real prompt.**

- **Copy, hotkey, paste.** Copy a stack trace, press `Ctrl+Alt+V`, pick a
  prompt: it lands in Claude Code, Codex or Cursor with the trace already
  inside.
- **Packs are files agents write.** One JSON file per project; point Claude
  Code or Codex at your repo and it drafts the pack for you to review.
- **No telemetry, no account.** One update check, at startup and once a day, off in a click.
  Your prompts are JSON files on your disk.

A tiny tray app for developers who run coding agents all day. Hit the
global hotkey (default `Ctrl+Alt+V`), a popup appears at your cursor with
your prompt library — pick one and it's pasted straight into the app you were
just using: Claude Code or Codex in a terminal, ChatGPT or claude.ai in the
browser, Cursor, a PR comment box, anywhere.

## The killer move

Copy an error / stack trace / diff, hit the hotkey, pick **"Root cause first"**
— your template pastes with the clipboard contents already inserted where
`{clipboard}` was. One gesture turns raw error text into a well-formed prompt.

## Install

Windows 10/11 only. Download an installer from the
[Releases page](https://github.com/bekalpaslan/promptline/releases):

- `Promptline_X.Y.Z_x64-setup.exe` — the setup exe (NSIS); smaller, and the
  one to pick if in doubt
- `Promptline_X.Y.Z_x64_en-US.msi` — the MSI, for those who prefer it

Or from a terminal, with [Scoop](https://scoop.sh):

```powershell
scoop bucket add promptline https://github.com/bekalpaslan/scoop-bucket
scoop install promptline
```

Scoop runs the same setup exe from the release, so the install is the same
one and it updates itself the same way.

The setup exe installs for the current user only, under
`%LOCALAPPDATA%\Promptline`, so there is no admin prompt; the MSI installs
for all users under Program Files and asks for admin. If Microsoft Edge WebView2 is missing (it ships
with Windows 11 and most Windows 10 machines), the installer downloads its
bootstrapper, which is the one moment installation needs the network.

The installers are not code-signed yet, so SmartScreen shows "Windows protected
your PC" on first run — choose **More info → Run anyway**. SignPath
Foundation's free signing programme for open-source projects didn't accept a
first application, and the project will apply again; the
[Code signing policy](https://promptline.cc/code-signing/) says what will be
signed and who approves it.

After installing, Promptline sits in the tray: left-click the icon for the
manager, press the hotkey anywhere for the popup. Promptline checks for a
newer release at startup and once a day; when there is one, Windows shows a
notification and the tray menu offers **Update to X.Y.Z**. Installing is a
click, a small progress window and a restart, and your prompts, packs and
settings carry over untouched. Each installer updates with its own kind:
a setup exe install with the next setup exe, an MSI install with the next
MSI. The first release with the check is still installed by hand; from
then on it updates itself, with the check on even for a library carried
over from an older version. Turn it off under **Settings → About**.

### Build from source

Requires Rust and Node 22. `npm run build` produces the same two installers
under `src-tauri/target/release/bundle/` (`nsis/` and `msi/`). See
[Development](#development).

## Why not…

**Why not Espanso or AutoHotkey?** They're good at what they do: a typed
trigger expands into text. They know nothing about your clipboard, packs or
fill-in fields; Promptline is a library you search, with a preview, pins and
your most used prompts first.

**Why not Raycast snippets?** Raycast is a fine launcher, but it's
macOS only, and its snippets have no packs, groups or files an agent can
write. Promptline runs on Windows today, with a macOS version on the way.

**Why not slash commands in Claude Code, or Cursor rules?** They're the
right tool inside the one tool they belong to. A prompt library hotkey works
everywhere: the same library pastes into the terminal, the browser, the IDE
and a PR comment box.

**Why not a clipboard manager?** Ditto and the Windows clipboard history
remember what you copied, and do it well. Promptline is what you meant to
say about it: your clipboard, inside the prompt you picked.

**Why not a Notion page of prompts?** It keeps prompts tidy, and it's two
windows and a copy away. Promptline is one hotkey away, in every window,
with your clipboard already inside.

## Uninstall

**Settings → Apps → Installed apps** (Apps & Features), like any other
program. The setup exe's uninstaller offers a **Delete the application
data** checkbox: leave it off to keep your library for a reinstall, tick
it to remove the data folder too. Either way it removes the autostart
entry it made, so nothing of Promptline runs at the next login. The MSI's
uninstaller removes the program only; turn autostart off in **Settings**
first.

## Back up / sync

Everything Promptline knows is in one folder,
`%APPDATA%\io.github.bekalpaslan.promptline\` — copy it to back up, restore
it to bring a library back. To share prompts rather than the whole library,
use the pack files: every pack owns a `.json` under `…\packs\` that the app
keeps current, so you can copy one to a colleague, commit it to a project,
or let an agent write into it; the other side imports it from **Settings →
Backup and import** (see [Data](#data)).

## Known limitations

- **Windows only, for now.** A macOS version is on the way; it needs the
  Windows-specific parts rewritten (see [Stack](#stack)).
- **Unsigned installers**, so SmartScreen warns once (above).
- **Elevated windows don't accept the paste.** Windows blocks keystrokes
  from a normal process into a window running as administrator (an elevated
  terminal, Regedit, an installer). The popup tells you when that happens;
  the prompt is on your clipboard, so paste it by hand.
- **WebView2 download at install** on the few machines that lack it (above).
- **An install from 0.2.16 or earlier keeps `Ctrl+Shift+V`.** New installs
  start on `Ctrl+Alt+V`, and an upgrade never moves a hotkey you already
  have. `Ctrl+Shift+V` is *paste* in Windows Terminal and *paste without
  formatting* in browsers; Promptline wins while it runs, and those apps
  lose the shortcut. Record `Ctrl+Alt+V` (or anything else) in
  **Settings** if you miss either.

**No telemetry. One update check, off in a click.** At startup and once a
day Promptline fetches one small file, `https://promptline.cc/latest.json`,
to see whether a newer release exists. The address is fixed and the same
for everyone; the request carries nothing about you (no version, no ID, no
usage). Like any web request it reaches GitHub Pages, which hosts
promptline.cc and logs IP addresses, and it names the updater library as
its user agent (`tauri-plugin-updater/2.12.0`). If you accept an update,
the installer downloads from GitHub Releases and is installed only if its
signature matches the key built into the app. Turn the check off under
**Settings → About**; *Check for updates* there still works by hand.
Nothing else leaves your machine except what you paste. If something goes
wrong it writes `promptline.log` under the data folder; attach it to a bug
report.

## Placeholders

| Token | Expands to |
|---|---|
| `{clipboard}` | whatever was on the clipboard when you hit the hotkey |
| `{date}` / `{time}` | current date / time |
| any other `{lowercase_word}` | a runtime fill-in field — the popup asks before pasting |
| `{{lowercase_word}}` | a config parameter — set its value once (editor → Placeholders), it pastes silently every time |

Unset config parameters downgrade to fill-in fields instead of pasting holes.
The editor's **Placeholders** card shows what the prompt's text holds, each
as a chip with an × that takes it out of the text, the config values beside
their names, and one "insert…" chip for adding more: a typed name, or a
built-in or a field name the rest of your library already uses.

## The popup

- **Enter** pastes · **Ctrl+Enter / Ctrl+click** copies only · **Esc** closes
- **Ctrl+1..5** pastes the top results instantly — pins (max 5) always sit on
  top, so they become stable muscle-memory slots
- **Tab** opens an action panel: paste / copy / pin / edit in manager / delete
- **→** shows the full-prompt preview card (also on mouse hover), with the
  prompt's whole title above its text; **PgUp** / **PgDn** scroll it and
  **←** closes it
- A line under the search box says what the clipboard holds, that it is
  empty (the rows that would paste without it hollow their icon), or that it
  still holds the last prompt you pasted; its **Ctrl N** key saves it as a
  new prompt
- Search is fuzzy over titles, tags, and bodies with match highlighting;
  `#tag`, `@pack` and `>group` terms filter (`#debug root cause`); click a tag pill to filter by it
- With no query, prompts sort by how often you use them, grouped under
  collapsible pack sections with a collapsible sub-header per group (**←**
  folds the selected row's group or pack, **Ctrl+→** unfolds everything);
  searching flattens them into one ranked list
- **Ctrl+N** turns whatever you just copied into a new prompt without leaving
  the popup — title pre-filled from the first line, pick its pack, confirm.
  Esc with an edited title asks once before discarding
- Deleting from the action panel asks once more, then offers **Undo**
  (a button, **Ctrl Z**) until the summon after next; copy-only confirms, and any
  failure shows in a feedback strip instead of vanishing
- The whole popup is keyboard-operable and screen-reader labelled (a real
  listbox, announced results, collapsible pack sections from the keyboard)
- **Drag the window edge** to resize; the size is remembered
- **Ctrl+K** (or the toggle beside the search box) keeps the popup open
  beside your work: it stays up after a paste and pastes into the last
  window you used, so a run of short replies to an agent is one click each.
  Drag its frame to move it; **Esc** closes it and ends Keep open
- **Auto enter** (a toggle under a prompt's text in the editor) presses
  Enter for you after the paste, for quick replies like "LGTM" or `/clear`.
  The popup marks those rows with ↵ and its hint bar says "paste and
  enter"; a copy never enters. It stays in your library and never travels
  in a pack file or an export
- The prompt stays on your clipboard after pasting — if the app you came from
  had no text field focused, the keystroke lands nowhere, so click into one and
  paste it yourself

## The manager (left-click the tray icon)

- **Autosaves** — no Save button, no lost drafts; Quit from the tray waits for
  a pending save. Deletes are two-click, and **Undo** covers a deleted prompt,
  a deleted pack (the pack comes back, not just its prompts), an ungroup, a
  regroup, and a merge
- Sidebar groups by **pack** (collapsible); each pack and group header has a
  menu button on hover (right-click works too) to rename / lock / export
  (to the clipboard or a file) / delete it; right-click prompts for multi-select actions (move to pack or
  group, add tag, pin/unpin, export, delete) — Ctrl/Shift+click to select
  several. Inline renames commit on Enter only
- **Groups** sit inside a pack: one pack per project, a group per practice
  (debugging, review, docs…). Right-click a pack header → **New group** to
  start one with a fresh prompt; set a prompt's group in the editor or from
  the right-click menu; dragging a prompt into another group moves it there.
  Right-click a group header (or use its ⋯) to start a new prompt in it,
  rename it, ungroup its prompts, or delete the group — deleting removes its prompts after a confirmation dialog
- **Locked packs** (🔒) refuse new prompts and can't be deleted, nor can their
  groups, until unlocked
- **New** above the list makes a pack, a group or a prompt, and always asks
  where: a group picks its pack, a prompt picks a pack or a group in one.
  A new pack or group is selected with its name ready to type. **Generate pack
  with AI** (also under New) takes a topic, hands you an instruction to paste into any AI chat,
  and imports its reply — every prompt is reviewed in a checklist (bulk
  select, per-row pack names, a prompt hiding invisible or direction-changing
  characters flagged and unticked, and malformed JSON is editable in place)
  before anything is added. With a coding agent, leave the topic empty and it surveys
  the project it runs in, writing one pack per daily practice; the dialog
  watches for the agent's file with an elapsed clock and a Stop button, and
  no pack exists until you import
- Sort by uses, title, or **Custom** — press and hold a row to lift it, then
  drag to arrange your own order; **Alt+Up / Alt+Down** moves the selected row
  from the keyboard
- Clicking a pack or group header shows its prompts in the pane and opens it
  in the tree; the chevron (or ←) folds it. **Ctrl+N** starts a prompt where
  the pane is looking, **Ctrl+F** reaches the filter
- Packs are listed A–Z until you arrange them: **Move up / Move down** in a
  pack's ⋯ menu (or **Alt+Up / Alt+Down** on its header). The popup lists
  packs in the same order. Groups move within their pack the same way
- Every control is reachable from the keyboard, including context menus, and
  labelled for screen readers
- **Settings** (⚙, top-right of the pane): record a hotkey by pressing it,
  then **Apply** it; autostart (a login launch stays in the tray; the
  manager opens from the tray icon); theme (Instrument, the default, or
  Indigo, each with a light and a dark side); mode (System / Light / Dark,
  System follows Windows); popup density; UI font (system / Outfit / Inter /
  serif / mono); UI scale (90–125%); **Packs** — each pack and its file,
  with rows to copy its path, show it in Explorer, import from it, export
  it, or create its file, plus Generate and New pack; **Backup and import**
  — export the whole library to the clipboard or a file, import from the
  clipboard or a file, or **Open folder** to see the data folder (library,
  packs and the log file) in Explorer; and **About**, with the version
  you're running

## Data

Everything lives in `%APPDATA%\io.github.bekalpaslan.promptline\` as plain JSON — snippets,
packs, and preferences. Pack format docs: [`packs/TEMPLATE.md`](packs/TEMPLATE.md);
curated packs ship in [`packs/`](packs/). Older data formats migrate automatically,
and a library from a release before 0.2.9 (which kept it under
`%APPDATA%\com.promptline.app\`) is moved to the new folder on first start.

Every pack owns a file under `…\packs\` from the moment it exists — however it
came about, including packs conjured by an import — and the app keeps it
current, so it's always there to share, back up, or let an agent write into.
Deleting a pack moves its file to `…\packs\deleted\` rather than unlinking it:
the file may hold prompts written there but never imported, and deleting a pack
in the app shouldn't be able to destroy them.

## Development

Requires Rust and Node 22 (`.nvmrc`).

```sh
npm install
npm run dev        # run in dev mode (starts Vite + Tauri; UI hot-reloads)
npm run build:unsigned  # produce the installers (src-tauri/target/release/bundle)
npm run build      # the same, signed for the updater (needs the release key)
npm run ui:build   # typecheck + build the frontend only
npm test           # JS core tests (node --test)
npm run tokens     # render design/tokens.json into src/index.css (tokens:check verifies)
                   # edited tokens on the design-system page? ask Claude to pull
                   # its project/tokens.json into design/tokens.json, then run this
npm run design:build  # bundle the real components + previews for the design-system artifact (design/dist)
npm run test:rust  # Rust unit tests (cargo test)
npm run lint       # ESLint over the whole tree (`npx eslint src` for the app alone)
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, the frontend build,
`cargo fmt`/`clippy` and the three test suites (node, Playwright, Rust) on every push and pull request; a
`v*` tag also builds both installers and keeps them as workflow artefacts
(the release itself is still made by hand). See [Install](#install) for the
unsigned-installer caveat.

The frontend is a two-entry Vite app (`index.html` → manager window,
`popup.html` → popup window) under `src/`. Shared pure logic lives in
`ui/core.js` (UMD; bridged into React via `src/lib/core.ts`, covered by tests).

[`BEHAVIOR.md`](BEHAVIOR.md) covers what each surface does and why the
non-obvious parts are built the way they are — start there before changing
the paste pipeline or anything touching pack files.
[`CONTRIBUTING.md`](CONTRIBUTING.md) has the checks and conventions;
[`SECURITY.md`](SECURITY.md) says what the app touches and how to report a
problem.

## Stack

Tauri 2 (Rust) + React 19 + Vite + Tailwind v4 + [shadcn/ui](https://ui.shadcn.com)
(Base UI primitives, Segoe UI by default with Outfit and Inter bundled, Remix
Icon). Windows-specific parts (focus restore via `SetForegroundWindow`, paste
via `SendInput`) are isolated in `src-tauri/src/platform.rs`; a macOS port
needs that file reimplemented (CGEventPost + Accessibility permission), plus
the Explorer call in `commands.rs`.

## Support

Promptline is free and stays free: the source is MIT and every release's
installers are on GitHub. If it saves you time,
[buy me a coffee](https://buymeacoffee.com/hurryupbob); the **Sponsor**
button at the top of the repository goes to the same page.

Questions, ideas and the prompts you reach for most go to
[Discussions](https://github.com/bekalpaslan/promptline/discussions); bugs
go to the [issue tracker](https://github.com/bekalpaslan/promptline/issues).

## Credits

- [Outfit](https://github.com/Outfitio/Outfit-Fonts), one of the UI fonts, by the
  Outfit Project Authors under the SIL Open Font License 1.1
- [Remix Icon](https://remixicon.com), the icons, by Remix Design under the
  Remix Icon License 1.0
- [Tauri](https://tauri.app), the shell that turns a Rust core and a webview
  into a Windows app
- [shadcn/ui](https://ui.shadcn.com) on [Base UI](https://base-ui.com), the
  components

The full licence texts and the rest of the bundled dependencies are in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md), which also ships with
the installer.

## License

MIT — see [`LICENSE`](LICENSE).
