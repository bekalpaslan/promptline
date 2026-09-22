# Promptline — notes for agents

A Tauri 2 tray app for Windows: Rust in `src-tauri/`, two React windows
(`index.html` = manager, `popup.html` = popup) built by one Vite config, pure
logic in `ui/core.js` (plain UMD, tested with bare `node --test`).

## Where things are written down

- `BEHAVIOR.md` — how each surface behaves and *why*. Read the section for
  what you're changing first; update it in the same commit when behaviour
  changes.
- `README.md` — the app as a user sees it.
- `BACKLOG.md` — deferred ideas. Add to it rather than widening a change.
- `REVIEW.md`, `BUG-HUNT-*.md` — review and benchmark trackers with their own
  rules at the top of each file.
- `docs/architecture/` — the architecture map, for the human managing the
  project (see *Architecture map* below).

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
generation delta at https://claude.ai/artifact/3ZgbonXsiQw7uxU55XPtHv. The
Export menu does nothing inside claude.ai (no download permission); it
works on the local HTML.

## Checks

- `npx tsc -b --noEmit`, `npm run lint`, `npm test` (core), `npm run test:rust`.
- `npm run lint` walks the whole tree, `.claude/worktrees/` included: a
  worktree left behind with broken files fails it. Remove finished
  worktrees (`git worktree remove`); `npx eslint src` checks only the app.
- Line endings: the index is LF (`core.autocrlf=true`), working copies are
  mixed. Run `unix2dos` on the files you touch, and only those. Scripted
  edits should normalise `\r\n` before matching, or they silently miss.

## Verifying UI changes

Look at the change running, not just the diff. There are two ways, and the
first is usually enough.

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
1000×800, popup 400×600.

What the mock can't show: real pasting, the global hotkey, window
show/hide and focus, file dialogs, and anything Rust does to the payload
(`paste_snippet` receives `{clipboard}` unexpanded; Rust substitutes it).

**2. The real app over CDP** — for those.

- Stop the installed app first (`%LOCALAPPDATA%\Promptline\promptline.exe`):
  it shares the WebView2 profile, and a second instance with other browser
  args never opens the debug port. Restart it detached with `Start-Process`
  when done.
- Back up `%APPDATA%\com.promptline.app` first and restore it after.
- Run `npm run ui:dev` (port 5173), then launch
  `src-tauri/target/debug/promptline.exe` with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` from a
  background Bash call (the PowerShell tool kills the child when the call
  ends). `http://127.0.0.1:9223/json` lists both pages.
- The document is never focused under CDP: `focus()`/`blur()` fire nothing,
  so dispatch `focusout`. Ctrl+Shift+V is taken by another tool on this
  machine; test hotkeys on a spare combination and restore the config.

## Releasing

Releases are GitHub releases carrying the two Windows installers, built
locally. Only on the user's say-so; each step below is one they've approved.

1. Everything is merged to `master`, pushed, and CI is green on it
   (`gh run watch <id> --exit-status`). Don't tag over a red or running CI.
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
   with both installers. Check with `gh release list` (`gh release view` has
   no "latest" field).

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
  (`Manager: …`, `Popup: …`). The body says what changed and why, in prose.
- Branch off `master` for work (`feat/…`, `fix/…`, `chore/…`).
