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

## Checks

- `npx tsc -b --noEmit`, `npx eslint src`, `npm test` (core), `npm run test:rust`.
- Use `npx eslint src`, not `npm run lint`: the full-tree lint also walks
  `.claude/worktrees/`, where a stale worktree fails it.
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

## Conventions

- Commit subjects are sentence case, often prefixed with the surface
  (`Manager: …`, `Popup: …`). The body says what changed and why, in prose.
- Branch off `master` for work (`feat/…`, `fix/…`, `chore/…`).
