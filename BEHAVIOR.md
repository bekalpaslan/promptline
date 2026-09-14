# How Promptline behaves

A reference for anyone working on the code: what each surface does, and *why*
the non-obvious parts are the way they are. The README describes the app for
people using it; this describes it for people changing it.

Nothing here is a specification to conform to — it documents decisions already
made. Where a decision has a trap behind it, the trap is written down.

## Shape

Two webview windows and a tray icon, over one Rust core.

| Surface | Entry | Role |
|---|---|---|
| **Popup** | `popup.html` → `src/popup/` | The daily surface. Summoned by hotkey at the cursor, gone in a keystroke. |
| **Manager** | `index.html` → `src/manager/` | Editing, organising, settings. Opened by left-clicking the tray. |
| **Tray** | `lib.rs` | Left-click opens the manager; the menu quits. Reuses `default_window_icon()`, so it needs no asset of its own. |

Both windows are one Vite build sharing `src/index.css`, `src/lib/`, and
`ui/core.js`. They are separate OS windows with separate JS contexts — they
share nothing at runtime except the files on disk and Tauri events.

`ui/core.js` is deliberately a plain UMD module rather than TypeScript: it holds
the pure logic (tokenizing, fuzzy scoring, pack parsing) and is covered by
`tests/core.test.js` running under bare `node --test`, with no build step in the
way. `src/lib/core.ts` bridges it into React.

## The paste pipeline

The one flow everything else exists to serve. Hotkey to pasted text:

1. **`show_popup`** records the foreground window in `AppState.prev_window`
   *before* showing anything — once the popup takes focus, the window the user
   came from is unrecoverable.
   A hotkey press while the popup is already up — keyboard autorepeat while
   the keys are held, or a second tap — only re-focuses it. `RegisterHotKey`
   has no repeat suppression, and recording the foreground window on the
   repeat would make the popup its own paste target: Ctrl+V would land on a
   window that has just been hidden. Toggling the popup closed on a repeat is
   a possible follow-up (BACKLOG).
2. The popup is positioned at the cursor, then clamped to the *work area* of
   the monitor under the cursor — not its full bounds — so it can't open half
   off-screen or under the taskbar.
3. The user picks a prompt. If it needs runtime `{field}` values, the popup
   switches to form mode first, pre-filled from `snippet.fieldValues`.
4. **`paste_snippet`** hides the popup, reads the current clipboard, expands
   `{clipboard}` from it, writes the result to the clipboard, and bumps `uses`.
5. A detached thread waits 80 ms, calls `SetForegroundWindow` on the remembered
   window, waits another 80 ms, and sends Ctrl+V via `SendInput`.

The sleeps are load-bearing. Focus changes are asynchronous on Windows; sending
the keystroke immediately delivers it to whatever had focus a moment ago.

**The prompt stays on the clipboard afterwards.** Ctrl+V only lands if the
target window has a focused text field, and nothing here can know whether it
did. Restoring the previous clipboard — which is what this used to do — meant a
missed paste left the user with nothing at all: no paste, and the prompt gone.
Leaving it there makes a miss recoverable by pasting manually. The cost is that
a `{clipboard}` template consumes its own source text, so firing two in a row
expands the second from the first one's output.

`send_ctrl_v` releases Shift, Alt and Ctrl before pressing Ctrl+V. The user may
still be physically holding the hotkey's modifiers, and a stray Shift turns the
paste into something else entirely.

## Placeholders

Handled in `ui/core.js`, shared by both windows so the popup's preview and the
editor's preview can never disagree.

| Token | Resolved |
|---|---|
| `{clipboard}` `{date}` `{time}` | At paste time, from the environment |
| `{lowercase_word}` | Runtime field — the popup asks, remembering the last value in `fieldValues` |
| `{{lowercase_word}}` | Config parameter — from `configValues`, silently |

Two rules that exist because their absence was worse:

- **An unset `{{config}}` downgrades to a runtime field** rather than pasting an
  empty hole. Silently pasting a gap into a prompt is the failure nobody notices
  until the AI answers the wrong question.
- **Only lowercase names are parameters.** `{File}` and `{step1}` are shown as
  near-misses in the preview rather than silently treated as literal text.

## Packs and their files

A pack is just a name. It has no independent existence — `packNames()` is the
union of declared `PackMeta` and every `snippet.pack` in the library, so naming
a pack on a prompt conjures it. Imports and moves create packs this way.

**A group is the same kind of thing one level down**: `snippet.group`, a
label scoped to its pack, empty meaning ungrouped. It has no metadata, no lock,
no file. Renaming a group rewrites the label on every prompt that carries it,
and renaming onto an existing name merges the two. Deleting a group deletes its
prompts, so it goes through a real dialog rather than an armed menu item, and
the status bar offers Undo afterwards. Pack files carry the label as an
optional `"group"` on each prompt; older files and libraries load with it
empty.

That is why file backing is reconciled rather than handled at creation.
**`ensure_packs_backed`** runs at startup and before every sync, giving every
name in play a `PackMeta` and a `.json` of its own. Handling it only in
`addPack` would miss every other route.

**`sync_pack_files`** writes each pack's shareable content — title, tags, text,
group, never `uses`/`pinned`/`configValues` — to its file on every save, but
only when the bytes would actually change: an autosave touches one prompt,
and rewriting every pack file each time only fed file watchers (the Generate
dialog polls its file, editors and sync clients watch the folder). Pack files
are a supported interchange surface: an agent can write one and the user
imports it.

Two guards follow from that:

- **An empty pack never overwrites its file.** The library's view of a pack is
  empty both when the user emptied it and when an agent has just written prompts
  that haven't been imported yet. The two are indistinguishable here, and only
  one of them is safe to act on.
- **Deleting a pack moves its file to `packs/deleted/`** instead of unlinking
  it, for the same reason. `save_packs` compares by *path*, not name — renaming
  a pack drops its old name while keeping the same file, and a name comparison
  would retire a live pack.

Orphans are never swept automatically. A file in `packs/` that no pack claims
may be one an agent just dropped there for importing.

**`packs/generated/`** holds scratch files for the Generate dialog's survey mode
(agent path, empty topic). An agent writes the project's pack into one, with a
group per practice, and the pack is created on import under whatever name the
agent gave it. The scratch file backs no pack, so it lives below the top-level
`packs/` that metadata points into, and it stays there afterwards as a record
of what was generated.

## State and where it lives

`%APPDATA%\com.promptline.app\`:

| File | Holds |
|---|---|
| `snippets.json` | `Vec<Snippet>` — the library |
| `config.json` | Hotkey, pack metadata, prefs, popup size, first-run flag |
| `packs/*.json` | Per-pack shareable content, derived from the library |
| `*.corrupt-<unix seconds>` | A data file that failed to parse, moved aside untouched |

**Every write goes through `write_atomic`**: the bytes land in a sibling
`.tmp` file that is then renamed over the target, so a crash or power loss
mid-write leaves the previous file whole instead of a truncated one.

**A file that won't parse is quarantined, never replaced in place.** Loading
distinguishes three cases. Missing means a first run and yields the starter
pack. Unparseable means the file is renamed to `<name>.corrupt-<timestamp>`,
a `Notice` is raised, and the library starts *empty* — starting with the
starters instead would look like a reset rather than a loss, and the first
autosave would have buried the only copy of the user's prompts. An I/O error
(a lock, a permission problem) is an error the command returns; nothing is
written, because the file may be perfectly good.

`Notice`s are the channel for anything the user must see that can happen
before the manager's webview is listening: they are stored in `AppState`, the
manager drains them with `take_notices` on startup and receives later ones
through the `notice` event, and shows each as a toast that stays until
dismissed.

Disk is the single source of truth; both windows re-read rather than caching
across each other. When one window writes, Rust emits an event so the other
re-fetches:

| Event | Meaning |
|---|---|
| `snippets-changed` | Another window wrote the library — re-fetch before saving over it; payload is the new revision |
| `edit-prompt` | Popup asked the manager to open a prompt |
| `popup-shown` / `first-popup` | Popup opened; the second only ever fires once |
| `notice` | Rust hit something the user must see (quarantined file, refused hotkey); shown until dismissed |

Every delete in the manager goes through one `deleteWithUndo`, and both the
delete and the Undo read the *live* library, never the array captured by the
render that started them. An Undo built from a render's snapshot re-added the
deleted prompts on top of a list that still contained them, and the next
autosave wrote the duplicates to disk.

`snippets-changed` exists because the manager used to cache at startup: a prompt
created in the popup stayed invisible until reload, and the manager's next
autosave would clobber it with its stale copy.

**Writes are intent-level where they can be, and revision-checked where they
can't.** The popup never sends the whole library: it creates with
`add_snippet`, pins and remembers fill-ins with `patch_snippet`, deletes with
`delete_snippet`, and the editor's autosave is `update_snippet` with only the
fields the editor owns — each a read-modify-write on disk in Rust, so a
snapshot that is seconds old can't overwrite what the other window wrote
meanwhile (`uses`, `pinned`, `fieldValues` are the popup's; title, text, tags,
pack, group, `configValues` are the editor's). The manager's bulk operations
(move, tag, reorder, delete with Undo) still replace the array, so
`save_snippets` carries the revision the manager loaded and Rust refuses it as
`stale` if the file has moved on; the manager then reloads, tells the user,
and the change has to be redone. Every snippet command returns the library
with its revision, and the store lock serialises every read-modify-write.

**Preferences are mirrored into `localStorage`** as well as `config.json`. The
popup must apply theme, scale and font on first paint — a round-trip to Rust
would show a flash of the wrong theme on every summon.

Migrations run on load in `apply_snippet_migrations` (v2 `category` becomes the
first tag; packless prompts get a default pack) and via `#[serde(default)]` on
every field added since. Old data must keep opening.

## Content Security Policy

`tauri.conf.json` sets a CSP: only the app's own scripts, styles (inline
allowed — Tailwind and Base UI set style attributes), `data:` images (the
editor's select chevron) and fonts; `connect-src` is the IPC only. Tauri
injects it into the HTML it serves, so it is live in a release build and in
a dev build that uses the embedded assets; a page served by the Vite dev
server carries no CSP at all, which is why `devCsp` looks permissive (Fast
Refresh needs inline scripts and the HMR websocket) yet changes nothing
under `npm run dev`. Anything new that loads a remote resource, an inline
script, or a `blob:` URL has to be added to the policy first.

## The hotkey

A combination the OS refuses at startup — another program owns it — is a
notice, not a fatal error: the tray and the manager still come up, because
Settings is the only place the user could fix it. Changing the hotkey
registers the new combination *before* releasing the old one, so a refusal
leaves the old one working and the config unchanged.

## Theming

`.dark` on `<html>` swaps CSS custom properties. It also sets `color-scheme`,
which is what makes native UI the webview paints itself — scrollbars, `<select>`
popups, form controls — follow the theme. Tokens alone leave those light.

## Windows-specific code

Confined to the `platform` module in `lib.rs`: `foreground_window`,
`focus_window`, `send_ctrl_v`, `left_button_down`. Everything else is portable.
A macOS port reimplements that module (CGEventPost, plus the Accessibility
permission) and nothing else.

One oddity lives outside it: the popup hides on blur, but starting a
border-resize drag on an undecorated window *is* a blur, which would slam the
window shut mid-drag. `is_resize_drag` recognises the case — left button held,
cursor on or just outside the frame — and reclaims focus instead of hiding.

## Tests

```sh
npm test           # ui/core.js — placeholders, fuzzy search, pack parsing
npm run test:rust  # config/snippet migration, pack filename sanitising
npm run typecheck  # tsc over both windows
```

The split reflects what is worth testing: pure functions with real edge cases.
UI wiring and anything needing an `AppHandle` is verified by running the app.
