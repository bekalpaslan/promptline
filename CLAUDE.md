# Promptline — notes for agents

A Tauri 2 tray app for Windows: Rust in `src-tauri/src/` (`lib.rs` holds
`AppState`, the tray and `run()`; `store.rs` files and atomic writes,
`packs.rs` pack metadata and files, `commands.rs` the Tauri commands,
`paste.rs` the popup and paste pipeline, `platform.rs` the Win32 calls,
`migrations.rs` old data), two React windows (`index.html` = manager,
`popup.html` = popup) built by one Vite config, pure logic in `ui/core.js`
(plain UMD, tested with bare `node --test`) with its TypeScript face in
`src/lib/core.ts`.

Released as `v0.2.9` on 2026-09-23 after a full audit; everything that
audit found is closed (`docs/history/RELEASE-AUDIT.md`). Start from the
backlog, not from another audit, unless asked.

## Where things are written down

- `BEHAVIOR.md` — how each surface behaves and *why*. Read the section for
  what you're changing first; update it in the same commit when behaviour
  changes.
- `README.md` — the app as a user sees it.
- `BACKLOG.md` — deferred ideas. Add to it rather than widening a change.
- `docs/history/` — the review, audit and benchmark trackers (`REVIEW.md`,
  `RELEASE-AUDIT.md`, `BUG-HUNT-*.md`) and the 2026-07 UI rework roadmap,
  each with its own rules at the top. Test names cite these files'
  finding ids (H1, M7, BH3-1), so they stay in the repo. For the next
  review, copy `RELEASE-AUDIT.md`'s shape: one heading per finding with
  Status / Where / What / Failure / Fix, a Resolution block appended when
  done, a progress table at the top, and decisions for the human in their
  own section. The orchestrator updates the tracker from agents' reports;
  agents never edit it.
- `docs/architecture/` — the architecture map, for the human managing the
  project (see *Architecture map* below).
- `site/` — the one-page website at https://promptline.cc, published to
  GitHub Pages by `.github/workflows/pages.yml` on every push to `master`
  that touches it (the workflow copies `docs/popup.png` and
  `docs/screenshots/*.png` in; `site/` holds no binaries). Plain HTML and
  CSS on the tokens from `design/tokens.json`; the three screenshots play
  as a slideshow under the hero, and a new screenshot is a file under
  `docs/screenshots/` plus a slide in `site/index.html`;
  the Download button is a plain link to
  `releases/latest/download/Promptline-setup.exe`, the stable-named copy
  each release carries (step 5 of *Releasing*), so a release needs no site
  change and a visitor's browser talks to nothing but GitHub Pages and,
  on a click, GitHub Releases. The footer's privacy note says so; keep it
  true (no analytics, no cookies, no remote fonts or scripts). Preview it with `python -m http.server` in `site/` after
  copying the screenshot in. Live with HTTPS enforced since 2026-09-23;
  DNS is at GoDaddy (four Pages A records, `www` CNAME). The bundle
  identifier stays `io.github.bekalpaslan.promptline` on purpose: it names
  the data folder, and a domain can lapse.

## Architecture map

An [archify](https://github.com/tt-a1i/archify) diagram of the runtime
shape: `promptline.architecture.json` is the current map, and
`alternatives/*.architecture.json` are proposals drawn against it. The JSON
is the source; the rendered HTML, screenshots and receipts are gitignored
(about 800 KB each), so render them to look. Archify is a global skill
(`~/.claude/skills/archify`), not a dependency: installed inside the repo,
`npm run lint` would walk its `.mjs`.

Every box carries `sources` (file and line) read at the commit in
`meta.repository.revision`, not the working tree. Keep that a pushed commit
so the SRC links resolve on GitHub.

- **Refresh** ("refresh the map") after a change to windows, commands,
  events or storage: set `revision` to the new pushed commit, fix the
  moved line numbers and any changed boxes or edges, then `validate`,
  `deliver`, `visual-check` (all four viewports must pass containment) and
  republish to the same artifact URL. A structural change updates the map in
  its own commit, like `BEHAVIOR.md`.
- **Propose** by copying the map into `alternatives/<idea>.architecture.json`,
  keeping every id that doesn't change, and rendering `compare` against the
  map for a Before / Delta / After page.
- **Stories** are one user scenario end to end, as a `sequence` diagram in
  `stories/<scenario>.sequence.json`, with lanes for the surfaces and files
  and function names in the message labels (sequence has no `sources`, and
  `--repo-root` is architecture-only). Trace the scenario in the code
  first; it routinely differs from the obvious guess. The viewer caps the
  width by the window height (about 930 px at 1440×900), so keep the
  viewBox about 1080 wide and at most about 610 high, and cut return
  arrows that add nothing before squeezing messages below 28 px apart.

Commands run from the skill directory, with `--repo-root` pointing at the
checkout:

```sh
cd ~/.claude/skills/archify
node bin/archify.mjs validate architecture <repo>/docs/architecture/promptline.architecture.json --quality showcase --repo-root <repo> --json
node bin/archify.mjs deliver  architecture <json> <same-name>.html --quality showcase --repo-root <repo> --json
node bin/archify.mjs visual-check <html> --json
node bin/archify.mjs compare  architecture <map.json> <alternative.json> <alternative>.delta.html --repo-root <repo> --json
```

Published (private) as claude.ai artifacts: the map at
https://claude.ai/artifact/WWYhTYdWQDFZeaHXBmwBbC, the direct-API
generation delta at https://claude.ai/artifact/3ZgbonXsiQw7uxU55XPtHv, the
tray-select-tag story at https://claude.ai/artifact/Ro7g4r6zpgc6DLqSzFPAtv. The
Export menu does nothing inside claude.ai (no download permission); it
works on the local HTML. Republishing needs the Artifact tool to have
read that URL once in the session first, or the publish is refused; the
"download link" warning on publish is that Export menu and is expected.
A refresh took about ten minutes on 2026-09-23: grep the new line
numbers, edit the JSON with a script, validate, deliver, visual-check,
read, publish, commit.

## Checks

Seven, and CI runs all of them on every push and PR (`.github/workflows/ci.yml`):

- `npx tsc -b --noEmit` (the app, the Vite config and `e2e/`)
- `npm run lint` (`eslint . --max-warnings 0`: a warning fails)
- `npm test` (node: core, tokens, and two parity tests, below)
- `npm run test:e2e` (Playwright: both windows in Chromium against the
  fake backend, `e2e/*.spec.ts`; `npx playwright install chromium` once.
  It starts its own Vite on 5179, or reuses one already there; a first
  failure leaves a trace in `test-results/`, `npx playwright show-trace`
  opens it. Add a case when a UI behaviour changes, in the file for its
  window, named for the behaviour; assert through roles and names, and
  through `window.__mock.calls` for what the backend was asked, never
  through class names)
- `npm run test:rust`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
  (`rustup component add rustfmt clippy` once; both are clean today, keep
  them so with fixes, not `#[allow]`)

Two tests enforce the seams, so read their failure text before anything else:

- `tests/mock.test.js`: every `invoke("…")` in `src/` must be registered
  in Rust's `generate_handler!` and handled in `src/lib/dev-mock.ts`, and
  every registered command must have a caller. Adding a command means all
  three.
- `tests/interface.test.js`: `Object.keys` of `ui/core.js` must equal the
  members of `PromptlineCore` in `src/lib/core.ts`. Adding a core function
  means declaring it there too.

Housekeeping:

- `npm run lint` walks the whole tree, `.claude/worktrees/` included: a
  worktree left behind with broken files fails it. Remove finished
  worktrees (`git worktree remove`); `npx eslint src` checks only the app.
- Line endings: the index is LF (`core.autocrlf=true`), working copies are
  mixed. Run `unix2dos` on the files you touch, and only those. Scripted
  edits should normalise `\r\n` before matching, or they silently miss.
  Any cargo run (`cargo add`, a build) rewrites `src-tauri/Cargo.toml` as
  LF, which shows as a phantom modification and blocks `git merge`:
  `git checkout -- src-tauri/Cargo.toml` when the diff is only that.
- Write multi-line edit scripts to a file with the Write tool and run
  them; a Python heredoc with quotes inside a Bash call trips the tool's
  parser.
- `npm install <pkg>` here (npm 11) rewrites `package-lock.json` and drops
  optional-peer entries (`@emnapi/runtime`, the nested
  `oxide-wasm32-wasi` ones) that CI's npm 10 then reports as missing, and
  `npm ci` fails before any check runs. After adding a dependency, diff
  the lock against `HEAD`: only the new packages should appear. If entries
  vanished, rebuild from the old lock plus the new entries (a script; the
  Playwright commit did this) rather than committing the rewrite.

## Verifying UI changes

Look at the change running, not just the diff. The Playwright suite
(`npm run test:e2e`, above) is the first stop: extend it for the behaviour
you changed, and it walks both windows for you. Then there are two ways to
look, and the first is usually enough.

**1. Browser with the fake backend** — layout, navigation, menus, keyboard,
anything the UI decides on its own.

```sh
npx vite --port 5175 --strictPort   # 5173 is often held by another session
```

Open `http://localhost:5175/?mock` (manager) or `/popup.html?mock` (popup);
`?mock=empty` starts with no prompts. `src/lib/dev-mock.ts` installs a fake
`window.__TAURI_INTERNALS__` before the app renders, seeded from
`packs/*.json` plus a small grouped pack, and exposes `window.__mock`:
`calls` (every invoke with its args), `clipboard` (settable), `emit(event,
payload)` for backend events such as `edit-prompt`, and `library`. Each page
has its own in-memory store; a reload starts over. Unknown commands resolve
to null and log `[mock] unhandled command …`. When you add a Tauri command
the UI depends on, add it to the mock too.

With the Playwright MCP, `browser_run_code_unsafe` runs in the browser
sandbox: there is no `require`/`fs`. Navigate to the `?mock` URL and assert
through `window.__mock`. Screenshots at the real window sizes: manager
1000×800, popup 400×600. When Playwright's profile is locked by another
session, the Chrome DevTools MCP does the same job (`new_page`,
`take_snapshot` for the a11y tree, `evaluate_script`, `take_screenshot`,
`resize_page`); its `resize_page` refuses widths under about 500 px, so
check the popup's 320×280 minimum with viewport emulation instead.
Parallel sessions each take their own port
(5175–5178 have been used); stop the server and close your pages when done.

What the mock can't show: real pasting, the global hotkey, window
show/hide and focus, file dialogs, and anything Rust does to the payload
(`paste_snippet` receives `{clipboard}` unexpanded; Rust substitutes it).

**2. The real app over CDP** — for those.

- Stop the installed app first (`%LOCALAPPDATA%\Promptline\promptline.exe`):
  it shares the WebView2 profile, and a second instance with other browser
  args never opens the debug port. Restart it detached with `Start-Process`
  when done.
- Back up `%APPDATA%\io.github.bekalpaslan.promptline` first and restore it after.
- Run `npm run ui:dev` (port 5173), then launch
  `src-tauri/target/debug/promptline.exe` with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` from a
  background Bash call (the PowerShell tool kills the child when the call
  ends). `http://127.0.0.1:9223/json` lists both pages.
- The document is never focused under CDP: `focus()`/`blur()` fire nothing,
  so dispatch `focusout`. Ctrl+Shift+V is taken by another tool on this
  machine; test hotkeys on a spare combination and restore the config.

## Working in parallel

The 2026-09-22 audit fixes ran as four agents at once, one per file
ownership area (Rust; manager; popup and core; docs and release), each in
its own worktree branch, merged by the orchestrator. It worked; what made
it work:

- **Own files, not topics.** Give each agent a file list and forbid the
  rest. Where two areas meet (a new command's return value, an event's
  payload), write the contract into both prompts up front so each side
  builds against it; the popup and Rust agents did this for `"copied"` and
  `paste-failed` without talking.
- **Worktrees start stale.** The harness has created agent worktrees
  several commits behind `master`. Tell every agent to run
  `git merge --ff-only master` (or `git reset --hard master` if it has no
  commits) before touching anything. A worktree has no `node_modules` and
  an empty `target/`: budget `npm ci` and a full Rust build.
- **BEHAVIOR.md is the merge conflict.** Each agent edits only its own
  sections; the orchestrator resolves the rest by keeping both sides.
  The tracker is never edited by agents (see *Where things are written
  down*); they report resolutions in the tracker's format and the
  orchestrator pastes them in.
- **Finish the tree.** After merging, `git worktree remove --force` every
  agent worktree (unlock first if the harness left a lock), delete the
  branches, then run the six checks from the main checkout. Lint walks
  worktrees, so it can't pass before they're gone.
- **Sequential when files collide.** A wave that touches `lib.rs` and one
  that splits it cannot run together; the split ran last, alone.

Small fixes across many files (call-site swaps, plurals) are faster done
directly than delegated.

## Releasing

Releases are GitHub releases carrying the two Windows installers, built
locally. Only on the user's say-so; each step below is one they've approved.
The `installers` job in `ci.yml` also builds both on a `v*` tag and uploads
them as workflow artefacts; it does not create the release and the local
build is still what ships.

1. Everything is merged to `master`, pushed, and CI is green on it
   (`gh run watch <id> --exit-status`; the run id from `gh run list
   --branch master --limit 3`). Don't tag over a red or running CI. The
   bump commit and the local build can proceed while that first run is
   still going; only the tag waits.
2. Bump the version, a patch step unless told otherwise, in all five places,
   as one commit titled `Bump to X.Y.Z`:
   - `package.json`
   - `package-lock.json`: twice, the root `"version"` and `packages[""]`
     (missing it cost a separate sync commit in 0.2.7)
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock`: only the `name = "promptline"` entry. A blanket
     replace hits other crates at the same version.
   - `src-tauri/tauri.conf.json`
3. `npm run build` (`tauri build`, several minutes; run it in the background).
   It writes `src-tauri/target/release/bundle/nsis/Promptline_X.Y.Z_x64-setup.exe`
   and `…/bundle/msi/Promptline_X.Y.Z_x64_en-US.msi`.
4. `git tag -a vX.Y.Z -m "Promptline X.Y.Z"`, then push `master` and the tag.
5. `gh release create vX.Y.Z --title "Promptline X.Y.Z" --notes-file <notes> --latest`
   with both installers and a copy of the setup exe named
   `Promptline-setup.exe` (the website's Download button links to
   `releases/latest/download/Promptline-setup.exe`; without the copy it
   404s). Check with `gh release list` (`gh release view` has no "latest"
   field).
6. If windows, commands, events or storage changed since the last map
   refresh, refresh the architecture map against the tagged commit (its
   own commit, pushed after).

Release notes, as in every release since 0.2.3 (`gh release view v0.2.7`):
one lead sentence linking the previous release, then a `###` section per
area in the user's terms (what they see and press, not the code), a
behaviour change that could surprise an existing library called out in
its bullet, and this closing section with the version filled in:

```md
### Install

`Promptline_X.Y.Z_x64-setup.exe` (NSIS) or `Promptline_X.Y.Z_x64_en-US.msi`.
Still unsigned, so SmartScreen warns on first run: *More info → Run anyway*.
Your prompts, packs and settings carry over untouched.
```

## Conventions

- Commit subjects are sentence case, often prefixed with the surface
  (`Manager: …`, `Popup: …`, `Rust: …`, `Core: …`). The body says what
  changed and why, in prose.
- Branch off `master` for work (`feat/…`, `fix/…`, `chore/…`).
- Logic that can be pure goes into `ui/core.js` with a `node --test` case
  named after the behaviour or the finding that motivated it; components
  call it. The audit moved a dozen such helpers out of components; don't
  put new ones back.
- One rule per concept, in core: `normalizeTag` for tags, `plural` for
  counts, `DRAFT_TITLE` / `isEmptyDraft` for an untouched draft,
  `resolveTheme` for the theme, `defaultPackFor` for where a new prompt
  goes. Grep for the helper before writing an inline version.
- In the manager, any write from a closure that outlives its render
  (context-menu actions, Undo toasts, anything after an `await`) passes
  `persist` an updater, never the render's array; deletes go through
  `deleteWithUndo`. Rust writes are intent-level commands (`add_pack`,
  `set_pack_locked`, `update_snippet`…), never a full list sent back.
- Names the user wrote (packs, groups, prompt titles) are shown as typed;
  uppercase is for the app's own section labels (`name-label` vs
  `section-label`).
- The sidebar is the library only (search, Display, New, the tree);
  app-level controls sit above the pane; appearance choices live in
  Settings.
- Every Tauri command the webview can call takes no path it hasn't been
  given by Rust (`read_pack_file`, `show_in_folder` refuse paths outside
  the data folder; `open_data_dir` takes none).
