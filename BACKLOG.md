# Promptline Backlog

Ideas and deferred work, roughly ordered. Promote items into a milestone when picked up.

## Next

The sequence from here to the first public step, set on 2026-10-29 (the
fresh-eyes review's decisions). Each line moves down or out as it lands;
the strategy behind it is in the local `docs/MARKETING.md`.

1. ~~**The Certum certificate**~~ issued 2026-11-05, valid to 2027-11-05:
   renew before then (CLAUDE.md → Releasing has the custody).
2. ~~**Signing copy**~~ done 2026-11-05 on `feat/certum-signing`, written
   as "from 0.2.28", so it merges just before that release.
3. **The first signed release**, 0.2.28. The TLS patch and the AltGr
   notice this line used to wait for shipped in 0.2.26.
4. **The Windows-only round**: r/ClaudeAI, r/ChatGPTCoding, the Claude Code
   Discord, each with the GIF and honest about "Windows for now". Show HN
   waits for the port.
5. **Later, undated: the macOS port** on its own branch (it takes the Tauri
   2.12 / wry 0.57 / tao 0.37 jump and the `@tauri-apps` 2.12 packages
   together; `paste.rs:321` is the first thing that does not compile), then
   Show HN and the launch-week table.

## Fresh-eyes review, 2026-11-02

Recorded 2026-11-02 from the fresh-eyes review at `927d395`, none of it
decided yet. Each item waits on the maintainer's call; where an item says
"pick", that is the agents' recommendation. The full report, with its
evidence and line references, is local only (gitignored, like the
2026-10-29 one): `docs/reviews/fresh-eyes-2026-11-02.md`. The P numbers
are the report's ids. The report suggests starting with P1(d) and the
domain renewal, with P2's Raycast fix alongside.

- **The updater: require the signed version, count "kept", survive a
  lapsed domain** (P1).
  - ~~**(d), the version check**~~ done 2026-11-05, ships in 0.2.28:
    `requireSignedVersion` is on, and `scripts/latest-json.mjs` refuses
    a signature that doesn't name the feed's version. Copies at 0.2.27
    or earlier can't be protected after the fact.
  - ~~**(a), counting "kept"**~~ done 2026-11-05, starts with 0.2.28: the
    feed names byte copies `Promptline_X.Y.Z_x64-update.exe` and
    `…-update.msi`, and `snapshot.mjs` reads their downloads as "kept",
    against the site downloads of every release before it. Copies at
    0.2.27 count too, since they read the same feed.
  - **(b) and (c), decision:** should the check ask
    `releases/latest/download/latest.json` before promptline.cc? It
    would give a daily count of checks, and a second endpoint if the
    domain lapses. Today a 200 response that isn't JSON ends the
    endpoint loop. Pick: yes, disclosed first; if not, ask
    `raw.githubusercontent.com` first.
  - **Also:** confirm promptline.cc renews; it expires 2027-09-22.
  - ~~**The trial**~~ passed 2026-11-05: an installed 0.2.17-1 fetched
    the `-update.exe` copy, installed it and came back at 0.2.17-2.
- **"Why not Raycast?" and the macOS line** (P2).
  - ~~**The Raycast answer**~~ done 2026-11-05: it now names where the
    library lives, the same words in the README and on the site, and a
    test holds the two together. Checked against Raycast's Windows
    changelog and manual, not in the app itself.
  - **Decision:** the macOS line says "in progress" or "on the way" in
    the README, the site, both posts, the repo description and dev.to,
    while the record calls the port undated. Pick: mention macOS only
    under Known limitations, as "planned, no date". That overturns Phase
    6 D-11 and Phase 10 D-02, and `tests/posts.test.js` enforces "in
    progress".
  - **Also:** record the namesakes D1 doesn't list (dyne.org's
    Promptline, `@jxtools/promptline`, promptline.vim). Homebrew's
    notability bar (75 stars, or 225 for your own submission) means a
    personal tap for now.
  - **Size:** hours.
- **The signing gate: dates, and what signing buys** (P3). This feeds
  items 1, 2 and 4 under Next.
  - **Now:** signing doesn't skip SmartScreen on day one; the warning
    shows the publisher's name until reputation builds. What signing
    buys at once is Smart App Control, which blocks the unsigned
    installer with no "Run anyway" and which nothing in the repo
    mentions.
  - ~~**The dates, the fallback and the rewrite list**~~ closed 2026-11-05:
    the certificate came 13 days after the order, so neither a chase nor
    a fallback was needed, and the copy names the publisher, the
    possible warning and Smart App Control. A signed test build showed
    the plug-ins signed. Smart App Control itself wasn't tried on a
    machine with it on.
  - **Local MARKETING:** :72 contradicts :81, and the awesome-list
    statuses at :120 are stale.
  - **Size:** hours, no code.
- **Start with Windows on a fresh install** (P4).
  - **Now:** nothing has ever turned autostart on (`set_autostart` is
    the only caller of `enable()`), and no decision on the default is
    recorded. A copy that isn't running neither pastes nor checks for
    updates. Scoop and winget installs never get the finish-page launch.
  - **Decision:**
    - (A) turn it on at the first launch of a fresh NSIS install, with a
      one-click "Don't" in the first-run banner. Gate it on
      `data_moved`, a fresh install, the NSIS bundle, and no
      StartupApproved value marking it disabled.
    - (B) the banner asks.

    Pick: A.
  - **First step:** add `?mock=first` and an e2e case for today's
    banner, so it has coverage before it changes.
  - **Knock-on:** this raises the priority of Manager window residency.
  - **Size:** about a day.
- **Generate and live pack files** (P5).
  - **Now:** `write_pack_files` (`packs.rs`) rewrites every non-empty
    file-backed pack whose bytes differ from the library's view. An
    agent's edit to a live pack's file is lost on the next save, even
    though the README and the PacksCard copy invite such edits.
  - **The false success:** Generate with an existing pack's name syncs
    that pack's file first. So the poll in `GenerateDialog.tsx` reports
    "The agent wrote the pack" within 2 s, before the agent has done
    anything.
  - **The broken recovery:** the recovery toast points at Settings →
    Packs, which doesn't list the file.
  - **Fix now:**
    - read a baseline when the instruction is copied, and open the
      review only once the file differs from it (a core helper with a
      `node --test` case);
    - give an existing pack's name a scratch file under
      `packs/generated/`;
    - make the toast name Import… → From file….
  - **Decision:** may anything write a live pack's file? Pick: no;
    reword the README, the tooltips and BEHAVIOR. The self-write guard
    stays with Linked pack file.
  - **Size:** about a day, plus the mock's per-path files and the first
    e2e case on this path.
- **Elevated windows: report instead of failing silently** (P6).
  - **Now:** the README's Known limitations says the popup tells you
    when it can't paste into an admin window. It doesn't: `SendInput`
    into an elevated window is dropped without an error, so nothing is
    shown and nothing is logged. BEHAVIOR's paste pipeline and
    `platform.rs` already say it's silent, and L2's resolution line in
    RELEASE-AUDIT is wrong.
  - **First step:** on 0.2.27, press Ctrl+Alt+V into an admin Windows
    Terminal, once without and once with Keep open.
  - **If it's silent:** add `platform::input_blocked(hwnd)`, comparing
    integrity RIDs and treating access denied as blocked. `paste.rs`
    then reports it through `report_paste_failed`, with a message of at
    most about 110 characters, which is what the strip's three lines
    hold at 320 px.
  - **Size:** hours.
- **Pin the zero scan code; PuTTY and Emacs** (P7).
  - **Now:** the injected Ctrl+V carries `wScan: 0` (`key()` in
    `platform.rs`), and mintty pastes exactly that key (wsltty#139). So
    Git Bash works by an unrecorded accident, which filling in the scan
    code would break.
  - **First step:** Ctrl+Alt+V into Git Bash, once plain and once inside
    `claude`. If the text lands, move the events into `ctrl_v_inputs()`,
    add a Windows test that they carry no scan code, add a comment, and
    add one BEHAVIOR sentence.
  - **PuTTY, KiTTY and Emacs** paste on Shift+Insert. Add a Known
    limitations bullet once a manual check confirms PuTTY misses.
  - **Decision:** a paste key per window class? Pick: not until a user
    asks. Shift+Insert gets dropped by Claude Code under the kitty
    protocol in VS Code (claude-code#93782).
  - **Size:** hours.
- **Report a bug from About** (P8).
  - **Now:** the app links to nothing but the coffee page
    (`OPENABLE_URLS`). No issue has ever been opened, and the backlog's
    demand gates read issues and Discussions that installed users can't
    find.
  - **Decision:** does 4e6d0fb's "the app gets no link until Discussions
    shows life" cover the issue tracker? Pick: no.
  - **The change, if so:**
    - a "Report a bug" button in Settings → About, opening
      `issues/new?template=bug_report.md`;
    - the `wr04` test extended to admit it and refuse lookalikes;
    - an e2e case asserting through `__mock.calls`;
    - SECURITY.md's "one link" updated;
    - `bug_report.md` pointing at About for the version.
  - **Size:** hours.
- **Hotkey collisions: Office and Visual Studio** (P9).
  - **Now:** Ctrl+Alt+V is Paste Special in Excel and PowerPoint, and it
    starts debugger chords in Visual Studio. The README and the Settings
    help name only AltGr, JetBrains and Terminal.
  - **The change:**
    - a dated table in BEHAVIOR's hotkey passage, covering both
      candidate defaults in each app (Ctrl+Alt+V still wins);
    - a wider README bullet.
  - **Decision:** add one clause to the Settings help, or keep the help
    and narrow BEHAVIOR's rule that it names every known collision. The
    checker picked narrowing.
  - **Size:** hours.
- **A gesture check before the feed goes live** (P10).
  - **Now:** the e2e suite stops at `invoke("paste_snippet")`. Nothing
    runs the built binary's hotkey, focus hand-back and paste before
    every copy is offered the release.
  - **The change:** `scripts/gesture-check.ps1` (a seeded data folder,
    Notepad and a console as targets, a nonce, polls rather than sleeps)
    and a `gesture` job on windows-latest.
  - **First step:** a probe triggered only by `workflow_dispatch`, to
    learn whether an injected hotkey fires and WebView2 renders on the
    runner.
  - **Decision:** does a red job block the tag? Pick: advisory, and
    perhaps first a manual gesture step in the release skill before the
    feed goes live.
  - **Size:** about a day.
- **Release cadence and the "kept" reading** (P11).
  - **Now:** releases that stayed latest for six days or more read 9 to
    15 versioned fetches; those latest for two days or less read 5 to 8.
    The floor is about 4 to 7, so short windows hide "kept".
  - **Decision:**
    - a standing 7-day floor, with an exception for fixes users can't
      work around;
    - or the narrower form, the checker's pick: `snapshot.mjs --releases`
      marks windows under 5 days as "kept not read", plus a week's hold
      after the round's release.

    Either way this reopens 10-29 P10.
  - **Also open:** does the X post run for every quiet-phase release, and
    should it link promptline.cc instead of the release page that
    `post-x.mjs` links today?
  - **Size:** hours.
- **Clipboard history and cloud sync.** This is the orchestrator's note;
  no second agent has checked it.
  - **Now:** each paste writes the composed prompt with a plain
    `set_text` (`paste.rs`). So it lands in Win+V history and, if sync is
    on, in the cloud clipboard.
  - **The risk (inferred, not run):** a secret copied from a password
    manager carries an exclusion mark. Pasted through `{clipboard}`, it
    loses that mark.
  - **The fix exists:** arboard 3.7 has `exclude_from_history()` and
    `exclude_from_cloud()`.
  - **Before acting:** it needs a deep dive and a check.
- **Not deepened in that review.** Each is one line in the report:
  - Search Console and Bing Webmaster verification (a DNS TXT record, no
    script);
  - opening the popup at the target window rather than at the mouse;
  - drift in the docs agents read (PRODUCT.md, MARKETING's "No network
    code", dead SHAs);
  - a retried paste wrapping the prompt in itself;
  - a release-step check of the feed signature over the released bytes
    (overlaps P1);
  - library writes off the UI thread, and a panic hook that logs.

  Angles no agent took: accessibility of both windows, and recovering
  the library after a bad import.

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

- ~~**Split the largest components**~~ — **done 2026-10-31** (REVIEW D6)
  as pure moves, thirteen commits, the e2e suite untouched and green: the
  popup's Shell, hint bar, list headers and SectionHeader are siblings
  under `src/popup/`, and `popupMode()` in `src/popup/mode.ts` is the one
  derivation the hint bar, the status text and the Undo keys read; the
  sidebar's QueryMirror, foot and resize handle, the editor's tag strip
  and Placeholders panel, the Generate dialog's instruction builders and
  Settings' hotkey recorder and Packs card are siblings under
  `src/manager/`. Folds were already shared (`src/lib/folds.ts`). Seams
  seen and left, each a small behaviour-touching change rather than a
  move: the popup's key handler still derives its own mode (it asks
  about the clipboard panel before the form, `popupMode` the other way
  round; they differ in one render); `formEmpty` and `emptyCount` count
  the same thing; four inline `r.left, r.bottom + 4` could call
  `atButton`; `marked()` in the sidebar and `HighlightedTitle` both mark
  hits; `paramName` restates `isValidParam`'s rule.

## Search

- ~~**Word-wise fuzzy matching**~~ — **shipped 2026-10-31**: each word of
  a query matches on its own in a title or tag list, in any order, scored
  by its worst word (+500 out of the typed order); single words and whole
  phrases rank as before (BEHAVIOR.md, the search passage). The old
  example "root fix" still reaches "Root cause first" through its body,
  since the title has no x; "cause root" is the gain.
- **Virtualize the popup list** only when a real library shows the need
  (memoized rows handle ~1k today).

## Manager

- ~~**Popup groups in the manager's order**~~ — **shipped 0.2.15**
  (`C.groupOrder`).
- ~~**Pack colour, as a setting**~~ — **shipped 2026-10-31**: six named
  theme-token colours from the pack menu's Colour submenu, an 8 px dot at
  the right of the header in both trees, `color` on `PackMeta` in
  `config.json` (absent while unset, never exported). Colour-free by
  default, as the ink hierarchy of 2026-09-22 stays. A swatch glyph on
  the menu items would need an icon slot on `CtxItem`; not done.

- ~~**Flush the editor on Windows shutdown**~~ — **shipped 0.2.15**
  (`platform::on_session_end`, BEHAVIOR.md "Launching and quitting").
- ~~**"Saving… / Saved" caption in the editor**~~ — **shipped 0.2.9**
  (release audit M9).
- ~~**Type-checked lint**~~ — **shipped 2026-10-31**: `recommendedTypeChecked`
  on `src/**` (it had grown to 40 findings in five rule classes), cleared
  in four commits with no behaviour change and no inline disable;
  `only-throw-error` is off for `dev-mock.ts` alone, which rejects with
  the bare values the real backend sends (release audit L13).
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

- ~~**Hotkey toggles the popup closed**~~ — **shipped 2026-10-31**: a
  second tap while the popup is in front hides it through the Esc path
  (Keep open ends); a held key only re-focuses, since the hotkey plugin
  registers with no-repeat and reports the key's release
  (`hotkey_action` in `paste.rs`). A press while the popup is up but
  behind the work brings it forward.

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
  declined the first application, stays the free fallback. Wired
  2026-11-05, first used by 0.2.28.
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
