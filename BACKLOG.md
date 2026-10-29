# Promptline Backlog

Ideas and deferred work, roughly ordered. Promote items into a milestone when picked up.

## Next

The sequence from here to the first public step, set on 2026-10-29 (the
fresh-eyes review's decisions). Each line moves down or out as it lands;
the strategy behind it is in the local `docs/MARKETING.md`.

1. **The Certum certificate** arrives (bought by the maintainer; no date).
   Until then: quiet releases, the monthly Dependabot round
   (`/dependabot`), the snapshot row in every release report.
2. **Signing copy** in the same session the certificate lands: README →
   Install, `site/code-signing/`, the release-notes closing in CLAUDE.md →
   Releasing, the Code signing entry below. They still describe the
   SignPath plan on purpose, one rewrite when the flow is real.
3. **The first signed release**, whose notes carry the updater's TLS patch
   (rustls, 2026-10-29) and the AltGr hotkey notice in their own bullets.
4. **The Windows-only round**: r/ClaudeAI, r/ChatGPTCoding, the Claude Code
   Discord, each with the GIF and honest about "Windows for now". Show HN
   waits for the port.
5. **Later, undated: the macOS port** on its own branch (it takes the Tauri
   2.12 / wry 0.57 / tao 0.37 jump and the `@tauri-apps` 2.12 packages
   together; `paste.rs:321` is the first thing that does not compile), then
   Show HN and the launch-week table.

## Import / export

- ~~**Import pack from file**~~ — **shipped 2026-07-12** (`rfd` picker +
  diagnostic parse errors distinguishing empty / not-JSON / malformed-likely-
  terminal-corruption / wrong-shape).
- ~~**Export pack/library to file**~~ — **shipped 0.2.15** (`export_pack_file`;
  a pack's menu and Settings → Your library).
- **Community packs as repo files** (shelved 2026-09-28, before any
  work). The first step toward the library below, without the in-app
  fetch: contributed packs in `packs/community/` with `author` and
  `description`, CC0, a CI check for hidden characters and risky wording,
  a page per pack on promptline.cc with its full text and a same-origin
  download, imported through the existing checklist. **Why it's
  shelved:** functionality ahead of reputation. A library and a submit
  guide serve contributors the project doesn't have yet; pick it up when
  people ask to share packs. Prompt injection through a pack's text (an
  honest-looking instruction, not only hidden characters) needs its own
  design pass when it comes back.
- **Linked pack file** (recorded 2026-10-29; the local half of shape C in
  `docs/MARKETING.md`'s shelved community-packs plan). A pack linked to a
  file the user chose on disk, say `<repo>\.promptline\<pack>.json`,
  through a Rust-side `rfd` picker; the path stored on `PackMeta.path`
  (`packs.rs` already keeps a path outside `packs/` absolute);
  `read_pack_file` and `show_in_folder` widened from "under the data
  folder" to "under the data folder or exactly a registered path"; a
  watcher or mtime poll emitting a change event that opens the existing
  import checklist, never a silent apply. **Hazards to design for:** two
  writers on one file (the app's atomic rename landing over an agent's
  half-written edit; a self-write guard and a debounce are needed), and
  `retire_pack_file` must never move a file out of a user's repo into
  `packs/deleted/`. **Why deferred:** 0 issues and one 0-comment
  Discussion on 2026-10-29; reputation before features (2026-09-28).
- **Community pack library** (parked 2026-09-24 over safety and legal
  concerns). Packs as `library/<slug>.json` in the repo (the pack format
  plus `description` and `author`, which `parsePacks` already ignores),
  contributed by PR, published CC0 to `promptline.cc/library/` by
  `pages.yml` with an `index.json`. In the app, a dialog like Generate's
  (New → Browse library, and a button under Settings → Your library) lists
  the packs; Add runs the import checklist. Rust fetches the index and one
  pack only when the dialog opens, only from `https://promptline.cc/library/`
  (slug `[a-z0-9-]+`, timeout, size cap), so the CSP stays IPC-only. A pack
  menu's "Submit to library…" opens GitHub's new-file page prefilled.
  **Why it's parked:** the risk is the content, not the code. Pack text is
  pasted into coding agents with tools and into terminals, so a merged
  prompt with a hidden instruction (`curl … | sh`, "summarise `.env`") or
  invisible Unicode would reach every user, with the app's endorsement; a
  takeover of the GitHub account, the Pages deploy or the domain would
  serve such packs to everyone who opens Library. **Before it's built:**
  CI rejecting zero-width, bidi and control characters and over-long
  prompts; CI flagging (not failing) shell pipes, URLs and "ignore
  previous"/secrets wording for the reviewer; the checklist showing the full
  text with a "From the Library" mark and no silent updates (the checklist
  already flags and unticks prompts with hidden characters); maintainer-
  written packs first, public PRs later; 2FA and branch protection before
  the in-app fetch ships; the README's privacy paragraph extended to name
  the Library fetch; the submit step saying the PR is public under the
  user's GitHub name.

## Deferred from the UI rework (see docs/history/UI-REWORK-ROADMAP.md)

- **Generate packs via direct API call** — call Claude with a user-supplied API
  key from the generate dialog, skipping the copy/paste loop (roadmap 4.4
  long-term variant).
- ~~**Merge popup hint bar + clipboard preview** into one meta-bar~~ (roadmap
  2.6) — **resolved 2026-08-15 by removing the clipboard bar**: the token is
  already highlighted in the preview card and rendered live in the fill-in
  form, so the second bar only cost a row of prompts.

## Code structure

- **Split the largest components** (REVIEW D6, 2026-09-14; pure moves, no
  behaviour change, deferred then to keep that diff readable). By size
  today: `src/popup/App.tsx` (2,479 lines), `src/manager/Sidebar.tsx`
  (1,165), then `Editor.tsx` (params panel + tag strip),
  `GenerateDialog.tsx` (pure `generate-instructions.ts` + dialog) and
  `Settings.tsx` (hotkey recorder + the Packs card). The popup's seams,
  each with its reason: the derived mode (the keydown handler, the hint
  bar, `announce` and `pick` each re-derive it; one derivation in one
  place), folds (duplicated with `src/manager/folds.ts`; a shared
  `useFolds` is scheduled), and the clipboard panel, preview card, action
  panel and fill-in form as hooks to extract when a feature next touches
  each, not before.

## Search

- **Word-wise fuzzy matching** — "root fix" should match "Root cause first"
  on title; today a multi-word query is one subsequence including the space
  (review L5). A ranking change that deserves its own discussion.
- **Virtualize the popup list** only when a real library shows the need
  (memoized rows handle ~1k today).

## Manager

- ~~**Popup groups in the manager's order**~~ — **shipped 0.2.15**
  (`C.groupOrder`).
- **Pack colour, as a setting** — a colour per pack (a swatch on its header,
  in both windows) for telling packs
  apart where their prompts mix. Direction B of the 2026-09-22 sidebar
  mockups; the ink hierarchy (A) shipped instead, colour-free by default.

- ~~**Flush the editor on Windows shutdown**~~ — **shipped 0.2.15**
  (`platform::on_session_end`, BEHAVIOR.md "Launching and quitting").
- ~~**"Saving… / Saved" caption in the editor**~~ — **shipped 0.2.9**
  (release audit M9).
- **Type-checked lint** — `recommendedTypeChecked` on `src/**` gives 24
  errors (`restrict-template-expressions` 12, `unbound-method` 3,
  `no-unsafe-argument` 3, …); fix them in one pass, then enable it
  (release audit L13, declined for 0.2.9).
- ~~**Three config re-reads per write**~~ — **shipped 0.2.15**: a write
  hands `sync_pack_files` the library it just wrote, and config.json is
  read once.
- ~~**Popup options contain buttons**~~ — **shipped 0.2.19** differently:
  a row's pills are text carrying `data-tag`, which the row's click reads,
  and pack and group headers are `aria-hidden` inside named groups
  (BEHAVIOR.md, "The list is a listbox"; release audit L20 leftover).
- ~~**Real-library screenshot**~~ — **done 2026-09-25** differently: every
  screen is staged against a demo library (`npm run shots`), in both
  themes, for the site's tour and the README.
- **Manager window residency** (noted 2026-10-29). Both windows are
  declared in `tauri.conf.json`, so the hidden 1000×800 manager has a
  WebView2 renderer alive from login for a user who only ever presses the
  hotkey. Measured 2026-10-29 on the installed 0.2.25 with the manager
  never opened: two WebView2 renderer processes, one per window, 36 and
  42 MB private (82 and 90 MB working set), so the idle manager costs
  about 40 MB. Worth doing: build the manager lazily from the tray click
  (and the other places that open it) and destroy it on close, keeping
  the `edit-prompt` and `library` event paths working when it isn't there.

## Popup

- **Hotkey toggles the popup closed** — a press while the popup is open
  currently only re-focuses it (deliberate, see BEHAVIOR.md); Raycast/Alfred
  hide on a second press. Revisit once the repeat guard has settled.

## Distribution

- **Release post on X with media** (deferred 2026-09-27, when
  `scripts/post-x.mjs` shipped text-only). The marketing plan's launch
  thread wants the GIF and the pack file attached; that is X's media
  upload (chunked `INIT`/`APPEND`/`FINALIZE`, then `media.media_ids` on
  the post) and a second post replying to the first for a thread. Both
  are more script than the text post, and every release in the quiet
  phase is one plain post, so they wait for the launch. X's API has no
  free tier since 2025: it's pay-per-use from prepaid credits, and a post
  carrying a url is $0.20 per request (2026-09), so a thread is a few
  times that; check the pricing page before building it.

- **Code signing** — unsigned installers trip Windows SmartScreen.
  Decided 2026-10-23: a Certum Open Source Code Signing certificate in
  the cloud (SimplySign), issued to the maintainer, signing the local
  release build through `bundle.windows.certificateThumbprint`; CI and
  `build:unsigned` stay unsigned (`tauri.unsigned.conf.json` clears the
  thumbprint). Azure Artifact Signing is closed to EU individuals, and
  EV lost its SmartScreen bypass in 2024. SignPath Foundation, which
  declined the first application, stays the free fallback. Waiting on
  the certificate.
- ~~**Auto-update**~~ — **shipped 0.2.17**: the Tauri
  updater reads `site/latest.json` on promptline.cc, written by the release
  step (CLAUDE.md, Releasing).
- **Quiet release class** (deferred 2026-10-29). A `"quiet": true` field
  in `site/latest.json`, read from `Update.raw_json` in `update.rs`
  (tauri-plugin-updater 2.12 exposes it, and the feed struct has no
  `deny_unknown_fields`, so the field is harmless to every installed
  copy), that skips the toast while keeping the tray item and the About
  line, for a release that changes nothing a user sees. **Why deferred:**
  the toast is the retention instrument (a copy that updates is a copy
  still in use), and visual-only releases have not recurred as a burst
  since 2026-10-03, when three toasts in a day went to every copy.
- ~~**Stable-named installer**~~ — **shipped 2026-09-24**: each release
  carries a `Promptline-setup.exe` copy, and the website links to it
  instead of asking the GitHub API from the visitor's browser.
- ~~**security@promptline.cc**~~ — **shipped 0.2.17**: GoDaddy forwards
  it to the mailbox, and SECURITY.md names it instead of a personal
  address.
- **macOS port** — reimplement the `platform` module (CGEventPost +
  Accessibility permission). Everything else is meant to be portable, but
  the non-Windows build has not compiled since f7e3813 (2026-09-22):
  `src-tauri/src/paste.rs:321` calls `w.hwnd().ok()` ungated, and Tauri's
  `hwnd` is `#[cfg(windows)]`; gate it with the rest when the port starts.
  Since 2026-10-29 the port is no longer the launch gate: a Windows-only
  round goes out once Certum signs a release, and Show HN is held for the
  port, which has no date.
