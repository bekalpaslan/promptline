# Promptline Backlog

Ideas and deferred work, roughly ordered. Promote items into a milestone when picked up.

## Import / export

- ~~**Import pack from file**~~ — **shipped 2026-07-12** (`rfd` picker +
  diagnostic parse errors distinguishing empty / not-JSON / malformed-likely-
  terminal-corruption / wrong-shape). Export-to-file remains open as the
  natural sibling.
- **Export pack/library to file** — save dialog counterpart to the file import.

## Deferred from the UI rework (see docs/history/UI-REWORK-ROADMAP.md)

- **Generate packs via direct API call** — call Claude with a user-supplied API
  key from the generate dialog, skipping the copy/paste loop (roadmap 4.4
  long-term variant).
- ~~**Merge popup hint bar + clipboard preview** into one meta-bar~~ (roadmap
  2.6) — **resolved 2026-08-15 by removing the clipboard bar**: the token is
  already highlighted in the preview card and rendered live in the fill-in
  form, so the second bar only cost a row of prompts.

## Code structure

- **Split the three largest components** — `Editor.tsx` (params panel + tag
  strip), `GenerateDialog.tsx` (pure `generate-instructions.ts` + dialog),
  `Settings.tsx` (hotkey recorder + library card). Pure moves, no behaviour
  change; deferred from the 2026-09 review (D6) to keep that diff readable.

## Search

- **Word-wise fuzzy matching** — "root fix" should match "Root cause first"
  on title; today a multi-word query is one subsequence including the space
  (review L5). A ranking change that deserves its own discussion.
- **Virtualize the popup list** only when a real library shows the need
  (memoized rows handle ~1k today).

## Manager

- **Pack colour, as a setting** — a colour per pack (a swatch on its header,
  carried by its groups' guide lines and in the popup) for telling packs
  apart where their prompts mix. Direction B of the 2026-09-22 sidebar
  mockups; the ink hierarchy (A) shipped instead, colour-free by default.

- **Flush the editor on Windows shutdown** — tray Quit now flushes a
  pending autosave (BEHAVIOR.md "Quitting"); `WM_QUERYENDSESSION` does not.
- **"Saving… / Saved" caption in the editor** — there is no visible signal
  that an edit has reached disk (UI review, M12).

## Popup

- **Hotkey toggles the popup closed** — a press while the popup is open
  currently only re-focuses it (deliberate, see BEHAVIOR.md); Raycast/Alfred
  hide on a second press. Revisit once the repeat guard has settled.

## Distribution

- **Code signing** — unsigned installers trip Windows SmartScreen.
- **Auto-update** — Tauri updater plugin + a release feed.
- **macOS port** — reimplement the `platform` module (CGEventPost + Accessibility
  permission); everything else is portable.
