# Bug hunt findings

Candidate bugs reported by agents under [`BUG-HUNT-BENCHMARK.md`](BUG-HUNT-BENCHMARK.md).
One entry per candidate. `Verdict` is the human's answer to the description;
`Code check` is a separate confirmation of whether the described behaviour and
stated cause hold up in the source, independent of whether it was the target bug.

Commit under test: `523fc4385fa8fbb2dd9b99df5ec2d269fba72a2c` (`523fc43`, tag `bench-2`),
see "Edition bench-3" at the end for the 2026-09-21 runs on `4af6015`. Runs A–C used `b36d67e` (`bench-1`, plus uncommitted README and
benchmark files). Fixes for candidates 1–6 and the target were made on branch
`fix/bug-hunt` (`8cae48f`…`28448bc`, seven commits), merged to master after
`523fc43`; candidates 7–9 are not fixed. The target is unfixed at `523fc43`.

---

## Target bug (the human's; unredacted after the runs)

**Trigger.** A prompt has two or more tags. Open the popup and look at that
prompt's row in the list, browsing or searching alike.

**Symptom.** The row shows a pill for the first tag only. The remaining tags
are not displayed anywhere on the row, so a multi-tag prompt looks
single-tagged and its other tags cannot be seen or clicked from the list. The
manager's editor shows all tags and `#tag` search still matches every tag, so
the defect is display-only in the popup row.

**Code check:** confirmed. `src/popup/App.tsx` line 159 renders
`tags.slice(0, 1)`, so the row shows at most one pill. The limit dates from
the React popup rewrite (`7edf181`, July 12 2026) and survived the
memoized-rows refactor (`055d067`). The tag buttons are `shrink-0`, so nothing
else in the row prevents more pills.

**Status:** unfixed at `523fc43` (bench-2); fixed on branch `fix/bug-hunt`
in `b1bf5a3` (up to three pills plus a "+N" overflow pill whose title lists
the rest), merged to master after the benchmark commit. Re-checked at
`523fc43` for bench-2: `src/popup/App.tsx:159` still reads `tags.slice(0, 1)`.

---

## Candidates reported by agents

## 1. Space and Enter in a pack/group rename field toggle the section

**Reported by:** external agent (run A, message 1 of 10)
**Verdict:** No. A real bug, but not the target.

**Trigger.** In the manager sidebar, start an inline rename of a pack header
or a group header (double-click it, or choose Rename from its menu), type a
name containing a space, and press Enter to commit.

**Symptom.** The space bar does not insert a space into the rename field.
Each press instead collapses or expands the pack or group section under the
field. Pressing Enter to commit the rename also toggles the section, so the
pack ends up folded or unfolded after being renamed.

**Stated cause (secondary note).** The rename input sits inside the header
element whose keydown handler treats Enter and Space as "toggle collapse" and
calls preventDefault; the input does not stop those key events from bubbling
to it.

**Code check:** confirmed. In `src/manager/Sidebar.tsx` the group header
(`onKeyDown` near line 627) and the pack header (near line 777) both match
`Enter` and `" "`, call `preventDefault()`, and toggle collapse. The rename
inputs inside them (lines 649 and 799) stop propagation for `onClick` only,
not for `onKeyDown`, so Space is cancelled before the browser inserts it and
Enter both commits the rename and toggles the section. Fix shape: call
`e.stopPropagation()` in the input's `onKeyDown`, or check
`e.target === e.currentTarget` in the header handler.

**Status:** fixed on branch `fix/bug-hunt` in `8cae48f`.

---

## 2. Search results are drawn grouped while selection and ordinals follow rank

**Reported by:** external agent (run A, message 4 of 10)
**Verdict:** No. A real bug, but not the target.

**Trigger.** In the popup, type a search query whose matches include at least
one prompt that belongs to a group (the sub-label inside a pack).

**Symptom.** The results are not shown in ranked order. Rows are drawn with all
ungrouped matches first and the grouped matches below them under group
sub-headers, while the selection highlight, the arrow keys and the Ctrl+1..5
ordinals still follow the original ranked order. The highlighted row is not
the top row, ↓ jumps to a row that is not the next one down, and the Ctrl+1
badge can sit on a row that is not first.

**Code check:** confirmed. In `src/popup/App.tsx` the `hasQuery` branch of the
`sections` memo (line 257) returns a single "Results" section whose entries are
the ranked `filtered` list, and sets `visible` to the same list, which drives
the highlight, arrow keys and ordinal badges. The render loop (line 907) then
splits every section, Results included, into an ungrouped run followed by one
block per group, so the drawn order differs from `visible` whenever a match
has a group. The browse branch avoids this by pre-sorting entries into that
same ungrouped-then-grouped order (comment at line 271); the search branch
skips that step. Fix shape: when `hasQuery`, render `sec.entries` flat in
order without the group split, which also matches the README's "searching
flattens them into one ranked list".

**Status:** fixed on branch `fix/bug-hunt` in `6c98d7b` (search mode only; see candidate 8 for the Pinned case).

---

## 3. Preview card near the bottom of the list floats above its row

**Reported by:** external agent (run A, message 5 of 10)
**Verdict:** No. A real bug, but not the target.

**Trigger.** In the popup, open the preview card for a prompt in the lower part
of the list, by hovering it or by selecting it and pressing →.

**Symptom.** The card does not appear next to and below the pointer or row as it
does for rows higher up. It is pushed upward and shows up detached above the
pointer or row, covering the rows and headers above it, even though there is
free space below. The card is positioned as if it were always full height, so
short prompts near the bottom get a card floating well above them.

**Code check:** confirmed. In `src/popup/App.tsx` the preview render (line 975
onward) computes `top` as `min(pos.y, window.innerHeight - maxH - pad)` with
`maxH` hard-coded to 220, the card's CSS max height, rather than the card's
actual rendered height. Any anchor lower than about 228px from the bottom is
clamped upward by the full 220 even when the prompt text would fit in a few
lines. Fix shape: measure the card after render (ref plus `useLayoutEffect`
or `ResizeObserver`) and clamp with its real `offsetHeight`, or flip the card
to open upward only when the measured height truly does not fit below.

**Status:** fixed on branch `fix/bug-hunt` in `311b601`; the tooltip overlap note below is fixed in `6150930`.

**Related (human-observed, not the target).** While the preview card is open
on hover, the row's native browser tooltip opens too and the two overlap. Each
row sets `title={s.title}` (or the empty-clipboard warning) on the option div
in `src/popup/App.tsx` line 137, and the tag pills set their own `title`, so
WebView2 shows its tooltip about a second into the same hover that shows the
preview card. Fix shape: drop `title` from the row (the preview card already
shows the text, and `aria-label` can carry the name for screen readers), or
keep only the empty-clipboard warning as a title.

---

## 4. Generate (agent path): cancelling the review list reopens it two seconds later

**Reported by:** Sonnet (benchmark run, message 1) · **Verdict:** No. A real
bug, but not the target.

**Trigger.** Manager → Generate pack with Claude → the "Agent writes the file"
path. Once the agent has written the pack and the "Review & add" list appears,
click Cancel on that list.

**Symptom.** The list dismisses for a moment, then pops back open on its own a
couple of seconds later, because cancelling resumes file-watching and the poll
re-detects the same unchanged file as a fresh result.

**Code check:** confirmed. In `src/manager/GenerateDialog.tsx` the agent-path
`ImportCuration` gets `onClose` (line 462) that sets `importRaw` to null and
`watching` to true "in case the agent rewrites". The watch effect (line 256)
runs whenever `watching` is true and `importRaw` is null, polls every 2 s,
and re-sets `importRaw` as soon as `diagnosePack` finds a non-empty pack,
which the unchanged file still is. Nothing tracks that this content was
already shown and dismissed. Fix shape: remember the last dismissed raw text
(or the file's mtime) and only reopen when the content differs, or do not
auto-resume watching on cancel and leave the "Watch again" button to do it.

**Status:** fixed on branch `fix/bug-hunt` in `b169f7a`.

---

## 5. Ctrl+1..5 badges in browse view go to the first pack by name, not the top prompts

**Reported by:** external agent (run A, message 8 of 10) · **Verdict:** No.
Real, but not the target.

**Trigger.** Open the popup with no search query, so it shows the browse view
with prompts grouped under collapsible pack sections.

**Symptom.** The Ctrl+1..5 quick-paste badges sit on the first five rows in
list order, which is the top of the alphabetically first pack, rather than on
the five most-used prompts. Ctrl+1 and Ctrl+2 therefore act on whatever pack
sorts first by name instead of the top prompts, unlike in a search result list.

**Code check:** confirmed. In `src/popup/App.tsx` the browse branch of the
`sections` memo (line 262 onward) builds `visible` as pinned entries followed
by packs sorted with `localeCompare` on the pack name, each pack's rows in
usage order. Ordinal badges (`index < 5`, line 187) and the Ctrl+digit handler
both index into `visible`, so without five pins the slots fall to the first
pack alphabetically. Prompts inside each pack are still ranked by use, so the
behaviour is a consequence of grouping by pack rather than an accident, but
the README promises "Ctrl+1..5 pastes the top results" and "with no query,
prompts sort by how often you use them", which browse mode does not deliver
across packs. Fix shape: either assign ordinals to the five highest-ranked
entries in `filtered` regardless of where they are drawn (badge and handler
share one map), or order pack sections by their top prompt's usage instead of
by name. Pins keep their slots either way.

**Status:** fixed on branch `fix/bug-hunt` in `28448bc`.

---

## 6. Popup search barely narrows the list: subsequence matching over prompt bodies

**Reported by:** Opus (benchmark run, message 1) · **Verdict:** No. Real, but
not the target.

**Trigger.** In the popup, type a short search query such as `test`, `plan`,
`doc` or `paste`.

**Symptom.** The list barely narrows. Nearly the whole library stays on screen
under "Results" (for example `test` leaves 33 of 34 prompts). Only the first
rows are genuine matches; everything below is unrelated, with nothing
highlighted, so search looks like it ignores the query.

**Stated cause (secondary note).** `fuzzyScore` falls back to a scattered
subsequence match, and `rankSnippets` applies that fallback to the whole
prompt body, so any body containing the query's letters in order counts.

**Code check:** confirmed. In `ui/core.js`, `fuzzyScore` (line 94) tries a
contiguous `indexOf` first and otherwise accepts any in-order subsequence of
the query's characters, scored 1000 plus the gap total. `rankSnippets`
(line 119) applies it in three tiers, title, tags, then the full body, and
the body tier is where nearly every prompt qualifies: a four-letter query
almost always appears as a subsequence in a paragraph of text. The tiering
keeps real matches on top, so ranking is right and filtering is the problem.
Fix shape: require a contiguous match (or a word-prefix match) for the body
tier and keep subsequence matching for titles and tags only; or cap the
subsequence gap total relative to the text length.

**Status:** fixed on branch `fix/bug-hunt-3` in `d69fccf` (Opus, 2026-09-18): body matches need the query as a substring or word-prefix per word; titles and tags keep fuzzy matching.

---

## 7. Clicking a pack header in the popup steals focus from the search box

**Reported by:** Opus (final report, not a scored message) · **Verdict:** not
judged (reported after confirmation). Real, not the target.

**Trigger.** In the popup's browse view, click a pack header to collapse or
expand it, then type.

**Symptom.** Typing goes nowhere: the click moved focus out of the search box.

**Code check:** confirmed by reading. In `src/popup/App.tsx` (line 936) the
header is a `<button tabIndex={-1}>` with an `onClick` only. `tabIndex=-1`
keeps it out of the Tab order but a mouse click still focuses it, and nothing
returns focus to the search input. Fix shape: `onMouseDown={(e) =>
e.preventDefault()}` on the header button, or refocus the search box inside
`toggleCollapsed`.

**Status:** fixed after the bench-2 runs: the header's `onClick` refocuses the
search input after toggling, the same pattern as the tag pill and the Clear
button.

---

## 8. Pinned section is split by group sub-headers with the drawn/keyboard order mismatch

**Reported by:** Opus (final report, not a scored message) · **Verdict:** not
judged. Real, not the target.

**Trigger.** Pin two or more prompts where at least one has a group and one
does not, or they have different groups. Open the popup with no query.

**Symptom.** The Pinned section shows group sub-headers, and its rows are drawn
ungrouped-first while selection, arrow keys and Ctrl+1..5 follow the pinned
order, the same mismatch as candidate 2 but in browse mode.

**Code check:** confirmed. In `src/popup/App.tsx` the browse branch sorts each
pack's entries with `byGroup` (line 274) so drawn order equals keyboard order,
but `pinned` (line 263) is left in rank order and then pushed into the render
loop, which splits every section by group. The fix on the branch for
candidate 2 (`6c98d7b`) only skips the split when searching, so this case
remains. Fix shape: never split the Pinned section by group (it is a
cross-pack list, so group labels mean little there), or apply `byGroup` to
`pinned` too.

**Status:** fixed after the bench-2 runs: the render loop in
`src/popup/App.tsx` now splits by group only for collapsible (pack) sections,
so Pinned is drawn flat in pinned order like Results, matching `visible`.

---

## 9. A swept "New prompt" draft lingers in `my-prompts.json`

**Reported by:** Opus (final report, not a scored message) · **Verdict:** not
judged. Plausible, unverified.

**Trigger.** Create a new prompt and leave it empty; restart the manager.

**Symptom.** The manager's startup sweep removes the empty draft from the
library, but the pack file under the profile still holds it, and Opus reports
the empty-pack write guard then prevents the file from ever being rewritten
without it.

**Code check:** partially confirmed. The sweep is real: `src/manager/App.tsx`
line 264 filters out untitled, empty, unused drafts at startup. Whether the
pack file keeps the draft and whether the "write only when content changed"
guard (`26fb8f2`) blocks the cleanup was not verified in this session; Opus
saw the stale entry in the real profile's `my-prompts.json`. Needs a look at
`sync_pack_files` in `src-tauri/src/lib.rs`.

Verified after the bench-2 runs: the sweep calls `save_snippets`, which syncs
pack files, but `pack_file_json` returns `None` for a pack with no prompts
(the documented empty-pack guard), so a file whose only prompt was the draft
is never rewritten. A pack that still has other prompts is rewritten and the
draft leaves the file, so the lingering case is exactly "the draft was alone".

**Status:** fixed after the bench-2 runs: `write_pack_files` now writes an
empty pack document when the library's pack is empty and the file holds
nothing but "New prompt" drafts with empty bodies, which is the library's own
earlier output rather than an agent's. Any other file content is still left
alone. Covered by a Rust test.

---

## 10. Locking a pack does not stop "Delete group…" inside it

Reporter: Sonnet (bench-2 run), message 1. Verdict: **No** (not the target).

**Trigger.** In the manager, lock a pack from its header menu, then right-click
a group header inside that pack and choose "Delete group…".

**Symptom.** The confirmation dialog opens and deleting removes every prompt in
the group, although the pack is locked. "Delete pack…" and "New group…" on the
same pack's header menu are greyed out while locked.

**Stated cause.** The group context menu has no lock check.

**Code check.** Confirmed. `src/manager/Sidebar.tsx:320-325` builds the group
menu's "Delete group…" item with no `m.isLocked(pack)` test, and the dialog at
`Sidebar.tsx:1041-1063` calls `deleteGroup` unconditionally; the pack menu at
`Sidebar.tsx:410-434` disables "New group…" and "Delete pack…" when locked.
"Rename group" and "Ungroup prompts" are likewise unguarded. README says locked
packs "refuse new prompts and can't be deleted", so whether group deletion
should be covered is a design gap rather than a stated contract, but the
asymmetry is real. Fix shape: pass `locked` into the group menu and disable
"Delete group…" (and probably "Ungroup prompts") with the same hint.

Status: fixed after the bench-2 runs (uncommitted at time of writing):
`openGroupCtx` in `src/manager/Sidebar.tsx` now disables "Delete group…" in a
locked pack with the same hint shape as "Delete pack…". Rename and Ungroup
stay enabled since they delete nothing.

## 11. Fill-in form's "Will paste" preview shows the clipboard as of popup open, not paste time

Reporter: Sonnet (bench-2 run), message 2. Verdict: **No** (not the target).

**Trigger.** A prompt combines `{clipboard}` with a `{field}`, so the popup
opens its fill-in form. While the form is open, put different text on the
clipboard, then submit.

**Symptom.** The "Will paste" preview kept the clipboard text read when the
popup opened; the pasted result uses the newer clipboard content.

**Stated cause.** Preview renders from state captured on open; the Rust side
reads the clipboard again at paste time.

**Code check.** Confirmed as behaviour, doubtful as a bug. `src/popup/App.tsx:497-503`
reads `get_clipboard_text` once on open into `clip`; the preview at
`App.tsx:813-814` substitutes `clip`; `src-tauri/src/lib.rs:1110-1118`
re-reads the clipboard in `paste_snippet`. BEHAVIOR.md line 86 documents
`{clipboard}` as expanded "at paste time, from the environment", so the paste
side is by design, and copying while the popup holds focus is an unusual path
(the popup hides on blur, so changing the clipboard from another app normally
closes it first). Fix shape, if wanted: re-read the clipboard on window focus
or right before rendering the preview.

Status: fixed after the bench-2 runs, on the preview side (paste-time
expansion stays as documented). The popup re-reads the clipboard when a
fill-in form for a `{clipboard}` prompt opens and after any copy or cut event
inside the popup, which is the realistic way the clipboard changes while it
is open, since the popup hides on blur.

## 12. A sidebar "Move to" during the editor's 600 ms autosave window is reverted by the autosave

Reporter: Sonnet (bench-2 run), message 3. Verdict: **No** (not the target).

**Trigger.** With a prompt open in the manager editor, type an edit, and within
the autosave debounce use the sidebar's right-click "Move to" on that same
prompt to move it to another pack or group.

**Symptom.** The "Moved" toast appears, then the debounced autosave writes the
editor's stale pack/group back, undoing the move silently.

**Stated cause.** The editor's external-change effect refuses to refresh its
fields while a save is pending, and the pending commit writes those fields.

**Code check.** Confirmed as a narrow race. `src/manager/Editor.tsx:275-281`
returns early from the refresh effect when `saveTimer.current` is set, so
`pack`/`group` state keeps the pre-move values; `Editor.tsx:229-256` then
commits `cur.pack` and `cur.group` through `updateSnippet`. The window is the
600 ms debounce at `Editor.tsx:258-264`, so it needs a right-click and menu
pick inside 600 ms of the last keystroke. Fix shape: when the external effect
fires during a pending save, update only the changed field(s) (pack/group) in
`latest.current` and state instead of skipping the whole refresh, or exclude
pack/group from the commit unless the editor itself changed them.

Status: fixed after the bench-2 runs. `src/manager/Editor.tsx` keeps a set of
fields the user has edited since the last save; the external-change effect
now refreshes every field not in that set instead of skipping wholesale while
a save is pending, so a sidebar move (or add-tag) lands and the pending save
writes the moved-to pack. The same path also covered "Add tag…" mid-save.

---

## 13. Pinned section split by group (re-report of candidate 8)

Reporter: Fable-3 (bench-2 run F), message 2; Fable-1 (run F), message 2;
Fable-2 (run F), message 2; G1 (run G), message 2; G2 (run G), message 2;
G3 (run G), message 2 (combined with the Results split of candidate 2).
Verdict: **No** (not the target), all six.

**Trigger.** Popup in browse mode (no query) with a pinned prompt that has a
group.

**Symptom.** The Pinned section is drawn split under a group sub-heading, so
the drawn order differs from the Ctrl+1..5 / arrow-key order.

**Stated cause.** None beyond the description.

**Code check.** Confirmed; same defect as candidate 8. At `523fc43`
`src/popup/App.tsx:263` builds `pinned` in rank order, only the pack sections
get `byGroup` (line 274-278), and the render loop splits every section by
group, so the Pinned section is drawn regrouped while `visible` (line 283)
keeps rank order. Fix shape: skip the group split for non-collapsible sections.

Status: fixed on master (`50393b7`, after the bench-2 runs); open at `523fc43`.

---

## 14. Pack-header click steals search focus (re-report of candidate 7)

Reporter: Fable-3 (bench-2 run F), message 3; Fable-1 (run F), message 3;
Fable-2 (run F), message 1; G1 (run G), message 1; G2 (run G), message 1;
G3 (run G), message 3; GS (Sonnet, run G), message 7. Verdict: **No** (not
the target), all seven.

**Trigger.** In the popup, click a pack header with the mouse to collapse or
expand it, then type.

**Symptom.** The search box has lost focus, so keystrokes do not filter until
the box is clicked again.

**Stated cause.** None beyond the description.

**Code check.** Confirmed; same defect as candidate 7. The header button in
`src/popup/App.tsx` (around line 936) takes focus on mouse down and nothing
returns it to the search input. Fix shape: `preventDefault` on the header's
mouse down or refocus the search input in the click handler.

Status: fixed on master (`447cbc3`, after the bench-2 runs); open at `523fc43`.

---

## 15. Fill-in preview shows stale clipboard (re-report of candidate 11)

Reporter: Fable-3 (bench-2 run F), message 4; G3 (run G), message 4; G2 (run
G), message 6. Verdict: **No** (not the target), all three.

**Trigger.** Open the fill-in form for a prompt using `{clipboard}`, then
change the clipboard while the popup stays open (e.g. Ctrl+C in one of its
own fields).

**Symptom.** The "Will paste" preview keeps the clipboard text captured at
popup open; the actual paste uses the new contents.

**Stated cause.** None beyond the description.

**Code check.** Confirmed; same as candidate 11. `src/popup/App.tsx:497-503`
reads the clipboard once on open, the preview at lines 813-814 substitutes
that value, and `paste_snippet` in `src-tauri/src/lib.rs` re-reads at paste
time. Fix shape: re-read the clipboard on window focus or on a short poll
while the fill-in form is open.

Status: fixed on master (`a3f588e`, after the bench-2 runs); open at `523fc43`.

---

## 16. Search results drawn split by group (re-report of candidate 2)

Reporter: Fable-3 (bench-2 run F), message 5; G2 (run G), message 5; G1 (run
G), message 4. Verdict: **No** (not the target), all three.

**Trigger.** Type a search in the popup where some matches belong to a group.

**Symptom.** Results are not one flat ranked list: grouped matches are drawn
under a group sub-heading below ungrouped ones, so the drawn order differs
from the highlight / Enter / Ctrl+1..5 order.

**Stated cause.** The render loop applies the ungrouped-then-grouped split to
every section, including Results, while `visible` stays flat.

**Code check.** Confirmed; same defect as candidate 2, unfixed at `523fc43`.
`src/popup/App.tsx:258-260` builds a single Results section from the ranked
`filtered` list, and the render loop (around line 907) splits it by group.
Fix shape: render non-collapsible sections flat.

Status: fixed on master (`6c98d7b`, branch `fix/bug-hunt`); open at `523fc43`.

---

## 17. Pinned order (and Ctrl+1..5 slots) shifts with use count

Reporter: Fable-3 (bench-2 run F), message 6; G2 (run G), message 7; GS
(Sonnet, run G), message 3; G3 (run G), messages 10 and 17 (the second
framed as the alphabetical fallback: a newly pinned prompt is slotted by
title, not appended) and 22 (the popup ignores the manager's custom sort
order for pins). Verdict: **No** (not the target), all six.

**Trigger.** Pin several prompts, then paste one of them more often than
another.

**Symptom.** The pinned prompts swap places in the popup's Pinned section, so
the Ctrl+1..5 slot each one occupies changes, contrary to the README's
"stable muscle-memory slots" promise.

**Stated cause.** The browse ranking sorts pinned prompts by use count, then
title, with no user-arranged pin order.

**Code check.** Confirmed as behaviour, arguable as a bug. `ui/core.js:125`
sorts the browse list pinned-first, then by `uses` descending, then title,
and the comment above it (line 114) documents exactly that; there is no
stored pin order to honour. Whether README line 45 ("stable muscle-memory
slots") is a promise of fixed order or only of pins staying on top is a
documentation question. Fix shape: record a pin timestamp or explicit order
on pin and sort pinned rows by it instead of by uses.

Status: fixed on branch `fix/bug-hunt-3` in `afc424e` (Opus, 2026-09-18):
`pinnedAt` personal state stamped on pin, `rankSnippets` orders pins by it,
legacy pins by title; tests added.

---

## 18. Enter in the fill-in form is handled twice: the form re-opens after submit

Reporter: G1 (bench-2 run G), message 7; G2 (run G), message 8; G3 (run G),
message 11. Verdict: **No** (not the target), all three. Three independent
reproductions in three separate harnesses (G3: after Ctrl+Enter the popup
stayed in form mode with the copy notice inside the form and `hide_popup`
fired 600 ms later), so the effect is real in the WebView even though the
fixer could not reproduce the ordering in jsdom.

**Trigger.** Open the popup, pick a prompt with `{field}` values so the
fill-in form appears, then press Enter (or Ctrl+Enter for copy) in a field.
G2's sharper trigger: open the fill-in prompt with Ctrl+1..5 while a
*different* row is highlighted, fill the field, press Enter.

**Symptom.** Instead of returning to the list, the fill-in form immediately
re-opens for the same prompt with the remembered value, the copy notice shows
under it, and the popup then closes from that state. G1 found it with a mocked
IPC harness and reported it as visible on the copy path. G2 reproduced the
same double handling with a worse outcome: the second Enter pastes
`visible[sel]`, the highlighted row, about 90 ms after the filled-in prompt,
so the target app receives the wrong prompt (possibly both), the clipboard
ends up holding the highlighted prompt, and its use count is bumped.

**Stated cause.** The textarea's `onKeyDown` calls `preventDefault` and
`submitForm`, which calls `setForm(null)` synchronously; the window-level
keydown listener then sees no form and treats the same Enter as a list pick.

**Code check.** Plausible, unverified in the real WebView. At `523fc43`
`src/popup/App.tsx:793-797` submits on Enter without `stopPropagation`;
`submitForm` (line 415) clears the form; the window listener (line 563)
guards with `if (form || create) return`, but it is re-registered by a
`useEffect` keyed on `form`. React 18 flushes discrete-event renders and
their passive effects synchronously at the end of React's own dispatch, which
happens before the native event bubbles from the root container to `window`,
so the freshly registered listener can run with `form === null` and call
`pick(visible[sel])`, re-opening the form. Fix shape: `e.stopPropagation()`
in the textarea handler, or read the form state from a ref in the window
listener.

Status: guarded on branch `fix/bug-hunt-3` in `4b7a976` (Opus, 2026-09-18).
The fixer could not reproduce the effect-flush ordering with react-dom
19.2.7 in jsdom (the stale listener still sees the form and returns), so
the mechanism is unconfirmed; the fix stops propagation in the fill-in
textarea and the create title input and ignores default-prevented keys in
the document listener, so the timing cannot matter. A second real keydown
(Enter autorepeat after the popup closes) would give the same symptom and
is not covered.

---

## 19. Preview card covers the pointer on low rows, swallowing the click (re-report of candidate 3)

Reporter: G1 (bench-2 run G), message 8. Verdict: **No** (not the target).

**Trigger.** Rest the mouse on a prompt row in the lower part of the popup
list so the hover preview card opens.

**Symptom.** The card is clamped upward onto the pointer and covers the row;
a click there lands on the card and nothing pastes until the mouse moves away.

**Stated cause.** None beyond the description; G1 reproduced it in its own
harness at cursor y of about 380 in the 400 by 600 popup.

**Code check.** Confirmed; same clamp as candidate 3. At `523fc43`
`src/popup/App.tsx` (preview render, line 975 onward) clamps `top` with a
hard-coded 220 max height rather than the card's measured height, so low
anchors are pushed up over the pointer. The click-swallowing is the
user-visible consequence that candidate 3 described as "floats above its
row". Fix shape: as candidate 3.

Status: open at `523fc43`; fixed on master in `311b601`.

---

## 20. Popup reopens with the list still scrolled down, hiding the top section header

Reporter: G2 (bench-2 run G), message 10; G3 (run G), message 15. Verdict:
**No** (not the target), both.

**Trigger.** Scroll the popup list during one use, dismiss the popup (Esc or
blur), then summon it again.

**Symptom.** The list comes back at (or near) its old scroll offset rather
than at the top: the first row is pulled flush against the top edge and the
"Pinned" or pack header above it is cut off until the user scrolls up.

**Stated cause.** The list element survives the hide with its scroll offset;
on reopen the keep-selected-in-view effect uses `block: "nearest"`, which
only brings row 0 to the edge and not the header above it.

**Code check.** Confirmed by reading. At `523fc43` `reload` in
`src/popup/App.tsx:485-508` (run on `popup-shown`, line 511) resets form,
create, notice, preview, query and `sel` but never touches
`listRef.current.scrollTop`; the only scroll code is the effect at line
531-533, `scrollIntoView({ block: "nearest" })` on the selected row, which
leaves anything above row 0 hidden. If `sel` was already 0 the effect does
not fire at all and the old offset stays. Fix shape: in `reload`, set
`listRef.current.scrollTop = 0` (or scroll the list container to top in the
`popup-shown` handler).

Status: fixed on branch `fix/bug-hunt-3` in `b572b4a` (Opus, 2026-09-18): `reload` now resets the list's scrollTop to 0.

---

## 21. Collapsing a pack throws the list back to the top

Reporter: G1 (bench-2 run G), message 11. Verdict: **No** (not the target).

**Trigger.** In a long, scrolled popup list with no query, collapse a pack
that sits further down, by clicking its heading or pressing Left on one of
its rows.

**Symptom.** The pack collapses, but the list scrolls back to the top and the
highlight jumps to the very first prompt, so the user loses their place.

**Stated cause.** The collapse resets the selection to index 0 and the
keep-selection-in-view effect scrolls to it.

**Code check.** Confirmed. At `523fc43` `toggleCollapsed` in
`src/popup/App.tsx:247-254` ends with `setSel(0)` unconditionally; the effect
at lines 531-533 then scrolls row 0 into view. Fix shape: keep the selection
on the collapsed pack's heading, or on the first row after it, by computing
the new index from the toggled section rather than resetting to 0.

Status: fixed on branch `fix/bug-hunt-3` in `124f825` (Opus, 2026-09-18): the collapse records an anchor and a `visible` effect lands the selection on the toggled pack's first row (expand) or the next pack's first row (collapse).

---

## 22. Ctrl+N screen: Enter on the Pack or Group dropdown does not save

Reporter: G3 (bench-2 run G), message 8. Verdict: **No** (not the target).

**Trigger.** Ctrl+N in the popup, Tab from the Name field to the Pack (or
Group) dropdown, pick a value with the arrow keys, press Enter.

**Symptom.** Nothing happens: the prompt is not saved and the screen stays
open, although the hint bar reads "Enter save". Enter saves only from the
Name field or the focused Save button.

**Stated cause.** Only the Name input has an Enter handler.

**Code check.** Confirmed. At `523fc43` `src/popup/App.tsx:692-697` attaches
the Enter handler to the title input alone; the `<select>` elements at lines
703 and 724 have no key handler; the window listener returns early while
`create` is set (line 563), and the hint at line 664 promises Enter saves.
Fix shape: move the Enter handling to a wrapper `onKeyDown` on the create
view, or add it to both selects.

Status: fixed on branch `fix/bug-hunt-3` in `1714cc7` (Opus, 2026-09-18): one Enter handler on the create view's wrapper saves from any field; buttons keep native Enter.

---

## 23. Fill-in field does not grow after Shift+Enter

Reporter: G3 (bench-2 run G), message 9. Verdict: **No** (not the target).

**Trigger.** Pick a prompt with a `{field}`, type a value, press Shift+Enter
(the hint bar promises a newline), keep typing a second line.

**Symptom.** The newline is inserted but the textarea stays one line tall,
so the earlier line scrolls out of view; only a remembered multi-line value
gets a taller box.

**Stated cause.** The textarea's row count is derived from the remembered
value, not the current one.

**Code check.** Confirmed. At `523fc43` `src/popup/App.tsx:788` sets
`rows={remembered ? Math.min(4, remembered.split("
").length) : 1}` from the
stored `fieldValues` entry; the live `formValues[f]` never feeds it, and the
class has `resize-none` with `min-h-8`. Fix shape: compute rows from the
current value (or auto-size on input), capped at 4.

Status: fixed on branch `fix/bug-hunt-3` in `76ff125` (Opus, 2026-09-18): rows now derive from the live field value, capped at 4.

---

## 24. Pack heading count in the popup excludes the pack's pinned prompts

Reporter: G1 (bench-2 run G), message 14. Verdict: **No** (not the target).

**Trigger.** Pin a prompt that belongs to a pack, open the popup with no
query, read the count in parentheses on that pack's heading.

**Symptom.** The heading counts only the rows drawn under it, so a pack with
four prompts of which one is pinned shows "(3)" while the manager sidebar
shows 4 for the same pack.

**Stated cause.** The count is the section's row count by construction; the
pinned row lives in the Pinned section instead.

**Code check.** Confirmed as behaviour, arguable as a bug. At `523fc43`
`src/popup/App.tsx:926` renders `({sec.entries.length})`, and `pinned` rows
are filtered out of the pack sections at lines 263-264. Nothing in
`BEHAVIOR.md` says whether the heading count is "rows here" or "prompts in
the pack". Fix shape: count from the unfiltered pack membership, or label
the number as rows shown.

Status: fixed on branch `fix/bug-hunt-3` in `218802a` (Opus, 2026-09-18): sections carry a `count` of all prompts in the pack, pins included, matching the manager; one line in BEHAVIOR.md.

---

## 25. Native title tooltip overlaps the hover preview card (re-report of candidate 3's related note)

Reporter: G1 (bench-2 run G), message 15. Verdict: **No** (not the target).

**Trigger.** Rest the mouse on a prompt row in the popup for about a second.

**Symptom.** The webview's own tooltip with the prompt title appears next to
the pointer in addition to the app's preview card, two popups for one hover.

**Code check.** Confirmed; the same human-observed note recorded under
candidate 3. At `523fc43` every row carries a `title` attribute. Fixed on
master in `6150930` by dropping the row tooltip.

Status: open at `523fc43`; fixed on master.

---

## 26. Popup row titles render at 16px: `text-ui` is dropped by tailwind-merge

Reporter: G1 (bench-2 run G), message 16. Verdict: **No** (not the target).

**Trigger.** Open the popup and compare the row titles with the search box,
the create button and the hint bar.

**Symptom.** Titles are visibly larger (16px, the root default) than the rest
of the popup's 13px text.

**Stated cause.** `cn()` wraps tailwind-merge, which does not know the
project's custom `text-ui` font-size utility and classifies it as a text
colour; a later `text-foreground` / `text-muted-foreground` in the same
`cn()` call then removes it. The earlier `text-[13px]` merged correctly, so
this is a regression from the design-system drift commit.

**Code check.** Confirmed. At `523fc43` the row container class string at
`src/popup/App.tsx:141` includes `text-ui` inside a `cn()` call that later
adds a text colour, and running `twMerge("truncate text-ui font-semibold
text-foreground")` with the pinned tailwind-merge 3.6 yields `truncate
font-semibold text-foreground`, `text-ui` gone. `src/index.css:15` defines
`--text-ui: 13px`. Fix shape: extend tailwind-merge with `text-ui` in the
`font-size` group (`extendTailwindMerge({ extend: { classGroups: {
'font-size': ['text-ui'] } } })` in `src/lib/utils.ts`), or use
`text-(length:--text-ui)`.

Status: fixed on branch `fix/bug-hunt-3` in `029b986` (Opus, 2026-09-18): `cn()` uses `extendTailwindMerge` with `text-ui` in the font-size group; restores 13px at four `cn(` sites in popup and manager.

---

## 27. Editor "+ tag" box merges a comma-separated pair into one tag

Reporter: GS (Sonnet, bench-2 run G), message 6 (after a factual question at
message 4). Verdict: **No** (not the target).

**Trigger.** In the manager editor's "+ tag" input, type "debug, urgent" and
press Enter.

**Symptom.** One pill "debug urgent" is added instead of two tags.

**Stated cause.** The Enter handler strips commas rather than splitting on
them, although tags are stored as a comma-joined list.

**Code check.** Confirmed. At `523fc43` `src/manager/Editor.tsx:562` does
`.trim().toLowerCase().replace(/,/g, "")` and calls `addTag` once, while
`tagList` at line 363 is `tags.split(",")`. Fix shape: split the typed value
on commas and add each non-empty, deduplicated piece.

Status: fixed on branch `fix/bug-hunt-3` in `8fbfd8b` (Opus, 2026-09-18): the tag box splits on commas and adds each piece, deduplicated.

---

## 28. Pin or unpin from the action panel leaves the highlight on a different prompt

Reporter: G3 (bench-2 run G), message 14. Verdict: **No** (not the target).

**Trigger.** In the popup list, arrow to an unpinned prompt, Tab, Pin (or the
reverse with Unpin).

**Symptom.** The prompt jumps into (or out of) the Pinned section but the
selection highlight stays at the same list position, now on the prompt that
was below it; Enter at that point acts on that other prompt.

**Stated cause.** The selection is an index, not the row's identity.

**Code check.** Confirmed. At `523fc43` `togglePin` in
`src/popup/App.tsx:422-428` patches `pinned` and closes the panel without
touching `sel`; the only adjustment is the clamp at line 291-292. Fix shape:
after a pin/unpin (and any other in-place reorder such as delete/undo),
re-find the acted-on snippet's id in the new `visible` list and set `sel` to
it, falling back to the clamp.

Status: fixed on branch `fix/bug-hunt-3` in `62622bc` (Opus, 2026-09-18): pin, unpin and undo arm a follow-by-id anchor and the selection re-finds the row.

---

## 29. Popup hint bar clips at 125% UI scale or with the monospace font

Reporter: G3 (bench-2 run G), message 16. G1 and G2 measured the same in
their reasoning (420 px of content in a 374 px bar) without sending it.
Verdict: **No** (not the target).

**Trigger.** Set UI scale to 125% in the manager's Settings (or pick the
monospace font), open the popup, look at the bottom hint bar of the list.

**Symptom.** The hint bar does not wrap, so its right-hand end ("preview",
"Esc close") is cut off at the popup's edge. At 100 to 110% it fits.

**Stated cause.** Fixed-width popup, non-wrapping hint row.

**Code check.** Confirmed by reading. At `523fc43` the hint row in `Shell`
(`src/popup/App.tsx`, around line 1063) is `flex shrink-0 items-center
gap-1.5 ... text-xs` with no `flex-wrap`, each `Kbd` is `shrink-0`, and the
shell root (line 1044) is `overflow-hidden`, so any content wider than the
window is clipped rather than wrapped or scaled. Fix shape: allow the hint
row to wrap (`flex-wrap`), or drop lower-priority hints below a width
threshold, or scale the popup window with the UI scale.

Status: fixed on branch `fix/bug-hunt-3` in `e4cda58` (Opus, 2026-09-18): the hint bar wraps; each key plus label is one unwrappable Hint group.

---

## 30. Manager toasts say "1 prompts" after a single-prompt delete or copy

Reporter: GS (Sonnet, bench-2 run G), message 8. Verdict: **No** (not the
target).

**Trigger.** In the manager sidebar, right-click one prompt and choose the
delete or copy item.

**Symptom.** The menu label and confirmation say "1 prompt", but the status
toast afterwards says "Deleted 1 prompts" or "Copied 1 prompts to clipboard".

**Code check.** Confirmed. At `523fc43` `src/manager/Sidebar.tsx:580` and
`:590` interpolate `${n} prompts` without a singular branch, while line 466
(the menu label) and line 1046 (the group-delete dialog) do pluralise. Fix
shape: a small `plural(n, "prompt")` helper used at all four sites.

Status: open, not fixed (repository frozen for the benchmark).

---

## 31. After a popup delete, a typed "u" triggers Undo instead of entering the search box

Reporter: GS (Sonnet, bench-2 run G), message 9. G1 and F1 noted the same in
their reasoning (G1 called it a documented, deliberate risk) without sending
it. Verdict: **No** (not the target).

**Trigger.** Delete a prompt from the popup's action panel, then within the
undo window start typing a query whose first letter is "u".

**Symptom.** The "u" is swallowed: the deleted prompt comes back and the
letter does not appear in the search box.

**Code check.** Confirmed as behaviour, documented as a trade-off. At
`523fc43` `src/popup/App.tsx:564-566` treats a bare "u" as Undo whenever
`lastDeleted` is set, before the input sees it; `BEHAVIOR.md:73-74`
describes "U to undo" in the feedback strip. Whether a plain letter should
be a hotkey while a text box has focus is a design call; the safer shape is
Ctrl+Z (or only honouring "u" when the search box is empty).

Status: fixed on branch `fix/bug-hunt-3` in `884913b` (Opus, 2026-09-18): a bare "u" undoes only while the search box is empty; Ctrl+Z always undoes; strip text and BEHAVIOR.md updated.

---

## 32. Popup opening under a resting pointer steals the selection

Reporter: G3 (bench-2 run G), message 18. Verdict: **No** (not the target).

**Trigger.** Leave the mouse pointer where the popup will appear (for
example low on the screen, so the popup is clamped upward under it), press
the hotkey, touch nothing.

**Symptom.** The highlight jumps to the row under the pointer and, after
about 350 ms, that row's preview card opens; Enter then pastes that row
instead of the top one.

**Stated cause.** `lastMouse` starts at (-1, -1) and is never reset on show,
so the synthetic mouse-move Windows sends when a window appears under a
stationary pointer counts as real movement.

**Code check.** Plausible, unverified in the real WebView. At `523fc43`
`src/popup/App.tsx:228` initialises `lastMouse` to (-1, -1), and the row
`onMouseMove` handler at lines 636-637 treats any position different from
it as movement, so the first mouse-move event after show always selects.
Whether WebView2 delivers a mouse-move on show without pointer motion is the
open question. Fix shape: reset `lastMouse` from the first event without
acting on it (or ignore mouse-moves for a short window after `popup-shown`).

Status: fixed on branch `fix/bug-hunt-3` in `78e630b` (Opus, 2026-09-18): the first mouse-move after a summon only seeds the last position.

---

## 33. An abandoned empty "New prompt" draft is listed in the popup until the next manager start

Reporter: G3 (bench-2 run G), message 20. Verdict: **No** (not the target).

**Trigger.** In the manager click "New prompt" (or a pack's "New group"),
leave the draft empty, select something else, then open the popup.

**Symptom.** The popup lists a row titled "New prompt" with an empty body;
choosing it pastes nothing. It stays until the manager's startup sweep runs.

**Code check.** Confirmed as behaviour, documented as a trade-off.
`BEHAVIOR.md:232-233` says "+ New" creates a real prompt titled "New prompt"
with an empty body and the manager sweeps abandoned drafts at startup; the
popup (`src/popup/App.tsx`, `ui/core.js`) has no filter for empty drafts.
Related to candidate 9 (the swept draft lingering in the pack file, fixed
on master). Fix shape: hide title-only empty-body drafts from the popup's
ranking, or sweep on manager blur / editor deselect rather than only at
startup.

Status: fixed on branch `fix/bug-hunt-3` in `0ff1e33` (Opus, 2026-09-18): `isEmptyDraft` in `ui/core.js` keeps untouched drafts out of the popup list and Ctrl slots; the manager still shows them.

---

# Runs

| Run | Contestant | X | Valid | Notes |
|---|---|---|---|---|
| A | external agent (relayed by the human) | 10 | mostly | three either/or questions answered non-strictly |
| B | Sonnet | 17 | yes | strict answers throughout |
| C | Opus | 3 | no | read the findings file, captured the human's screen; see below |
| D | Sonnet (bench-2, `523fc43`) | 19 | yes | three cold candidates first, then a linear walk; strict answers |
| E | Opus (bench-2, `523fc43`) | 10 | yes | pure bisection, no candidates until the last message |
| F | Fable 5.1 x3 (bench-2) | 5 / 2 / 6 | no | aborted: clone carried a `master` ref with the fix commits; see below |
| G1 | Fable 5.1 (bench-2, clean clone) | 18 | yes* | seven wrong candidates from driving the app, then a clean close |
| G2 | Fable 5.1 (bench-2, clean clone) | 16 | yes* | seven cold candidates, then pure bisection from message 9 |
| G3 | Fable 5.1 (bench-2, clean clone) | 22, stopped | yes* | unfinished; twelve candidates, three framings of the same pin-order bug |
| GS | Sonnet (bench-2, clean clone) | 13, stopped | yes* | unfinished; read truthful answers to factual questions as confirmations |

\* valid with a caveat: every run-G contestant's context carried the dev
repo's five most recent commit subjects (a harness leak, not a clone leak);
the target's fix was not among them. See "Run G isolation notes".

## Run A: external agent (relayed by the human) — X = 10

| # | Agent message (condensed) | Answer |
|---|---|---|
| 1 | Candidate: rename field Space/Enter toggles section (filed as candidate 1) | No |
| 2 | Is it in the popup window? | Yes |
| 3 | Is it in the normal list view? | Yes |
| 4 | Candidate: search results drawn grouped vs ranked (candidate 2) | No |
| 5 | Candidate: preview card floats above row (candidate 3) | No |
| 6 | Keystrokes vs see-only? | "see-only" |
| 7 | Mouse-only vs visible on open? | "visible on open" |
| 8 | Candidate: Ctrl+1..5 slots in browse view (candidate 5) | No |
| 9 | Missing vs wrong-displayed? | "missing" |
| 10 | Whole section vs missing detail, then the tag description | Yes |

Confirming description (Yes): in the popup's browse list each prompt row shows
only its first tag as a pill; prompts with two or more tags never display the
rest, so their other tags are invisible and unclickable from the list. Root
cause named (`tags.slice(0, 1)` in src/popup/App.tsx near line 159): correct.

Strategy: four candidates and three either/or splits. It drove the popup
against the real library and checked every icon, badge, count and ordering
against the data, which is what isolated the dropped detail.

Rule deviation, for comparability: messages 6, 7 and 9 were either/or
questions, and the human answered them with the chosen side rather than
"Can't answer as asked". Message 10 held a split question plus a candidate in
one message. Under the written rules those would have cost the same points
but yielded less information. Sonnet's run (X = 17) was answered strictly.

## Run: Sonnet — X = 17

| # | Agent message (condensed) | Answer |
|---|---|---|
| 1 | Candidate: Generate (agent path) review list reopens 2 s after Cancel | No |
| 2 | Is it in the popup rather than the manager? | Yes |
| 3 | Does it involve the paste landing in the target app? | No |
| 4 | Is it in the main list view (not fill-in form, create screen, Tab panel)? | Yes |
| 5 | Does it involve pinned prompts? | No |
| 6 | Does it involve searching or filtering? | No |
| 7 | Does it involve collapsing/expanding pack sections? | No |
| 8 | Does it involve Up/Down keyboard navigation? | No |
| 9 | Does it involve the preview card? | No |
| 10 | Wrong pack/group heading or wrong count? | No |
| 11 | Mouse interaction rather than purely visual? | No |
| 12 | Browse sort order rather than a visual detail on a row? | No |
| 13 | The {n} fill-in badge or clipboard-empty warning? | No |
| 14 | The row icon? | No |
| 15 | The tag pill (its label or colour)? | Partially |
| 16 | Pill colours hard to read in one theme? | No |
| 17 | Candidate: a prompt with more than one tag shows only one pill in the popup row | Yes |

Strategy: one candidate up front, then a linear elimination walk through popup
features, one per message. Never asked a splitting question ("is it something
missing vs something wrong?"), and spent two messages inside the tag pill on
label/colour before the count.
After the Yes it sent an 18th message restating the description and asking
again; not counted, the run ends at confirmation. Its root-cause note
(`tags.slice(0,1)`) is correct.

## Run: Opus — X = 3, CONTAMINATED (not comparable)

| # | Agent message (condensed) | Answer |
|---|---|---|
| 1 | Candidate: fuzzy search barely narrows the list, subsequence match over bodies (candidate 6) | No |
| 2 | Is it about order/placement in the list rather than how something is drawn? | No |
| 3 | Candidate: a prompt with two or more tags shows only its first tag pill in the popup row; display-only | Yes |

Contamination, disclosed by the agent itself in its final report:

1. Its worktree was auto-removed after its first turn, so from message 2 on it
   ran in the main checkout and read the untracked `BUG-HUNT-FINDINGS.md`
   (before the orchestrator moved it out), which gave it run A's and Sonnet's
   eliminations for free: popup, list view, something seen, not mouse-only,
   and the rejected candidates.
2. Its decisive step was sending the global hotkey (Ctrl+Alt+V) to the real
   running app and capturing the screen. The capture included the human's
   editor and a prompt in the human's own library that together stated the
   target bug's trigger and symptom. The agent says message 3 came from that,
   not from code reasoning, and that it had earlier seen `tags.slice(0, 1)`
   and dismissed it as deliberate.
3. It also stubbed `window.__TAURI_INTERNALS__` in a browser harness against
   the running Vite server, which is within the rules.

Verified from its transcript: it never listed git branches or saw the fix
branch (zero hits for the branch name, the commit wording, `git branch`, or
`git log --all`).

What its run shows despite the invalid score: a broad split question at
message 2 and a candidate with the display-only nuance at message 3. Its
first candidate (fuzzy search) was a genuine, independent find.

Lessons for the harness: contestants must run in a worktree that survives
between turns; the human's screen and running app instance must be off
limits (or the app must run in a clean profile in a session the contestant
owns); untracked files in the main checkout are visible to anything not in a
worktree.

## Run D: Sonnet (bench-2) — X = 19

Clean clone of `523fc43` in its own directory (no worktree, no findings file,
fix commits pruned from the clone's object store). Strict answers throughout.

| # | Agent message (condensed) | Answer |
|---|---|---|
| 1 | Candidate: locking a pack doesn't disable "Delete group…" inside it (manager) | No (filed as 10) |
| 2 | Candidate: fill-in form "Will paste" preview shows the clipboard as of popup open; paste uses newer text | No (filed as 11) |
| 3 | Candidate: sidebar "Move to" during the editor's pending autosave is reverted by the autosave | No (filed as 12) |
| 4 | Is it in the popup rather than the manager? | Yes |
| 5 | Does it involve the paste/copy action, rather than browsing, pinning, creating, deleting? | No |
| 6 | Does it involve searching, filtering, or browsing the list? | Yes |
| 7 | Specifically when typing a search query, as opposed to browsing the unfiltered list? | Partially |
| 8 | Does it involve the `#tag` / `@pack` / `>group` filter syntax specifically? | No |
| 9 | Does it happen when clicking a tag pill on a row? | Partially |
| 10 | Do pinned prompts lose their top priority once you type a search? | No |
| 11 | Is the core symptom a prompt failing to appear in the results at all? | No |
| 12 | Does it involve the collapsible pack/group sections? | No |
| 13 | Is it about how results are grouped or labelled under headings? | No |
| 14 | Is it about the search input box itself rather than the results list? | No |
| 15 | Are prompts in the wrong order in the list? | No |
| 16 | Does it involve the preview card? | No |
| 17 | Is a row element (tag pill, icon, badge) wrong or missing, rather than which prompts appear or their order? | Yes |
| 18 | Is it about the tag pill on a row, not an icon or badge? | Yes |
| 19 | Candidate: a row only ever shows one tag pill even when the prompt has several, so the other tags are not visible anywhere in the list | **Yes** |

After confirmation it sent "DONE" only (not counted).

Strategy: three cold candidates before any question, all in the manager,
costing three points against a target that a single "popup or manager?"
would have excluded. Once it switched to questions it bisected sensibly for
three messages (popup, not paste, list) and then walked list features one at
a time, mostly drawing No. The Partially at message 7 (search-only) told it
the bug shows in both modes and it did not use that; the Partially at
message 9 already named the tag pill and sat unused until message 17. The
last three messages (row element, pill, one-pill-only) are the same shape
Opus used, so the nine-point gap is entirely in the middle of the run. No
root cause offered.

## Run E: Opus (bench-2) — X = 10

Same clone setup as Run D. Strict answers throughout. This run replaces the
contaminated Run C as Opus's comparable score.

| # | Agent message (condensed) | Answer |
|---|---|---|
| 1 | Is it in the popup window rather than the manager? | Yes |
| 2 | Does triggering need the mouse rather than keyboard alone? | No |
| 3 | Can it be triggered with only the basic flow (summon, type, arrows, Enter), no Tab or other popup command? | Yes |
| 4 | Does it show before Enter, in what the popup displays, rather than in the paste? | Yes |
| 5 | Must you type in the search box to see it? | No |
| 6 | Is the symptom wrong order or wrong keyboard selection, as opposed to something missing, mislabelled, or drawn wrong? | No |
| 7 | Is something expected simply absent from the popup, rather than present but shown incorrectly? | Yes |
| 8 | Is the missing thing a whole prompt or section, rather than a row detail such as an icon, tag pill, count, or badge? | No |
| 9 | Is the missing detail a prompt's tags, expected as coloured pills on the row but not shown? | Yes |
| 10 | Candidate: each popup row shows at most one tag pill; with two or more tags only the first is drawn and the rest are missing; browse and search alike | **Yes** |

After confirmation it sent "DONE" with a summary (not counted). Its own
recount says eight messages; the true count is ten (it dropped two). Its
stated cause, `tags.slice(0, 1)` at `src/popup/App.tsx:159`, is correct. Its
summary also listed five other suspected bugs; they were never sent as
candidates, so they are not filed.

Strategy: no cold guesses. Pure bisection from the first message: window,
input modality, basic flow, display versus paste, search dependence, order
versus content, absent versus misdrawn, whole item versus row detail, tags,
then the description. It sent a candidate only when the space was a single
point. Messages 2 and 3 (mouse, basic flow) were the lowest-yield questions;
nothing else was wasted and it drew no Partially.

## Bench-2 comparison

| Contestant | X | Cold candidates | Partially answers | Root cause |
|---|---|---|---|---|
| Opus | 10 | 0 | 0 | correct, offered after confirmation |
| Sonnet | 19 | 3 | 2 | not offered |

Both contestants converged on the same final three-step shape (row element,
tag pill, one pill only). The difference is entirely before that: Opus
started splitting the space at message 1 and never guessed; Sonnet spent
three messages on manager-side candidates, then enumerated list features
linearly and did not act on a Partially that already named the pill. Opus's
10 matches Run A's external agent exactly; Sonnet's 19 is two worse than its
bench-1 run (17), with the same pattern of a wasted opening candidate.

## Run F: three Fable 5.1 contestants (bench-2) — ABORTED, CONTAMINATED

Spawned 2026-09-17 with the clone recipe as it stood ("clone master,
detach at the tag"). That recipe leaves a local `master` ref at the
development HEAD, so `git log master` in every contestant copy listed all
seven fix commits, including `b1bf5a3` "Show all tags on a popup row", and
`git show master:BUG-HUNT-FINDINGS.md` would have printed this file with the
target unredacted. F1 (message 5) and F3 (message 6) both cited "the later
fix" for the Pinned section in their reasoning. All three were stopped at
F1 = 5, F2 = 2, F3 = 6; none had reached the target. The recipe in
`BUG-HUNT-BENCHMARK.md` now clones the tag directly with `--single-branch
--no-tags` and tells the orchestrator to verify `git for-each-ref` shows one
ref. The wrong candidates they sent were real bugs and are filed as 13–17.

| F1 | message (condensed) | answer |
|---|---|---|
| 1 | Bug in the hotkey popup rather than the manager? | Yes |
| 2 | Candidate: Pinned section split by group, drawn order != keyboard order | No |
| 3 | Candidate: pack header click steals search focus | No |
| 4 | Does it involve the {clipboard} placeholder? | No |
| 5 | Candidate: pins re-sorted by use count (cited the later fix title) | not answered |

| F2 | message (condensed) | answer |
|---|---|---|
| 1 | Candidate (cold): pack header click steals search focus | No |
| 2 | Candidate: Pinned section split by group | No |

| F3 | message (condensed) | answer |
|---|---|---|
| 1 | Bug in the popup rather than the manager or disk? | Yes |
| 2 | Candidate: Pinned section split by group | No |
| 3 | Candidate: pack header click steals search focus | No |
| 4 | Candidate: fill-in preview shows stale clipboard | No |
| 5 | Candidate: search results split by group | No |
| 6 | Candidate: pins re-sorted by use count | No |

## Run G isolation notes

Clean clone verified before copying: one ref (`refs/tags/bench-2`), 106
commits all reachable from HEAD, no fix commit in `git log --all`, no
findings file, 42 tests passing. Each contestant got its own copy; the
copies were deleted after the runs.

**Harness leak, not fixed.** Every subagent spawned from the orchestrator's
session receives the orchestrator's own git status block in its system
context: the dev repo's branch, dirty files, and its five most recent
commit subjects. On 2026-09-17 those five were the fixes for candidates 11,
9, 8, 7 and 12. Every run-G contestant therefore opened with the same
five-item shortlist and spent its first messages guessing them; G2's
reasoning literally called it "the fix list", and G3 quoted the subject
"Draw the popup's Pinned section flat, in pinned order" at message 17. The
target's fix (`b1bf5a3`) is older than the five, so the target itself was
not leaked; the leak acted as five decoys that cost each contestant two to
seven messages. Runs D and E were spawned the same way and saw whatever the
dev HEAD's five recent subjects were then (the Ctrl+1..5 and lock fixes,
plus benchmark and merge commits), so the leak differs between editions and
confounds cross-run comparison. Fix for the next edition: run each
contestant as a separate `claude -p` process whose working directory is its
clone, so the injected git status is the clone's own; or commit nothing
descriptive to the dev repo between template build and run.

**Transcript file.** The orchestrator's scratchpad transcript was emptied by
a failed write mid-run (a non-ASCII character in a Windows code-page write
truncated the file before the exception). It was rebuilt from the
conversation record; the tables below are that reconstruction.

## Run G1: Fable 5.1 (bench-2, clean clone) — X = 18

| # | Agent message (condensed) | Answer |
|---|---|---|
| 1 | Candidate (cold): pack heading click drops search focus | No |
| 2 | Candidate: Pinned section split by group | No |
| 3 | In the manager rather than the popup? | No |
| 4 | Candidate: search results split by group | No |
| 5 | About the pasted or clipboard text rather than the popup's look or behaviour? | No |
| 6 | About popup open, close or focus rather than inside the popup? | No |
| 7 | Candidate: fill-in Ctrl+Enter re-opens the form (18) | No |
| 8 | Candidate: preview card covers the pointer on low rows, click swallowed (19) | No |
| 9 | On a secondary screen rather than the main list? | No |
| 10 | Does it involve the search box? | No |
| 11 | Candidate: collapsing a lower pack scrolls to top (21) | No |
| 12 | Does it involve the Tab action panel? | No |
| 13 | Something displayed wrongly on the list rather than a key or click response? | Yes |
| 14 | Candidate: pack heading count excludes pins (24) | No |
| 15 | Candidate: native tooltip overlaps the preview card (25) | No |
| 16 | Candidate: row titles at 16px, `text-ui` dropped by tailwind-merge (26) | No |
| 17 | Is something that should be there cut off or missing? | Yes |
| 18 | Candidate: a multi-tag prompt's row shows only its first tag as a pill; the other tags are missing, though the editor shows them and search matches them | **Yes** |

After confirmation it sent "DONE" (not counted). Its own recount said 20;
the true count is 18. Stated cause `tags.slice(0, 1)` in the row component
is correct.

Strategy: two cold guesses off the leaked shortlist, then a linear
bisection (manager, clipboard, open/close, secondary screens, search, action
panel, display, missing versus extra) that was sound but interleaved with
seven candidate guesses of real bugs it had found by building and driving
the app in its own profile. Those guesses were the whole gap to G2: the
bisection questions alone would have closed in about nine. It found more
new bugs than any other contestant (18, 19, 21, 24, 25, 26).

## Run G2: Fable 5.1 (bench-2, clean clone) — X = 16

| # | Agent message (condensed) | Answer |
|---|---|---|
| 1 | Candidate (cold): pack header click steals search focus | No |
| 2 | Candidate: Pinned section split by group | No |
| 3 | In the manager rather than the popup or disk? | No |
| 4 | In the popup itself rather than the JSON files? | Yes |
| 5 | Candidate: search results split by group | No |
| 6 | Candidate: fill-in preview shows stale clipboard | No |
| 7 | Candidate: pins re-sorted by use count (17) | No |
| 8 | Candidate: Ctrl+digit fill-in then Enter pastes the highlighted row instead (18) | No |
| 9 | Already wrong in what the popup first displays on open? | Yes |
| 10 | Candidate: popup reopens still scrolled down (20) | No |
| 11 | About position or size rather than contents? | No |
| 12 | About appearance or layout rather than which prompts are listed or highlighted? | Partially |
| 13 | About how individual rows are drawn rather than headers or grouping? | Yes |
| 14 | About the row's text rather than its tag pill, icon, badges or highlight? | No |
| 15 | About the row highlight rather than the tag pill, icon or badges? | No |
| 16 | Candidate: a prompt with several tags shows only one pill, the first tag; the others are not shown, while the manager shows them all | **Yes** |

After confirmation it sent "DONE" (not counted). Stated cause correct.

Strategy: no location question until message 3, and seven cold candidates in
the first eight messages (five from the leaked shortlist, plus the grouped
search results and the pin order). From message 9 it switched to a pure
bisection (at open, position, appearance versus listing, rows versus
headers, text versus adornments, highlight versus pill) and landed the
target on its first candidate after that. The Partially at message 12 was
read correctly. Its bisection tail of eight messages is the best in the
edition; its opening is the worst.

## Run G3: Fable 5.1 (bench-2, clean clone) — stopped at 22, unconfirmed

| # | Agent message (condensed) | Answer |
|---|---|---|
| 1 | In the popup rather than the manager or disk? | Yes |
| 2 | Candidate: grouped rows split in Pinned and Results | No |
| 3 | Candidate: pack header click steals search focus | No |
| 4 | Candidate: fill-in preview shows stale clipboard | No |
| 5 | Does reproducing require typed search text? | No |
| 6 | Does reproducing require the mouse? | No |
| 7 | Does it concern what happens outside the popup? | No |
| 8 | Candidate: Ctrl+N Enter on the Pack/Group dropdown does not save (22) | No |
| 9 | Candidate: fill-in field does not grow after Shift+Enter (23) | No |
| 10 | Candidate: pins re-sorted by use count (17) | No |
| 11 | Candidate: copy-only submit re-opens the fill-in form (18) | No |
| 12 | Does the popup fail to appear or vanish? | No |
| 13 | On the main list screen rather than a sub-screen? | Yes |
| 14 | Candidate: pin/unpin from the panel leaves the highlight on another prompt (28) | No |
| 15 | Candidate: popup reopens scrolled down (20) | No |
| 16 | Candidate: hint bar clips at 125% scale (29) | No |
| 17 | Candidate: new pin slotted alphabetically, not appended (17) | No |
| 18 | Candidate: popup opening under a resting pointer steals the selection (32) | No |
| 19 | Does reproducing require a prior manager action (tagging, grouping, ...)? | Yes |
| 20 | Candidate: abandoned empty "New prompt" draft listed in the popup (33) | No |
| 21 | Is the manager action a Settings change rather than a prompt/pack change? | No |
| 22 | Candidate: popup Pinned order ignores the manager's custom sort (17) | No |

Stopped by the human at 22. Strategy: good opening (location, typed text,
mouse, outside/inside) but then twelve candidate guesses against seven
questions, including three framings of the same pin-order bug (10, 17, 22).
It never asked the display-versus-behaviour or missing-versus-extra
questions that carried G1 and G2 home, and at message 19 it listed "only the
first tag shown per row" among its remaining options without asking about
it. Most productive bug-finder after G1: 22, 23, 28, 29, 32, 33 are its.

## Run GS: Sonnet (bench-2, clean clone) — stopped at 13, unconfirmed

| # | Agent message (condensed) | Answer |
|---|---|---|
| 1 | Factual question: does pasting a pin change its Ctrl slot? (true) | Yes |
| 2 | "DONE" with a root-cause write-up, no candidate description | Can't answer as asked |
| 3 | Candidate: pins re-sorted by use count (17) | No |
| 4 | Factual question: does "debug, urgent" become one tag in the editor? (true) | Yes |
| 5 | "DONE" again, no candidate description | Can't answer as asked |
| 6 | Candidate: editor tag box merges a comma pair (27) | No |
| 7 | Candidate: pack header click steals search focus | No |
| 8 | Candidate: manager toast says "1 prompts" (30) | No |
| 9 | Candidate: a typed "u" after a popup delete triggers Undo (31) | No |
| 10 | In the manager rather than the popup? | No |
| 11 | Is the pasted text wrong rather than search, sorting, focus or display? | No |
| 12 | About the popup window's position, size or timing? | No |
| 13 | Factual question premised on the popup staying open after a copy (it hides after 600 ms) | Can't answer as asked |

Stopped by the human at 13. Strategy: it asked "does the app do X?" about a
bug it had found, read the truthful Yes as a confirmation, and declared DONE
twice; each cost a point and a further point to resend as a candidate. It
then guessed four more real-but-wrong bugs before asking its first location
question at message 10. Its questions from 10 on were reasonable splits.

## Run G score table

| Contestant | Model | X | Cold candidates before first split | Candidates total | Partially | Root cause |
|---|---|---|---|---|---|---|
| G2 | Fable 5.1 | 16 | 2 | 8 | 1 | correct |
| G1 | Fable 5.1 | 18 | 2 | 9 | 0 | correct |
| G3 | Fable 5.1 | stopped at 22 | 0 | 12 | 0 | not reached |
| GS | Sonnet | stopped at 13 | 1 (plus two DONEs) | 6 | 0 | not reached |
| E (ref.) | Opus | 10 | 0 | 1 | 0 | correct |
| D (ref.) | Sonnet | 19 | 3 | several | 2 | not offered |

The three Fables shared one failure mode: each built and drove the app in
its own profile, found a real bug, and spent a message on it as a candidate
instead of continuing to split the space. G1 and G2 recovered by switching
to bisection (G2 from message 9, G1 throughout but interleaved); G3 never
did and cycled the same pin-order bug three times. Against run E's Opus
(10, pure bisection, one candidate), the best Fable is six messages worse,
and the whole gap is candidate guesses: G2's eight bisection questions from
message 9 to 16 are as tight as Opus's ten. The five-commit harness leak
explains the first two to five guesses of every Fable but not the later
ones, which came from their own harnesses. The compensating result is
sixteen new filed candidates (18–33) from this edition, six of them since
fixed on `fix/bug-hunt-3`. Sonnet's run is not comparable with run D: it
used a different tactic (factual questions read as confirmations) and was
stopped early.

## Release 0.2.5

`fix/bug-hunt-3` was rebased onto master (`077b1d6`, which had merged its
first four commits as `4a9ffa8`) and tagged `v0.2.5` at `d69fccf`. Installers
built from that commit: `Promptline_0.2.5_x64-setup.exe` (NSIS) and
`Promptline_0.2.5_x64_en-US.msi` under `src-tauri/target/release/bundle/`.
Fixed in this release beyond the four already on master: candidates 6, 20,
21, 22, 23, 24, 26, 27, 28, 29, 31, 32, 33 and the Alt+F4 popup-destroy
note (`3d4b3c4`). Not fixed: nothing filed remains open at `d69fccf`.

---

# Edition bench-3

Commit under test: `4af6015a4a77423c32a8eec5f6d3b1a520a99906` (`4af6015`, tag
`bench-3`), run on 2026-09-21. Candidates 34–43 and runs H1–H3 below are
against that commit. Unlike bench-2, this commit carries this findings file
and the benchmark file, so every contestant could read candidates 1–33 and
the bench-2 target; none of those describe the bench-3 target.

## Target bug (bench-3; unredacted after the runs)

**Trigger.** Clean profile. In the manager, create a pack with "New pack"
(name it, Enter). Click "New prompt": the draft lands in a freshly created
"My prompts" pack, not the pack just created (debatable, but the documented
rule: no last-saved pack yet, so the default pack). In the editor, change the
draft's pack to the pack created first.

**Symptom.** "My prompts" stays in the sidebar and the Library view as an
empty pack, "(0)", even though it was only conjured to hold that one draft
and now holds nothing. It never goes away on its own.

**Code check.** Confirmed. `add_snippet` calls the pack-backing pass in
`src-tauri/src/lib.rs:385-405`: a pack that "exists only as a name on a
prompt" gets a real `PackMeta` and a file the moment the draft is written.
`packNames` (`src/lib/library.ts:25-34`) unions declared metadata with
referenced names, and the sidebar seeds a section for every declared pack
(`src/manager/Sidebar.tsx:112-114`), so the declared, now-empty "My prompts"
is drawn forever. Moving the draft out and the startup sweep of an abandoned
draft (Opus's message 14) leave the same residue. Fix shape: do not declare a
pack for an empty "New prompt" draft until the draft is kept, or undeclare a
pack that was auto-created for a draft when its last prompt leaves. Status:
fixed on the working tree on 2026-09-21: an empty draft references no pack
for backing (`packs_in_play`, `is_empty_draft` in src-tauri/src/lib.rs), so the
default pack is declared by the first save that gives the draft a body or a
title; unit-tested, documented in BEHAVIOR.md.

## Candidates reported by agents (bench-3)

## 34. Folding a group in the popup throws the selection back to the top (Sonnet, message 2)

Verdict: No (not the target). Trigger: in the popup browse list, fold or unfold a group (click its sub-header or Left on one of its rows) with the selection lower in the list. Symptom: the highlight, and with it the scroll, jumps to the first row of the whole list; folding a pack keeps the selection by the toggled section. Stated cause: the selection-keeping fix for pack collapse (candidate 21) was never applied to group collapse.
Code check: confirmed. `toggleCollapsedGroup` in src/popup/App.tsx:195-207 ends with `setSel(0)`, while `toggleCollapsed` (packs, line 181-194) sets `pendingAnchor.current = { pack, expanding }` and lets the effect at line 552 land the selection. Fix shape: set an anchor for the group (first row of the group when expanding, first row after it when collapsing) instead of `setSel(0)`. Status: fixed on the working tree on 2026-09-21: popup group folds now anchor the selection like pack folds (src/popup/App.tsx).

## 35. Library view cards show the literal `{clipboard}` in their body excerpt (Sonnet, message 3)

Verdict: No (not the target). Trigger: open the manager's Library view with a prompt whose body contains `{clipboard}`. Symptom: the card's three-line excerpt prints the placeholder verbatim, while BEHAVIOR.md ("Previews show the clipboard, not the word 'clipboard'") says every preview substitutes the current clipboard on the builtin tint. Stated cause: the card renders the raw body.
Code check: confirmed as a rule-vs-code gap. `PromptCard` in src/manager/Library.tsx:194-196 renders `s.text.replace(/\s+/g, " ")` with no `clipboardPreview` pass; the editor and popup previews do substitute. Whether a 3-line card excerpt should expand the clipboard is a judgement call (it is a tinted placeholder elsewhere), so fix shape is either to run the excerpt through the shared preview renderer or to exempt cards in BEHAVIOR.md. Status: fixed on the working tree on 2026-09-21: Library cards run the excerpt through the shared tokeniser with the clipboard on the builtin tint (src/manager/Library.tsx).

## 36. Escape on a context menu also switches the manager between prompt view and Library view (Fable, message 2)

Verdict: No (not the target). Trigger: in the manager, open a right-click or three-dot menu on a prompt, pack or group and press Escape. Symptom: the menu closes and the manager also switches mode: prompt view jumps to the Library view, Library view drops back to the prompt view. Stated cause: the menu's Escape handling does not stop the manager's mode-switch handler.
Code check: confirmed by listener order. The manager's Escape handler (src/manager/App.tsx:371) is a document keydown listener that only skips when `e.defaultPrevented` or a `[role="dialog"]` is open; the menu's listener (src/manager/ctx-menu.tsx:68-73) is also on document and calls `preventDefault`, but it is registered when the menu opens, so it runs after the manager's listener, which was registered at mount and re-registered only when `settingsOpen`, `view.kind` or `activeId` change. Fix shape: have the manager's handler also return when a `[role="menu"]` is present, or register the menu's listener in the capture phase. Status: fixed on the working tree on 2026-09-21: the manager's Escape handler also yields to an open [role="menu"] (src/manager/App.tsx).

## 37. A collapsed pack or group comes back expanded after a rename (Sonnet, message 7)

Verdict: No (not the target). Trigger: collapse a pack (or a group) in the manager sidebar, then rename it. Symptom: the renamed pack or group reappears expanded; its collapsed state is lost. Stated cause: collapsed state is keyed by the name string and a rename never migrates the entry.
Code check: confirmed. `collapsed` and `collapsedGroups` in src/manager/Sidebar.tsx:55-56 are name-keyed sets persisted to localStorage; the rename paths (lines 326 and 491 call `renameGroup`/`renamePack` from the manager API) touch neither set, and the stale entry stays under the old name. Fix shape: on rename, move the old key to the new one in both sets (and in the popup's `popupCollapsedPacks`/`popupCollapsedGroups`, which have the same shape). Status: fixed on the working tree on 2026-09-21: renames carry the fold keys over, in the sidebar and the popup's stored keys (src/manager/Sidebar.tsx).

## 38. A pack created while the sidebar filter is active is not listed until the filter is cleared (Sonnet, message 15)

Verdict: No (not the target). Trigger: type into the sidebar's "Filter prompts…" box, then click "New pack" and name it. Symptom: the toast says the pack was created but no section for it appears until the filter is cleared. Stated cause: under a filter the sidebar lists only packs holding a matching prompt.
Code check: behaviour confirmed, intent debatable. src/manager/Sidebar.tsx:112-114 seeds empty packs as sections only when no filter is typed (`if (!q)`), by design so a filter shows matches only; an empty new pack therefore has no section under a filter. Fix shape, if wanted: clear the filter when a pack is created, or seed the just-created pack regardless of `q`. Status: open, not fixed (repository frozen for the benchmark).

## Target-adjacent: Opus message 14: empty "My prompts" left behind after the swept draft

Verdict: Partially. Symptom matches the target (a permanent empty default-pack section the user never created, conjured by New prompt); the trigger given is the draft being swept rather than the prompt being moved to another pack. Code check: the same cause covers both triggers. `add_snippet` (src-tauri/src/lib.rs:385-405) declares the draft's pack into `config.packs` with a file the moment the draft is created; neither a later move nor the sweep of the abandoned draft undeclares it. So the swept-draft path is a real second trigger of the same bug.

## 39. "New pack" accepts a name that differs from an existing pack only by letter case (Sonnet, message 20)

Verdict: No (not the target). Trigger: create a pack whose name matches an existing one except for case (or, per the candidate, surrounding spaces). Symptom: two packs that read the same. Stated cause: the duplicate check is an exact string match.
Code check: half confirmed. The whitespace half is refuted: the sidebar input trims before calling `addPack` (src/manager/Sidebar.tsx:614). The case half holds: `addPack` (src/manager/App.tsx:238) rejects only an exact `packNames().includes(name)` hit, and `create_pack_file` in lib.rs has no case-insensitive check, so "General" and "general" coexist as two packs; on Windows their pack files would also collide by name unless `new_pack_file` suffixes. Fix shape: compare names case-insensitively in `addPack` (and in the Rust rename path, which has the same exact-match test at lib.rs:963). Status: fixed on the working tree on 2026-09-21: pack names are compared case-insensitively in addPack, the rename menu and rename_pack_in (src/manager/App.tsx, src/manager/menus.tsx, src-tauri/src/lib.rs).

## 40. An abandoned empty "New prompt" draft stays listed in the sidebar and Library view (Fable, message 12)

Verdict: No (not the target). Trigger: click New prompt (or "+ prompt" in the Library view) and leave the draft untouched. Symptom: the empty draft stays as a sidebar row and an "(empty)" Library card. 
Code check: refuted as a defect, documented behaviour. BEHAVIOR.md "The manager sweeps abandoned drafts at startup" says the draft is a real prompt the editor autosaves into and is deleted when the manager next starts; the popup already hides it (`isEmptyDraft`). Same family as candidates 9 and 33. Fix shape, if the design changes: sweep on leaving the editor rather than at startup. Status: by design, no fix.

## 41. Editor keeps the previous prompt's title and body after "New prompt" (Sonnet, message 22)

Verdict: No (not the target). Trigger: with a prompt open in the editor, click New prompt. Claimed symptom: the editor still shows the old title and body while the sidebar selects the new draft. Stated cause: no `key` prop on the editor, so React reuses the instance and its `useState(snippet.title)` never resets.
Code check: refuted. The editor is mounted as `<Editor key={activeId ?? "none"} />` (src/manager/App.tsx:456), so a new active id remounts it with fresh state; Sonnet read the `useState` initialisers in Editor.tsx:228-233 without checking the call site. Status: not a bug.

## Target-adjacent: Sonnet message 23: New prompt filed under an unchosen pack

Verdict: Partially. It names the setup half of the target (with a pack just created, New prompt lands in the default "My prompts" rather than the new pack, which the human called debatable but expected) and stops before the symptom (the empty "My prompts" left behind after the prompt is moved). Code check: `newPrompt` in src/manager/App.tsx:208 uses `defaultPackFor`, which prefers the last pack saved into (`localStorage.lastPack`) and otherwise the default pack; in a clean profile there is no last pack, so a just-created pack is never chosen. Documented in BEHAVIOR.md, so by design at this commit.

## 42. The sidebar does not scroll a newly created prompt or pack into view (Sonnet, message 26)

Verdict: No (not the target). Trigger: with a sidebar list longer than the window, click New prompt or New pack so the new row lands outside the visible area. Symptom: the list does not scroll to it; the editor opens the draft but the row must be found by hand. Stated cause: the popup scrolls its selected row into view, the sidebar has no equivalent.
Code check: confirmed by absence. src/manager/Sidebar.tsx and src/manager/App.tsx contain no `scrollIntoView` or `scrollTo` call; the popup does scroll its selection. Fix shape: after `newPrompt`/`addPack`, scroll the row for the new id (or the new pack header) into view. Status: fixed on the working tree on 2026-09-21: the sidebar scrolls the active row and a just-created pack into view (src/manager/Sidebar.tsx).

## Target-adjacent: Fable message 19: sidebar New prompt takes the pack of the last edited prompt

Verdict: Partially. Same setup half as Sonnet's message 23: the sidebar's New prompt uses `defaultPackFor`, which follows `localStorage.lastPack` (set by the editor on save, so "the pack of the prompt you last typed in") rather than the pack that last received a new prompt or the just-created pack. Documented in BEHAVIOR.md; no leftover-pack symptom named.

## Target-adjacent: Fable message 22: sidebar New prompt ignores packs filled by other routes

Verdict: Partially. Third variant of the setup half: `lastPack` is written only by the editor's save path, so a pack filled by "+ prompt", import or generate never becomes the sidebar New prompt's default and the draft goes to "My prompts". True and documented; the leftover empty pack is still not named.

## Target-adjacent: Fable message 23: New prompt not created in the pack currently open

Verdict: Partially. Fourth restatement of the setup half; see message 19.

## Target-adjacent: Fable message 25: a freshly created pack does not receive the next New prompt

Verdict: Partially. Exact trigger setup of the target (New pack, then New prompt) with the expected half as the symptom; the leftover empty "My prompts" after moving the prompt is still unnamed. Fifth restatement.

## 43. (refuted) New pack disappears after New prompt (Sonnet, message 29)

Verdict: No. Code check: refuted. `packNames` (src/lib/library.ts:25-34) unions declared metadata with every pack referenced by a prompt, and the sidebar seeds a section for each name when no filter is typed (src/manager/Sidebar.tsx:112-114); nothing in `newPrompt` removes or hides a pack. Status: not a bug.

## Target-adjacent: Fable message 26: New prompt conjures a "My prompts" pack out of nowhere

Verdict: Partially. Now names the auto-created default pack (the other half of the target's setup) but with the draft still in it; the leftover empty pack after the prompt leaves is still unnamed. Sixth candidate on the theme.

## Target-adjacent: Fable message 27: sidebar New prompt ignores the pack you work in

Verdict: Partially. Seventh restatement of the setup half.

## Run H isolation notes

Each contestant was a separate `claude -p` process (`--output-format json`,
`--dangerously-skip-permissions`, `--resume <session>` for every turn after
the first) whose working directory was its own `robocopy /MIR` copy of the
template clone (`--branch bench-3 --single-branch --no-tags`, one ref, 162
commits all reachable from HEAD, `node_modules` installed). The orchestrator
session's git status is therefore not injected: the five-commit shortlist
leak of runs D–G is closed. Two remaining exposures: the committed findings
file (above), and `--dangerously-skip-permissions` lets a contestant read
the development checkout if it goes looking; none did. Opus left a mock
harness and an `http.server` outside the repo, Fable a Vite dev server;
both were stopped and the copies deleted after the runs.

Contestants were stopped at 30 messages if unconfirmed.

## Run H1: Opus (bench-3, clean clone) — X = 15

| # | Agent message (condensed) | Answer |
|---|---|---|
| 1 | Bug is in the manager window rather than the popup? | Yes |
| 2 | Requires the library view rather than sidebar+editor? | No |
| 3 | In the editor pane rather than the sidebar list? | No |
| 4 | Involves pack/group header rows rather than prompt rows? | Yes |
| 5 | Symptom is in what a header shows (label/count/extra element) rather than click/key response? | Yes |
| 6 | Header text (name/count) wrong rather than styling or a control? | No |
| 7 | Control missing from/extra on header rather than styling? | No |
| 8 | Is the wrong styling visible on an ordinary short-named header at default settings? | Can't answer as asked |
| 9 | Is it about which headers appear at all (one extra or one missing)? | Yes |
| 10 | Is a header missing rather than an extra one showing? | No |
| 11 | Is the extra one a pack header rather than a group sub-header? | Yes |
| 12 | Is the extra pack section an empty one, (0) with no prompts? | Yes |
| 13 | Did the empty pack appear on its own, never created by you? | Yes |
| 14 | CANDIDATE: empty "My prompts" (0) left behind permanently after New prompt conjures it and the draft is swept | Partially |
| 15 | CANDIDATE: empty "My prompts" (0) left behind after New prompt conjures it and the prompt is moved to the wanted pack or goes away | Yes (X = 15) |

After confirmation it sent "DONE" (not counted). Stated cause correct
(`defaultPackFor` returns the default pack without checking it exists, the
Rust backing pass conjures metadata, the sidebar draws every declared pack).

Strategy: pure bisection with no cold candidate, reading every diff since
the last release before message 1. Messages 6–8 were lost in a "styling"
branch after two literal No answers (the extra header is not a wrong label,
count, control or style, and the human answered the question as asked);
message 8 was the edition's only Can't answer as asked. From message 9 it
recovered in one move ("which headers appear at all") and reached the
symptom by 13. Its first candidate (14) had the right symptom and a real but
different trigger (the swept draft); the second widened the trigger to
"once that prompt is no longer in it" and was confirmed.

## Run H2: Sonnet (bench-3, clean clone) — stopped at 30, unconfirmed

| # | Agent message (condensed) | Answer |
|---|---|---|
| 1 | Popup row shows only first tag pill for multi-tag prompt (bench-2 target) | No |
| 2 | CANDIDATE: popup group fold resets selection/scroll to first row | No |
| 3 | CANDIDATE: Library card preview shows literal {clipboard} | No |
| 4 | Bug in the popup rather than the manager? | No |
| 5 | In the editor pane rather than sidebar/library/generate/settings? | No |
| 6 | In the manager sidebar rather than library/generate/settings? | Yes |
| 7 | CANDIDATE: collapsed pack/group comes back expanded after rename | No |
| 8 | Involves press-and-hold drag reordering in the sidebar? | No |
| 9 | Involves multi-select or a right-click multi-select action? | No |
| 10 | Involves inline rename of a pack or group? | No |
| 11 | Involves collapsing/expanding a section (fold chevron)? | No |
| 12 | Involves locking/unlocking a pack? | No |
| 13 | Involves filter box, Order by, or Group-by-pack toggle? | No |
| 14 | Involves the New prompt or New pack button? | Yes |
| 15 | CANDIDATE: new pack created under an active filter is hidden until filter cleared | No |
| 16 | New pack specifically, as opposed to New prompt? | Partially |
| 17 | New prompt lands in a pack other than expected (not the just-created one)? | Partially |
| 18 | New prompt files into last-saved pack rather than the selected one? | Partially |
| 19 | Part of the bug about which group the new prompt lands in? | No |
| 20 | CANDIDATE: New pack allows a case/whitespace-variant duplicate | No |
| 21 | Happens on plain first-time use of New prompt/New pack, no precondition? | Yes |
| 22 | CANDIDATE: editor keeps previous prompt title/body after New prompt (no key prop) | No |
| 23 | CANDIDATE: New prompt filed under an unchosen pack with no indication | Partially |
| 24 | Is the bug broadly about WHERE a new prompt/pack is filed? | No |
| 25 | About the buttons appearance rather than what happens after clicking? | No |
| 26 | CANDIDATE: sidebar does not scroll to reveal a newly created prompt/pack | No |
| 27 | Specifically about New prompt, not New pack? | Partially |
| 28 | Requires New pack and New prompt together in sequence? | Yes |
| 29 | CANDIDATE: newly created pack disappears/hidden after New prompt | No |
| 30 | New prompt first, then New pack? | No — run stopped at 30, unconfirmed |

Strategy: opened by guessing the bench-2 target straight out of this file,
then two more cold candidates before any location question. From message 4
it bisected to the sidebar in three moves, then walked sidebar features
linearly (drag, multi-select, rename, fold, lock, filter) for eight messages
before landing on New prompt/New pack at 14. It then alternated candidates
with narrow questions and never asked what remains after the prompt moves;
its closest candidate (23) was the expected setup half. Nine candidates,
six of them real bugs filed above (34, 35, 37, 38, 39, 42), two refuted
(41, 43).

## Run H3: Fable 5.1 (bench-3, clean clone) — stopped at 30, unconfirmed

| # | Agent message (condensed) | Answer |
|---|---|---|
| 1 | Bug in the manager window rather than the popup? | Yes |
| 2 | CANDIDATE: Escape on a context menu also toggles prompt view / Library view | No |
| 3 | Shows in the Library view rather than sidebar/editor/settings/dialogs? | Partially |
| 4 | Shows in both the sidebar and the Library view? | Yes |
| 5 | Triggered by a context-menu action rather than without a menu? | No |
| 6 | Involves inline renaming of a pack or group? | No |
| 7 | About listing order rather than count/icon/folding/looks? | No |
| 8 | Something displayed wrongly/missing on a header, row or card rather than a click/key response? | Partially |
| 9 | Involves folding/unfolding a pack or group? | No |
| 10 | Involves pinning? | No |
| 11 | Involves creating a new prompt (New prompt button / draft)? | Yes |
| 12 | CANDIDATE: abandoned empty New prompt draft stays listed in sidebar and Library | No |
| 13 | Involves the new prompt title text? | No |
| 14 | New prompt lands under a different pack/group than expected? | Partially |
| 15 | Is it the group that goes wrong (right pack, wrong group)? | No |
| 16 | Position of the new prompt within its pack rather than which pack? | No |
| 17 | New prompt row not visible where it should be, rather than visible in a wrong place? | No |
| 18 | Sidebar New prompt button files into unexpected pack while Library + prompt files where clicked? | Partially |
| 19 | CANDIDATE: sidebar New prompt picks the pack of the last edited prompt, not where one was last created | Partially |
| 20 | Unexpected pack is the last-edited prompt pack rather than default My prompts? | No |
| 21 | Is the pack the new prompt lands in the default My prompts? | Yes |
| 22 | CANDIDATE: sidebar New prompt ignores packs filled by other routes, draft goes to My prompts | Partially |
| 23 | CANDIDATE: sidebar New prompt does not create in the pack you are currently in, goes to My prompts | Partially |
| 24 | Requires first creating a prompt in pack X via Library + prompt, then sidebar New prompt? | No |
| 25 | CANDIDATE: freshly created pack does not receive the next New prompt, draft goes to My prompts | Partially |
| 26 | CANDIDATE: New prompt resurrects/conjures a My prompts pack out of nowhere holding the draft | Partially |
| 27 | CANDIDATE: sidebar New prompt ignores the pack you work in, draft always in My prompts | Partially |
| 28 | Involves a locked pack? | No |
| 29 | Involves saving from the popup with Ctrl+N first? | No |
| 30 | Expected pack is the one open in the Library view just before? | No — run stopped at 30, unconfirmed |

Strategy: 88 tool turns before message 1 (built and drove the app), then a
clean bisection opening. Messages 5–10 and 13–17 were feature walks with one
No each. It reached "creating a new prompt" at 11 and "the default My
prompts pack" at 21, then spent seven candidates (19, 22, 23, 25, 26, 27
and the sweep at 12) restating the setup half — which pack the draft goes
to — each answered Partially, without once asking what the auto-created
pack does after the draft leaves it. Two real bugs filed (36, 40 is by
design).

## Run H score table

| Contestant | Model | X | Cold candidates before first split | Candidates total | Partially | Root cause | Cost (USD) |
|---|---|---|---|---|---|---|---|
| H1 | Opus | 15 | 0 | 2 | 1 (plus 1 Can't answer) | correct | 25.16 |
| H2 | Sonnet | stopped at 30 | 3 | 9 | 5 | not reached | 8.53 |
| H3 | Fable 5.1 | stopped at 30 | 0 | 9 | 10 | not reached | 23.44 |

Opus won by the same method as run E: bisection only, no candidate until
the symptom was pinned, and a widened second candidate after a Partially.
Sonnet and Fable both reached the right feature (New prompt, the default
pack) and then failed the same way: a Partially on a candidate that named
the setup half was read as "close, restate it" rather than "half right,
find the other half", so both cycled restatements. Fable's ten Partially
answers were all on that theme. The harness leak fix worked (no contestant
mentioned a dev-repo commit), but the committed findings file gave Sonnet
its first guess for free. Next edition: keep the findings file out of the
benchmark commit, or accept that contestants start with a 33-item exclusion
list.
