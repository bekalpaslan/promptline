# Promptline release audit — 2026-09-22 — tracker

The live source of truth for the pre-release audit's findings, kept the way
`REVIEW.md` is: every finding carries its severity, location, failure
scenario and proposed fix; a **Status** line and a **Resolution** block
record what was done. Statuses: `TODO`, `IN PROGRESS`, `BLOCKED`, `DONE`,
`DECLINED`, `DECISION` (the human's call, not a task). At most one finding
is `IN PROGRESS` at a time. `DONE` means the failure scenario is fixed and
verified by the checks listed in the resolution.

Scope: the working tree at `d9be788` (`feat/new-menu-and-form`, two commits
ahead of local `master`, which is twelve ahead of `origin/master`). Five
passes ran in parallel: Rust backend (`R`), frontend code (`F`), UI/UX and
accessibility in the browser mock (`U`), tests and CI (`T`), release, docs
and security (`D`). Line numbers are from the tree at audit time and drift
as fixes land.

Baseline before any change: `npx tsc -b --noEmit` clean, `npm run lint`
clean, `npm test` 71/71, `npm run test:rust` 24/24, CI green on
`origin/master` (`ad06b34`), versions agree at 0.2.8 in all five places,
`v0.2.8` released with both installers.

Security posture was checked and needs nothing: no network code and no
telemetry, `connect-src` is the IPC only, one capability (`core:default`)
for both windows, `withGlobalTauri` off, `open_url` https-only with a
constant URL, no log files, no secrets in the history, bundled packs clean.

Deliberate decisions in `BEHAVIOR.md` were treated as constraints (the 80 ms
sleeps, `prev_window` before show, the prompt staying on the clipboard,
`ui/core.js` staying UMD, retire-not-unlink).

---

## Progress summary

| Status | High | Medium | Low | Decisions | Total |
|---|---|---|---|---|---|
| TODO | 0 | 0 | 0 | 0 | 0 |
| IN PROGRESS | 0 | 0 | 0 | 0 | 0 |
| DONE | 7 | 15 | 25 | 2 | 49 |
| **Total** | **7** | **15** | **25** | **2** | **49** |

Everything is closed as of 2026-09-23 except L13's type-checked lint
(declined for now) and one popup ARIA nit under L20. The second wave ran as four
parallel agents in worktrees (Rust, manager, popup and core, docs and
release) merged into master on 2026-09-22.

Order taken: the "fix before tagging" set (H1–H7, plus M3, M8, L6, L11,
L12) in one branch, `fix/release-audit`; the rest in the order listed
under each heading, medium before low, `R`/`F` before `U`, docs last.

---

## Decisions (the human's)

### D1. The name "Promptline" and the identifier `com.promptline.app`
**Status:** DECISION
**Where:** `src-tauri/tauri.conf.json:5`, product name throughout.
**What:** `promptline.app` is a live product (a customer-service agent
platform); `PromptLine-app` is a GitHub org; `nkmr-jp/prompt-line` is a
macOS prompt-input tool aimed at Claude Code users, this app's own audience.
The bundle identifier mirrors a domain the project does not own and names
the data folder (`%APPDATA%\com.promptline.app`), so it can only be changed
cheaply before the public release; afterwards a change moves every user's
data directory and needs a migration.
**Options:** keep the name and change the identifier now to something owned
(`io.github.bekalpaslan.promptline`) with a one-time data-dir migration; or
rename the product before promoting it.
**Decided (2026-09-22):** keep the name, own the identifier.
**Resolution:**
- *Implementation:* `identifier` is `io.github.bekalpaslan.promptline`;
  `migrate_data_dir` runs first in `setup` and moves every entry of the old
  `%APPDATA%\com.promptline.app` into the new folder (skipping names the
  new folder already has), rewrites the packs' absolute file paths in the
  moved `config.json`, and removes the old folder once empty; a failure is
  a notice and the library stays put. The WebView2 profile under
  `%LOCALAPPDATA%` is not moved: prefs come from `config.json`, only the
  sidebar's fold state and sort order (localStorage) start fresh.
- *Tests added:* `moving_the_data_dir_carries_files_and_rewrites_pack_paths`.
- *Docs:* `BEHAVIOR.md` "State and where it lives"; the path in `README.md`,
  `CLAUDE.md`, Settings and the architecture map's JSON sources (the
  published map still shows the old label until the next refresh).
- *Release notes:* call the folder move out as the one change an existing
  install notices.

### D2. Which internal documents ship in the public repo
**Status:** DECISION
**Where:** `REVIEW.md` (1 872 lines), `BUG-HUNT-BENCHMARK.md` (which says
"this codebase also contains several other real bugs"),
`BUG-HUNT-FINDINGS.md` (1 655 lines), `UI-REWORK-ROADMAP.md` (a history
document since 2026-07-12), `docs/architecture/` (private claude.ai links),
`CLAUDE.md` (machine-specific notes, private artifact links), this file.
**What:** a stranger skimming the root sees benchmark and bug-seeding
artefacts before the README. Test names cite the trackers' finding ids
(H1, M7, BH3-1), so deleting them orphans references; moving them under
`docs/history/` and pointing `CLAUDE.md` there keeps both.
**Done meanwhile:** `PITCH-SCRIPT.md` is gitignored (it names a person).
**Decided (2026-09-22):** move under `docs/history/`, keep everything.
**Resolution:** the five trackers live in `docs/history/`; `CLAUDE.md` and
`BACKLOG.md` point there. Still open from L11: the stale `claude/*` remote
branches, the merged `fix/bug-hunt*` branches, `src-tauri/gen/schemas/`
being tracked, the mobile icon folders, and the private artifact links and
machine-specific notes in `CLAUDE.md`.

---

## High

### H1. No single-instance guard; two processes defeat the revision check
**Status:** DONE
**Where:** `src-tauri/src/lib.rs` `run()` (~:1871). Pass `R`.
**What:** nothing stopped a second process. Autostart plus a Start-menu
click, or the installer's finish page starting an app that was already
running, gave two tray icons and two managers over the same files. Each
process keeps its own `AppState.revision`, so `save_snippets` in one could
not see the other's writes: the stale-write protection from the 2026-09
review (H6) was defeated across processes. The hotkey refusal being
non-fatal (H4) made the double launch quiet.
**Fix:** `tauri-plugin-single-instance`; the second launch shows the first's
manager.
**Resolution:**
- *Implementation:* `tauri-plugin-single-instance = "2"` (2.4.5) in
  `Cargo.toml`; `run()` registers it first. The callback opens the running
  instance's manager (`show_main`) unless the arguments carry `--hidden`.
- *Tests:* none possible in `cargo test` (process-level); manual: launch
  the release build twice, one tray icon, the second launch raised the
  manager.
- *Docs:* `BEHAVIOR.md` "Launching and quitting".

### H2. Autostart opens the manager window at every login
**Status:** DONE
**Where:** `src-tauri/tauri.conf.json:14-24` (main window has no
`visible: false`), `lib.rs:1873` (autostart plugin initialised with no
arguments). Pass `R`.
**What:** with Autostart on, a 1000×800 manager appeared centred over the
desktop at every login; for a tray app that is the opposite of what
autostart is for.
**Fix:** pass `--hidden` from the autostart entry and hide `main` in `setup`
when it is present.
**Resolution:**
- *Implementation:* `HIDDEN_ARG` constant; `tauri_plugin_autostart::init(…,
  Some(vec![HIDDEN_ARG]))`; `setup` hides `main` before it paints when
  `std::env::args()` contains it. The window stays declared visible so a
  normal launch shows the manager without a flash of nothing.
- *Note:* an existing autostart entry keeps its old command line until the
  user toggles Autostart off and on (the plugin rewrites the Run key then).
  Called out for the release notes.
- *Docs:* `BEHAVIOR.md` "Launching and quitting", `README.md` Settings bullet.

### H3. Undo callbacks and context-menu actions persist a stale render snapshot
**Status:** DONE
**Where:** `src/manager/menus.tsx` (rename-group merge Undo ~:83, Ungroup and
its Undo ~:124, pin/unpin ~:297, move-to ~:325, add tag ~:373, "Give this
pack a file…" ~:174), `src/manager/Sidebar.tsx` regroup-by-drag Undo
(~:232), `src/manager/Settings.tsx:374`, `src/manager/Editor.tsx:438`,
`src/manager/ImportCuration.tsx:132`. Pass `F`.
**What:** every one of these called `m.persist(m.snippets.map(…))` from a
closure built when the menu opened or the Undo toast was shown, so up to
12 s old. `deleteWithUndo` reads the live library (review H1); these did
not. The revision check cannot catch it: `snippets-changed` → `reloadLibrary`
keeps `revisionRef` current, so `save_snippets` accepts a current base
revision with stale content.
**Failure:** Ungroup a group; type a title in the editor (autosave lands via
`update_snippet`) or paste from the popup (`uses` bumps); click Undo within
12 s. Disk now holds the pre-ungroup array: the title edit and the use
count are gone, while the editor still shows the typed title.
**Fix:** `persist` accepts an updater applied to `snippetsRef.current`; every
closure site passes one.
**Resolution:**
- *Implementation:* `ManagerApi.persist(next | (current) => next)` in
  `src/manager/state.ts`, applied to `snippetsRef.current` in
  `src/manager/App.tsx`. All eleven sites pass updaters; the regroup Undo
  re-inserts the moved prompt at its old index with its old label in the
  current library instead of restoring a captured array; the import appends
  its new prompts to the current library; "Give this pack a file…" writes
  `(cur) => [...cur]` to trigger the pack sync.
- *Tests:* the logic is React state plumbing; covered by the mock walk
  below. A pure `restoreAt` helper in core with a node test is the follow-up
  if this regresses.
- *Docs:* `BEHAVIOR.md` "State and where it lives", the `deleteWithUndo`
  paragraph.

### H4. A new prompt can land in a pack that does not exist
**Status:** DONE
**Where:** `ui/core.js` `defaultPackFor` (~:377), `src/lib/library.ts:42`
(`packNames(…, { always: true })`), `src/popup/App.tsx:272` (the create
form's pack list, also `always: true`). Passes `U` and `F`.
**What:** the rule's second branch returned the default pack whenever it
was unlocked, without checking it exists, and the callers added it to
`names` unconditionally. A library that had deleted "My prompts" saw popup
Ctrl+N and the manager's empty-state button pre-select it and conjure it on
save; the popup's select listed a pack nobody had made.
**Fix:** require `names.includes(defaultPack)`; list only existing packs plus
the form's own choice.
**Resolution:**
- *Implementation:* `defaultPackFor` returns the default pack only when it
  is in `names` (or when `names` is empty: a fresh library starts with it);
  `library.ts` no longer passes `always`; the popup lists
  `packNames(…, { extra: create?.pack })`.
- *Tests added:* `tests/core.test.js` "defaultPackFor never names a pack
  that does not exist": default deleted → first unlocked; last-used gone and
  first locked → next; all locked → "Unsorted".
- *Docs:* `BEHAVIOR.md` "Where a new prompt goes".

### H5. Removing a parameter chip reformats the whole prompt
**Status:** DONE
**Where:** `src/manager/Editor.tsx:357-365` `removeParam`. Pass `F`.
**What:** after deleting the token it ran `.replace(/[^\S\n]{2,}/g, " ")`
over the entire text, so any indented code or aligned table in the prompt
lost its indentation; autosave committed it 600 ms later with no undo.
**Fix:** tidy only the whitespace adjacent to the removed token.
**Resolution:**
- *Implementation:* `C.removeParamToken(text, name)` in `ui/core.js`: a
  token between spaces leaves one, a token alone on its line takes the line,
  nothing else is touched. The editor calls it.
- *Tests added:* `tests/core.test.js` two cases, including a Python block
  and an aligned table that come back byte-identical apart from the token.

### H6. A failed use-count bump after the popup is hidden swallows the paste
**Status:** DONE
**Where:** `src-tauri/src/lib.rs` `paste_snippet` (~:1245). Pass `R`.
**What:** `load_snippets_from_disk(&app)?` ran after the clipboard write and
`w.hide()` but before the paste thread was spawned. A momentarily
unreadable `snippets.json` (sync client, scanner, permission error) returned
`Err` to a hidden popup: no Ctrl+V, prompt on the clipboard, nothing shown.
**Fix:** make the read best-effort like the write already was.
**Resolution:**
- *Implementation:* `if let Ok(mut snippets) = load_snippets_from_disk(&app)`;
  the paste always follows.
- *Docs:* `BEHAVIOR.md` paste pipeline step 4.

### H7. New pack's inline rename appends instead of replacing
**Status:** DONE
**Where:** `src/manager/Sidebar.tsx:648` (pack rename), `:471` (group
rename). Pass `U`.
**What:** the field focused with the caret after "New pack", so typing
"Work" gave "New packWork"; the editor's draft title selects all
(`Editor.tsx:510`), this one did not. Neither input had an accessible name
(`U`-A3).
**Resolution:**
- *Implementation:* `onFocus={(e) => e.currentTarget.select()}` and
  `aria-label="Rename pack …"` / `"Rename group …"` on both inputs.

---

## Medium

### M1. Pack file paths are absolute and write failures are silent
**Status:** DONE
**Where:** `lib.rs` `PackMeta.path` (~:191), `write_pack_files` (~:509),
`ensure_packs_backed` (~:401). Pass `R`.
**What:** a restored or roamed profile (other username, moved folder) leaves
every path pointing at a missing directory; every pack write fails with
ENOENT, nothing is reported, Settings still shows the old path.
**Fix:** store the file name relative to `packs/`; at minimum treat a path
whose parent does not exist like an empty one in `ensure_packs_backed` and
`notify` on a pack write failure.
**Resolution:**
- *Implementation:* `PackMeta.path` on disk is relative to `packs/` (a file outside stays absolute); `resolve_pack_path`/`relativize_pack_path`; `load_config_from_disk` migrates a pre-0.2.9 config once; `get_config` resolves on the way out and `save_packs` relativises on the way in, so the IPC shape is unchanged. `write_pack_files` returns what failed; `sync_pack_files` logs each failure and raises a `pack-write-failed` notice once per session. `move_data_dir` writes the relative form directly.
- *Tests added:* relative/absolute round trip, one-time migration, an unwritable pack file is reported.
- *Docs:* `BEHAVIOR.md` "Packs and their files", "State".

### M2. Nothing is logged in a release build
**Status:** DONE
**Where:** `notify` uses `eprintln!` (`lib.rs:66`); `main.rs:1`
`windows_subsystem = "windows"`. Pass `R`.
**What:** every `let _ =` (pack writes, retirement, `SetForegroundWindow`,
autostart) is unobservable in the shipped binary; a public bug report has
no file to attach.
**Fix:** `tauri-plugin-log` with a rolling file target in the data dir;
route ignored results through `log::warn!`.
**Resolution:**
- *Implementation:* `tauri-plugin-log` (Rust-only, no capability), `warn` level, rolling `promptline.log` in the data folder (512 KB, keep one); `notify` and every formerly ignored result (pack writes, retirement, config saves, the use-count write, autostart, `SetForegroundWindow`) log paths and error text, never prompt content.
- *Docs:* `BEHAVIOR.md` State table; README, SECURITY.md and the bug template name the file.

### M3. `write_atomic` neither retries the rename nor fsyncs
**Status:** DONE
**Where:** `lib.rs:86-90`. Pass `R`.
**What:** on Windows `rename` fails with "Access is denied" while OneDrive,
Dropbox or Defender hold the destination for tens of milliseconds after a
change; an autosave in that window shows "Couldn't save" and the manager
reloads, discarding the keystrokes since the last save. Without
`sync_all` the "power loss leaves the previous file whole" comment is not
guaranteed on NTFS (the quarantine path bounds the damage).
**Fix:** 3–5 retries with a short backoff on `rename`; `sync_all` on the
temp file first.
**Resolution:**
- *Implementation:* `write_synced` (write + `sync_all`) then `rename_with_retries` (5 tries, 20 ms doubling) on PermissionDenied / sharing violations; the temp file is removed on final failure.
- *Tests added:* transient-error classification, a write outlasting a 60 ms exclusive handle (Windows), no temp file left after a failed write.

### M4. Summoning the popup from the manager pastes into the editor
**Status:** DONE
**Where:** `lib.rs` `show_popup` (~:1322). Pass `R`.
**What:** only the popup's own HWND is refused as `prev_window`; the
manager's is accepted. Editing prompt X, pressing the hotkey to check Y and
hitting Enter pastes Y's text into X's textarea, and autosave writes it.
**Fix:** when the foreground window is any of ours, record 0 and have
`paste_snippet` treat 0 as copy-only with the "Copied" feedback.
**Resolution:**
- *Implementation:* `paste_target` records 0 when the foreground window is the popup or the manager; `paste_mode` turns a paste with no target into copy-only. `paste_snippet` returns `"pasted"` or `"copied"`; the popup shows "Copied to clipboard — the manager was in front" on `"copied"` and hides itself like Ctrl+Enter.
- *Tests added:* both mappings in Rust; the popup path walked in the mock (`__mock.pasteResult`).
- *Docs:* `BEHAVIOR.md` paste pipeline steps 1 and 4.

### M5. First drag under "Most used" / "A–Z" applies the drop in array order
**Status:** DONE
**Where:** `src/manager/Sidebar.tsx` `commitReorder` (~:219). Pass `F`.
**What:** the drop target is chosen in the displayed (sorted) order but the
splice happens in the master array's order; `setOrderBy("custom")` then
reveals that order, so every row except the dragged one reshuffles.
**Fix:** when `orderBy !== "custom"`, rebase the array to the current
`C.sortPrompts` result before splicing.
**Resolution:**
- *Implementation:* `commitReorder` rebases the array to the displayed order (`C.sortPrompts`, flattened by `C.packTree` in the grouped view) before splicing when the order is not Custom.
- *Manual verification:* Alt+Down under "Most used" moved only the dragged row; the persisted array matched what was on screen.

### M6. A folded group in the popup cannot be reopened from the keyboard
**Status:** DONE
**Where:** `src/popup/App.tsx` Ctrl+→ (~:642), ← (~:675). Pass `F`.
**What:** ← folds a group and its rows leave `visible`; Ctrl+→ clears pack
folds only and otherwise opens the preview. Keyboard-only users need the
mouse.
**Fix:** Ctrl+→ clears both pack and group folds unconditionally.
**Resolution:**
- *Implementation:* Ctrl+→ clears both pack and group folds unconditionally.
- *Manual verification:* ← folded a group (30 → 29 rows), Ctrl+→ restored it without opening the preview.
- *Docs:* `BEHAVIOR.md` "The popup's list folds from the keyboard too".

### M7. `{0}` / `{1}` are shown as red "not a param" chips
**Status:** DONE
**Where:** `ui/core.js` `tokenize` (marks every invalid name `bad`), editor
preview. Pass `U`.
**What:** the comment and `BEHAVIOR.md` say numeric names stay literal, but
pasting code with format slots yields one red chip per slot, each repeating
the full rule, wrapping mid-chip.
**Fix:** treat purely numeric names as `text` in `tokenize`; shorten the
near-miss chip and state the rule once in the legend.
**Resolution:**
- *Implementation:* `tokenize` keeps purely numeric names as text in one run with their surroundings; `{Goal}`/`{1st}` stay `bad`.
- *Tests added:* `{0}`/`{1}` as text; the near-miss test expects only `{Goal}`.
- *Chip wording (wave 3):* the near-miss chip reads "Goal — not a field"; the editor's preview footer states the rule once, naming the offending tokens.

### M8. Mock backend missed nine of the 26 commands the UI calls
**Status:** DONE
**Where:** `src/lib/dev-mock.ts:91-144`. Passes `F` and `T`.
**What:** `read_pack_file`, `import_pack_file`, `create_generated_file`,
`edit_in_manager`, `hide_popup`, `open_url`, `quit_now`, `set_autostart`,
`show_in_folder` resolved to null: the Settings import buttons and the
generate dialog's agent path were inert under `?mock`. `request_quit_cmd`
was registered in Rust with no caller.
**Resolution:**
- *Implementation:* all nine handled (the two readers answer with a small
  pack holding one new and one duplicate prompt; `create_generated_file`
  returns a path; the window/shell ones are no-ops); `paste_snippet` bumps
  `uses` like the real one. `request_quit_cmd` removed.
- *Tests added:* `tests/mock.test.js` scans `src/**` for `invoke("…")`,
  `lib.rs` for `generate_handler![…]` and the mock for its keys, and asserts
  the three agree (every invoke registered, every invoke mocked, no dead
  command). Enforces CLAUDE.md's "add it to the mock too".

### M9. No autosave feedback anywhere
**Status:** DONE
**Where:** editor. Pass `U` (also BACKLOG "Saving… / Saved caption").
**Fix:** a small "Saved" indicator in the editor header, announced once
through the live region.
**Resolution:**
- *Implementation:* the editor header shows "Saving…" when a save is scheduled and "Saved" (with a check) when `update_snippet` lands, fading after 2 s; a sibling `role=status` announces "Saved" once. Errors stay with the existing toast.
- *Manual verification:* typed a title: "Saving…" at 100 ms, "Saved" at 900 ms, gone at 3.2 s, edit on disk.
- *Docs:* `BEHAVIOR.md` "The editor autosaves, and says so in one place".

### M10. User-written names are uppercased in menu headers and the fill-in title
**Status:** DONE
**Where:** `section-label` (`text-transform: uppercase`) used for ctx-menu
headers ("SESSION FLOW"), the popup form title and create mode. Pass `U`.
**What:** `BEHAVIOR.md`: "uppercase is for the app's own section labels,
never for names the user wrote."
**Fix:** a non-transforming header variant for user names.
**Resolution:**
- *Implementation:* a `name-label` utility (same size, weight and tone as `section-label`, no transform); context-menu header items carry `name: true` when their text is the user's; the popup's `SectionHeader` takes `name` for the form and action-panel titles. The app's own headings are unchanged.
- *Commit:* `3dcd86d`.

### M11. Two competing empty states on an empty library
**Status:** DONE
**Where:** `?mock=empty` manager: sidebar "No prompts yet … [New pack]" and
pane "No prompts yet … [New prompt] [Generate pack…]". Pass `U`.
**Fix:** one empty state, one primary action; if "New prompt" stays, have it
ask where like the New menu does.
**Resolution:**
- *Implementation:* the sidebar's own empty state is gone; the pane's empty-library state has one primary "New" that opens the New menu (Pack / Group / Prompt / Generate) and a secondary "Generate pack with Claude…". The non-empty "Select a prompt" state keeps its `defaultPackFor` "New prompt".
- *Manual verification:* `?mock=empty`: one "No prompts yet"; New → Pack created the pack with its name selected for typing.
- *Docs:* `BEHAVIOR.md` "The manager's New asks where".

### M12. Sidebar is ~100 Tab stops with no arrow-key navigation
**Status:** DONE
**Where:** `src/manager/Sidebar.tsx` rows (`div role=button tabindex=0`).
Pass `U` (findings 7, A1, A2).
**What:** no `tree` semantics; rows nest real `<button>`s inside
`role=button` (invalid ARIA; the computed name becomes "Collapse pack Work
Work Actions for pack Work 0").
**Fix:** roving tabindex with Up/Down/Left/Right as a `tree`; actions
button as a sibling of the row.
**Resolution:**
- *Implementation:* the sidebar is a `role=tree` ("Library") of `treeitem`s with `aria-level`, `aria-expanded`, `aria-selected` and explicit labels; one roving tab stop; Up/Down, Home/End, Right unfolds or enters, Left folds or leaves, Enter/Space activates, Alt+Up/Down reorders, Menu key / Shift+F10 opens the row's menu. Chevron and dots are `aria-hidden` and refocus the row. Enter on a pack or group now opens its overview instead of folding.
- *Manual verification:* a11y snapshot with one tabbable row and no buttons inside treeitems; the full keyboard walk; every mouse behaviour unchanged.
- *Docs:* `BEHAVIOR.md` "The sidebar is one tree to the keyboard".

### M13. Tag suggestions show every tag in the library
**Status:** DONE
**Where:** editor Tags card. Pass `U`.
**Fix:** cap at ~6 most used; the rest through typing.
**Resolution:**
- *Implementation:* at most six pills, the most-used tags the prompt lacks; a `datalist` on the "+ tag…" input completes every other tag.
- *Manual verification:* six pills, twelve datalist options, the prompt's own tag skipped.

### M14. `PromptlineCore` interface is hand-written and drifting
**Status:** DONE
**Where:** `src/lib/core.ts:101-150` vs `ui/core.js`. Passes `T` and `F`.
**What:** `core.js` is neither typechecked nor linted; `expandBuiltins`
omits the `now` parameter and `fillFields` requires `values` in TS while JS
accepts `undefined`; `RESERVED` is exported but not typed. A renamed export
passes every check and fails at runtime in both windows. `isEmptyDraft` is
re-spelled in `App.tsx:298` and `Editor.tsx:197`; tag normalisation differs
between the editor, "Add tag…" and import.
**Fix:** `// @ts-check` + JSDoc on `core.js` with `checkJs`, or a generated
`core.d.ts`; a node test that `Object.keys(C)` equals the interface's keys;
export `DRAFT_TITLE`, `RESERVED`, `normalizeTag` and use them.
**Resolution:**
- *Implementation:* `core.ts` fixed (`expandBuiltins(text, now?)`, `fillFields(text, values?)`, `expandForCopy(…, now?)`, `RESERVED`, `isValidParam`); core exports `DRAFT_TITLE`, `normalizeTag` (lowercase, strip everything outside `[a-z0-9_-]`, the strictest of the three rules), `plural`, `titleFromClipboard`, `slotEntries`.
- *Tests added:* `tests/interface.test.js` asserts the interface's member names equal `Object.keys(core)` both ways.
- *Manager call sites (wave 3):* `App.tsx` uses `C.DRAFT_TITLE`; the editor's draft check is `C.isEmptyDraft`; the editor's tag field, "Add tag…" and `parsePacks` share `C.normalizeTag` (documented in `BEHAVIOR.md` "One tag rule everywhere", with a test that an imported "Code Review" becomes `codereview`); the plural slips in the editor footer, Settings' export toast and the import curation count use `C.plural`.

### M15. CI never builds the shipped artefact and toolchains are unpinned
**Status:** DONE (validated, not run)
**Where:** `.github/workflows/ci.yml`. Pass `T`.
**What:** lint, tsc, node tests and `cargo test` run, but never `vite build`
(Tailwind/CSS errors surface at release time) nor `tauri build`; no
`rustfmt`/`clippy` locally or in CI; `dtolnay/rust-toolchain@stable` and
Node 22 float; no `permissions:`, `concurrency` or `timeout-minutes`.
**Done:** the trigger is now every push and every PR, so a locally merged
feature branch is checked before it lands on master.
**Fix:** add `npm run ui:build` to the checks; a `v*` tag job that runs
`tauri build` and uploads both installers as artefacts; `rustup component
add rustfmt clippy` and `cargo fmt --check`, `cargo clippy --all-targets --
-D warnings`; `rust-toolchain.toml`, `engines.node`.
**Resolution:**
- *Implementation:* `checks` adds `npm run ui:build`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` (components via the toolchain action); an `installers` job on `v*` tags runs `tauri build` and uploads both installers as artefacts; `permissions: contents: read`, `concurrency` with cancel, `timeout-minutes`; Node 22 from `.nvmrc` and `engines`. The crate is fmt- and clippy-clean.
- *Not verified:* the workflow was parsed, not run; the first push shows.

---

## Low

### L1. Popup clamp uses the pre-move size on mixed-DPI monitors
**Status:** DONE
**Where:** `lib.rs` `show_popup` (~:1341). Pass `R`, by reading.
**Fix:** scale the size by the target monitor's factor before clamping, or
clamp again after `show()`.
**Resolution:**
- *Implementation:* pure `clamp_to_area`; the popup's size is scaled by the target monitor's factor before clamping.
- *Tests added:* negative-coordinate monitor, taskbar strip, 150 % size, oversized window.

### L2. Paste into an elevated or foreground-locked window fails silently
**Status:** DONE
**Where:** `platform::focus_window` (~:1384), `send_ctrl_v` (~:1421). Pass `R`.
**Fix:** check both return values on the paste thread and re-show the popup
with "Couldn't paste into that window — the prompt is on your clipboard".
Document the limitation in README (see L17).
**Resolution:**
- *Implementation:* `send_ctrl_v` reports whether all events went in; a refused `SetForegroundWindow` sends no Ctrl+V; either failure re-shows the popup without re-recording `prev_window` and emits `paste-failed` with a message the popup shows as a persistent error. UIPI drops input to elevated windows silently, so that case still passes; README's Known limitations says so.
- *Docs:* `BEHAVIOR.md` step 5, events table.

### L3. `save_packs` trusts a full client-side list
**Status:** DONE
**Where:** `lib.rs` `save_packs` (~:918). Pass `R`.
**What:** a stale list retires and re-creates pack files, leaving strays in
`packs/deleted/`; if the pack was empty in the library the real content
moves to `deleted/` and a fresh empty file takes its place.
**Fix:** intent-level commands (`set_pack_locked`, `delete_pack`, `add_pack`)
like `rename_pack`.
**Resolution:**
- *Implementation:* `save_packs` is gone; `set_pack_locked`, `delete_pack`, `add_pack` (refuses a case-insensitive duplicate via `validate_pack_name`, shared with rename) and `add_pack_file` ("Create pack file…") are read-modify-writes under the store lock answering with the resolved `Config.packs`; the manager takes the answer as `packMeta` (`applyPacks`), `persistPacks` is gone, the pack-delete Undo restores the lock with `set_pack_locked`.
- *Tests added:* one Rust test per helper; the mock answers all four (`tests/mock.test.js`).
- *Docs:* `BEHAVIOR.md` "Pack metadata is written by intent", "State".

### L4. Rust accepts a modifier-less hotkey
**Status:** DONE
**Where:** `lib.rs` `set_hotkey` (~:895), `resolve_hotkey`. Pass `R`.
**What:** `global-hotkey` 0.8 parses a bare `"a"` as valid; only the
recorder guards against it. A hand-edited config captures a letter
system-wide.
**Fix:** refuse a `Shortcut` with empty `mods` in both places.
**Done meanwhile:** the missing serde default on `hotkey` (the same
finding's other half) is fixed, with a test.
**Resolution:**
- *Implementation:* `parse_hotkey` refuses empty modifiers; `set_hotkey` returns the error, `resolve_hotkey` falls back to the default.
- *Tests added:* a bare `"a"` is refused everywhere (and confirmed to parse in `global-hotkey`).

### L5. `store` held across `w.hide()` works only because focus events are asynchronous
**Status:** DONE
**Where:** `hide_popup` (~:1195), `paste_snippet` (~:1241), `CloseRequested`
(~:1997) vs the `Focused(false)` handler (~:1983). Pass `R`, verified against
`tauri-runtime-wry 2.11.4`.
**Fix:** persist the size under the lock, release it, then hide.
**Resolution:**
- *Implementation:* `hide_popup`, `paste_snippet` and the blur handler persist the size under the lock, drop it, then hide. `CloseRequested` already scoped its guard.
- *Docs:* `BEHAVIOR.md` "Closing a window hides it"; the `AppState.store` comment.

### L6. Plural and copy slips
**Status:** DONE
**Where:** `menus.tsx:407` ("Deleted 1 prompts"), `menus.tsx:93`,
`menus.tsx:328` ("Moved 1 to …"), `Settings.tsx:459`,
`ImportCuration.tsx:148`; `Editor.tsx:753` ("1 fill-in field stay as
typed"). Passes `F` and `U`.
**Resolution:** the delete label is fixed. The rest wait for a `plural(n,
word)` helper in core (with M14).
**Resolution:**
- *Implementation:* `C.plural(n, word, pluralWord?)`; the popup's live region and form labels use it; the delete label was fixed earlier.
- *Manager sites (wave 3):* the editor footer, Settings' export toast and the import count use `C.plural`; the remaining `${n} prompts` strings only ever render for n > 1.

### L7. `open_url` and `show_in_folder` spawn `explorer` with a caller-supplied path
**Status:** DONE
**Where:** `lib.rs:1043-1074`. Pass `R`.
**What:** `read_pack_file(path)` reads any user-readable file into the
webview; `explorer <url>` parses its own command line. Only relevant if the
bundle is ever compromised; the URL is a constant today.
**Fix:** `ShellExecuteW` or `tauri-plugin-opener`; constrain
`read_pack_file`/`show_in_folder` to `data_dir`.
**Resolution:**
- *Implementation:* `path_within` canonicalises and checks containment; `read_pack_file` and `show_in_folder` refuse paths outside the data folder; `open_url` goes through `ShellExecuteW`, https-only.
- *Tests added:* only files under the data folder are admitted.

### L8. `lib.rs` is one 2 000-line file with repeated patterns
**Status:** DONE
**Where:** four "numbered until free" loops (~:144, :345, :955, :1033), two
epoch helpers, three re-reads of `config.json` per write, `config.json`
parsed on every hotkey press for the first-run flag, a stale comment on
`save_snippets` (`None` callers), template leftovers (`staticlib`,
`mobile_entry_point`). Pass `R`.
**Fix:** split into `store.rs`, `packs.rs`, `commands.rs`, `paste.rs`,
`platform.rs`; one `next_free_name`; cache the first-run flag in `AppState`.
**Resolution:**
- *Implementation:* `store.rs`, `packs.rs`, `commands.rs`, `paste.rs` (the paste commands live with their pipeline), `platform.rs`, `migrations.rs`; `lib.rs` keeps `AppState`, the tray, window events and `run`. One `first_free` for the four numbering loops, one `since_epoch`, `popup_seen` cached in `AppState`, `staticlib` and `mobile_entry_point` dropped, `pub(crate)` only where read across modules. Tests moved beside what they test (46).
- *Docs:* `BEHAVIOR.md` "Windows-specific code" (module map), README Stack.

### L9. Rust paste and storage policies are untested because they are inlined
**Status:** DONE
**Where:** the Stale gate (~:859), `retire_pack_file` (~:941), `{clipboard}`
expansion (~:1220), quarantined-library-starts-empty (~:623). Pass `T`.
**Fix:** extract `check_revision`, `retire_into`, `expand_clipboard`,
`snippets_from_loaded` as pure functions and test each (the `T` pass lists
the scenarios).
**Resolution:**
- *Implementation:* `check_revision`, `retire_into`, `expand_clipboard`, `snippets_from_loaded` extracted, behaviour unchanged.
- *Tests added:* one per function, the scenarios the `T` pass listed.

### L10. Testable manager and popup logic lives in components
**Status:** DONE
**Where:** `menus.tsx` `freeName`/`groupsIn`, `ImportCuration.tsx` dupe
detection and locked-skip, `popup/App.tsx` Ctrl+1..5 `slotEntries` and the
Ctrl+N title cut, `Editor.tsx` autosave payload, `Settings.tsx`
`hotkeyFromEvent`, `GenerateDialog.tsx` instruction builders (already in
BACKLOG). Pass `T`.
**Fix:** move each into `ui/core.js` with `node --test` cases; add a Rust
test parsing the exact vocabulary the recorder can emit.
**Resolution:**
- *Implementation:* `C.slotEntries(ranked, visibleIds, max)` and `C.titleFromClipboard(text, max)` with tests; the popup calls both.
- *Open:* `freeName`/`groupsIn` (`menus.tsx`), import curation, the autosave payload, `hotkeyFromEvent`, the generate builders, plus the manager wave's own candidates: `displayedOrder` and the `TreeRow` builder in `Sidebar.tsx`, `tagsByCount`.
**Resolution (manager parts):**
- *Implementation:* `freeName`, `groupsIn`, `tagsByCount`, `displayOrder`, `treeRows`, `groupKey`, `importRows` + `curateImport`, `hotkeyFromEvent` + `hotkeyKeyName` in `ui/core.js`; the recorder admits exactly the vocabulary `parse_hotkey` reads and refuses the rest with a message.
- *Tests added:* 11 node tests; Rust `every_key_the_recorder_can_emit_parses_as_a_hotkey`.
- *Bug found on the way:* Left from a grouped prompt never reached its group (`CSS.escape` on the group key's NUL); fixed by comparing keys.

### L11. Public-repo hygiene
**Status:** DONE (repo); remote branches for the human
**Where:** untracked `PITCH-SCRIPT.md`; stale remote branches `claude/*`;
merged local branches `fix/bug-hunt*`; `src-tauri/gen/schemas/` tracked
(regenerated on every build); `src-tauri/icons/android|ios` for a
Windows-only app; two git identities. Passes `T` and `D`.
**Done:** `PITCH-SCRIPT.md` gitignored.
**Fix:** the rest is D2 plus `git branch -d`, `git push origin --delete`,
`.gitignore` for `gen/schemas/`, `.mailmap`.
**Resolution:**
- *Implementation:* `src-tauri/gen/schemas/` gitignored and untracked; the Android and iOS icon folders deleted; `.mailmap` folds the two identities; `fix/bug-hunt*` and the empty `fix/release-audit` deleted locally.
- *Human:* `git push origin --delete claude/design-system-adoption-ecce19 claude/token-sync`; the `bench-*` tags stay.

### L12. Rename inputs unlabelled; popup create fields unlabelled
**Status:** DONE
**Where:** `Sidebar.tsx:471, 648` (done with H7); `popup/App.tsx` create
mode "Name" and "Pack" (`INPUT`/`SELECT` without `aria-label` or `<label
for>`). Pass `U` (A3, A4).
**Fix:** `<label htmlFor>` on the popup's two create fields.
**Resolution:**
- *Implementation:* the popup's create fields carry `<label htmlFor>` (`create-title`, `create-pack`, `create-group`); the rename inputs were done with H7.

### L13. Lint warnings cannot fail CI; no type-checked lint
**Status:** DONE (max-warnings); type-checked lint DECLINED
**Where:** `eslint.config.mjs`, `package.json` `"lint"`. Pass `F`.
**Fix:** `--max-warnings 0`; `recommendedTypeChecked` for `src/**` to get
`no-floating-promises` (`menus.tsx:253,262`, `Sidebar.tsx:260` have
unhandled rejections today).
**Resolution:**
- *Implementation:* `"lint": "eslint . --max-warnings 0"`.
- *Declined:* `recommendedTypeChecked` on `src/**` yields 24 errors (`restrict-template-expressions` 12, `unbound-method` 3, `no-unsafe-argument` 3, …), over the threshold; revisit when those are worth fixing.

### L14. Popup `pick` has no re-entrancy guard
**Status:** DONE
**Where:** `popup/App.tsx:384-401`. Pass `F`.
**What:** a second Enter inside the ~150 ms before Rust hides the window runs
`paste_snippet` twice: two Ctrl+V, `uses` +2.
**Fix:** ignore `pick` while `pickedId` is set; clear it on failure.
**Resolution:**
- *Implementation:* `pickedRef` guards `pick` and `submitForm` while a paste is in flight; cleared on failure, on `"copied"`, on `paste-failed` and on every summon.
- *Manual verification:* double Enter → one `paste_snippet`; the form's two Enter paths → one.

### L15. Ctrl+Z runs an Undo whose toast was dismissed
**Status:** DONE
**Where:** `src/manager/status.ts:13-26`. Pass `F`.
**Fix:** clear `lastUndo` in the toast's `onDismiss`/`onAutoClose`.
**Resolution:**
- *Implementation:* `sayUndo` clears `lastUndo` on the toast's dismiss and auto-close; the 12 s timer is gone.
- *Manual verification:* close the toast, Ctrl+Z does nothing; with the toast up it restores.

### L16. Overview and Sidebar hold independent `useLibraryMenus` instances
**Status:** DONE
**Where:** `Overview.tsx:206,330` vs `Sidebar.tsx:338-350`. Pass `F`.
**What:** a rename from the overview never runs `carryPackFolds`; "New
group…" from the overview never unfolds the pack.
**Fix:** lift the fold-carry and unfold callbacks into the manager API.
**Resolution:**
- *Implementation:* `src/manager/folds.ts` (`useFolds`) holds pack/group folds in the manager API; renames carry folds from either surface; `newPrompt(into)` unfolds where the draft lands; rename state is shared and filtered per surface; the overview's rename input selects on focus.
- *Manual verification:* rename from the overview kept the fold; "New group…" from the overview unfolded the pack.

### L17. README for a stranger
**Status:** DONE
**Where:** `README.md`. Pass `D`.
**What:** Install says build from source with no link to Releases; no
screenshot or GIF; the hotkey note mentions browsers but not Windows
Terminal, where Ctrl+Shift+V is paste and the headline use case lives;
nothing on uninstall (the NSIS uninstaller offers a "delete application
data" checkbox and removes the autostart key), backup ("copy this folder"),
or known limitations (Windows only, unsigned, no auto-update, elevated
windows, the WebView2 bootstrapper download); no Credits (Outfit is OFL and
its licence text must ship; Remix Icon 4.9 is under the Remix Icon License,
attribution appreciated). `packs/TEMPLATE.md` describes UI that no longer
exists ("Group by pack", the old generate step titles).
**Fix:** the sections above, a `THIRD-PARTY-NOTICES` file shipped through
`bundle.resources`, and a rewrite of `TEMPLATE.md`'s UI references.
**Resolution:**
- *Implementation:* README leads with the Releases download and both installer names, then source; Uninstall, Back up / sync, Known limitations and Credits sections; `docs/popup.png` embedded; `packs/TEMPLATE.md` rewritten against the live UI; `THIRD-PARTY-NOTICES.md` (OFL text for Outfit, the Remix Icon License, a table of the other runtime dependencies) shipped via `bundle.resources`.
- *Not verified:* the notices file landing beside the exe needs the next `tauri build`.

### L18. Installer metadata is empty
**Status:** DONE
**Where:** `tauri.conf.json` `bundle` has only `active/targets/icon`;
generated `installer.nsi` shows `MANUFACTURER "promptline"`, `LICENSE ""`,
`COPYRIGHT ""`. Pass `D`.
**Fix:** `bundle.publisher`, `copyright`, `shortDescription`,
`longDescription`, `homepage`, `licenseFile: ../LICENSE`.
**Resolution:**
- *Implementation:* `bundle.publisher`, `copyright`, `shortDescription`, `longDescription`, `homepage`, `licenseFile`, `windows.nsis.installMode: currentUser`. The publisher string "Alpaslan Bek" could not be confirmed from the GitHub profile (no display name); change it if wrong.

### L19. No CHANGELOG, CONTRIBUTING, SECURITY.md or issue templates; repo has no description or topics
**Status:** DONE (files); repo settings for the human
**Fix:** a short `SECURITY.md`, a paragraph `CONTRIBUTING.md` pointing to
`BEHAVIOR.md`, `gh repo edit --description … --add-topic …`.
**Resolution:**
- *Implementation:* `SECURITY.md`, `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/bug_report.md`.
- *Human:* `gh repo edit bekalpaslan/promptline --description "Your prompt vocabulary, one hotkey away, in every window. A Windows tray app that pastes prompts from a library into any app, with the clipboard substituted." --add-topic tauri --add-topic rust --add-topic react --add-topic windows --add-topic clipboard --add-topic prompts --add-topic prompt-library --add-topic claude --add-topic productivity --add-topic tray-app`; enable private vulnerability reporting.

### L20. Remaining UI polish from the browser walk
**Status:** DONE (one popup ARIA item left)
**Where and what** (pass `U`, screenshots in the session scratchpad):
"Give this pack a file…" is jargon; two toasts for one New → Pack; title
tiebreak sorts "0, 1, 10, 11, 2" (use `localeCompare` with `numeric`);
"+ prompt" / "New prompt" / "+ New" inconsistency; the preview card covers
the row it previews near the bottom; the hint bar wraps at 320 px; Ctrl+N
cuts the title mid-word at 40 chars; the sidebar New button is 8 px
narrower than the filter row once the list scrolls; two orange primaries
in Settings (Generate and Buy me a coffee); no "Open folder" in Settings;
the editor's Pin button is stranded under the preview; Display menu groups
lack `role=group`; popup options contain buttons (invalid ARIA, works with
`aria-activedescendant`).
**Resolution:**
- *Popup:* preview card opens above when there is no room below; minor hints hide below 360 px; Ctrl+N title cut at a word boundary; title ties sort numerically.
- *Manager:* one toast for New → Pack, on commit; "New prompt"/"New pack" wording; the sidebar New button outside the scroll region; the donation link secondary; Pin next to Delete; Display menu groups labelled.
- *Open:* "Give this pack a file…" wording; an "Open folder" button in Settings (needs a Rust command); popup options containing buttons.
**Resolution (leftovers):**
- *Implementation:* "Give this pack a file…" is "Create pack file…" with the hint "For sharing, or for an agent to write into"; Settings' library card has "Open folder" (`open_data_dir`, no path from the frontend).
- *Open:* popup options containing buttons (valid enough with `aria-activedescendant`; revisit with a popup pass).

### L21. Keyboard handlers guard `!e.key` but not `e.isComposing`
**Status:** DONE
**Where:** `popup/App.tsx:580`, `manager/App.tsx:377`, `Settings.tsx:84`.
Pass `F`. Safe on WebView2 today.
**Fix:** `if (!e.key || e.isComposing) return`.
**Resolution:**
- *Implementation:* `if (!e.key || e.isComposing) return` in the popup, manager and Settings handlers; comments corrected.

### L22. Miscellany verified by pass `F`
**Status:** DONE
`ctx-menu.tsx:112` clamps in `useEffect` (one-frame flash; use
`useLayoutEffect`); `App.tsx:293` init effect is not idempotent under
StrictMode (a dev-only "Couldn't load" toast when drafts exist);
`App.tsx:342` schedules a timer inside a state updater; the stale-refusal
message always blames the popup; `popup/App.tsx:303` `hide_popup` on a
600 ms timer can hide a re-summoned popup; `GenerateDialog.tsx:259` and
`ctx-menu.tsx:257` avoidable non-null assertions; two
`eslint-disable-next-line react-hooks/exhaustive-deps` in `Sidebar.tsx`.
**Resolution:**
- *Implementation:* `useLayoutEffect` clamps; the init effect is cancellable and uses `C.isEmptyDraft`; the first-run timer is an effect; the stale toast no longer blames the popup; the post-copy hide timer is cancelled on `popup-shown`.

### L23. Test-quality nits
**Status:** DONE
**Where:** `tests/core.test.js:72` (`expandBuiltins` only asserts tokens
vanished), `:539` (`expandForCopy` compares against `new Date()`; inject
`now`), `ui/core.js:453` (`sortPrompts` does `b.uses - a.uses` unguarded),
`lib.rs:1628` (`temp_dir` never cleans up). Pass `T`.
**Resolution:**
- *Implementation:* exact `{date}`/`{time}` with an injected clock; `expandForCopy` takes `now`; `sortPrompts` guards `uses`; `clipboardPreview` steps back off a high surrogate; cases for CRLF packs, `fillFields` expansion order, `{}`/`{goal`, `goal_10`.

### L24. `BEHAVIOR.md` says the sidebar tree comes from `packTree`; it doesn't
**Status:** DONE
**Where:** `BEHAVIOR.md:40-43` vs `Sidebar.tsx:37-48, 188-203` (own
`groups` memo and `splitGroups`); only `Overview.tsx:227` uses
`C.packTree`. Pass `T`.
**Fix:** replace the sidebar's version with `C.packTree`.
**Resolution:**
- *Implementation:* the sidebar builds from `C.packTree`; its own memo and `splitGroups` are gone. Also fixed: Alt+Down on an ungrouped row and shift-ranges crossing groups used the old order.

### L25. Wording drift in README and BEHAVIOR
**Status:** DONE
**Where:** `README.md:144` ("CI … on every push", now true again),
`README.md:138` (`npm run lint` "over the frontend": it is the whole tree),
`BEHAVIOR.md` "Tests" (`test:rust` description understates the suite).
Pass `T`.
**Resolution:**
- *Implementation:* README's lint and CI sentences; `BEHAVIOR.md` "Tests" describes the Rust suite and `tests/mock.test.js`.

---

## What is solid

The storage layer and the previous review's fixes are real: atomic writes,
typed load results with byte-exact quarantine, intent-level merges that keep
popup-owned and editor-owned fields apart, a serialised store lock, a
revision check on full-array saves, rename as one step, retirement instead
of unlinking. The paste pipeline records `prev_window` before showing,
guards autorepeat, writes the clipboard before hiding and releases
modifiers before Ctrl+V. The webview surface is minimal. `ui/core.js`
holds the logic that matters and its tests assert behaviour, many named
after the bug that motivated them. Both themes pass contrast at every text
node measured; long and non-Latin content truncates cleanly in both
windows down to their minimum sizes. Release mechanics are disciplined and
`BEHAVIOR.md` moves with every behaviour commit.
