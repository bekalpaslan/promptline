# Bug hunt findings

Candidate bugs reported by agents under [`BUG-HUNT-BENCHMARK.md`](BUG-HUNT-BENCHMARK.md).
One entry per candidate. `Verdict` is the human's answer to the description;
`Code check` is a separate confirmation of whether the described behaviour and
stated cause hold up in the source, independent of whether it was the target bug.

Commit under test: `b36d67e` (plus uncommitted README and benchmark files).
Fixes for candidates 1–6 and the target are on branch `fix/bug-hunt`
(`8cae48f`…`28448bc`, seven commits); candidates 7–9 are not on it.

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

**Status:** fixed on branch `fix/bug-hunt` in `b1bf5a3` (up to three pills
plus a "+N" overflow pill whose title lists the rest).

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

**Status:** open, not fixed (not on the fix branch).

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

**Status:** open, not fixed.

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

**Status:** open, not fixed (not on the fix branch).

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

**Status:** open, unverified.

---

# Runs

| Run | Contestant | X | Valid | Notes |
|---|---|---|---|---|
| A | external agent (relayed by the human) | 10 | mostly | three either/or questions answered non-strictly |
| B | Sonnet | 17 | yes | strict answers throughout |
| C | Opus | 3 | no | read the findings file, captured the human's screen; see below |

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

