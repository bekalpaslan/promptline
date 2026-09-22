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

**The sidebar never leaves the manager.** It is the library as a tree,
and whatever is selected in it fills the pane beside it: a prompt opens in
the editor, and a pack or group title shows its **overview** — the prompts
it holds as preview cards (a pack's ungrouped prompts, then each group under
a heading that opens that group), with the clipboard substituted as in every
preview. Clicking a title selects it the way clicking a row selects a
prompt; the chevron folds the tree, Enter folds too, and a double-click
renames. The overview has no folds of its own and no mode to leave: a card
click opens that prompt, the editor's crumbs (pack, group) open those
overviews, and Escape goes up one level — from a prompt to its group (or
pack), from a group to its pack. This replaced a full-window library view
that hid the sidebar to draw the same tree a second time. The tree itself
(`packTree`) and the row order (`sortPrompts`) come from `ui/core.js`, one
shape for the sidebar and the overview so the two can't disagree. The
three-dot, right-click and Menu-key actions on packs, groups and prompts
are one hook too (`useLibraryMenus` in `menus.tsx`), with the inline
rename and the delete-group dialog it drives, so both surfaces offer the
same menu; only "Move up/down" is sidebar-only, since the overview's grid
has no row order to move within. An overview follows a rename of its pack
or group; one whose group is gone shows the pack.

**The tree tells its levels apart without colour.** A pack is a bold row
with a box icon, a group a medium row in the secondary ink, a prompt a
regular row; a group's prompts hang from a guide line under its header,
and counts sit at the right in mono. Group names show as typed: uppercase
is for the app's own section labels, never for names the user wrote. The
accent hue marks state (the selected pack or group, focus, a search hit),
not structure, per the design system's "ink first, hue second"; so the
`heading` tokens are ink colours. In the overview a group is a heading over
a hairline, not a panel, so it doesn't repeat its pack's look.

**The sidebar's filter is always there, and apart from the display.** The
field under the title takes the popup's syntax (`#tag`, `@pack`, `>group`,
then free-text words anywhere in the prompt: `matchesQuery` in core), with
Ctrl+F from anywhere in the manager and Escape clearing it. Its filter
terms read as chips: the field is a plain input with transparent text over
a mirror that draws the same text, the terms on a ground and a hairline
(both drawn without padding, so the mirror lays out exactly like the input
and the caret stays where it belongs). While it holds text the tree opens
to its hits, a pack counts "hits / all", a pack without hits stays listed
but faded (so the tree keeps its shape), matched words are marked in
titles, and a line under the field counts them. A search
begun while a pack or group is shown stays inside it (a chip in the field;
its × or "N more elsewhere" widens it) and clearing the search drops the
scope. How the list is shown lives in the Display menu beside the field:
Packs or One list (each row then says where it lives), the order, and
collapse or expand all; a dot on the button means it is off the defaults
(packs, most used). The filter narrows the list the sidebar already
ordered; it never ranks, unlike the popup.

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
   switches to form mode first, pre-filled from `snippet.fieldValues`. Each
   field grows with its text, wrapped lines included, from one line to three,
   then scrolls; the fields and preview scroll together while the button stays
   in reach. An empty field is allowed and never silent, but quiet: its
   placeholder says it pastes nothing, the preview keeps its chip, and the
   button counts the empties. It used to be outlined in red, which shouted
   at every field of a form the user had only just opened.
4. **`paste_snippet`** reads the current clipboard, expands `{clipboard}`
   from it, writes the result to the clipboard, and only then hides the popup
   and bumps `uses`. The clipboard write comes first because it is the step
   that can fail (another program holding the clipboard open), and an error
   has to return to a window that is still on screen: the popup shows it in
   its feedback strip and nothing else happens. Copy-only (Ctrl+Enter) leaves
   the popup up for a moment to say "Copied to clipboard"; the popup hides
   itself afterwards. The `uses` bump is best effort in both halves, the
   read as much as the write: the popup is already hidden by then, so an
   error would reach nobody, and a library a sync client or scanner is
   holding for a moment must not turn into a paste that never happens with
   the prompt sitting on the clipboard.
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

**Search matches titles and tags fuzzily, bodies strictly.** `rankSnippets`
ranks title matches above tag matches above body matches, and the first two
accept a subsequence (`rvw` finds "Review"). The body tier does not: a
four-letter query is a subsequence of almost any paragraph, so that fallback
matched nearly every prompt and search stopped narrowing anything. A body has
to contain the query (`bodyScore`), or, for a multi-word query, start a word
with each of its words.

**The popup has its own undo.** A delete from the action panel offers
"U or Ctrl+Z to undo" in the feedback strip for a few seconds and puts the
prompt back through `add_snippet` with its old id, so nothing about it is
lost. It is popup-local on purpose: the manager may not be open, and a round
trip through it would depend on its state. The bare "u" is honoured only while
the search box is empty — every other key goes to the search box, and an
unconditional "u" made a query like "unit tests" impossible to type after a
delete; Ctrl+Z works whatever is typed.

## Placeholders

Handled in `ui/core.js`, shared by both windows so the popup's preview and the
editor's preview can never disagree.

| Token | Resolved |
|---|---|
| `{clipboard}` `{date}` `{time}` | At paste time, from the environment |
| `{lowercase_name}` | Runtime field — the popup asks, remembering the last value in `fieldValues` |
| `{{lowercase_name}}` | Config parameter — from `configValues`, silently |

**Previews show the clipboard, not the word "clipboard".** `{clipboard}`
expands at paste time, so every preview — the editor's, the popup's card,
the fill-in form's "Will paste" — substitutes the clipboard as it is now,
one line and cut at 240 characters (`clipboardPreview`), on the builtin's
tint so it still reads as a placeholder. An empty clipboard shows
"(clipboard is empty)": that is what would paste, and hiding it is how a
hole gets pasted. The manager re-reads the clipboard when its window
regains focus and after a copy or cut in it; the popup already re-reads
on every summon and copy.

Two rules that exist because their absence was worse:

- **An unset `{{config}}` downgrades to a runtime field** rather than pasting an
  empty hole. Silently pasting a gap into a prompt is the failure nobody notices
  until the AI answers the wrong question.
- **A name is lowercase letters, digits and `_`, never starting with a digit**
  (`isValidParam`). `{File}` and `{1st}` are shown as near-misses in the
  preview rather than silently treated as literal text; `{0}` and `{1}` stay
  text, so format-string slots in pasted code never turn into questions.
  Every pattern that substitutes a name (`fillFields`, `expandConfig`,
  `downgradeUnsetConfig`) uses this same rule, or a valid name would be
  asked for and then never filled.

**One name, one value; a numbered copy asks again.** Writing `{goal}` twice
pastes the one value in both places. For a second value of the same kind,
the editor's chip for a field already in the text carries a +, which
inserts the next free numbered copy (`nextCopyName`: `{goal_2}`, then
`{goal_3}`, all counted from the same stem, whichever copy's + is used).
The first `{goal}` is never renamed, so its remembered value keeps working;
the fill-in form labels the copy "Goal 2".

## Packs and their files

A pack is just a name. It has no independent existence — `packNames()` is the
union of declared `PackMeta` and every `snippet.pack` in the library, so naming
a pack on a prompt conjures it. Imports and moves create packs this way.

**The manager's New asks where.** Its menu makes a pack straight away (named
"New pack", selected, its name open for typing), a group in a pack the user
picks, or a prompt in a pack or group the user picks from the library's
tree; locked packs are listed but disabled. There is no default placement
there: a New that guessed put prompts in packs nobody chose. A group, being
a label, starts life on a draft prompt, and is what gets selected and named;
the draft waits inside it, so a group left with only that draft goes when
the draft is swept (below).

**Where a new prompt goes** when nothing chose — the popup's Ctrl+N, the
editor's and overview's empty-state buttons — is one rule for both windows
(`defaultPackFor` in `ui/core.js`): the pack that last received a prompt if it still exists and
is unlocked, else the default pack if it exists and is unlocked, else the
first unlocked pack, else a fresh "Unsorted"; a library with no packs at all
starts with the default pack. Both windows used to have their own version
and they disagreed once "My prompts" was locked. Only packs that exist are
candidates: the rule used to skip that check for the default pack, so a
library that had deleted "My prompts" saw Ctrl+N pre-select it and conjure
it again on save. The popup's pack select lists the packs that exist plus
the form's own choice, never a phantom default.

**A group is the same kind of thing one level down**: `snippet.group`, a
label scoped to its pack, empty meaning ungrouped. It has no metadata, no lock,
no file. Renaming a group rewrites the label on every prompt that carries it,
and renaming onto an existing name merges the two. Deleting a group deletes its
prompts, so it goes through a real dialog rather than an armed menu item, and
the status bar offers Undo afterwards. Pack files carry the label as an
optional `"group"` on each prompt; older files and libraries load with it
empty.

**Pack operations that touch metadata and prompts happen in one Rust step
or in a fixed order.** `ensure_packs_backed` runs inside every save, so a
rename done as two frontend writes let it see prompts still carrying the old
name and conjure a second pack; `rename_pack` renames both at once. A delete
removes the prompts first and the metadata second, for the same reason. And
because the reconciler can add metadata on any write, the manager re-reads
pack metadata after every write rather than trusting its own copy.

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
  one of them is safe to act on. The one exception is a file holding nothing but
  the manager's own swept "New prompt" drafts: that is the library's earlier
  output, not an agent's, and it is emptied so the draft doesn't linger.
- **Deleting a pack moves its file to `packs/deleted/`** instead of unlinking
  it, for the same reason. `save_packs` compares by *path*, not name — renaming
  a pack drops its old name while keeping the same file, and a name comparison
  would retire a live pack.

Orphans are never swept automatically. A file in `packs/` that no pack claims
may be one an agent just dropped there for importing. **Backing a pack adopts
such a file when it declares that very pack's name** (`pack_file_slot`): the
Generate dialog creates a pack's file before the pack exists, so an import that
conjures the pack used to find `<name>.json` taken and back the pack with
`<name>-2.json`, leaving the agent's file orphaned beside it. An adopted file is
never written over on adoption — it may still hold prompts the library has not
imported. A file claimed by another pack, or one that isn't a readable pack
document, is never taken.

**`packs/generated/`** holds scratch files for the Generate dialog's survey mode
(agent path, empty topic). An agent writes the project's pack into one, with a
group per practice, and the pack is created on import under whatever name the
agent gave it. The scratch file backs no pack, so it lives below the top-level
`packs/` that metadata points into, and it stays there afterwards as a record
of what was generated.

## State and where it lives

`%APPDATA%\io.github.bekalpaslan.promptline\` (the bundle identifier; it was
`com.promptline.app` until 0.2.9, a domain the project never owned, and
`migrate_data_dir` moves the old folder's contents into the new one on the
first start after the change, rewriting the packs' absolute file paths in
the moved config; a folder the move cannot touch stays where it is and
raises a notice):

| File | Holds |
|---|---|
| `snippets.json` | `Vec<Snippet>` — the library |
| `config.json` | Hotkey, pack metadata, prefs, popup size, first-run flag |
| `packs/*.json` | Per-pack shareable content, derived from the library |
| `packs/deleted/*.json` | Files of deleted packs, retired rather than unlinked (numbered on repeats) |
| `packs/generated/*.json` | Scratch files the Generate dialog's survey mode hands to an agent |
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
autosave wrote the duplicates to disk. The same rule covers every other
write from a closure that outlives its render: context-menu actions (pin,
move, tag, ungroup) and the Undo of a merge or a regroup pass `persist` an
*updater* that is applied to the latest library. An array captured at
`ctx.open` time carried the state of that moment back to disk up to 12 s
later, reverting a title typed in the editor or a use count bumped by the
popup in between — and the revision check could not see it, because the
manager's own reloads had kept the revision current while the closure's
array went stale.

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

**A pin remembers when it was pinned.** `pinnedAt` (ms since epoch, personal
state next to `uses` and `pinned`) is stamped when a prompt is pinned and
cleared when it is unpinned, and `rankSnippets` draws pinned rows in that
order. Ordering them by `uses` like the rest of the list made Ctrl+1..5 slots
swap as soon as one pin was pasted more often than another, which is the
opposite of what a pin is for. Legacy pins carry no stamp (0) and sort by
title among themselves. Every pin path goes through `C.withPin` (manager) or
`patch_snippet` (popup) so the stamp can't be forgotten. A popup pack heading
counts every prompt in the pack, its pinned ones included, even though those
rows are drawn up in the Pinned section — the count answers "how big is this
pack", the same number the manager's sidebar shows.

**Preferences are mirrored into `localStorage`** as well as `config.json`. The
popup must apply theme, scale and font on first paint — a round-trip to Rust
would show a flash of the wrong theme on every summon.

**The manager sweeps abandoned drafts at startup.** "+ New" creates a real
prompt titled "New prompt" with an empty body so the editor has something to
autosave into; one that was never filled in (that title, no text, never used)
is deleted when the manager next starts (roadmap 0.7). The popup cannot make
one: with an empty clipboard it refuses to save (L7), and a saved popup prompt
always has a body. Until the sweep runs, `rankSnippets` keeps such a draft out
of the popup's list and its Ctrl+1..5 slots (`isEmptyDraft`) — there is nothing
to paste from it — while the manager still lists and edits it. Such a draft
also backs no pack (`packs_in_play`): "New prompt" lands in the default pack,
and declaring that pack with metadata and a file the moment the draft was
written left a permanent empty "My prompts" behind once the draft was moved
to the pack the user meant, or swept. The pack is declared by the first save
that gives the draft a body or a title, like any other prompt's pack.

Migrations run on load in `apply_snippet_migrations` (v2 `category` becomes the
first tag; packless prompts get a default pack) and via `#[serde(default)]` on
every field added since. Old data must keep opening.

## Launching and quitting

**One process.** `tauri-plugin-single-instance` hands a second launch's
arguments to the running instance and exits it. Two processes over the same
files each kept their own revision counter, so the stale-write check could
not see the other's writes, and the second showed a second tray icon while
the first kept the hotkey. A second launch with no arguments (the Start
menu, the installer's finish page) opens the running instance's manager,
the same as a tray click.

**Autostart stays in the tray.** The autostart entry passes `--hidden`, and
`setup` hides the main window before it paints when it sees that argument.
The window is declared visible in `tauri.conf.json` so a normal launch shows
the manager straight away; a login launch of a tray app that opened a
1000×800 window over the desktop was the opposite of what autostart is for.

Tray Quit is a handshake, not an `app.exit`: Rust emits `quit-requested`,
the manager runs the editor's pending autosave (the 600 ms debounce would
otherwise lose the last edit) and answers with `quit_now`; Rust exits on
its own after 1.5 s if the webview never answers, so Quit can't hang.
`beforeunload` would not have done it — `app.exit` tears the webview down
without firing it.

**Closing a window hides it, whichever window it is.** The main window going
to the tray is the visible half of that; the popup needs it just as much,
because it is created once at startup and never rebuilt — Alt+F4 on it used to
destroy the window, and `show_popup` then had nothing to show, leaving the
hotkey dead until a restart. The popup's size is persisted on the way out, the
same as on a blur.

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
leaves the old one working and the config unchanged. The `hotkey` field is
serde-defaulted like every other: a `config.json` without it (hand-edited,
or half-written) used to fail to parse and be quarantined, taking every
pack's lock and file path with it.

## Theming

`.dark` on `<html>` swaps CSS custom properties. It also sets `color-scheme`,
which is what makes native UI the webview paints itself — scrollbars, `<select>`
popups, form controls — follow the theme. Tokens alone leave those light.

Three things are tokens on purpose and not literals, because each failed in
the theme it was not tuned for: the placeholder-kind colours
(`--param-builtin/-field/-config`, darker in light so chip text clears 4.5:1
on white), the segmented controls (`--segment-track/-active`, a raised tile in
dark instead of a hole), and the popup's floating shadows (`--shadow-pop`,
navy in light, black in dark). Focus is one colour (`--focus`) through one
utility (`focus-ring`, keyboard focus only). Tag hues stay dark-tuned in
`ui/core.js`; a chip sets `--tag` and the `tag-text` / `tag-tint` utilities
darken or fade it per theme — a `var(--tag)` inside a `:root` token would
resolve at `:root`, where `--tag` is unset.

What a prompt looks like in a list is drawn by one module for both windows,
`src/components/prompt-bits.tsx`: the key cap, the underline that marks a
search match, the token preview (popup hover card, fill-in form, overview
card, editor), and the Chip. Every small label is a Chip — #tags,
`{placeholders}`, the `{N}` and `+N` badges, add-suggestions, the sidebar's
search scope, the import badges — and its whole look is the `chipVariants`
table there: a `tone` for what it is, a `size` for where it sits (16px in a
row, 20px beside an editor input, inline in wrapping text). There were
thirteen hand-styled versions once, in three text sizes and three weights,
and they drifted. A difference between chips belongs in that table, never at
a call site. Two lookalikes stay apart on purpose: a key cap is a key, not a
label, and the sidebar's search-box chip draws under the input's text, so it
cannot take padding.

The rest of what both windows draw follows the same rule, one definition
each: the preview box (`PREVIEW_BOX`, grey, 13px), a pack or group's `Count`
(the bare number), key combinations (`Keys`, one cap per key), menus
(`components/menu-styles.ts`: the popup's panel for the context menus too),
fields (`components/field.tsx`: every input, textarea and select filled and
borderless; the two search boxes are the bordered exception, being the field
each window is built around), the segmented control, and the two heading
roles (`section-title` on a manager panel, `section-label` over a run of
items in a list or menu). Hover is `--hover` grey everywhere; the accent
marks what is selected and nothing else.

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
npm test           # tests/*.test.js under node --test (see below)
npm run test:rust  # the storage layer and its policies (see below)
npm run typecheck  # tsc over both windows
```

`npm test` runs two files. `tests/core.test.js` covers `ui/core.js`:
placeholders, fuzzy search and ranking, pack parsing, the rules the two
windows share (`defaultPackFor`, `removeParamToken`, pins). `tests/mock.test.js`
checks command parity: it scans `src/**` for every `invoke("…")`, `lib.rs`
for the `generate_handler![…]` list and `src/lib/dev-mock.ts` for the
commands the fake backend answers, and fails when the three disagree — a
command the UI calls but the mock ignores hides a whole flow from the
browser walk, and one Rust never registered fails at runtime.

`npm run test:rust` is around 26 tests in `lib.rs`, covering the storage
layer end to end: `write_atomic` (temp file, rename, nothing left behind),
loading with the missing / unparseable / I/O-error split and the byte-exact
quarantine of an unreadable file, the snippet and config migrations with
every field serde-defaulted (including a config without a hotkey), the
intent-level merges (`update` keeps what the popup owns, `patch` changes only
what is given, `add` replaces a duplicate id, `delete` reports change), the
pin stamp, pack filename sanitising and reserved Windows device names, pack
file adoption and write-only-when-changed, drafts backing no pack and a
draft-only file being emptied, `rename_pack` moving metadata and prompts
together and treating case variants as taken, the data-dir move from
`com.promptline.app` rewriting pack paths, and the starter pack's ids.

The split reflects what is worth testing: pure functions and file-level
policies with real edge cases. UI wiring and anything needing an
`AppHandle` is verified by running the app (`CLAUDE.md`, "Verifying UI
changes").
