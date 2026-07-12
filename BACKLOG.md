# Promptline Backlog

Ideas and deferred work, roughly ordered. Promote items into a milestone when picked up.

## Import / export

- **Import pack from file** — file picker (`tauri-plugin-dialog`) next to
  "Import pack", reading `*.json` directly into the curation checklist.
  Motivation: clipboard round-trips through terminals corrupt JSON (observed
  2026-07-12: a pack copied from a Claude Code terminal session arrived with
  mid-word splices and fused fields — the byte-exact file path avoids terminal
  rendering entirely). Export-to-file is the natural sibling.

## Deferred from the UI rework (see UI-REWORK-ROADMAP.md)

- **Generate packs via direct API call** — call Claude with a user-supplied API
  key from the generate dialog, skipping the copy/paste loop (roadmap 4.4
  long-term variant).
- **Merge popup hint bar + clipboard preview** into one meta-bar (roadmap 2.6,
  deliberately skipped — revisit if the two stacked bars bother anyone).

## Distribution

- **Code signing** — unsigned installers trip Windows SmartScreen.
- **Auto-update** — Tauri updater plugin + a release feed.
- **macOS port** — reimplement the `platform` module (CGEventPost + Accessibility
  permission); everything else is portable.
