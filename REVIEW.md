# Promptline review — 2026-09-14 — tracker

This file is the live source of truth for the review's findings. Every finding
keeps its severity, locations, failure scenario and proposed fix from the
original review; a **Status** line and a **Resolution** block record what was
done. Statuses: `TODO`, `IN PROGRESS`, `BLOCKED`, `DONE`, `DECLINED`. At most
one finding is `IN PROGRESS` at a time. `DONE` means the failure scenario is
fixed and verified by the checks listed in the resolution.

Scope: everything in the working tree at `73e680d` plus the (now committed, see
`7265cf5`) groups work (`>group` filter, group headers, `packs/generated/`,
`SizeDebug`). Line numbers in the findings refer to the working tree at review
time; they drift as fixes land. A second, UI-only pass (usability, visual
consistency, accessibility, interaction states, copy) was merged in on the
same day as the `U`-prefixed findings; its line numbers were taken after
`e437876` and are therefore ~20 lower in `Sidebar.tsx`, 9 lower in
`Editor.tsx`, 5 lower in `Settings.tsx` and 15 higher in `manager/App.tsx`
than the code findings' numbers.

Baseline before any change: `npm run typecheck` clean, `npm test` 29/29,
`npm run test:rust` 7/7. Versions agree at 0.2.4 across `package.json`,
`Cargo.toml`, `tauri.conf.json`. `dist/` is gitignored and not committed.
`npm run dev` with another Promptline instance already running exited at
startup because that instance owned the global hotkey (see H4).

## Ground rules (constraints, not findings)

Deliberate decisions in BEHAVIOR.md are treated as constraints:

- both 80 ms sleeps in the paste pipeline stay
- `prev_window` is captured before the popup is shown
- the resulting prompt stays on the clipboard after pasting
- `ui/core.js` stays a plain UMD module (no TypeScript, no ESM)
- an empty pack never overwrites its file; a deleted pack's file is retired to
  `packs/deleted/`; orphan files in `packs/` are never swept

Storage and concurrency work prefers Rust-authoritative intent-level
mutations, serialized access, atomic writes, typed load errors and revisioned
responses. Races are not papered over with JavaScript delays. UI logic that can
be pure goes into `ui/core.js` and gets a `node --test` case.

"Confirmed" in a finding means verified against library source; "by reading"
means the defect follows from the code but was not exercised in the running
app.

---

## Progress summary

Code findings (H, M, L):

| Status | High | Medium | Low | Decisions | Total |
|---|---|---|---|---|---|
| TODO | 0 | 2 | 11 | 3 | 16 |
| IN PROGRESS | 0 | 0 | 0 | 0 | 0 |
| BLOCKED | 0 | 0 | 0 | 0 | 0 |
| DONE | 6 | 11 | 1 | 5 | 23 |
| DECLINED | 0 | 0 | 0 | 0 | 0 |
| **Total** | **6** | **13** | **12** | **8** | **39** |

UI findings (UH, UM, UL — see "UI findings" below; UL9 is a keep-list, not
a task):

| Status | High | Medium | Low | Total |
|---|---|---|---|---|
| TODO | 11 | 19 | 7 | 37 |
| IN PROGRESS | 0 | 0 | 0 | 0 |
| BLOCKED | 0 | 0 | 0 | 0 |
| DONE | 2 | 3 | 1 | 6 |
| DECLINED | 0 | 1 | 0 | 1 |
| **Total** | **13** | **23** | **8** | **44** |

Implementation order: critical data integrity (H1, H3, H6) → high correctness
and security (H2, H4, H5, M9) → quick wins (M6, M7, M8, M1, M2, M11+L11, M10,
L2) → medium (M3, M4, M5, M12, M13, L1+L3, L9) → low documentation, structure
and release hygiene (L4–L8, L10, L12, D5, D6).

UI order, interleaved where a code fix touches the same lines: silent
failures and wrong guards (M3 with its manager half, UH4, UH5, L7, UM2) →
popup trust (UH1, UH2, UH3 with H5, UM3, UM22) → one pass over `index.css`
and the primitives (UH10, UH12, UH13, UM14, UM20; most of the visual list
collapses into this) → semantics and keyboard (UH6–UH9, UH11, UM11, UM13,
UM15, with UL6 adopting `Input`/`Label`/`Kbd`) → flows and copy (UM1, UM8,
UM9, UM10, UM21, remaining UM/UL).

---

## High

### H1. Undo after deleting a pack, a group, or a multi-selection duplicates the prompts
**Status:** DONE
**Where:** `src/manager/Sidebar.tsx` `deletePack` (~:308), `deleteGroup`
(~:269), multi-delete in `openRowCtx` (~:558); `src/manager/Settings.tsx:109-111`.
**What:** the Undo callback restores with `[...m.snippets, ...removed]`, but
`m` is the closure from the render in which the delete started, so `m.snippets`
is the *pre-delete* array that still contains `removed`. The editor's own
`doDelete` (`Editor.tsx:371-375`) gets this right by reading `mRef.current`.
**Failure:** delete a pack holding 3 prompts, click Undo. The library now holds
6 entries, 3 pairs sharing an id. React logs duplicate-key warnings, the sidebar
shows every prompt twice, the editor edits only the first copy, and the next
autosave writes the duplicates to `snippets.json` and the pack file.
**Fix:** restore from the latest state, not the captured one. Expose a
`snippetsRef` on the manager API or accept an updater in `persist`. A shared
`deleteWithUndo(ids, label)` in `state.ts` fixes all four sites and removes the
duplication listed in L1.
**Evidence:** by reading; high confidence.
**Resolution:**
- *Implementation:* `ui/core.js` gained `removeByIds(list, ids)` (returns
  `kept` plus each removed item with its index) and `restoreRemoved(list,
  removed)` (re-inserts at the old index, clamped, skipping ids already
  present). The manager API gained `deleteWithUndo(ids, label)` in
  `src/manager/App.tsx`, which reads `snippetsRef.current` for both the delete
  and the Undo and clears active/selection if they were removed. All five
  delete sites use it: Sidebar `deletePack`, `deleteGroup`, multi-select
  delete; Settings `deletePack`; Editor `doDelete` (which keeps its
  position-preserving restore through the helper).
- *Tests added:* `tests/core.test.js` — remove then restore yields the
  original array with positions kept; restore against the stale pre-delete
  list (the H1 scenario) produces no duplicate ids; positions clamp when the
  list shrank.
- *Manual verification:* dev build, manager window. Deleted the "Desktop" pack
  from the sidebar context menu (34 → 32 rows), clicked Undo: 34 rows, 34
  unique ids, "Restored" toast, `snippets.json` holds 34 unique ids and the
  pack's file was re-created. Same for a group via the delete dialog.
- *Commit:* `e437876`.

### H2. Holding or double-tapping the hotkey makes the popup its own paste target
**Status:** DONE
**Where:** `src-tauri/src/lib.rs:710-712` (`show_popup`); plugin handler
`:932-936`.
**What:** `show_popup` unconditionally records `GetForegroundWindow()` into
`prev_window`. `global-hotkey 0.8.0` registers with `RegisterHotKey` without
`MOD_NOREPEAT` (verified in `platform_impl/windows/mod.rs:96`), so keyboard
autorepeat delivers `WM_HOTKEY` repeatedly while the keys are held. The first
event shows and focuses the popup; the next one, ~250 ms later, records the
popup's own HWND as `prev_window`.
**Failure:** hold Ctrl+Shift+V a beat too long, or press it twice because the
popup felt slow, then press Enter. `paste_snippet` hides the popup, calls
`SetForegroundWindow` on the now-hidden popup, and Ctrl+V lands nowhere. The
user sees "nothing happened".
**Fix:** in `show_popup`, if the popup is already visible (`w.is_visible()`)
or the foreground HWND equals the popup's own (`w.hwnd()`), return without
touching `prev_window` (or toggle-hide; see D1). Document in BEHAVIOR.md.
**Evidence:** confirmed against crate source.
**Resolution:**
- *Implementation (`lib.rs` `show_popup`):* if the popup is already visible
  the hotkey only re-focuses it and returns (D1: ignore, not toggle); when it
  is not visible, the foreground HWND is recorded only if it isn't the popup's
  own. `prev_window` is still captured before the popup is shown.
- *Tests added:* none automated — `show_popup` needs an `AppHandle` and the
  Win32 foreground window; covered by the manual check below.
- *Manual verification:* dev build with a paste-target window and synthesized
  hotkey presses (Ctrl+Shift+V is intercepted by another tool on this machine,
  so the test hotkey was Ctrl+Alt+Shift+F9; the config was restored). Before
  the fix a second press while the popup was open re-ran `show_popup` (the
  popup reloaded and the typed query was reset — the same path that records
  the popup as `prev_window`). After: the second press leaves the query
  intact, and both a double-tap (300 ms gap) and a single tap followed by
  Enter paste "test" into the target window. The repeat-driven "nothing
  happened" case could not be provoked directly because synthesized key
  events don't autorepeat; the guard is on the path the review confirmed.
- *Commit:* `f82c4d4`.

### H3. A partial write or unreadable JSON silently replaces the library with the starter pack
**Status:** DONE
**Where:** `lib.rs:351-358` (`load_snippets_from_disk`), `:360-363`
(`write_snippets`), `:365-370` (`load_config_from_disk`), `:403-406`
(`save_config`).
**What:** every write is `fs::write` (truncate, then write, no temp file).
Every read maps a parse error to `default_snippets()` / `Config::default()`.
**Failure:** power loss or a crash mid-write leaves a truncated
`snippets.json`. On next launch the app shows 16 starter prompts; the first
autosave, use bump, or `sync_pack_files` overwrites the truncated file and the
user's library is gone. A corrupt `config.json` loses every lock flag and pack
path, after which `ensure_packs_backed` creates fresh `-2.json` files beside
the orphaned originals.
**Fix:** write to `<file>.tmp` then `fs::rename` (atomic on NTFS within a
volume). On a parse failure, rename the bad file to
`<file>.corrupt-<timestamp>`, start empty (not with starters), and emit a
`library-recovered` event the manager shows as a persistent error toast. Rust
tests for the rename path and for "parse failure never overwrites".
**Evidence:** by reading.
**Resolution:**
- *Implementation (`lib.rs`):* `write_atomic` (temp file beside the target,
  then `rename`) is used for `snippets.json`, `config.json`, new pack files,
  pack sync and the generated scratch file. `load_json_file` returns a typed
  `Loaded::{Present, Missing, Quarantined}`; an I/O error other than
  not-found is an `Err` and nothing is written over the file. A file that
  fails to parse is moved to `<name>.corrupt-<unix seconds>` (numbered if
  that exists) and reported through a new `Notice` channel: `notify` logs,
  stores in `AppState.notices`, and emits a `notice` event; the manager calls
  `take_notices` on startup and listens for the event, showing each as a
  persistent error toast (`sayPersistent`). The library then starts *empty*
  (an empty `[]` is written so the next load isn't a first run), never with
  starters; a quarantined config falls back to defaults with the same notice.
  `load_snippets_from_disk` / `load_config_from_disk` now return `Result`,
  and every read-modify-write command holds `AppState.store` for its
  duration. Callers that can't load skip writing (`ensure_packs_backed`,
  `sync_pack_files`, `persist_popup_size`).
- *Tests added (`cargo test`):* `write_atomic` replaces content and leaves no
  temp file; missing file is `Missing`, not an error; a good file parses; a
  truncated file is quarantined byte-for-byte under `snippets.json.corrupt-…`,
  a subsequent write to the original path leaves it untouched, and a second
  corruption in the same second gets a distinct name.
- *Manual verification:* backed up the real library, truncated
  `snippets.json` to half, relaunched the dev build: file moved to
  `snippets.json.corrupt-1789419932`, `snippets.json` is `[]`, sidebar shows
  every pack at (0), the manager shows the persistent toast with the path and
  a close button, pack files untouched (they still hold the prompts). Restored
  the backup, relaunched: 34 rows, no toast, no `.tmp` left behind.
- *Commit:* `a025d20`.

### H4. A hotkey the OS refuses aborts startup; a failed re-register leaves no hotkey
**Status:** DONE
**Where:** `lib.rs:975` (`handle.global_shortcut().register(shortcut)?` inside
`setup`), `lib.rs:414-415` (`set_hotkey`).
**What:** in `setup` a registration error propagates and `run()` panics with
"error while running Promptline". In `set_hotkey`, `unregister_all` runs before
`register`; if the new combination is taken, the old one is already gone and
`config.hotkey` is not updated.
**Failure:** (a) another tool owns Ctrl+Shift+V (clipboard managers often
do). Promptline exits at launch with no window and no tray icon, so the user
cannot reach Settings to change it. (b) In Settings, recording a taken
combination shows "Couldn't register", but the previous hotkey is dead until
restart while the UI still displays it.
**Fix:** (a) log, continue startup, emit `hotkey-failed`; the manager shows a
persistent error toast pointing at Settings. (b) register the new shortcut
first and unregister the old only on success. Rust test for the parse fallback.
**Evidence:** (a) confirmed: `npm run dev` while another instance held the
hotkey exited at startup. (b) by reading.
**Resolution:**
- *Implementation (`lib.rs`):* (a) `setup` no longer propagates the
  registration error; it raises a `hotkey-failed` notice naming the
  combination and pointing at Settings → Global hotkey (shown by the manager
  as a persistent toast through the H3 notice channel) and startup continues
  with tray and manager. (b) `set_hotkey` registers the new shortcut first and
  only then unregisters the old one; on refusal it returns the error with the
  config untouched, so the UI keeps showing the combination that is actually
  bound. Re-recording the configured combination after a startup refusal is
  a retry. `resolve_hotkey` is the pure parse-with-fallback.
- *Tests added (`cargo test`):* `resolve_hotkey` falls back to the default
  for garbage and empty strings and keeps a valid combination.
- *Manual verification:* (a) with one instance owning the hotkey, launched a
  second one: it started (process alive, manager window up) and logged
  `hotkey-failed: Couldn't register the hotkey … Another program probably
  owns it — choose a different combination under Settings → Global hotkey`.
  (b) a separate process held Ctrl+Alt+Shift+F8; `set_hotkey` to a free
  combination succeeded, `set_hotkey` to F8 was refused ("HotKey already
  registered"), `config.json` still held the previous combination, and that
  combination still summoned the popup.
- *Commit:* `13ca171`.

### H5. Fill-in values containing `$` are mangled
**Status:** DONE
**Where:** `src/popup/App.tsx:304`
(`text.replaceAll(`{${f}}`, formValues[f] ?? "")`).
**What:** a string replacement interprets `$$`, `$&`, `` $` ``, `$'`.
**Failure:** a `{goal}` field filled with "cap spend at $$50" pastes
"cap spend at $50"; "see $& above" pastes "see {goal} above". Config values
are safe (`expandConfig` uses a function replacer) and `{clipboard}` is
expanded in Rust, so only runtime fields are affected.
**Fix:** move the substitution into `ui/core.js` as `fillFields(text, values)`
with a function replacer; use it from the popup; test the `$` cases.
**Evidence:** by reading; certain.
**Resolution:**
- *Implementation:* `ui/core.js` `fillFields(text, values)` substitutes
  `{field}` tokens through a function replacer (values are inserted
  literally; names without a value, including builtins, are left alone);
  `submitForm` in the popup calls it instead of `replaceAll`. Done together
  with UH3, which lives on the same lines.
- *Tests added:* `tests/core.test.js` — `$$`, `$&`, `` $` ``, `$'` are
  inserted literally; repeated fields; builtins and unvalued fields
  untouched; missing values object tolerated.
- *Manual verification:* dev build. Added a prompt `goal: {goal} end`,
  summoned the popup, filled the field with `spend $$50 and $& here`,
  Ctrl+Enter (copy only): clipboard reads `goal: spend $$50 and $& here end`.
- *Commit:* `35adc7d`.

### H6. Popup writes the whole library from a snapshot and can drop a manager edit
**Status:** DONE
**Where:** `src/popup/App.tsx:274-276` (create), `:311-313` (form values),
`:322-324` (pin), `:329-331` (delete); Rust `lib.rs:384-396` writes whatever
array it receives.
**What:** the popup snapshots `snippets` on `popup-shown` and later writes the
full array. The manager autosaves on a 600 ms debounce (`Editor.tsx:226-229`)
and refreshes only on `snippets-changed`. Sync Tauri commands serialize on the
main thread, so the file is never torn, but the last full-array write wins.
**Failure:** type in the editor, hit the hotkey within 600 ms, pick a prompt
with a `{field}`, press Enter. Writes land in this order: popup snapshot,
manager debounce saves the edit, popup `submitForm` saves its snapshot. The
edit is gone; the manager re-fetches on `snippets-changed` and shows old text.
**Fix:** narrow Rust commands that read-modify-write on disk:
`add_snippet(snippet)`, `patch_snippet(id, {pinned?, fieldValues?})`,
`delete_snippet(id)`. `paste_snippet` already works this way for `uses`. The
popup then never sends a full array. Rust tests on the merge helpers.
**Evidence:** by reading.
**Resolution:**
- *Implementation (`lib.rs`):* intent-level commands `add_snippet`,
  `patch_snippet(id, {pinned?, fieldValues?})`, `update_snippet(id, edit)`
  (the editor's fields only: title, text, tags, pack, group, configValues) and
  `delete_snippet(id)`, each a read-modify-write on disk under the store lock
  via `mutate_library`, built on pure `merge_add` / `merge_patch` /
  `merge_update` / `merge_delete`. Every snippet command returns a `Library
  {snippets, revision}`; `AppState.revision` is bumped by every write of
  `snippets.json`. `save_snippets(snippets, base_revision)` refuses a
  full-array save whose base is behind the file with a typed
  `StoreError::Stale {revision}` and writes nothing; `snippets-changed` now
  carries the revision. Popup: create → `add_snippet`, form values / pin →
  `patch_snippet`, delete → `delete_snippet`; it never sends an array.
  Manager: `persist` pins the revision it loaded, and on any failure reloads
  from disk, toasts (a stale rejection says the popup wrote meanwhile and asks
  to redo the change) and rethrows so success toasts don't fire; the editor's
  autosave is `updateSnippet`, so it can never revert `uses`, `pinned` or
  `fieldValues` the popup wrote; `newPrompt` uses `add_snippet`. M13 falls
  out: `submitForm` no longer mutates the snippet in state.
- *Tests added (`cargo test`):* `merge_update` keeps popup-owned fields and
  ignores an unknown id; `merge_patch` changes only what is given;
  `merge_add` replaces a duplicate id, `merge_delete` reports change;
  `StoreError` serializes as `{"kind":"stale","revision":N}`.
- *Manual verification:* dev build. Read the popup's in-memory title ("Test
  H6b"), edited the title in the manager to "Test H6c" (autosave landed on
  disk), confirmed the popup still showed "Test H6b", then unpinned from the
  popup's action panel: disk holds "Test H6c" with `pinned: false`, the popup
  list refreshed to "Test H6c", the manager row lost its pin icon. Called
  `save_snippets` from the manager with `baseRevision - 1`: refused with
  `{"kind":"stale","revision":6}`, nothing written. Test prompt renamed back.
- *Commit:* `c725a09`.

---

## Medium

### M1. Settings "Export pack" and "Export library" drop `group`
**Status:** DONE
**Where:** `src/manager/Settings.tsx:96-101` vs `Sidebar.tsx` `packToJson`
(~:243).
**What:** two `packToJson` implementations; the Settings one predates groups.
**Failure:** export from Settings, import elsewhere: every group label is lost.
The sidebar's export keeps them.
**Fix:** one `packToJson` in `src/lib/`, used by both (and by "Export
selection", a third inline copy).
**Resolution:** `packToJson(name, prompts)` lives in `ui/core.js` (pure,
tested) and all three sites call it: Settings export pack / export library,
Sidebar export pack, Sidebar export selection. Test: group present only when
set; uses/pinned/fieldValues/configValues never exported; missing tags
become `[]`. Manual: Settings → Export library in the dev build copies JSON
whose Desktop prompts carry `"group": "as"` (2 packs, 34 prompts). Commit: `eb80c42`.

### M2. Keyboard focus is lost when leaving form or create mode
**Status:** DONE
**Where:** `src/popup/App.tsx:397-402` (Escape), `:278-280` (`saveCreate`).
**What:** form and create views replace the whole tree, so the search input
unmounts. On Escape nothing refocuses it; `saveCreate` calls
`inputRef.current?.focus()` synchronously after `setCreate(null)`, when the ref
is still null because the state change has not committed.
**Failure:** pick a `{field}` prompt, press Esc, start typing a new search:
keystrokes go nowhere (arrows still work because that handler is on
`document`). Same after Ctrl+N then Enter.
**Fix:** an effect keyed on `form`/`create` returning to null that focuses
`inputRef`; delete the synchronous focus call.
**Resolution:** an effect tracks `form`/`create` and focuses the search
input on the transition back to the list; the synchronous
`inputRef.current?.focus()` in `saveCreate` is gone. No automated test
(DOM focus). Manual (dev build, popup): picked a `{goal}` prompt → focus in
the form textarea; Escape → focus on the search input. Ctrl+N → focus in the
create title input; Escape → focus on the search input. Commit: `1ad4cba`.
**Evidence:** by reading; verify in the app. Independently confirmed by the
UI pass (rated High there: focus lands on `body`, no caret explains why).

### M3. The popup has no error surface; failed pastes and saves are silent
**Status:** DONE
**Where:** `src/popup/App.tsx:236-238` (`send`), `:298`, `:276`, `:313`,
`:324`, `:331`; manager `App.tsx:42-46` (`persist` does not catch) and every
`void m.persist(...)` in `Sidebar.tsx`.
**What:** `invoke` rejections are unhandled. `paste_snippet` hides the popup
*before* the clipboard write, so an error there is invisible. arboard retries
the clipboard open 5 times (`arboard-3.6.1 windows.rs:533-554`), which makes
this rare, not impossible. Disk-full or a locked file makes every manager
autosave fail silently while the UI keeps showing the unsaved text.
**Fix:** popup: wrap `send` and the writes; on error re-show the popup with a
one-line error strip. Manager: `persist` catches, calls `sayErr`, and
re-fetches so the UI reflects disk. Rust: in `paste_snippet`, write the
clipboard before hiding the popup so an error can return to a visible window.
UI pass (rated High): the popup mounts no `Toaster`, so there is no channel
even if an error were raised; in `saveCreate` a rejection leaves the create
view sitting there with no message. The error strip can reuse the
`panelNote` slot (`popup/App.tsx:110`) but see UM22 for its placement.
**Resolution:**
- *Implementation:* popup — a `notice` state rendered by `Shell` as a strip
  above the hint bar (`role="status"`, `aria-live="polite"`): errors say
  "Couldn't paste/copy/save/delete/load the library: <reason> — Esc to
  dismiss" and stay until Esc or the next summon; `send`, `saveCreate`,
  `patch`, `deleteSnippet` and `reload` all catch. Manager — done in H6
  (`persist` and `updateSnippet` catch, toast, reload from disk and rethrow).
  Rust — `paste_snippet` writes the clipboard *before* persisting the size
  and hiding the popup, with messages naming the step ("Couldn't open/write
  to the clipboard: …"); on failure nothing is hidden and `uses` is not
  bumped. Done with UM3 (copy-only feedback), which shares the strip.
- *Tests added:* none automated (needs the clipboard and a window).
- *Manual verification:* dev build. A helper process held the clipboard
  open with a real owner window (arboard then fails: "The native clipboard is
  not accessible due to being held by another party"); pressing Enter on a
  prompt showed the strip `Couldn't paste: Couldn't write to the clipboard:
  … — Esc to dismiss` with the list still on screen; Esc cleared it and
  focus stayed on the search input; the prompt's use count was unchanged.
  With the clipboard free, Enter pastes as before (H2 check).
- *Commit:* `25d006d`.

### M4. Every autosave rewrites every pack file
**Status:** DONE
**Where:** `lib.rs:218-248` (`sync_pack_files`), called from `save_snippets`
and `save_packs`.
**What:** each save re-serializes all packs and `fs::write`s each file, and
`ensure_packs_backed` reloads config and snippets from disk again.
**Failure:** typing in the editor with 20 packs produces 20 identical file
writes per 600 ms pause. Any file watcher (the Generate dialog polls every
2 s, editors, sync clients) sees constant churn.
**Fix:** serialize each pack, compare with the file's current bytes, write only
on change. Test.
**Resolution:** `sync_pack_files` now delegates to `write_pack_files(packs,
snippets)`, which serializes each file-backed, non-empty pack and writes
(atomically) only when the bytes differ from the file; it returns the number
written. Test: first sync writes, an identical sync writes nothing, a change
to one prompt rewrites only its pack, personal state (`uses`, `pinned`) never
triggers a write, an empty pack never gets a file. Manual: with three pack
files, editing a Desktop prompt's title twice changed `desktop.json`'s mtime
each time while `promptline.json` and `my-prompts.json` kept theirs.
Commit: `26fb8f2`.

### M5. Popup list rendering does redundant work per row and has no memoization
**Status:** TODO
**Where:** `src/popup/App.tsx:93-98` (`rowIcon` calls `requiredInputs`), `:624`
(`requiredInputs` again), `:621-683` (`row` closure re-created every render),
keyboard effect `:386-451` re-subscribes on every `sel` change.
**What:** each render tokenizes every visible prompt's body twice; every arrow
key re-renders every row because `row` closes over `sel`. No virtualization.
**Failure:** at 1k prompts with nothing collapsed, an arrow press is ~2k
tokenizations plus a 1k-row reconcile. Noticeable at 2-3k; fine today.
**Fix:** a `useMemo` map id → `{inputs, Icon}` on `snippets`; a `memo`ized
`Row` taking `(entry, selected, picked, compact)`. Leave virtualization until
a real library shows the need.

### M6. Popup clamps to the monitor bounds, not the work area
**Status:** DONE
**Where:** `lib.rs:726-735`.
**What:** uses `monitor.size()`; tauri 2.11.5 has `Monitor::work_area()`
(`tauri-2.11.5/src/window/mod.rs:96`).
**Failure:** hotkey with the cursor near the bottom of the screen: the popup's
last rows and the hint bar sit under the taskbar.
**Fix:** clamp against `work_area()`; a few lines.
**Resolution:** `show_popup` clamps against `monitor.work_area()`
(position and size) instead of `position()`/`size()`. No automated test
(needs a monitor). Manual: screen bottom 1440, work-area bottom 1392
(taskbar); cursor placed at (2520, 1434) and the popup summoned — popup
bottom 1385, right 2553, i.e. inside the work area. Commit: `418bf92`.

### M7. A UTF-8 BOM makes a valid pack file "not JSON"
**Status:** DONE
**Where:** `ui/core.js:153-154` (`stripFences`), `:199` (prefix test).
**What:** `﻿` is not stripped; `JSON.parse` fails and the diagnosis says
"not JSON — the source starts with '{'", which is contradictory on screen.
**Failure:** save a pack from Notepad or PowerShell `Out-File` (BOM by default
on older setups), Import from file: rejected with a misleading message.
**Fix:** strip a leading BOM in `stripFences`; one test.
**Resolution:** `stripFences` removes a leading U+FEFF before trimming and
de-fencing. Tests: `stripFences` drops the BOM; `diagnosePack` of a BOM
file is `ok`; `parsePacks` handles BOM plus fences. Manual: covered by the
pure test (the import path calls `diagnosePack` on the file's text
unchanged). Commit: `e1681c1`.

### M8. Reserved Windows device names become pack filenames
**Status:** DONE
**Where:** `lib.rs:143-155` (`sanitize_pack_filename`).
**What:** "CON", "NUL", "AUX", "PRN", "COM1"…"LPT9" survive sanitization.
**Failure:** name a pack "Con". `fs::write("con.json")` addresses the console
device; the write errors or hangs, `ensure_packs_backed` leaves `path` empty,
and the pack is never file-backed.
**Fix:** suffix reserved stems with `-pack`; extend the filename test.
**Resolution:** `sanitize_pack_filename` appends `-pack` when the stem is
`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9` or `LPT1`–`LPT9` (any case;
`COM0`, `com10`, `Console`, `Con Air` are not reserved). Test added for the
reserved set and the near-misses. Manual: `create_pack_file("Con")` in the
dev build returned `…\packs\con-pack.json` (test file removed afterwards).
Commit: `d994932`.

### M9. No Content Security Policy
**Status:** DONE
**Where:** `src-tauri/tauri.conf.json:45` (`"csp": null`).
**What:** the app loads no remote content and renders all text through React
text nodes, so there is no injection today. A CSP is defense in depth against a
future `dangerouslySetInnerHTML` or a dependency that injects.
**Fix:** `default-src 'self'; img-src 'self' data:; style-src 'self'
'unsafe-inline'; font-src 'self'`. `data:` is needed for the select chevron in
`Editor.tsx:439`; `'unsafe-inline'` for style because Tailwind and Base UI set
inline styles. Verify both windows in dev and in a release build. See D2.
**Resolution:**
- *Implementation (`tauri.conf.json`):* `csp` = `default-src 'self';
  script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
  font-src 'self'; connect-src 'self' ipc: http://ipc.localhost; object-src
  'none'; base-uri 'self'; form-action 'none'`. `devCsp` is the same with
  `'unsafe-inline'` scripts (React Fast Refresh preamble) and the Vite
  origin/websocket in `connect-src`. Tauri injects the policy only into HTML
  it serves itself (`get_asset` in `tauri-2.11.5/src/manager/mod.rs`), so
  under `npm run dev` the Vite-served pages carry no CSP at all; `devCsp`
  applies when a dev build uses the embedded assets. Recorded in BEHAVIOR.md.
- *Tests added:* none automated (configuration).
- *Manual verification:* release build (`tauri build --no-bundle`), both
  windows: a `fetch("https://example.com")` raises a
  `securitypolicyviolation` (`connect-src blocked https://example.com/`) and
  rejects; a `data:` image loads; Outfit loads; IPC works (34 rows); the
  editor opens with its data-URI select chevron intact and no violations;
  toasts render. Dev build, both windows: no CSP present (as explained), app
  unaffected.
- *Commit:* `0a803aa`.

### M10. Toasts follow the OS theme, not the app theme
**Status:** DONE
**Where:** `src/components/ui/sonner.tsx:8` (`useTheme()` from `next-themes`
with no `ThemeProvider` mounted anywhere).
**What:** `theme` resolves to "system", so Sonner reads
`prefers-color-scheme`; the app's theme is the `.dark` class.
**Failure:** app in Light, OS in dark: toast text and icon colors use the dark
palette on a light `--popover` background.
**Fix:** derive the theme from `document.documentElement.classList` (a
`MutationObserver`, or pass `m.prefs.theme` down). Drop `next-themes`; nothing
else uses it.
**Resolution:** `sonner.tsx` derives the theme from the `.dark` class on
`<html>` through a `MutationObserver` (`useAppTheme`), so it follows the
Light/Dark toggle exactly; `next-themes` removed from `package.json`. No
automated test (DOM). Manual (dev build, manager): with a toast up, the
toaster's `data-sonner-theme` is `light` after clicking Light and `dark`
after clicking Dark; light-mode toast screenshot checked. Commit: `195215d`.

### M11. `paste_snippet` doc comment contradicts BEHAVIOR.md
**Status:** DONE
**Where:** `lib.rs:648-650` says "then restore the previous clipboard".
**What:** the body and BEHAVIOR.md deliberately do not restore (commit
`d46212e`). The comment predates that.
**Fix:** rewrite the comment.
**Resolution:** comment now says the prompt stays on the clipboard and
points at the body's note and BEHAVIOR.md. Commit: `17766a9`.

### M12. Pending editor autosave is lost on tray Quit
**Status:** TODO
**Where:** `Editor.tsx:226-229` (600 ms debounce), `lib.rs:994`
(`app.exit(0)`).
**Failure:** type, then Quit from the tray within 600 ms: the last edit never
reaches disk. Also true for Windows shutdown.
**Fix:** flush on `beforeunload`/`pagehide` in the editor, or a Rust
`flush-and-quit` handshake. See D3. UI pass: there is also no
"Saving…/Saved" caption or dirty marker anywhere, so the user has no signal
that it is safe to close; add a two-state caption near the title driven by
`saveTimer`.

### M13. `submitForm` mutates an object that lives in React state
**Status:** DONE
**Where:** `src/popup/App.tsx:310` (`snippet.fieldValues = {...}`).
**What:** works today because the array is new, but a future `memo`ized row
comparing `s === prev.s` (M5) would miss the change.
**Fix:** `{ ...snippet, fieldValues }`; falls out of H6.
**Resolution:** fixed with H6 — `submitForm` sends `{fieldValues}` to
`patch_snippet` and replaces the popup's list with the returned library; the
object in state is never written to. Verified by reading `submitForm`; the
form-values path is exercised again in M3's paste check.

---

## Low

### L1. Logic duplicated between popup and manager
**Status:** TODO
- `DEFAULT_PACK`, `MAX_PINS`: `popup/App.tsx:20,29` and `manager/state.ts:107-108`.
- `packNames` / `isLocked`: `popup/App.tsx:210-221` and `manager/App.tsx:53-68`.
- "which pack does a new prompt go to" (`lastPack`, locked fallback):
  `popup/App.tsx:246-252` and `manager/App.tsx:89-97`, with *different*
  fallback orders ("Unsorted" exists only in the manager version).
- `packToJson`: `Settings.tsx:96-101`, `Sidebar.tsx` (~:243), and a third
  inline copy for "Export selection" (~:535). See M1.
- Token chip rendering: `popup/App.tsx:49-76` (`Tokens`) and
  `Editor.tsx:109-151` (`TokenPreview`) share the class set and labels.
- `deletePack` + undo: `Settings.tsx:103-112` and `Sidebar.tsx` (~:301).
- `Config` shape: `manager/App.tsx:16-24` and inline in `popup/App.tsx:361`.
**Fix:** a `src/lib/library.ts` holding `DEFAULT_PACK`, `MAX_PINS`,
`packNames(meta, snippets)`, `isLocked`, `defaultPackFor(...)`, `packToJson`,
and the `Config` type; both windows import it.

### L2. Dead code and stray dev aids
**Status:** DONE
- 13 unused shadcn components: `badge`, `collapsible`, `command`,
  `context-menu`, `dropdown-menu`, `input`, `input-group`, `kbd`, `label`,
  `scroll-area`, `select`, `separator`, `tooltip`. Tree-shaken from the
  bundle, but they carry `cmdk` and inflate `typecheck` and future upgrades.
- `cmdk` is a runtime dependency used only by the unused `command.tsx`;
  `next-themes` only by `sonner.tsx` (M10).
- Nine `eslint-disable-next-line` comments and no ESLint config or script.
- `src/lib/SizeDebug.tsx` (untracked) is imported by both windows
  (`manager/App.tsx:4,251`, `popup/App.tsx:4,822`). It renders nothing in
  production but its `useEffect` still attaches a resize listener there.
  Decide: keep behind `import.meta.env.DEV` at the import site, or remove
  before committing the groups work.
- `src-tauri/capabilities/default.json:4` still says "EasyPaste windows".
**Resolution:** deleted nine unused primitives (`badge`, `collapsible`,
`command`, `context-menu`, `dropdown-menu`, `input-group`, `scroll-area`,
`select`, `tooltip`) and the `cmdk` dependency; kept `input`, `label`,
`kbd`, `separator` because UL6/UM11/UM20 adopt them (D4 refined by UL6).
`next-themes` went with M10. `SizeDebug` is mounted only behind
`import.meta.env.DEV` at both sites, so production neither renders it nor
attaches its listener. Capability description now names Promptline. The
`eslint-disable` comments are D5's. Typecheck proves nothing imports the
removed files. Commit: `f3454bd`.

### L3. TypeScript strictness gaps in the bridge
**Status:** TODO
**Where:** `src/lib/core.ts`.
- `PackDiagnosis` is `{ok: boolean; message?; packs?}`, forcing `diag.packs!`
  at `ImportCuration.tsx:469,480` and `GenerateDialog.tsx:260`. A
  discriminated union removes every `!`.
- `TAG_COLORS: string[]` is wrong (it is a `Record<string,string>`; the test
  uses `core.TAG_COLORS.debug`).
- `parsePacks(): unknown` although the shape is known.
- `matchesFilters(snippet: Snippet, …)` demands a full `Snippet`; it reads only
  `tags/pack/group`.
- `createContext<ManagerApi>(null!)` in `state.ts:144`; a throwing
  `useManager` is the usual guard.
- `handleRowClick` casts `e as React.MouseEvent` three times; a
  `{ctrlKey, metaKey, shiftKey}` pick type is honest.
- `noUncheckedIndexedAccess` is off; enabling it would flag `visible[sel]`
  reads that are already guarded, at the cost of a few `?.`.

### L4. Match highlighting can misalign on non-BMP titles
**Status:** TODO
**Where:** `popup/App.tsx:79-90` iterates `[...title]` (code points) with
indices from `fuzzyScore`, which are UTF-16 offsets of the lowercased string
(`core.js:86-101`). An emoji in a title shifts every underline after it.
**Fix:** iterate by UTF-16 index, or accept the edge.

### L5. Search ergonomics (design notes, not defects)
**Status:** TODO
- Multi-word queries must match as one subsequence including the space
  (`core.js:85-101`); "root fix" misses "Root cause first" on title and falls
  to body. Word-wise AND matching would rank better; a ranking decision.
- A bare `>` in the query is dropped (`core.js:112`), so "a > b" and "a>b"
  differ. Documented by the test; acceptable.

### L6. Non-text clipboard reads as empty
**Status:** TODO
**Where:** `lib.rs:583-589`. An image on the clipboard expands `{clipboard}`
to nothing with no hint in list mode (the form preview already says
"(clipboard is empty)").

### L7. Ctrl+N with an empty clipboard creates an empty prompt
**Status:** TODO
**Where:** `popup/App.tsx:241-281`. Saving with `clip === ""` yields a
"New prompt" with no body, which the manager's startup GC
(`manager/App.tsx:166`) later deletes silently.
**Fix:** disable Save when the clipboard is empty, with inline text "Copy
something first — the clipboard is the prompt body"; and give popup-created
drafts a non-sentinel title (e.g. "Untitled prompt") so the GC can never
claim them. The Save button is always enabled today (`popup/App.tsx:549`).
UI review rated this Medium: the loss is silent and delayed.

### L8. Agent generate path creates the pack before anything is written
**Status:** TODO
**Where:** `GenerateDialog.tsx:233-238`. "Create file & copy instructions"
with a topic persists a new empty `PackMeta`; cancelling leaves an empty pack
in the sidebar. Consistent with "a pack is just a name"; worth a note in the
dialog or a cleanup on cancel while the pack is still empty. The
no-stop/no-timeout half of the same flow is UM1; fix the two together
(create the pack on successful import).

### L9. Accessibility gaps
**Status:** TODO
Superseded in detail by the UI findings; this item closes when they do.
- Popup list semantics → UH6 (rated High there).
- Tag pills, action panel, preview card, DeleteBadge, sidebar headers → UM13.
- Create/form and manager labels → UM11.
- Context menus, Settings rows, popup headers, drag → UH7, UH8, UH9, UH11.
- Focus rings, contrast, live region, reduced motion, hit targets → UH10,
  UH13, UM14, UM15.
- Dialogs (Base UI) and `ImportCuration` rows (`role="checkbox"`) are correct,
  though the inner `<Checkbox>` needs `aria-hidden` (UM20).

### L10. Theme and visual consistency
**Status:** TODO
Superseded in detail by the UI findings; this item closes when they do.
- `--sidebar-*` and `--chart-*` tokens are defined in `index.css` but unused.
- `#00a6f4` focus border → UH10 (not a brand colour; it bypasses `--ring` and
  is one of four focus systems). Claude orange `#d97757` → UL5 (deliberate,
  comment it).
- Dark-mode `--border` at 10 % white → UM20 (rows lose their edges; the
  segmented controls invert outright, UH12).
- Placeholder-kind chips and tag hues fail contrast in light → UH13.

### L11. Docs drift
**Status:** TODO
- `UI-REWORK-ROADMAP.md` (lines 3-6) says the two meta-bars were "kept
  separate"; `BACKLOG.md` says the clipboard bar was removed on 2026-08-15.
  The backlog is right.
- `BEHAVIOR.md` "State" table lists `packs/*.json` but not `packs/deleted/`
  and `packs/generated/` (both explained in prose; the table is the quick
  reference).
- `BEHAVIOR.md` does not mention the manager's startup GC of empty
  "New prompt" drafts (`manager/App.tsx:164-167`), a non-obvious decision
  (roadmap 0.7) that surprises anyone who creates a draft in the popup.
- `lib.rs:648-650` (M11).
- README, the macOS note, the `platform` module description, and BACKLOG's
  open items all match the code.

### L12. Build and release
**Status:** TODO
- Versions consistent (0.2.4 × 3). `dist/` ignored. `src-tauri/gen/schemas`
  committed, as Tauri expects.
- No `lint` script; `typecheck` and both test suites exist. No CI in the repo.
- Bundle: `utils-*.js` 242 KB, `main-*.js` 171 KB, `popup-*.js` 19 KB, CSS
  72 KB, fonts 47 KB. Reasonable for a desktop webview.
- `shadcn` (the CLI) is a runtime dependency because `index.css` imports
  `shadcn/tailwind.css`; correct but surprising, worth a comment in
  `index.css`.
- `typescript ~6`, `vite ^8`, `@vitejs/plugin-react ^6` are current majors;
  `package-lock.json` is committed.

---

## UI findings (second pass, 2026-09-14)

Produced by four independent lens reviewers (usability / Nielsen, visual and
design system, accessibility and keyboard, interaction states and copy) and
two cross-verifiers that re-checked every finding against the working tree,
merged duplicates and re-rated severity. IDs are prefixed `U` so they never
collide with the code findings above. Where a UI finding overlaps a code
finding, the code finding was amended in place and no `U` item was created
(M2, M3, M12, L7, L8 gained detail; L9 and L10 now point here). Line numbers
are from the working tree at verification time.

Dropped after verification: the undo-duplicates finding (already fixed, H1);
a "keyboard trap" claim on the hotkey field (Escape exits and is documented at
`Settings.tsx:136-139`); a ctx-menu "runs off-screen" claim (clamped at
`ctx-menu.tsx:64-81`); a `var(--primary)` token claim (it is the real
property).

Three patterns account for most of the High list: nothing in the popup can
report an error and the manager persists optimistically (M3); every menu,
listbox and disclosure is hand-rolled from `div`s while the shadcn primitives
sit unimported (D4); colour is set by literal value in four places and each
fails in the theme it was not tuned for (UH10, UH12, UH13).

### UH1. Hotkey recorder commits on the first keystroke and registers Shift+Tab
**Status:** TODO
**Where:** `src/manager/Settings.tsx:49-83, 113-128`.
**What:** recording starts on focus (:122) and the first valid combo is
registered immediately (:76); no Apply, Cancel or Reset. `e.preventDefault()`
runs before any branch (:51), so Tab yields combo `"tab"` and an error toast,
and Shift+Tab yields `shift+tab`, which passes the modifier check.
**Failure:** Tab through Settings with the hotkey field in the path: the
global hotkey is now Shift+Tab. Escape does exit, so this is not a trap, but
the field has no label or `aria-describedby`.
**Fix:** early-return on Tab/Shift+Tab before `preventDefault`; arm with an
explicit Record button; show the pending combo with Apply / Cancel / Reset to
default. Related: H4 (a failed re-register must not drop the old hotkey).
**Evidence:** by reading; cross-verified.

### UH2. Popup delete is permanent with no undo
**Status:** DONE
**Where:** `src/popup/App.tsx:328-333, 343-345, 393`.
**What:** "Delete" → "Confirm delete?" then the prompt is gone and the panel
closes. Every manager delete offers 8 s Undo. Number keys 1-9 fire panel
actions directly (:393).
**Failure:** a mis-aimed second press on the fast keyboard surface destroys a
prompt with no recovery path.
**Fix:** keep the panel open with `Deleted "<title>" — press U to undo` for a
few seconds, or route the delete through the manager's `deleteWithUndo`. See
D8.
**Evidence:** by reading; cross-verified.
**Resolution (D8: popup-local):** after a delete the feedback strip reads
`Deleted "<title>" — U to undo` for 8 s; U (no modifiers, list mode)
re-adds the exact snippet through `add_snippet` (same id, so uses, pin and
remembered fill-ins come back) and the strip says `Restored "<title>"`. The
offer expires with the strip and is cleared on the next summon. Verified in
the dev build: Tab → 5 → 5 deleted "FB temp" (18 → 17 rows), U restored it
(18 rows, present on disk with its body). Commit: see commit list (popup
feedback).

### UH3. An empty fill-in field pastes an empty hole, silently
**Status:** DONE
**Where:** `src/popup/App.tsx:304, 609-614`.
**What:** `formValues[f] ?? ""`; the button reads "Paste" and is enabled.
This is the failure BEHAVIOR.md:73-75 builds the config-downgrade rule to
prevent, permitted at runtime.
**Fix:** red border on empty fields and a label stating the consequence
(`Paste with 1 field empty`); keep it enabled, deliberate blanks are
legitimate. Lands naturally with H5 (`fillFields` in `ui/core.js`).
**Evidence:** by reading; cross-verified.
**Resolution:** done with H5. An empty field gets a destructive outline,
`aria-invalid`, and the label suffix "empty — pastes nothing"; the submit
button reads `Paste with 1 field empty` (or `Copy …` in copy mode — the
label half of UM3) and stays enabled. Labels now carry `htmlFor` to the
textarea `id`. Verified in the popup: empty → outlined, `aria-invalid=true`,
button "Paste with 1 field empty"; filled → plain "Paste". Screenshot taken.
Commit: see H5.

### UH4. Pack-file failure produces two contradictory toasts
**Status:** DONE
**Where:** `src/manager/App.tsx:139-146`; raw `String(e)` also at
`App.tsx:168`, `Sidebar.tsx:320`, `Settings.tsx:283, 413`.
**What:** on `create_pack_file` failure `sayErr(String(e))` runs, then the
code falls through to `persistPacks` and `say("Pack … created")`.
**Failure:** a raw Rust error and a green success at once; the user ends with
an un-backed pack and is told it is fine.
**Fix:** return after the catch, or say `Pack "X" created, but its file
couldn't be written — use "Back with a file…" to retry`. Replace every bare
`String(e)` with a sentence that names the action.
**Evidence:** by reading; cross-verified.
**Resolution:** `addPack` still creates the pack (a pack is just a name)
but says one thing: `Pack "X" created, but its file couldn't be written
(<reason>) — use "Give this pack a file…" to retry`; on success the green
toast as before. Every bare `String(e)` now names the action (preferences,
pack file, link). "Back with a file…" is renamed "Give this pack a file…"
(UM21's suggestion) in the sidebar and Settings. Verified by reading and
typecheck; the failure itself needs an unwritable packs directory. Commit:
see commit list (UH4).

### UH5. Pin guard rejects legal pins and the message is wrong
**Status:** DONE
**Where:** `src/manager/Sidebar.tsx:436-441`.
**What:** the check is `already + selected.length > MAX_PINS`, counting
already-pinned rows in the selection as new. `toPin` is computed at :437 and
never used in the message.
**Failure:** select 3 rows (2 pinned) with 3 other pins: "Max 5 pins — that
would make 6", though the result would be 4.
**Fix:** compare `already + toPin.length`; message
`Max 5 pins — 3 already pinned, so you can pin 2 more`. One core test.
**Evidence:** by reading; cross-verified.
**Resolution:** `pinPlan(snippets, ids, max)` in `ui/core.js` counts only
rows that would newly be pinned (already-pinned rows in the selection take
no slot) and returns `already`, `toPin`, `room`; the sidebar's Pin action
uses it and says `Max 5 pins — N already pinned, so you can pin M more`.
Test covers the review's scenario. Manual: see verification note. Commit:
see commit list (UH5).

### UH6. Popup list is a listbox with no ARIA
**Status:** TODO
**Where:** `src/popup/App.tsx:627-639` (rows), `:693` (input), `:733-747`
(sections).
**What:** rows are bare `div`s carrying only `data-selected`; the input has no
`role="combobox"`, `aria-expanded` or `aria-activedescendant`.
**Failure:** a screen-reader user hears a text field and nothing else on the
app's primary surface.
**Fix:** `role="combobox"` + `aria-activedescendant` on the input,
`role="listbox"` on the list, `role="option" id aria-selected` on rows,
`role="group" aria-label` on sections.
**Evidence:** by reading; cross-verified.

### UH7. Context menus cannot be operated from the keyboard
**Status:** TODO
**Where:** `src/manager/ctx-menu.tsx:35-39` (`open`), `:122-131` (submenu),
`:190` (portal); `Sidebar.tsx:468, 663, 696`.
**What:** `open()` sets state only; the portal lands on `document.body`; no
focus move, arrow traversal or focus restore. Submenus open on `onMouseEnter`
only, and every pack entry has `run`, so "Move to → pack → group" is
mouse-only.
**Failure:** Shift+F10 opens a menu the user cannot reach; pin, move, tag,
export, rename, lock, delete are all behind it.
**Fix:** focus the first item on open; roving Up/Down/Home/End; restore focus
on close; ArrowRight/Enter opens a submenu, ArrowLeft/Escape returns.
**Evidence:** by reading; cross-verified.

### UH8. Settings pack rows are tabbable but inert
**Status:** TODO
**Where:** `src/manager/Settings.tsx:200-217`.
**What:** `tabIndex={0}` + `onClick`, no `onKeyDown`, `role` or
`aria-expanded`.
**Failure:** Enter/Space do nothing, sealing path / copy / show in folder /
sync / export / back with a file / delete (:218-315) from keyboard users.
**Fix:** render as `<button type="button" aria-expanded>`; styling unchanged.
**Evidence:** by reading; cross-verified.

### UH9. Popup pack headers collapse by mouse only
**Status:** TODO
**Where:** `src/popup/App.tsx:735-747, 198, 441-443`.
**What:** header `div` with `onClick`, no `tabIndex`, role or `aria-expanded`.
Collapsed packs drop out of `visible`, and Tab is taken by the action panel.
**Failure:** a mouse-only control gates what the keyboard can reach.
**Fix:** `<button aria-expanded>`, plus ArrowLeft/ArrowRight on a row to
collapse/expand its pack.
**Evidence:** by reading; cross-verified.

### UH10. Focus styling is four systems, and a dozen controls have none
**Status:** TODO
**Where:** popup `FOCUS_BORDER = "#00a6f4"` via `--palette-focus`
(`popup/App.tsx:22, 503-504, 587-588, 689-690`); manager `focus:ring-ring`
(`Sidebar.tsx:754`, `Editor.tsx:391, 453, 577`, `GenerateDialog.tsx:314`),
shadcn `focus-visible:ring-ring/30` (`button.tsx:7`), an underline
(`Editor.tsx:384`), `focus-within` (`Editor.tsx:477`). `outline-none` with no
replacement: `popup/App.tsx:512, 533`, `ctx-menu.tsx:101`, `Settings.tsx:334`
and `selectCls` at `:31-32` (three selects), `Editor.tsx:94, 428, 508`,
`Sidebar.tsx:596, 707, 764`, `ImportCuration.tsx:121`.
**What:** `index.css:132` sets outline colour only, so `outline-none` kills
it. Hand-rolled rings use `focus:` while primitives use `focus-visible:`, so
mouse clicks flash a ring on half the app.
**Fix:** one `focus-visible:ring-2 ring-ring` utility; delete `FOCUS_BORDER`
(the "same in both themes" comment at `popup/App.tsx:21` is a code comment,
not a BEHAVIOR.md decision); never ship `outline-none` without it.
**Evidence:** by reading; cross-verified.

### UH11. Drag-to-reorder: no keyboard path, no resting affordance, silent regroup
**Status:** TODO
**Where:** `src/manager/Sidebar.tsx:627-668` (pointer), `:148-166`
(`commitReorder`), `:155-160` (group rewrite), `:768` (the only hint).
**What:** custom order is reachable only by a 180 ms press-and-hold; rows show
`cursor-pointer` until lifted. `commitReorder` has no key route and no live
region. Dropping a row among another group's rows rewrites `group` as a side
effect, with no toast and no undo (the sort-mode change does toast at :164).
**Fix:** `hover:cursor-grab` + grip glyph; Alt+Up/Down on a focused row and
"Move up / Move down" in `openRowCtx`; polite live region; toast + undo on a
cross-group drop.
**Evidence:** by reading; cross-verified.

### UH12. Segmented controls invert in dark mode and have no state semantics
**Status:** TODO
**Where:** `src/manager/Sidebar.tsx:875-908`; `GenerateDialog.tsx:326-344`.
**What:** track `bg-secondary/80`, active `bg-background` +
`rgba(28,29,34,0.08)` shadow. Dark `--background` (0.145) is darker than
`--secondary` (0.274) (`index.css:97, 105`).
**Failure:** in dark the active segment reads as a hole and the shadow
vanishes. No `role="radio"` or `aria-pressed`; selection is a class swap.
**Fix:** explicit active tokens defined in both theme blocks;
`aria-pressed={active}` at minimum.
**Evidence:** by reading; cross-verified.

### UH13. Three colour systems fail contrast
**Status:** TODO
**Where / What:**
- Tag hues: eight fixed hexes in `ui/core.js:131-149` tuned for dark, used as
  text on white at `popup/App.tsx:655`, `Editor.tsx:494`. `#e8b45f` on white
  is 1.89:1.
- Placeholder-kind chips: literal `text-amber-500 bg-amber-500/15` etc. at
  ~10 sites (`popup/App.tsx:64-67, 598-604`; `Editor.tsx:131-141, 317, 569`).
  Amber 2.16:1, cyan 2.57:1 in light. The fix exists once at
  `GenerateDialog.tsx:115` (`text-amber-600 dark:text-amber-500`) and was
  never propagated.
- `muted-foreground` is 4.73:1 at full; `/50` placeholders (`Editor.tsx:484`,
  `Sidebar.tsx:801`) are 1.65:1, `/70` (`Sidebar.tsx:572`, real text) 2.23:1,
  `opacity-70` (`popup/App.tsx:755`) similar. The Editor placeholder is the
  app's only inline syntax documentation.
**Fix:** three semantic tokens for placeholder kinds in `:root` and `.dark`;
two luminance ramps for tag hues (or hue as border only); drop the alpha
modifiers on muted text.
**Evidence:** ratios computed from `index.css` values; cross-verified.

### UM1. Agent-mode generate blocks the manager with no stop or timeout
**Status:** TODO
**Where:** `src/manager/GenerateDialog.tsx:253-271, 277-280, 402-411`.
**What:** the modal polls every 2 s with no timeout, elapsed time, stop or
manual import; the only exit closes the dialog. The pack-before-generation
half is L8.
**Fix:** after ~90 s offer "Keep watching / Import from file…"; allow closing
without losing progress and toast when the file lands.
**Evidence:** by reading; cross-verified.

### UM2. Pack-delete undo restores prompts but not the pack; empty-pack delete is silent
**Status:** DONE
**Where:** `src/manager/App.tsx:54-55`; `Sidebar.tsx:295-299`;
`Settings.tsx:103-107`.
**What:** `deleteWithUndo` returns early when nothing was removed, so
deleting an empty pack drops its lock flag and file path with no toast and no
undo. For non-empty packs undo brings prompts back but `PackMeta` is gone.
**Fix:** capture and restore `PackMeta` alongside the prompts; always toast.
Follow-up to H1.
**Evidence:** by reading; cross-verified.
**Resolution:** `deleteWithUndo(ids, label, { pack })` captures the pack's
`PackMeta`; deleting an empty pack still toasts with Undo; Undo restores
the prompts and re-adds the metadata (lock flag kept, path cleared so
`ensure_packs_backed` gives it a fresh file — the old one is in
`packs/deleted/`). Both delete sites (sidebar, Settings) pass it. Manual:
see verification note. Commit: see commit list (UM2).

### UM3. Copy-only gives no feedback, and the form button says "Paste" while copying
**Status:** DONE
**Where:** `src/popup/App.tsx:297-298, 301-315, 613, 476, 339, 446`.
**What:** Ctrl+Enter / Ctrl+click hide the window with nothing shown;
`pickedId` highlight lasts 90 ms and `submitForm` never sets it. In copy mode
the form's button and hint still read "Paste".
**Fix:** label from `form.paste`; hold the popup ~600 ms with "Copied to
clipboard".
**Evidence:** by reading; cross-verified.
**Resolution:** the form button reads Paste/Copy from `form.paste` (done in
H5/UH3); for copy-only, Rust no longer hides the popup — the popup shows
"Copied to clipboard" in the feedback strip and hides itself after 600 ms.
Verified: Ctrl+Enter on "Test" showed the strip and the clipboard held
`test`. Commit: see M3.

### UM4. Popup create gives no confirmation; the new prompt may be invisible
**Status:** DONE
**Where:** `src/popup/App.tsx:278-280, 134, 198`.
**What:** snaps back to the list; `uses:0` sorts last; a collapsed pack hides
the row entirely.
**Fix:** expand, scroll to and flash the new row, or "Saved to <pack>" in the
hint bar.
**Evidence:** by reading; cross-verified.
**Resolution:** the feedback strip says `Saved "<title>" to <pack> › <group>`
after Ctrl+N → Enter. Verified in the dev build (`Saved "FB temp" to
Desktop`). Commit: see commit list (popup feedback).

### UM5. Pack and group operations exist only behind right-click
**Status:** TODO
**Where:** `src/manager/Sidebar.tsx:696-700, 585-589` (context menus),
`:692, 581` (double-click rename).
**What:** rename, lock, export, file actions, new group, delete have no
visible affordance; Settings → Your library covers some but not rename, lock
or new group.
**Fix:** a hover-revealed `⋯` on pack and group headers opening the same menu.
**Evidence:** by reading; cross-verified.

### UM6. Inline renames commit on blur; merge-on-rename has no undo
**Status:** TODO
**Where:** `src/manager/Sidebar.tsx:713, 602`; `Editor.tsx:406-413`.
**What:** a misclick commits the typed text. Group merge on collision is
deliberate (BEHAVIOR.md:88-90) and does toast, but is irreversible.
**Fix:** Enter commits, blur cancels (or Confirm/Cancel affordances);
`sayUndo` on a merging rename.
**Evidence:** by reading; cross-verified.

### UM7. Ungroup is one click, irreversible, and the toast has no noun
**Status:** DONE
**Where:** `src/manager/Sidebar.tsx:272-281`.
**What:** "Ungrouped 5". Its sibling "Delete group…" gets a dialog and undo.
**Fix:** `sayUndo("Ungrouped 5 prompts", restore)` with captured labels.
**Evidence:** by reading; cross-verified.
**Resolution:** Ungroup remembers the ids that carried the label and
toasts `Ungrouped N prompts from "<group>"` with Undo, which puts the label
back on exactly those prompts. Manual: see verification note. Commit: see
commit list (UM7).

### UM8. Import curation: no bulk select, hidden pack names, lost input on bad JSON, double-submit
**Status:** TODO
**Where:** `src/manager/ImportCuration.tsx:128-160` (rows), `:114, 150-157`
(pack name), `:55-62` (bad JSON), `:163, 97-98` (Add button).
**What:** no All/None/Only-new though `dupes` is computed; multi-pack rows
never show `r.packName`; invalid JSON → toast + `onClose()`, the raw text is
gone and step 3 of the Generate dialog collapses; "Add N prompts" stays
enabled during the await, so a second click imports twice.
**Fix:** bulk buttons; `packName` chip per row; inline error with an editable
textarea and Retry; `busy` state on the button.
**Evidence:** by reading; cross-verified.

### UM9. Settings pane has no heading, close control, or Escape
**Status:** TODO
**Where:** `src/manager/App.tsx:290`; `Settings.tsx:111`;
`Sidebar.tsx:899-901`.
**What:** the editor pane becomes a stack of cards starting at "General"; the
only cue is the gear tint.
**Fix:** an `h1` "Settings" with ✕; Escape → `showSettings(false)`.
**Evidence:** by reading; cross-verified.

### UM10. Empty states: no actions, three treatments, none in the sidebar
**Status:** TODO
**Where:** `Editor.tsx:157-171` ("Select or create a prompt", nothing to
click); `popup/App.tsx:717`; `ImportCuration.tsx:127`; `Sidebar.tsx:841-870`
renders nothing when empty.
**Fix:** one `EmptyState` (icon, line, action); the editor's gets "New
prompt" and "Generate pack with Claude…".
**Evidence:** by reading; cross-verified.

### UM11. Form controls have no programmatic labels
**Status:** TODO
**Where:** `Settings.tsx:25` (`Row` label is a `<span>`) → `:113-183`;
`Editor.tsx:372, 416, 444, 478, 505, 573`; `GenerateDialog.tsx:296`;
`popup/App.tsx:490-574` (`<label>` without `htmlFor`); `Sidebar.tsx:748-755`
filter input and its icon-only toggle `:731-742` (title only).
**Fix:** `Row` generates an id and renders `<label htmlFor>`; `id`/`htmlFor`
pairs in the popup; `aria-label` elsewhere.
**Evidence:** by reading; cross-verified.

### UM12. Tab hijack in the popup strands three controls
**Status:** DECLINED
**Where:** `src/popup/App.tsx:441-443, 702-712, 652-664, 769-779`.
**What:** deliberate and reasonable, but the clear ✕ and per-row tag chip have
no key route (the create button has Ctrl+N).
**Fix:** say so in the hint bar; typed `#tag` already covers the chip.
**Evidence:** by reading; cross-verified.
**Resolution:** declined as already satisfied: the list-mode hint bar reads
`Tab actions` (and now `Esc close`), the create button shows `Ctrl N`, the
clear ✕ is redundant with Backspace/Escape and the tag chip with a typed
`#tag`. No control is unreachable from the keyboard; the finding's own fix
is the existing hint.

### UM13. Non-semantic interactive elements
**Status:** TODO
**Where / What:** Sidebar headers `:568-580, 676-691` (Enter/Space work, no
role or `aria-expanded`); `Editor.tsx:75` `DeleteBadge` claims
`role="button"` with no `tabIndex` or key handler (mouse-only);
`popup/App.tsx:652-664` tag chip is a `span`; popup action panel `:801-818`
has no `role="menu"`/`menuitem` and its Tab-open is unannounced; preview card
`:781-799` is an unannounced fixed `div`.
**Fix:** real buttons and roles; `role="tooltip"` + `aria-describedby` for
the preview (not `dialog`, it never takes focus).
**Evidence:** by reading; cross-verified.

### UM14. No live region in the popup; no reduced-motion handling
**Status:** TODO
**Where:** `src/popup/App.tsx:716-720, 172-200`; no `prefers-reduced-motion`
anywhere (`dialog.tsx:32, 54`, `tooltip.tsx:51`, `Editor.tsx:78`,
`Sidebar.tsx:627, 632`, `GenerateDialog.tsx:405` spinner).
**Fix:** sr-only `role="status"` in `Shell` fed by result count and mode; a
reduced-motion block in `index.css`.
**Evidence:** by reading; cross-verified.

### UM15. Hit targets under 24 px
**Status:** TODO
**Where:** `Editor.tsx:78` DeleteBadge 14 px; `:57-68` AddPill and `:490-499`
tag pills ≈20 px; `popup/App.tsx:34` Kbd 16 px reused beside clickable rows
at `:816`.
**Fix:** `after:-inset-2` hit area (idiom at `checkbox.tsx:13`); `py-1`.
**Evidence:** by reading; cross-verified.

### UM16. "Sync from file" does not sync
**Status:** TODO
**Where:** `src/manager/Settings.tsx:246-253` → append-only `ImportCuration`.
**Fix:** relabel "Import from this file…".
**Evidence:** by reading; cross-verified.

### UM17. Truncated names have no tooltip; import titles cannot shrink
**Status:** TODO
**Where:** `Sidebar.tsx:671, 717, 605`; `popup/App.tsx:80, 83-89, 646`
(`truncate`, no `title`); `ImportCuration.tsx:150` `whitespace-nowrap`
without `truncate`/`min-w-0`.
**Fix:** `title=`; `min-w-0 truncate`.
**Evidence:** by reading; cross-verified.

### UM18. Placeholder syntax help disappears; field names are sanitised silently
**Status:** TODO
**Where:** `Editor.tsx:483` (placeholder vanishes on typing), `:184` (Advanced
collapsed by default); `Editor.tsx:97` sanitises to `[a-z_]` so `step1`
becomes `{step}`, the rule shown only in the post-hoc chip (:130) and
inconsistent with tag sanitising at `Sidebar.tsx:502`.
**Fix:** a one-line legend under Preview; live "will insert {step}" under the
input.
**Evidence:** by reading; cross-verified.

### UM19. Toasts cover the editor controls; undo is 8 s only
**Status:** TODO
**Where:** `src/manager/App.tsx:294` (`position="top-right"`, over the
pack/group/delete row at `Editor.tsx:416-468`); `status.ts:5-8`; no
`closeButton`.
**Fix:** bottom-right, `closeButton`, longer undo, Ctrl+Z bound to the last
undo callback. Related: M10.
**Evidence:** by reading; cross-verified.

### UM20. Design-system drift
**Status:** TODO
- Button: `size="sm"` then `h-auto px-2.5 py-1 text-xs` at 11 Settings sites
  and 3 GenerateDialog sites with a different override; `destructive` variant
  exists (`button.tsx:18`) but is rebuilt at `Editor.tsx:460-465`,
  `Settings.tsx:291-295`.
- Kbd: three treatments (`popup/App.tsx:32-38`, `manager/App.tsx:274`,
  unused `ui/kbd.tsx`).
- Radius: popup shell/preview/panel (`:828/791/802`) use `rounded-lg`, the
  control radius, against the documented scale (`index.css:43-51`); chips
  split `rounded-sm` vs `rounded-full`.
- Hover fill: `bg-accent` (ctx-menu, popup) vs `bg-secondary` (Settings,
  ImportCuration, Sidebar) vs border-only (popup rows, sidebar rows).
- Icons: lock 3 vs 2.5, chevron 4 vs 3.5, pin 3 vs 3.5; `Settings.tsx:3`
  imports the filled arrow family; `size-1.75` at :211.
- Dark mode: popup shadow is hardcoded navy (`:791, 802, 828`) and invisible
  in dark; rows are `bg-background border-border` on a `bg-background` shell,
  so with `--border` at 10 % white (`index.css:112`) row edges nearly vanish
  (was L10's "cosmetic" note).
- `ImportCuration.tsx:149` inner `<Checkbox>` lacks `aria-hidden`, so rows
  announce "checkbox" twice.
**Evidence:** by reading; cross-verified.

### UM21. Terminology and labels
**Status:** TODO
- Four names for one feature: "+ New (with Claude)" (`Settings.tsx:327`,
  beside plain "+ New" at :352), "✦ or generate a pack with Claude…"
  (`Sidebar.tsx:820`), "Generate a pack with Claude" (`GenerateDialog.tsx:290`),
  README "Generate pack with Claude". Pick one.
- "Delete 7…" / "Really delete 7?" (`Sidebar.tsx:538, 540`): no noun.
- ctx-menu inputs commit on Enter only but placeholders don't say so
  (`Sidebar.tsx:403, 480, 500`; "tag name" is the only lowercase one) while
  inline inputs do (`Sidebar.tsx:799`, `Settings.tsx:332`, `Editor.tsx:389`).
- "Delete (locked)" / "New group (locked)" disabled with no hint how to unlock
  (`Sidebar.tsx:390, 370`; `Settings.tsx:305-311`); `CtxItem` has no `title`
  field, so this needs an API addition.
- "file-backed" / "Back with a file…" (`Settings.tsx:225, 286`) is jargon;
  suggest "Give this pack a file".
**Evidence:** by reading; cross-verified.

### UM22. Popup create discards typed work on Escape; `panelNote` replaces the row title
**Status:** DONE
**Where:** `src/popup/App.tsx:399, 319, 803`.
**What:** Escape drops an edited title with no confirm; an error note renders
in place of `panelFor.title` and only clears on `closePanel`.
**Fix:** confirm when the title was edited; render the note below the title.
**Evidence:** by reading; cross-verified.
**Resolution:** create mode remembers the prefilled title; Escape with an
edited title first shows `Press Esc again to discard "<title>"`, the second
Escape discards. The action panel now renders `panelNote` under the title
instead of in its place. Verified: first Esc keeps the create view with the
strip, second returns to the list. Commit: see commit list (popup feedback).

### UM23. Armed-delete cancellation differs across four controls
**Status:** TODO
**Where:** `Settings.tsx:296-303` (no Escape, no timeout, stays armed
indefinitely); `Editor.tsx:356-360` (3 s, no Escape); ctx-menu Escape closes
the whole menu; popup Escape closes the panel. None announce the armed state.
**Fix:** Escape + 3 s timeout everywhere; `aria-live="assertive"` on the label
change.
**Evidence:** by reading; cross-verified.

### UL1. List-mode hint bar omits Esc
**Status:** DONE
`popup/App.tsx:480` vs `:474/476/478`; the other three variants include it.
**Resolution:** list-mode hint now ends with `Esc close` (verified in the
dev build). Commit: see commit list (popup feedback).

### UL2. Search feedback and clear controls
**Status:** TODO
"No matches" gives no hint that `#`/`@`/`>` terms are narrowing
(`popup/App.tsx:716-720`); clear ✕ has no label (`:703-711`); sidebar chip
reads `filter: "…" ✕` (`Sidebar.tsx:784-790`). Related: L5.

### UL3. Off-scale sizes
**Status:** TODO
`text-[13px]` at 10 popup sites and `Sidebar.tsx:627`; nine arbitrary sizes
incl. the `// matches max-h-55` comment (`popup/App.tsx:784`);
`disabled:opacity-40` in ctx-menu vs 50 in primitives.

### UL4. Pack select chevron is a data-URI SVG with `#888e98` baked in
**Status:** TODO
`Editor.tsx:430`; passes 3:1 in both themes but is the only non-Remix chevron.

### UL5. Brand button colours are hardcoded
**Status:** TODO
`Settings.tsx:324, 400-417`; deliberately mirror the vendor's config;
`text-black` on `#d97757` is 6.7:1. Worth a comment (was in L10).

### UL6. Unused shadcn primitives
**Status:** TODO
13 of 18 `src/components/ui/` files are unimported (badge, collapsible,
command, context-menu, dropdown-menu, input, input-group, kbd, label,
scroll-area, select, separator, tooltip). Keep the hand-rolled ctx-menu
(programmatic x/y + inline inputs justify it); adopt `Input`, `Label`, `Kbd`,
`Separator` while fixing UM11/UM20, delete the rest. Same call as D4 / L2.

### UL7. Landmarks and headings
**Status:** TODO
No `h1` in either window; sidebar is a plain `div` not `<aside>`
(`Sidebar.tsx:727, 730`); popup search has no `role="search"`
(`popup/App.tsx:688`); `h2` is both `text-2xl font-bold` (`Sidebar.tsx:730`)
and `text-xs uppercase` (`Settings.tsx:16`).

### UL8. Three identical "Edit" buttons
**Status:** TODO
`ParamSection` (`Editor.tsx:37-45`, instantiated :537/:545/:559) with no
`aria-pressed`; fix with `aria-label={editing ? \`Done editing ${title}\` : \`Edit ${title}\`}`.

### UL9. What the UI does well (keep while fixing)
The paste loop is keyboard-first with a hint bar that teaches in place and
hover/keyboard arbitration (`suppressHoverUntil`). Placeholder chips are
typed and colour-coded, and near-misses like `{File}` surface as "not a
param". Manager deletes are staged with undo, and the delete-group dialog's
"To keep the prompts, choose Ungroup instead" is the best line in the app.
Import is curation-first. The status channel is deliberate (`status.ts`) and
validation messages explain the constraint. Density is tuned per window, the
radius scale is collapsed and documented, and `color-scheme` is set on both
themes.

---

## Decisions

Resolved with the review's recommendation unless the choice would materially
change product behavior, in which case the item is BLOCKED and asked.

| # | Question | Options / recommendation | Status / resolution |
|---|---|---|---|
| D1 | H2: when the hotkey fires while the popup is open, **toggle** (hide) or **ignore**? | Toggle matches Raycast/Alfred; ignore is the minimal change. Recommend ignore now, toggle as a follow-up | DONE — ignore (a repeat re-focuses the open popup); toggle-to-hide noted in BACKLOG |
| D2 | M9: add a CSP? Hardens a local-only app; every future inline style/data URL must be allowed explicitly | Recommend yes with the policy in M9, verified in dev and a release build | DONE — added; enforced in release, not injectable into the Vite dev page |
| D3 | M12: flush the editor on quit via `beforeunload` (cheap, may miss OS shutdown) or a Rust handshake (robust, more code)? | Recommend the cheap one now | TODO — see M12 for the choice made and why |
| D4 | L2: remove the unused shadcn components, or keep them as a palette? | Recommend remove; `npx shadcn add` restores any in seconds | DONE — removed nine; `input`/`label`/`kbd`/`separator` kept for UL6 adoption |
| D5 | Add a minimal ESLint config (`react-hooks`, `typescript-eslint`) so the nine `eslint-disable` comments mean something, or delete the comments? | Recommend add; ~20 lines, and `react-hooks/exhaustive-deps` catches stale closures like H1 | TODO — add |
| D6 | Split `Editor.tsx` (628), `GenerateDialog.tsx` (434), `Settings.tsx` (428)? Cuts: `Editor` → `ParamsPanel` + `TagStrip`; `GenerateDialog` → `generate-instructions.ts` (pure, testable) + dialog; `Settings` → `HotkeyRecorder` + `LibraryCard` | Pure moves, no behavior change; defer if you prefer the files as they are | TODO — defer until correctness work is done |
| D7 | Commit the in-progress groups work first (coherent and green), then land the fixes on top? | Recommend yes; small commits on a clean base | DONE — `1f548bc` (gitignore), `7265cf5` (groups work, SizeDebug, window sizes) |
| D8 | UH2: give the popup its own undo (a timed "Deleted — U to undo" strip, popup-local state) or route popup deletes through the manager so `deleteWithUndo` covers both? | Popup-local is self-contained and works with the manager closed; routing via the manager depends on H6's Rust-side mutations landing first. Recommend popup-local now, revisit after H6 | DONE — popup-local (`add_snippet` re-adds by id, so nothing is lost) |

---

## Coverage notes by area (checked and found sound unless referenced above)

1. **Paste pipeline.** `show_popup` → `paste_snippet` → `focus_window` →
   `send_ctrl_v` is as BEHAVIOR.md describes. Modifier release before Ctrl+V
   is correct. `{clipboard}` is expanded in Rust from the clipboard as read at
   paste time, matching the documented "second expands from the first's
   output". Findings: H2, H6, M3, M6, M11.
2. **Placeholders.** Popup and editor call the same core functions, so previews
   agree. `{date}`/`{time}` expand in JS before Rust sees the text, so clipboard
   content containing `{date}` is never expanded (correct). Config values
   containing `{clipboard}` are expanded by Rust afterwards; arguably a feature.
   Finding: H5.
3. **Pack diagnostics.** `diagnosePack` codes are exhaustive and tested.
   Finding: M7.
4. **Fuzzy search and filters.** Title > tags > body tiering holds; `#`, `@`,
   `>` parse and filter with substring semantics, tested. Findings: L4, L5.
5. **Pins and Ctrl+1..5.** `MAX_PINS` enforced in popup, editor, and sidebar;
   import never sets `pinned`. Ordinals and Ctrl+N index the same `visible`
   array, so the badge always matches the key.
6. **Usage sorting.** `uses` is bumped only in Rust from disk state, so it never
   loses to a stale snapshot. Copy-only also bumps; defensible.
7. **Positioning.** Cursor-anchored, clamped to the monitor. Finding: M6.
8. **Rust robustness.** `unwrap`s: `prev_window.lock()` (poison only),
   `default_window_icon()` (icon configured), `Config::default().hotkey.parse()`
   (constant). Sync commands serialize on the main thread, so file writes never
   interleave. Findings: H3, H4, M8.
9. **Security.** Capability is `core:default` only; no shell/fs/http plugin.
   `open_url` is https-only and hard-coded. `show_in_folder`/`read_pack_file`
   take paths only from the app's own config, called only by the local
   frontend. All pack/prompt text renders as React text; no
   `dangerouslySetInnerHTML`. Finding: M9.
10. **Concurrency.** Two JS contexts, disk as truth, `snippets-changed` for
    popup→manager. Findings: H6, M12.

---

## Tests

**Covered by `tests/core.test.js` at baseline (29):** tokenize classes,
customFields, configNames, code-brace false positives, expandConfig
(set/unset/empty), downgradeUnsetConfig, requiredInputs, expandBuiltins,
fuzzyScore (contiguous vs subsequence, position, null/empty), parseQuery (#, @,
>, bare sigils), matchesFilters, tagColor stability, parsePacks (object, array,
legacy, fences, junk, group), diagnosePack (all four codes), fmtHotkey.

**Covered by `cargo test` at baseline (7):** v2 migration, serde defaults,
`category` not re-serialized, config defaults, pack filename sanitizing,
`PackMeta.path` default, starter ids unique.

**Highest-value missing tests, in order** (ticked as they land):
1. [x] `fillFields` with `$&`/`$$` values (H5), after moving it into core.
2. [x] Rust: atomic write, and "unreadable file is preserved, never overwritten"
   (H3), via a temp dir and `AppHandle`-free helpers.
3. [x] Rust: `sync_pack_files` skips empty packs and unchanged files (M4);
   `retire_pack_file` numbering on repeated deletes — the retire numbering is
   still untested (needs an `AppHandle`); covered by the H1 manual check.
4. [x] `stripFences` strips a BOM; `diagnosePack` of a BOM file is `ok` (M7).
5. [x] `sanitize_pack_filename("CON")` (M8).
6. [ ] Popup ranking as a pure function: extract the title/tags/body tiering from
   `popup/App.tsx:129-149` into `core.rankSnippets(query, snippets)` and test
   that a title subsequence beats a tag contiguous match and that pins lead
   with no query.
7. [ ] `defaultPackFor(lastPack, names, isLocked)` once extracted (L1).
8. [x] `packToJson` includes `group` only when set (M1).
9. [x] Undo restoration helper (H1) once extracted: delete then undo yields the
   original array with no duplicate ids.
10. [x] Rust: `patch_snippet`/`add_snippet`/`delete_snippet` merge helpers (H6).

---

## UX and accessibility summary

Keyboard flows in the popup are complete for list/panel/form/create except the
focus return (M2), the mouse-only pack headers (UH9) and the controls
stranded by the Tab hijack (UM12). Manager rows and headers are reachable by
Tab and act on Enter/Space; context menus open from the Menu key but cannot
be operated once open (UH7); Settings pack rows are inert (UH8); reorder is
pointer-only (UH11). Screen-reader semantics are the weak spot (UH6, UM11,
UM13, UM14). The manager toasts most failures but not `persist` failures; the
popup has no error channel at all (M3). Focus styling is four systems with a
dozen unstyled controls (UH10). Themes are consistent apart from toasts
(M10), the segmented controls that invert in dark (UH12), and three colour
sets that fail contrast in light (UH13). Feedback gaps cluster in the popup:
no undo on delete (UH2), no confirmation on copy or create (UM3, UM4), an
empty fill-in field pastes silently (UH3).

---

## Verification matrix

Filled in as findings close. Every DONE row lists the automated checks that
passed at its commit and the manual check performed.

| Finding | typecheck | npm test | test:rust | Manual (app) | Commit |
|---|---|---|---|---|---|
| H1 | ✓ | ✓ 32/32 | ✓ 7/7 | delete pack / group → Undo, ids unique on screen and on disk | `e437876` |
| H3 | ✓ | ✓ 32/32 | ✓ 11/11 | truncated snippets.json → quarantined, empty library, persistent toast; backup restored | `a025d20` |
| H6 + M13 | ✓ | ✓ 32/32 | ✓ 15/15 | stale popup write keeps the manager's edit; stale full-array save refused | `c725a09` |
| H2 + D1 | ✓ | ✓ 32/32 | ✓ 15/15 | repeat press keeps popup state; double-tap and single-tap pastes land | `f82c4d4` |
| H4 | ✓ | ✓ 32/32 | ✓ 16/16 | second instance starts with a notice; taken combination refused, old one keeps working | `13ca171` |
| H5 + UH3 | ✓ | ✓ 34/34 | ✓ 16/16 | `$$`/`$&` value copies literally; empty field outlined and labelled | `35adc7d` |
| M9 + D2 | ✓ | ✓ 34/34 | ✓ 16/16 | release build: remote fetch blocked by connect-src, assets/IPC/editor fine in both windows | `0a803aa` |
| M8 | ✓ | ✓ 34/34 | ✓ 18/18 | `create_pack_file("Con")` → `con-pack.json` | `d994932` |
| M4 | ✓ | ✓ 34/34 | ✓ 18/18 | title edit rewrites only `desktop.json` | `26fb8f2` |
| M11 | ✓ | ✓ 34/34 | ✓ 18/18 | comment only | `17766a9` |
| M6 | ✓ | ✓ 34/34 | ✓ 18/18 | cursor at (2520,1434): popup bottom 1385 ≤ work area 1392 | `418bf92` |
| M7 | ✓ | ✓ 35/35 | ✓ 18/18 | pure test (BOM file diagnoses ok) | `e1681c1` |
| M1 | ✓ | ✓ 36/36 | ✓ 18/18 | Settings → Export library carries `group` | `eb80c42` |
| M2 | ✓ | ✓ 36/36 | ✓ 18/18 | Esc from form / create → focus on search input | `1ad4cba` |
| M10 | ✓ | ✓ 36/36 | ✓ 18/18 | toaster `data-sonner-theme` follows Light/Dark | `195215d` |
| L2 + D4 | ✓ | ✓ 36/36 | ✓ 18/18 | app reloads and renders with the primitives and deps removed | `f3454bd` |
| M3 + UM3 | ✓ | ✓ 36/36 | ✓ 18/18 | held clipboard → error strip, popup stays, Esc clears; copy-only → "Copied" strip | `25d006d` |
| UH2, UM4, UM22, UL1 (+D8) | ✓ | ✓ 36/36 | ✓ 18/18 | delete → U restores (disk checked); Saved-to strip; Esc-twice on edited title; hint shows Esc | (popup feedback commit) |

## Commit list

| Commit | Findings | Subject |
|---|---|---|
| `1f548bc` | D7 | Ignore agent scratch directories |
| `7265cf5` | D7 | Groups inside packs, and an agent survey mode for Generate |
| `996007f` | — | REVIEW.md: turn the review into a findings tracker |
| `e437876` | H1 | Undo after delete restores from the live library, never a snapshot |
| `a025d20` | H3 | Write data files atomically and quarantine ones that won't parse |
| `183835f` | — | REVIEW.md: merge the UI review's findings into the tracker |
| `c725a09` | H6, M13 | Snippet edits become intent-level Rust commands with a revision guard |
| `f82c4d4` | H2, D1 | Ignore the hotkey while the popup is already open |
| `13ca171` | H4 | A refused hotkey no longer aborts startup or drops the old binding |
| `35adc7d` | H5, UH3 | Fill-in values paste literally, and an empty field is never silent |
| `0a803aa` | M9, D2 | Add a Content Security Policy |
| `d994932` | M8 | Reserved Windows device names can't become pack filenames |
| `26fb8f2` | M4 | Write a pack file only when its content changed |
| `17766a9` | M11 | Fix the paste_snippet doc comment |
| `418bf92` | M6 | Clamp the popup to the work area, not the monitor |
| `eac8f50` | — | REVIEW.md: record commits for M4, M6, M8, M11 |
| `e1681c1` | M7 | Accept pack files that start with a UTF-8 BOM |
| `eb80c42` | M1 | One packToJson for every export, so groups survive Settings |
| `1ad4cba` | M2 | Popup: give the search box focus back after form or create mode |
| `195215d` | M10 | Toasts follow the app's theme, not the OS setting |
| `f3454bd` | L2, D4 | Remove unused shadcn primitives and cmdk; gate SizeDebug behind DEV |
| `4fbcb30` | — | REVIEW.md: verification notes and commits for M1, M2, M7, M10, L2 |
| `25d006d` | M3, UM3 | Popup: a feedback strip for failures, and copy-only confirms |

## Remaining risks and deliberate exclusions

Written at completion.

**Deliberately not proposed by the review:** virtualizing the popup list (no
evidence of need yet), word-wise fuzzy search (a ranking change that deserves
its own discussion), changing copy-only use counting, the macOS port, and
anything in BACKLOG's Distribution section.
