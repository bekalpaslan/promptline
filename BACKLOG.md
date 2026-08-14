# Promptline Backlog

Ideas and deferred work, roughly ordered. Promote items into a milestone when picked up.

## Import / export

- ~~**Import pack from file**~~ — **shipped 2026-07-12** (`rfd` picker +
  diagnostic parse errors distinguishing empty / not-JSON / malformed-likely-
  terminal-corruption / wrong-shape). Export-to-file remains open as the
  natural sibling.
- **Export pack/library to file** — save dialog counterpart to the file import.

## Deferred from the UI rework (see UI-REWORK-ROADMAP.md)

- **Generate packs via direct API call** — call Claude with a user-supplied API
  key from the generate dialog, skipping the copy/paste loop (roadmap 4.4
  long-term variant).
- ~~**Merge popup hint bar + clipboard preview** into one meta-bar~~ (roadmap
  2.6) — **resolved 2026-08-15 by removing the clipboard bar**: the token is
  already highlighted in the preview card and rendered live in the fill-in
  form, so the second bar only cost a row of prompts.

## Distribution

- **Code signing** — unsigned installers trip Windows SmartScreen.
- **Auto-update** — Tauri updater plugin + a release feed.
- **macOS port** — reimplement the `platform` module (CGEventPost + Accessibility
  permission); everything else is portable.
