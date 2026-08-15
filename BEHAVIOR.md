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
2. The popup is positioned at the cursor, then clamped to the monitor under the
   cursor so it can't open half off-screen.
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

That is why file backing is reconciled rather than handled at creation.
**`ensure_packs_backed`** runs at startup and before every sync, giving every
name in play a `PackMeta` and a `.json` of its own. Handling it only in
`addPack` would miss every other route.

**`sync_pack_files`** writes each pack's shareable content — title, tags, text,
never `uses`/`pinned`/`configValues` — to its file on every save. Pack files are
a supported interchange surface: an agent can write one and the user imports it.

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

## State and where it lives

`%APPDATA%\com.promptline.app\`:

| File | Holds |
|---|---|
| `snippets.json` | `Vec<Snippet>` — the library |
| `config.json` | Hotkey, pack metadata, prefs, popup size, first-run flag |
| `packs/*.json` | Per-pack shareable content, derived from the library |

Disk is the single source of truth; both windows re-read rather than caching
across each other. When one window writes, Rust emits an event so the other
re-fetches:

| Event | Meaning |
|---|---|
| `snippets-changed` | Another window wrote the library — re-fetch before saving over it |
| `edit-prompt` | Popup asked the manager to open a prompt |
| `popup-shown` / `first-popup` | Popup opened; the second only ever fires once |

`snippets-changed` exists because the manager used to cache at startup: a prompt
created in the popup stayed invisible until reload, and the manager's next
autosave would clobber it with its stale copy.

**Preferences are mirrored into `localStorage`** as well as `config.json`. The
popup must apply theme, scale and font on first paint — a round-trip to Rust
would show a flash of the wrong theme on every summon.

Migrations run on load in `apply_snippet_migrations` (v2 `category` becomes the
first tag; packless prompts get a default pack) and via `#[serde(default)]` on
every field added since. Old data must keep opening.

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
