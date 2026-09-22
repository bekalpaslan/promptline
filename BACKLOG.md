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
- ~~**"Saving… / Saved" caption in the editor**~~ — **shipped 0.2.9**
  (release audit M9).
- **Type-checked lint** — `recommendedTypeChecked` on `src/**` gives 24
  errors (`restrict-template-expressions` 12, `unbound-method` 3,
  `no-unsafe-argument` 3, …); fix them in one pass, then enable it
  (release audit L13, declined for 0.2.9).
- **Three config re-reads per write** — every intent-level write parses
  `config.json` in `mutate_library`, `sync_pack_files` and
  `ensure_packs_backed`; pass it through once (release audit L8 leftover).
- **Popup options contain buttons** — the tag pills and pack headers inside
  `role=listbox` options are invalid ARIA, though they work with
  `aria-activedescendant`; move tag filtering to the action panel (release
  audit L20 leftover).
- **Real-library screenshot** — `docs/popup.png` (README and the website)
  is the mock's data ("Mock Groups", a `{2}` chip); retake it from a real
  library over CDP.

## Popup

- **Hotkey toggles the popup closed** — a press while the popup is open
  currently only re-focuses it (deliberate, see BEHAVIOR.md); Raycast/Alfred
  hide on a second press. Revisit once the repeat guard has settled.

## Distribution

- **Code signing** — unsigned installers trip Windows SmartScreen.
- **Auto-update** — Tauri updater plugin + a release feed. The feed can be
  a static `latest.json` served by the website (`site/` on GitHub Pages at
  promptline.cc), written by the release step; the updater needs a signing
  key pair, which is the real work.
- **Stable-named installer** — a `Promptline-setup.exe` copy on each
  release so `releases/latest/download/…` links work without the version;
  today the website resolves the versioned name through the GitHub API.
- **security@promptline.cc** — GoDaddy forwarding to the mailbox, then
  SECURITY.md stops naming a personal address.
- **macOS port** — reimplement the `platform` module (CGEventPost + Accessibility
  permission); everything else is portable.
