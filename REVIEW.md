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
time; they drift as fixes land.

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

| Status | High | Medium | Low | Decisions | Total |
|---|---|---|---|---|---|
| TODO | 6 | 13 | 12 | 6 | 37 |
| IN PROGRESS | 0 | 0 | 0 | 0 | 0 |
| BLOCKED | 0 | 0 | 0 | 0 | 0 |
| DONE | 0 | 0 | 0 | 1 | 1 |
| DECLINED | 0 | 0 | 0 | 0 | 0 |
| **Total** | **6** | **13** | **12** | **7** | **38** |

Implementation order: critical data integrity (H1, H3, H6) → high correctness
and security (H2, H4, H5, M9) → quick wins (M6, M7, M8, M1, M2, M11+L11, M10,
L2) → medium (M3, M4, M5, M12, M13, L1+L3, L9) → low documentation, structure
and release hygiene (L4–L8, L10, L12, D5, D6).

---

## High

### H1. Undo after deleting a pack, a group, or a multi-selection duplicates the prompts
**Status:** TODO
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

### H2. Holding or double-tapping the hotkey makes the popup its own paste target
**Status:** TODO
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

### H3. A partial write or unreadable JSON silently replaces the library with the starter pack
**Status:** TODO
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

### H4. A hotkey the OS refuses aborts startup; a failed re-register leaves no hotkey
**Status:** TODO
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

### H5. Fill-in values containing `$` are mangled
**Status:** TODO
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

### H6. Popup writes the whole library from a snapshot and can drop a manager edit
**Status:** TODO
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

---

## Medium

### M1. Settings "Export pack" and "Export library" drop `group`
**Status:** TODO
**Where:** `src/manager/Settings.tsx:96-101` vs `Sidebar.tsx` `packToJson`
(~:243).
**What:** two `packToJson` implementations; the Settings one predates groups.
**Failure:** export from Settings, import elsewhere: every group label is lost.
The sidebar's export keeps them.
**Fix:** one `packToJson` in `src/lib/`, used by both (and by "Export
selection", a third inline copy).

### M2. Keyboard focus is lost when leaving form or create mode
**Status:** TODO
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
**Evidence:** by reading; verify in the app.

### M3. The popup has no error surface; failed pastes and saves are silent
**Status:** TODO
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

### M4. Every autosave rewrites every pack file
**Status:** TODO
**Where:** `lib.rs:218-248` (`sync_pack_files`), called from `save_snippets`
and `save_packs`.
**What:** each save re-serializes all packs and `fs::write`s each file, and
`ensure_packs_backed` reloads config and snippets from disk again.
**Failure:** typing in the editor with 20 packs produces 20 identical file
writes per 600 ms pause. Any file watcher (the Generate dialog polls every
2 s, editors, sync clients) sees constant churn.
**Fix:** serialize each pack, compare with the file's current bytes, write only
on change. Test.

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
**Status:** TODO
**Where:** `lib.rs:726-735`.
**What:** uses `monitor.size()`; tauri 2.11.5 has `Monitor::work_area()`
(`tauri-2.11.5/src/window/mod.rs:96`).
**Failure:** hotkey with the cursor near the bottom of the screen: the popup's
last rows and the hint bar sit under the taskbar.
**Fix:** clamp against `work_area()`; a few lines.

### M7. A UTF-8 BOM makes a valid pack file "not JSON"
**Status:** TODO
**Where:** `ui/core.js:153-154` (`stripFences`), `:199` (prefix test).
**What:** `﻿` is not stripped; `JSON.parse` fails and the diagnosis says
"not JSON — the source starts with '{'", which is contradictory on screen.
**Failure:** save a pack from Notepad or PowerShell `Out-File` (BOM by default
on older setups), Import from file: rejected with a misleading message.
**Fix:** strip a leading BOM in `stripFences`; one test.

### M8. Reserved Windows device names become pack filenames
**Status:** TODO
**Where:** `lib.rs:143-155` (`sanitize_pack_filename`).
**What:** "CON", "NUL", "AUX", "PRN", "COM1"…"LPT9" survive sanitization.
**Failure:** name a pack "Con". `fs::write("con.json")` addresses the console
device; the write errors or hangs, `ensure_packs_backed` leaves `path` empty,
and the pack is never file-backed.
**Fix:** suffix reserved stems with `-pack`; extend the filename test.

### M9. No Content Security Policy
**Status:** TODO
**Where:** `src-tauri/tauri.conf.json:45` (`"csp": null`).
**What:** the app loads no remote content and renders all text through React
text nodes, so there is no injection today. A CSP is defense in depth against a
future `dangerouslySetInnerHTML` or a dependency that injects.
**Fix:** `default-src 'self'; img-src 'self' data:; style-src 'self'
'unsafe-inline'; font-src 'self'`. `data:` is needed for the select chevron in
`Editor.tsx:439`; `'unsafe-inline'` for style because Tailwind and Base UI set
inline styles. Verify both windows in dev and in a release build. See D2.

### M10. Toasts follow the OS theme, not the app theme
**Status:** TODO
**Where:** `src/components/ui/sonner.tsx:8` (`useTheme()` from `next-themes`
with no `ThemeProvider` mounted anywhere).
**What:** `theme` resolves to "system", so Sonner reads
`prefers-color-scheme`; the app's theme is the `.dark` class.
**Failure:** app in Light, OS in dark: toast text and icon colors use the dark
palette on a light `--popover` background.
**Fix:** derive the theme from `document.documentElement.classList` (a
`MutationObserver`, or pass `m.prefs.theme` down). Drop `next-themes`; nothing
else uses it.

### M11. `paste_snippet` doc comment contradicts BEHAVIOR.md
**Status:** TODO
**Where:** `lib.rs:648-650` says "then restore the previous clipboard".
**What:** the body and BEHAVIOR.md deliberately do not restore (commit
`d46212e`). The comment predates that.
**Fix:** rewrite the comment.

### M12. Pending editor autosave is lost on tray Quit
**Status:** TODO
**Where:** `Editor.tsx:226-229` (600 ms debounce), `lib.rs:994`
(`app.exit(0)`).
**Failure:** type, then Quit from the tray within 600 ms: the last edit never
reaches disk. Also true for Windows shutdown.
**Fix:** flush on `beforeunload`/`pagehide` in the editor, or a Rust
`flush-and-quit` handshake. See D3.

### M13. `submitForm` mutates an object that lives in React state
**Status:** TODO
**Where:** `src/popup/App.tsx:310` (`snippet.fieldValues = {...}`).
**What:** works today because the array is new, but a future `memo`ized row
comparing `s === prev.s` (M5) would miss the change.
**Fix:** `{ ...snippet, fieldValues }`; falls out of H6.

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
**Status:** TODO
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
**Fix:** disable Save when the clipboard is empty.

### L8. Agent generate path creates the pack before anything is written
**Status:** TODO
**Where:** `GenerateDialog.tsx:233-238`. "Create file & copy instructions"
with a topic persists a new empty `PackMeta`; cancelling leaves an empty pack
in the sidebar. Consistent with "a pack is just a name"; worth a note in the
dialog or a cleanup on cancel while the pack is still empty.

### L9. Accessibility gaps
**Status:** TODO
- Popup list: no `role="listbox"` / `role="option"`, no `aria-selected`, no
  `aria-activedescendant` on the search input (`popup/App.tsx:693-701,627-639`).
- Tag pills are `span`s with `onClick` (`:652-665`); not focusable.
- Action panel items are `div`s (`:797-811`); should be `menuitem`s or
  `button`s.
- Create/form `<label>`s have no `htmlFor` (`:490,508,529,570`).
- Sidebar pack/group headers have `tabIndex` but no `role="button"` or
  `aria-expanded`.
- Dialogs (Base UI) and `ImportCuration` rows (`role="checkbox"`) are correct.

### L10. Theme and visual consistency
**Status:** TODO
- `--sidebar-*` and `--chart-*` tokens are defined in `index.css` but unused.
- Hard-coded `#00a6f4` focus border (`popup/App.tsx:22`) and Claude orange
  `#d97757` (`Settings.tsx:329,415`) bypass the token system; fine as brand
  colors, worth a comment.
- Dark-mode `--border` is 10 % white; popup rows in dark are barely outlined.
  Cosmetic.

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

## Decisions

Resolved with the review's recommendation unless the choice would materially
change product behavior, in which case the item is BLOCKED and asked.

| # | Question | Options / recommendation | Status / resolution |
|---|---|---|---|
| D1 | H2: when the hotkey fires while the popup is open, **toggle** (hide) or **ignore**? | Toggle matches Raycast/Alfred; ignore is the minimal change. Recommend ignore now, toggle as a follow-up | TODO — ignore (refocus the open popup); toggle noted in BACKLOG |
| D2 | M9: add a CSP? Hardens a local-only app; every future inline style/data URL must be allowed explicitly | Recommend yes with the policy in M9, verified in dev and a release build | TODO — yes |
| D3 | M12: flush the editor on quit via `beforeunload` (cheap, may miss OS shutdown) or a Rust handshake (robust, more code)? | Recommend the cheap one now | TODO — see M12 for the choice made and why |
| D4 | L2: remove the unused shadcn components, or keep them as a palette? | Recommend remove; `npx shadcn add` restores any in seconds | TODO — remove |
| D5 | Add a minimal ESLint config (`react-hooks`, `typescript-eslint`) so the nine `eslint-disable` comments mean something, or delete the comments? | Recommend add; ~20 lines, and `react-hooks/exhaustive-deps` catches stale closures like H1 | TODO — add |
| D6 | Split `Editor.tsx` (628), `GenerateDialog.tsx` (434), `Settings.tsx` (428)? Cuts: `Editor` → `ParamsPanel` + `TagStrip`; `GenerateDialog` → `generate-instructions.ts` (pure, testable) + dialog; `Settings` → `HotkeyRecorder` + `LibraryCard` | Pure moves, no behavior change; defer if you prefer the files as they are | TODO — defer until correctness work is done |
| D7 | Commit the in-progress groups work first (coherent and green), then land the fixes on top? | Recommend yes; small commits on a clean base | DONE — `1f548bc` (gitignore), `7265cf5` (groups work, SizeDebug, window sizes) |

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
1. [ ] `fillFields` with `$&`/`$$` values (H5), after moving it into core.
2. [ ] Rust: atomic write, and "unreadable file is preserved, never overwritten"
   (H3), via a temp dir and `AppHandle`-free helpers.
3. [ ] Rust: `sync_pack_files` skips empty packs and unchanged files (M4);
   `retire_pack_file` numbering on repeated deletes.
4. [ ] `stripFences` strips a BOM; `diagnosePack` of a BOM file is `ok` (M7).
5. [ ] `sanitize_pack_filename("CON")` (M8).
6. [ ] Popup ranking as a pure function: extract the title/tags/body tiering from
   `popup/App.tsx:129-149` into `core.rankSnippets(query, snippets)` and test
   that a title subsequence beats a tag contiguous match and that pins lead
   with no query.
7. [ ] `defaultPackFor(lastPack, names, isLocked)` once extracted (L1).
8. [ ] `packToJson` includes `group` only when set (M1).
9. [ ] Undo restoration helper (H1) once extracted: delete then undo yields the
   original array with no duplicate ids.
10. [ ] Rust: `patch_snippet`/`add_snippet`/`delete_snippet` merge helpers (H6).

---

## UX and accessibility summary

Keyboard flows in the popup are complete for list/panel/form/create except the
focus return (M2). Manager rows and headers are reachable by Tab and act on
Enter/Space; context menus need the mouse or the Menu key. Screen-reader
semantics are the weak spot (L9). The manager toasts most failures but not
`persist` failures; the popup has no error channel at all (M3). Themes are
consistent apart from toasts (M10) and a faint dark-mode border (L10).

---

## Verification matrix

Filled in as findings close. Every DONE row lists the automated checks that
passed at its commit and the manual check performed.

| Finding | typecheck | npm test | test:rust | Manual (app) | Commit |
|---|---|---|---|---|---|
| (none yet) | | | | | |

## Commit list

| Commit | Findings | Subject |
|---|---|---|
| `1f548bc` | D7 | Ignore agent scratch directories |
| `7265cf5` | D7 | Groups inside packs, and an agent survey mode for Generate |

## Remaining risks and deliberate exclusions

Written at completion.

**Deliberately not proposed by the review:** virtualizing the popup list (no
evidence of need yet), word-wise fuzzy search (a ranking change that deserves
its own discussion), changing copy-only use counting, the macOS port, and
anything in BACKLOG's Distribution section.
