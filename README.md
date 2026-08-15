# Promptline

*Your prompt vocabulary, one hotkey away, in every window.*

A tiny tray app for developers who talk to Claude (or any AI) all day. Hit the
global hotkey (default `Ctrl+Shift+V`), a popup appears at your cursor with
your prompt library — pick one and it's pasted straight into the app you were
just using: Claude Code in a terminal, claude.ai in the browser, Cursor, a PR
comment box, anywhere.

## The killer move

Copy an error / stack trace / diff, hit the hotkey, pick **"Root cause first"**
— your template pastes with the clipboard contents already inserted where
`{clipboard}` was. One gesture turns raw error text into a well-formed prompt.

## Placeholders

| Token | Expands to |
|---|---|
| `{clipboard}` | whatever was on the clipboard when you hit the hotkey |
| `{date}` / `{time}` | current date / time |
| any other `{lowercase_word}` | a runtime fill-in field — the popup asks before pasting, pre-filled with your last value |
| `{{lowercase_word}}` | a config parameter — set its value once (editor → Advanced options), it pastes silently every time |

Unset config parameters downgrade to fill-in fields instead of pasting holes.
Parameter tooling lives behind **Advanced options** in the editor — one card
per kind (built-in / fill-in / config), each with an Edit toggle for removing
them, plus config values and a live preview. Invisible until you want it.

## The popup

- **Enter** pastes · **Ctrl+Enter / Ctrl+click** copies only · **Esc** closes
- **Ctrl+1..5** pastes the top results instantly — pins (max 5) always sit on
  top, so they become stable muscle-memory slots
- **Tab** opens an action panel: paste / copy / pin / edit in manager / delete
- **→** shows the full-prompt preview card (also on mouse hover)
- Search is fuzzy over titles, tags, and bodies with match highlighting;
  `#tag` and `@pack` terms filter (`#debug root cause`); click a tag pill to filter by it
- With no query, prompts sort by how often you use them, grouped under
  collapsible pack sections; searching flattens them into one ranked list
- **Ctrl+N** turns whatever you just copied into a new prompt without leaving
  the popup — name pre-filled from the first line, pick its pack, confirm
- **Drag the window edge** to resize; the size is remembered
- The prompt stays on your clipboard after pasting — if the app you came from
  had no text field focused, the keystroke lands nowhere, so click into one and
  paste it yourself

## The manager (left-click the tray icon)

- **Autosaves** — no Save button, no lost drafts; deletes are two-click with Undo
- Sidebar groups by **pack** (collapsible); right-click a pack header to
  rename / lock / export / delete it; right-click prompts for multi-select
  actions (move to pack, add tag, pin/unpin, export, delete) — Ctrl/Shift+click
  to select several
- **Locked packs** (🔒) refuse new prompts and can't be deleted until unlocked
- Two **empty-slot cards** at the top of the list create a new prompt or a new
  pack; **Generate pack with Claude** takes a topic, hands you an instruction to
  paste into Claude, and imports its reply — every prompt is reviewed in a
  checklist before anything is added
- Sort by uses, title, or **Custom** — press and hold a row to lift it, then
  drag to arrange your own order
- **Light / Dark** toggle sits at the bottom of the sidebar, next to the
  settings gear
- **Settings** (⚙): record a hotkey by pressing it, autostart, popup density,
  UI font (Outfit / system / serif / mono), UI scale (90–125%), and
  library export/import

## Data

Everything lives in `%APPDATA%\com.promptline.app\` as plain JSON — snippets,
packs, and preferences. Pack format docs: [`packs/TEMPLATE.md`](packs/TEMPLATE.md);
curated packs ship in [`packs/`](packs/). Older data formats migrate automatically.

Every pack owns a file under `…\packs\` from the moment it exists — however it
came about, including packs conjured by an import — and the app keeps it
current, so it's always there to share, back up, or let an agent write into.
Deleting a pack moves its file to `…\packs\deleted\` rather than unlinking it:
the file may hold prompts written there but never imported, and deleting a pack
in the app shouldn't be able to destroy them.

> The default hotkey `Ctrl+Shift+V` shadows "paste without formatting" in
> browsers — record `Ctrl+Alt+V` in Settings if you use that.

## Development

Requires Rust and Node.

```sh
npm install
npm run dev        # run in dev mode (starts Vite + Tauri; UI hot-reloads)
npm run build      # produce installer (src-tauri/target/release/bundle)
npm run ui:build   # typecheck + build the frontend only
npm test           # JS core tests (node --test)
npm run test:rust  # Rust unit tests (cargo test)
```

The frontend is a two-entry Vite app (`index.html` → manager window,
`popup.html` → popup window) under `src/`. Shared pure logic lives in
`ui/core.js` (UMD; bridged into React via `src/lib/core.ts`, covered by tests).

## Stack

Tauri 2 (Rust) + React 19 + Vite + Tailwind v4 + [shadcn/ui](https://ui.shadcn.com)
(Base UI primitives, Outfit font, Remixicon). Windows-specific parts (focus
restore via `SetForegroundWindow`, paste via `SendInput`) are isolated in the
`platform` module in `src-tauri/src/lib.rs`; a macOS port only needs that
module reimplemented (CGEventPost + Accessibility permission).

## License

MIT — see [`LICENSE`](LICENSE).
