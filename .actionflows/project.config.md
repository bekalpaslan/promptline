# ActionFlows Project Binding — Promptline

> Ring-2 binding. Project-specific values only; core is never edited here.

## Identity

- **Name:** Promptline (repo/dir name: `easypaste` — predates the rename)
- **Description:** Windows tray app (Tauri 2) that pastes parameterized prompts into any
  focused window via a global hotkey — a prompt manager for developers who work with Claude.

## Stack

| Component | Tech | Directory |
|---|---|---|
| Backend / app shell | Rust (edition 2021), Tauri 2, plugins: global-shortcut, autostart; arboard, windows-rs 0.58 | `src-tauri/` |
| Frontend | Plain HTML/CSS/JS (no framework, no bundler), Tauri `withGlobalTauri` IPC | `ui/` (`index.html` manager, `popup.html` hotkey popup) |
| Tooling | npm (`@tauri-apps/cli` 2.x), cargo 1.93 | root `package.json`, `src-tauri/Cargo.toml` |
| Pack format docs | Markdown + JSON pack schema | `packs/TEMPLATE.md` |

## Commands

| Task | Command | Notes |
|---|---|---|
| Type/compile check | `cargo check` in `src-tauri/` | fastest correctness gate |
| Run (dev) | `npx tauri dev` (or `npm run dev`) | blocks; app stays running. UI edits need app restart — kill `promptline.exe`, rerun |
| Build installer | `npm run build` | output under `src-tauri/target/release/bundle/` |
| Lint | `cargo clippy` in `src-tauri/` | no JS linter configured |
| Test | — none yet | no test suite exists; `cargo test` runs empty |

## Version control

**Not a git repository.** `commit` actions cannot run until `git init`. Flag this in any
chain that ends with a commit step.

## Available MCPs → action grants

| MCP | Grant to | Use |
|---|---|---|
| context7 (docs) | `docs-lookup`, `code`, `debug` | Tauri 2 / windows-rs / arboard API docs — fast-moving, prefer over memory |
| playwright / chrome-devtools | `test`, `debug` | UI files are plain HTML — testable in a browser with a `window.__TAURI__` mock |
| github | `commit`/ship steps | only after repo is initialized and remoted |
| Others (slack, postgres, gmail, figma, …) | none | not relevant to this project |

## Domain concepts

- **Prompt/snippet** — `{id, title, text, tags[], pack, uses, pinned}`; stored in
  `%APPDATA%\com.promptline.app\snippets.json`; migrations chain v1→v2→v3 in `load_snippets_from_disk`.
- **Pack** — named set of prompts (one pack per prompt); JSON exchange format
  `{name, prompts:[{title, tags, text}]}`, legacy formats accepted on import.
- **Placeholders** — `{clipboard}` (expands Rust-side at paste), `{date}`/`{time}` (JS),
  any other `{lowercase_word}` = fill-in field collected by the popup form.
- **Paste engine** — `platform` module in `src-tauri/src/lib.rs`: focus capture →
  clipboard swap → SendInput Ctrl+V → clipboard restore. **All OS-specific code stays in
  this module** (macOS port boundary).

## Routing notes

- Anything touching paste/focus/clipboard behavior → treat as `code/rust`; must preserve
  the `platform` module boundary and cannot be verified headlessly — needs a manual
  hotkey test on Windows.
- UI work → `code/frontend`; both HTML files are self-contained (inline CSS/JS, no build
  step). Beware: one past incident of invisible DEL (0x7F) bytes written into JS string
  literals — verify with `grep -P '\x7f' ui/*.html` after large writes.
- The two UI files duplicate small helpers (tag colors, token regex) by design (no bundler);
  a change to shared behavior must be applied to both.
