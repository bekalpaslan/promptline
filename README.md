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
| any other `{lowercase_word}` | a fill-in field — the popup shows a mini-form before pasting |

## Usage

- **Enter / click** pastes; **Ctrl+Enter / Ctrl+click** copies to the clipboard
  only; **Esc** closes the popup (or backs out of a fill-in form).
- With no search query, prompts are sorted by how often you use them.
- Search matches title, category, and body (fuzzy).
- Left-click the tray icon to manage prompts, categories, the hotkey, and
  autostart. Closing that window hides it to the tray.
- **Export → clipboard / Import ← clipboard**: prompt packs are plain JSON
  arrays (`[{title, text, category}]`) — share them in chat, gists, or a repo.
- Ships with a starter pack of Claude-focused prompts (Debug, Review, Plan,
  Guardrails, Meta, …). Delete freely; they're just defaults.
- Your previous clipboard contents are restored after each paste.
- Data lives in `%APPDATA%\com.promptline.app\snippets.json` (v1 EasyPaste data
  is migrated automatically).

> Note: the default hotkey `Ctrl+Shift+V` shadows "paste without formatting"
> in browsers. Change it in the settings bar (e.g. `ctrl+alt+v`) if you use that.

## Development

Requires Rust and Node.

```sh
npm install
npm run dev      # run in dev mode
npm run build    # produce installer (src-tauri/target/release/bundle)
```

## Stack

Tauri 2 (Rust) + plain HTML/JS UI. Windows-specific parts (focus restore via
`SetForegroundWindow`, paste via `SendInput`) are isolated in the `platform`
module in `src-tauri/src/lib.rs`; a macOS port only needs that module
reimplemented (CGEventPost + Accessibility permission).
