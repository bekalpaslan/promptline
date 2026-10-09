# How Promptline behaves

A reference for anyone working on the code: what each surface does, and *why*
the non-obvious parts are the way they are. The README describes the app for
people using it; this describes it for people changing it.

Nothing here is a specification to conform to — it documents decisions already
made. Where a decision has a trap behind it, the trap is written down.

## Shape

Two webview windows and a tray icon, over one Rust core.

| Surface | Entry | Role |
|---|---|---|
| **Popup** | `popup.html` → `src/popup/` | The daily surface. Summoned by hotkey at the cursor, gone in a keystroke. |
| **Manager** | `index.html` → `src/manager/` | Editing, organising, settings. Opened by left-clicking the tray. |
| **Tray** | `lib.rs` | Left-click opens the manager; the menu opens it, quits, and offers *Update to X.Y.Z* when a newer release is waiting. Reuses `default_window_icon()`, so it needs no asset of its own. |

Both windows are one Vite build sharing `src/index.css`, `src/lib/`, and
`ui/core.js`. They are separate OS windows with separate JS contexts — they
share nothing at runtime except the files on disk and Tauri events.

`ui/core.js` is deliberately a plain UMD module rather than TypeScript: it holds
the pure logic (tokenizing, fuzzy scoring, pack parsing) and is covered by
`tests/core.test.js` running under bare `node --test`, with no build step in the
way. `src/lib/core.ts` bridges it into React.

**The sidebar never leaves the manager.** It is the library as a tree,
and whatever is selected in it fills the pane beside it: a prompt opens in
the editor, and a pack or group title shows its **overview** — the prompts
it holds as preview cards (a pack's ungrouped prompts, then each group under
a heading that opens that group), with the clipboard substituted as in every
preview. Clicking a title selects it the way clicking a row selects a
prompt, and opens it in the tree if it was folded, so the sidebar never
hides the rows the pane is showing; the chevron folds without selecting
(← and → from the keyboard, Collapse all from Display), and a double-click
renames. Until 0.2.19 the click folded and unfolded as well, like a folder
in a file tree, which took a pack's rows out of the sidebar on the most
common click in the window and cost a re-expand before the next prompt.
A search holds every fold open, so there the click only selects. An empty
library says so under New ("No packs yet. New makes one."), and an empty
pack's overview puts its one action, New prompt, beside the words rather
than at the heading's far right. The overview has no folds of its own and no mode to leave: a card
click opens that prompt, and the copy button in its corner (or Ctrl+C on a
focused card) copies it without opening it: the clipboard and saved config
values in, {date} and {time} expanded, as the popup's copy would, and
fill-in fields left as typed, which the toast counts ("fill in 2 fields
where you paste it") since the manager has no form to ask for them (core's
`expandForCopy`). The clipboard is read at the click, so copying the same
card twice never wraps the first copy. The editor's Prompt panel has the
same Copy at the right of its heading, copying what is in the field now,
unsaved edits included (`src/manager/copy.ts`, one copy for both). In the
sidebar's One list display there are no pack titles to select, so the
overview is of every prompt ("All prompts", in the list's order, each card
naming its pack and group, following the filter): switching to One list
turns an open overview into it, Escape reaches it from a prompt or from an
empty pane, and switching back to Packs returns the pane to the editor,
since that overview belongs to no pack. The editor's crumbs (pack, group)
open those overviews, and Escape goes up one level — from a prompt to its group (or
pack), from a group to its pack. This replaced a full-window library view
that hid the sidebar to draw the same tree a second time. The tree itself
(`packTree`) and the row order (`sortPrompts`) come from `ui/core.js`, one
shape for the sidebar and the overview so the two can't disagree. The
three-dot, right-click and Menu-key actions on packs, groups and prompts
are one hook too (`useLibraryMenus` in `menus.tsx`), with the inline
rename and the delete-group dialog it drives, so both surfaces offer the
same menu; only "Move up/down" is sidebar-only, since the overview's grid
has no row order to move within. Packs and groups move from that menu (and
Alt+Up/Down) only: a header is no drag handle, since its click is the
fold. Prompt rows still lift on press-and-hold, and the rows part for a
lifted row as it crosses them: the tree is drawn with the row where the
pointer would drop it, taking a group's label when it is among that
group's rows (`C.placePrompt`, the one rule the release saves with, so
what is on screen mid-drag is what the drop does), and the rows slide into
their places (`flip.ts`). Until 0.2.19 an insertion line marked the spot
instead. A lifted row is put back where it was, with nothing saved, when
the gesture breaks off rather than ends (Escape, the browser taking the
pointer, the window losing focus mid-drag): the release that came after
an Alt+Tab used to drop the row wherever the pointer had last been. An
overview follows a rename of its pack
or group; one whose group is gone shows the pack. The folds and the
inline-rename state are the manager's as well (`folds.ts`, `renaming` on
the API), not the sidebar's: a rename from either surface carries the
folds keyed by the old name, a prompt created anywhere unfolds the pack
and group it lands in, and a New → Pack begun on any surface opens the
new pack's name for typing in the overview it selects. Each surface used
to hold its own copy of that state, so a rename from the overview left a
fold behind under the old name and a group created there stayed hidden
under a folded pack.

**The sidebar is one tree to the keyboard.** The list is a `tree` and every
row a `treeitem` carrying its level, its fold state and whether it is
selected; one row is the tab stop (the last one focused, else the open
prompt, the shown pack or group, or the first row), and Up/Down and
Home/End move between rows, Right unfolds a pack or group or steps to its
first child, Left folds or steps out to the parent, Enter or Space is the
click (with Ctrl and Shift for the selection, and the fold on a pack or
group), Alt+Up/Down moves a prompt, a pack or a group, and the Menu key or Shift+F10 opens the row's menu at it. While a search
holds every fold open, Left and Right only move. The chevron and the three
dots are hidden from assistive tech, since those keys reach the same
actions, and a click on either keeps focus on the row. The rows used to be
`role=button` tab stops with real buttons nested inside: about a hundred
Tab presses to cross a library, no arrow keys, and a computed name that
read the chevron and the dots out along with the title.

Every field that commits on Enter (a rename, a new tag or field name, a
pack or group name typed into a menu) ignores the Enter that ends an IME
composition, which chooses the candidate (`commitKey` in `field.tsx`);
it used to commit half a Japanese or Chinese word.

**The tree tells its levels apart without colour.** A pack is a bold row
with a box icon, a group a medium row in the secondary ink, a prompt a
regular row; a group's prompts hang from a guide line under its header,
and counts sit at the right in mono. Group names show as typed: uppercase
is for the app's own section labels, never for names the user wrote. The
accent hue marks state (the selected pack or group, focus, a search hit),
not structure, per the design system's "ink first, hue second"; so the
`heading` tokens are ink colours. In the overview a group is a heading over
a hairline, not a panel, so it doesn't repeat its pack's look.

**The editor is the prompt and little else.** A crumb line says where
the prompt sits (pack › group, each crumb opening that overview) and
holds its use count, its pin and two menus: the crumb's chevron opens the
same Move-to menu a row's right-click does, with the prompt's own place
checked, and a ⋯ at the right opens the prompt's own menu, the one its
row's right-click opens (Pin, Move to, Add tag, Export, Delete), less
Move up and down, which only the sidebar has rows for. Under it the title
alone, at the heading size nothing else in the pane uses, then the text,
the tags, and the placeholders the text holds. Placement is the store's,
never a field of the autosave: the pack select and the free-text group
field went in 0.2.19, since a move written through the 600 ms debounce
could undo a move made from a menu meanwhile, and two controls for one
thing broke the one-indicator rule beside the selected row. Placeholders
are only what the text holds, each a chip of its kind with an inline ×
that takes the token out of the text (`removeParamToken`), plus one
"insert…" chip whose menu takes a typed name (`{{name}}` in braces for a
config parameter) and offers the built-ins and the library's field names
the text lacks; the three cards of "Advanced options" offered every name
in the library to a prompt that used one. Tags are the prompt's own as
chips with an ×, and a box that completes every other tag as it is typed.

**The editor autosaves, and says so in one place.** Every edit lands
through a 600 ms debounce (`update_snippet`, only the fields the editor
owns), and a caption at the tail of the title reads "Saving…" from the first
keystroke until the write lands, then "Saved" for two seconds. It is the
only feedback a successful save gets — a toast per save would fire on
every pause in typing — and a screen reader hears "Saved" once per landing
through a `role=status` region beside it, never the "Saving…". A failed
save is toasted by `updateSnippet`, so the caption only clears.

**The sidebar's width is the user's.** Its right edge is a handle (a
`separator`): drag it, or focus it and press ← / → (Shift for four times
the step, Home and End for the bounds); a double-click goes back to the
default, `clamp(13rem, 28%, 20rem)`. The width is kept in localStorage
(`sidebarWidth`, px) like the other view choices, written on release
rather than on every move, and clamped by `sidebarWidth` in core on every
render: never under the CSS floor of 13rem, never over 32rem or what
leaves the pane 18rem. The clamp is against the window as it is now, so
a wide sidebar dragged out in a maximised window gives the pane its room
back when the window shrinks, without forgetting the width it was given.

**The sidebar's filter is always there, and apart from the display.** The
field under the title takes the popup's syntax (`#tag`, `@pack`, `>group`,
then free-text words anywhere in the prompt: `matchesQuery` in core), with
Ctrl+F from anywhere in the manager and Escape clearing it. The
placeholder spells the grammar while the sidebar has room for it and
says "Filter" below 16rem (the window's minimum width, a large UI
scale), where it used to clip mid-word; the grammar stays in the tooltip.
Ctrl+N outside a field starts a draft where the pane is looking (the
shown pack or group, else the pack the last prompt went to), the popup's
Ctrl+N being the same key; New's menu stays the way to choose a place.
The filter is the manager's, not the sidebar's: while a query is set the
overview shows only its hits and says "2 of 12 match the filter" (a
group with no hits is left out), so the two views never disagree in one
frame, which they did until 0.2.19. The overview's title is set at the
heading size the editor's title uses, 18px at 600 (it was 20 at 700, the
largest text in a window capped at 18), with no "Pack" or "Group" label
above it, and one New prompt per overview: the pack's at its heading,
and a group's only when the group is what is shown; a group heading's ⋯
still offers New prompt in it.
Its filter
terms read as chips: the field is a plain input with transparent text over
a mirror that draws the same text, the terms on a ground and a hairline
(both drawn without padding, so the mirror lays out exactly like the input
and the caret stays where it belongs). While it holds text the tree opens
to its hits, a pack counts "hits / all", a pack without hits stays listed
but faded (so the tree keeps its shape), matched words are marked in
titles, and a line under the field counts them. A search
begun while a pack or group is shown stays inside it (a chip in the field;
its × or "N more elsewhere" widens it) and clearing the search drops the
scope. How the list is shown lives in the Display menu beside the field:
Packs or One list (each row then says where it lives), the order, and
collapse or expand all; a dot on the button means it is off the defaults
(packs, most used). The filter narrows the list the sidebar already
ordered; it never ranks, unlike the popup.

## The paste pipeline

The one flow everything else exists to serve. Hotkey to pasted text:

1. **`show_popup`** records the foreground window in `AppState.prev_window`
   *before* showing anything — once the popup takes focus, the window the user
   came from is unrecoverable.
   A hotkey press while the popup is already up — keyboard autorepeat while
   the keys are held, or a second tap — only re-focuses it. `RegisterHotKey`
   has no repeat suppression, and recording the foreground window on the
   repeat would make the popup its own paste target: Ctrl+V would land on a
   window that has just been hidden. Toggling the popup closed on a repeat is
   a possible follow-up (BACKLOG).
   A summon while the **manager** is the foreground window records no
   target at all (`paste_target` answers 0 for any of our own HWNDs): the
   user is editing prompt X, presses the hotkey to look at Y and hits
   Enter, and Y's text used to land in X's textarea, where autosave kept
   it. With no target, `paste_snippet` copies instead (below).
2. The popup is positioned at the cursor, then clamped to the *work area* of
   the monitor under the cursor — not its full bounds — so it can't open half
   off-screen or under the taskbar (`clamp_to_area`). The size it is
   clamped with is scaled to that monitor's DPI first: a hidden window
   keeps the DPI of wherever it last was and Windows rescales it on the
   move, so clamping with the old size on a 100% → 150% move left a third
   of the popup off-screen.
3. The user picks a prompt. If it needs runtime `{field}` values, the popup
   switches to form mode first, with every field empty. Nothing typed is
   kept: up to 0.2.9 the form pre-filled each field with its last value
   (`fieldValues`, marked "last used"), and a library written by those
   builds drops that key on its next save. Each field grows with its text,
   wrapped lines included, from one line to three, then scrolls; the fields and preview scroll together while the button stays
   in reach. An empty field is allowed and never silent, but quiet: its
   placeholder says it pastes nothing, the preview keeps its chip, and the
   button counts the empties. It used to be outlined in red, which shouted
   at every field of a form the user had only just opened. Enter in a field
   goes to the next field that is still empty and sends only when none is
   left ahead (`nextEmptyField`), and the hint bar says which: `↵ next
   field`, then `↵ paste`. Every field's Enter used to send, so the reflex
   Enter after the first value pasted "it broke between v0.2.18 and ." into
   the terminal. The step is forward only: a blank behind the caret was
   passed on purpose, and Enter from the last field sends with the blanks
   the button counted. Ctrl+Enter copies at once from any field, since it
   is asked for by name; Shift+Enter is still a newline. The field Enter
   moves to is scrolled in whole, with its label and its focus ring: at
   320×280 and a larger UI scale the scroller holds one field, and the
   next one arrived cut by the button. A form opened to copy (Ctrl+Enter
   or Ctrl+click on the row) reads `↵ copy` once, not `↵ paste · Ctrl ↵
   copy`.
4. **`paste_snippet`** reads the current clipboard, expands `{clipboard}`
   from it, writes the result to the clipboard, and only then hides the popup
   and bumps `uses`. The clipboard write comes first because it is the step
   that can fail (another program holding the clipboard open), and an error
   has to return to a window that is still on screen: the popup shows it in
   its feedback strip and nothing else happens. Copy-only (Ctrl+Enter) leaves
   the popup up for a moment to say `Copied "<title>" to clipboard` (named,
   so a copy can't be taken for another row's); the popup hides
   itself afterwards, and takes no pick in that moment (an Enter in those
   600 ms pasted what Ctrl+Enter had only copied). The command answers with a tag, `"pasted"` when the
   paste thread was spawned and `"copied"` when it fell back to copy-only
   (`paste_mode`): when the manager was the foreground window at summon
   time there is nothing sane to paste into (Enter would land the prompt in
   whatever editor field had focus), so Rust copies only and leaves the
   popup up, and the popup says "Copied to clipboard — the manager was in
   front" and hides itself the way Ctrl+Enter does. That self-hide is a
   600 ms timer the next summon cancels: a hotkey press inside the pause
   used to have the freshly shown popup hidden under the user. One pick at
   a time: the popup ignores a second Enter while a paste is in flight (the
   row stays tinted until the popup is hidden or the paste fails), because
   a fast double Enter used to run the command twice, two Ctrl+V and
   `uses` +2. The `uses` bump is best effort in both halves, the
   read as much as the write: the popup is already hidden by then, so an
   error would reach nobody, and a library a sync client or scanner is
   holding for a moment must not turn into a paste that never happens with
   the prompt sitting on the clipboard.
5. A detached thread waits 80 ms, calls `SetForegroundWindow` on the remembered
   window, waits another 80 ms, and sends Ctrl+V via `SendInput`. Both
   results are checked: a refused `SetForegroundWindow` (an elevated
   window, a foreground lock held by another process) sends no Ctrl+V at
   all, since it would land in whichever window is in front; that, or a
   `SendInput` that inserted fewer events than asked, brings the popup
   back where it was (`report_paste_failed`: shown and focused, without
   re-recording `prev_window`) and emits `paste-failed` to it with
   `{ "message": "Couldn't paste into that window. The prompt is on your
   clipboard: press Ctrl+V there to paste it yourself." }` (what failed,
   then the recovery, with the key named; the one-sentence version lost
   its second half to truncation at the default width); the popup shows it
   in its feedback strip as an error that stays until Esc or the next
   summon, and the prompt is still on the clipboard to paste by hand. It
   used to fail with nothing said. While that message is up the popup
   re-reads the clipboard, so the line under the search box says "Last
   pasted prompt" (it kept showing what had been copied before, beside a
   message saying the prompt is on the clipboard), and Enter only clears
   the message, like Esc: the hint bar reads `Ctrl V in the target · ↵ Esc
   dismiss`. Enter used to send the row again, into the window that had
   just refused it, and a `{clipboard}` row would have wrapped the prompt
   in itself. The Enter after that picks as usual. The guard is in
   `pick`, the one function every way of picking goes through, so a slot
   key, a click, the action panel and the card's Copy button obey it too:
   it was on Enter alone, and each of the others re-sent the row. One case
   still passes silently: UIPI drops input aimed at an elevated window
   without reporting it, so `SendInput` returns success there.

The sleeps are load-bearing. Focus changes are asynchronous on Windows; sending
the keystroke immediately delivers it to whatever had focus a moment ago.

**The prompt stays on the clipboard afterwards.** Ctrl+V only lands if the
target window has a focused text field, and nothing here can know whether it
did. Restoring the previous clipboard — which is what this used to do — meant a
missed paste left the user with nothing at all: no paste, and the prompt gone.
Leaving it there makes a miss recoverable by pasting manually. The cost is that
a `{clipboard}` template consumes its own source text, so firing two in a row
expands the second from the first one's output.

`send_ctrl_v` releases Shift, Alt and Ctrl before pressing Ctrl+V. The user may
still be physically holding the hotkey's modifiers, and a stray Shift turns the
paste into something else entirely.

**Search matches titles and tags fuzzily, bodies strictly.** `rankSnippets`
ranks title matches above tag matches above body matches, and the first two
accept a subsequence (`rvw` finds "Review"). The body tier does not: a
four-letter query is a subsequence of almost any paragraph, so that fallback
matched nearly every prompt and search stopped narrowing anything. A body has
to contain the query (`bodyScore`), or, for a multi-word query, start a word
with each of its words.

**Delete asks, and the answer is Enter.** In the action panel, Delete (its
digit `5`, a click, or Enter on it) relabels to "Really delete?" and takes
the highlight and the keyboard focus with it, on the danger's soft fill
instead of the accent; the hint bar reads `↵ delete · Esc cancel` and the
status region says the question, since a screen reader does not re-read a
focused item whose label changed. Enter, `5` or a click then deletes. Esc
answers no and stays in the panel; arrowing or pointing at another item
withdraws the question, so it is never found still armed on the way back.
Until 2026-10-03 arming by digit left the highlight on Paste, so the Enter
that answered "Really delete?" pasted the prompt into the terminal, and the
item was keyed by its label, so arming it by Enter replaced the focused
button and focus fell to the body (critique popup P1).

**The popup has its own undo.** A delete from the action panel leaves
`Deleted "title"` in the feedback strip with an **Undo** button that
carries its keys as key caps, and puts the prompt back through
`add_snippet` with its old id, so nothing about it is lost. It is
popup-local on purpose: the manager may not be open, and a round trip
through it would depend on its state. The offer has no clock. It lasts the
session that deleted and survives one hide and summon, where the strip
shows it again; the summon after that starts clean, and a second delete
replaces it. It used to expire after eight seconds and on any summon, so
Esc, or a paste, inside that time made the delete permanent, against
"undoable, never lost". The bare "u" is honoured only in the session that
deleted and only while the search box is empty — every other key goes to
the search box, an unconditional "u" made a query like "unit tests"
impossible to type after a delete, and on the summon the offer survives
"u" is the first letter of whatever the user came back to type. Ctrl+Z
works whatever is typed. The button shows the keys that work right now:
`U` and `Ctrl Z`, `Ctrl Z` alone once something is typed or after a
summon, and none while the form, the create view or the action panel has
the keyboard (a click still undoes). The strip used to name both keys in a
sentence with nothing to click, and went on naming U after a query had
taken it.

**A result says why it is one.** A title match is underlined in the title.
A row the search found by its body shows, on its second line, the body
from just before the match with the matched words underlined
(`C.bodyExcerpt`, the same rule as `bodyScore`), in place of the prompt's
opening words; before, nothing on such a row said why it was in the list.
Under a `#tag` filter the row's one pill is the tag asked for, with the
others folded into `+N`: a row tagged *flow, debug* showed "flow +1" under
`#debug`. Ranking is unchanged. With no rows at all (no match, or an empty
library) the hint bar drops paste, copy, actions and preview, which have
nothing to act on, and offers `Ctrl N new prompt` when there is a clipboard
to save. The status region says "N prompts match" for any query, a `#tag`
as much as a word, and "1 prompt matches".

**The hint bar's breakpoints follow the UI scale.** Which hints the bar
shows is decided by container queries on the bar, in rem, so at 125% the
default window shows three hints on one line and a window widened to
500 px shows all five. As viewport pixels they kept showing five at 125%,
where the type is a quarter wider, and the bar wrapped at every width
(critique popup, 2026-10-03). At 125% in the 320 px minimum the warning
and the preview bars still take two lines. The clipboard's text on its
line is on Control grey, not the built-in tint, which in Instrument is the
selection's own colour and sat right above the selected row; a row's tag
pill truncates at 7rem so a long tag no longer squeezes the first line;
the fill-in placeholder is full Ink 2 (at 70% it was 3:1); and with no
rows the status region says the list's own message, which a listbox, read
as options only, never voiced.

**The popup's list folds from the keyboard too.** Every pack and group
header is a stop in the ↑↓ order, above its rows, as in the sidebar's
tree; Pinned and Results are not, since they don't fold. On a header,
Enter folds or opens it, ← folds an open one, → opens a folded one and on
an open one steps onto its first row, and ← on a folded group steps out
and folds its pack (a pack whose prompts were all in groups had no row
whose ← folded it). Opening keeps the selection on the header: landing on
the first row threw it to the top of the list when a pack's groups were
all folded, since there was no row to land on. ← on a row folds its
group, or its pack on an ungrouped row, and moves the selection to that
header, so → undoes it at once. The bar reads `← ↵ fold` or `→ ↵ unfold`
with `↑ ↓ move` while a header is selected, a list with nothing open and
nothing pinned starts on its first header, and Ctrl+→ still unfolds every
pack and group at once. A selected header is announced as an option
("Everyday, folded, 12 prompts") in its place, since the header itself is
hidden from assistive tech. Through 0.2.20 the arrows moved over rows
only: a fold could be reopened from the keyboard only by Ctrl+→, which
opened everything, and with everything folded ↑↓ did nothing. Before
that, Ctrl+→ cleared pack folds only, and only while one was folded, so a
group folded with ← could only be reopened with the mouse.

**The clipboard has a line of its own under the search box.** Every
`{clipboard}` row pastes it, and the row shows only the word, so the line
says what the clipboard holds (one line on Control grey, with the *hidden text* badge and a line count when it has more
than one), that it is empty ("Clipboard is empty — prompts paste without
it": the fact in Warn while any prompt wraps the clipboard, and never
truncated; the consequence after it gives way at the 320 px minimum; those
rows hollow their clipboard icon and are described by the line for a
screen reader), or that it holds the last prompt the popup
pasted or copied ("Last pasted prompt"): the prompt stays on the clipboard
after a paste on purpose, so without this a second summon showed the first
prompt's output as if it were something the user had copied. The popup
keeps what it last sent, expanded the way Rust expands it, and compares.
Before the line, an empty clipboard was a native tooltip on the row, and a
hole was found in the terminal.

**A row shows one icon, and a hole comes first.** The slot at the row's
left holds one of five (`C.rowIcon`), by what matters most before Enter:
the hollow clipboard when the prompt wraps `{clipboard}`, the clipboard is
empty and no fill-in form will show the hole first; then the pin, except
under the Pinned heading; then the kind (a pencil for a prompt that asks, a
filled clipboard, a page). The pin used to win everywhere, so the pinned
rows, the ones pasted most and by `Ctrl+1..5` without a look at anything
else, were the only rows that never hollowed, and a pinned "Explain this
error" pasted its hole into the terminal unannounced (critique popup P1,
2026-10-03). Under the Pinned heading every row is pinned, so the slot says
the kind there, as it does in every pack; in search results, where pinned
and unpinned rows mix, the pin still tells them apart. A fill-in row keeps
its pencil, dimmed: Enter opens its form, whose preview shows
"(clipboard is empty)" before anything is pasted. "Empty" is one test for
the line, the rows and the hint bar, and whitespace alone counts: it
pastes a hole as surely as nothing does, and the line used to call it
empty while the rows did not.

**An empty clipboard is said one way.** The line, the row's tooltip, the
hint bar and the action panel all say the prompt pastes *without* the
clipboard. The line and the tooltip used to say such rows "paste nothing",
which they don't: they paste the prompt with nothing where the clipboard
goes, and three wordings for one state read as three states (critique
popup, 2026-10-03). The hollow icon is ink at 55%, not 40%: at 40% it was
2.5:1 on Paper, under the 3:1 a state icon needs; it is deliberately not
Warn, since with an empty clipboard a dozen rows show it at once and the
Warn belongs to the one line and the one hint. The `Ctrl N` key on the
line is drawn unavailable (half strength, `aria-disabled`) while there is
nothing to save; it still answers with "Copy something first" in the strip.

**Every hole Enter would send is said in Warn, on the Enter hint.** The
empty clipboard was the only one. A fill-in form whose Enter sends now
with fields still empty reads `↵ paste with 1 field empty` (the button's
words; `copy with…` in a form opened to copy), where it read a neutral `↵
paste` over a button that counted the hole. And while the clipboard holds
the prompt the popup sent last, a `{clipboard}` row with no form reads `↵
paste, wraps last prompt`, with "Last pasted prompt" on the clipboard line
in Warn too: Enter would paste that prompt inside itself, which is rarely
meant and looked exactly like a normal paste. Both still paste at once,
for the reason below. A form opened to copy heads its preview "Will copy",
not "Will paste", and opening a form clears a passing remark such as "Copy
something first" from the strip (an Undo offer and an error stay). In
the narrowest bar there is (320 px at a 125% UI scale) a Warn hint stands
alone, without `Esc`, and the failed paste's bar keeps only `↵ Esc
dismiss`: with one more hint each of them wrapped to two lines, the empty
clipboard's included, and took a row from a window that has one.

**The hint bar says so too.** While the selected row would paste a hole,
`↵ paste` reads `↵ paste without clipboard` with the label in Warn: the bar
is where the eye checks what Enter does, and the icon alone is a quiet
signal. Enter still pastes at once; a second Enter to confirm would add a
step to the one gesture the popup exists for, and a prompt pasted without
its clipboard is sometimes what the user wants. The longer label takes the
room of the hints it displaces, so the bar stays one line: `Ctrl ↵ copy`
shows from 360 px, `Tab actions` and `→ preview` from 500 px, `← fold` not
at all. The action panel (Tab) replaces the bar's hints with its
own, so on such a row its first two items read "Paste without clipboard"
and "Copy without clipboard".

**The feedback strip wraps and errors are alerts.** The strip used to
truncate to one line with "— Esc to dismiss" appended, which at the default
width cut the failed paste's message to "…the prompt is on your clip…", the
half that says how to recover. It now wraps to two lines, the hint bar's
Esc reads *dismiss* while an error is up, and an error lands in a
`role="alert"` region (a confirmation stays a polite status): the popup
has just reappeared when a paste fails, and a polite announcement on a
window the user did not expect is easy to miss.

**Inserted text is isolated.** The clipboard and fill-in values in every
preview, and prompt titles, render in `<bdi>`, and bidi and control
characters in them are shown as ⟨RLO⟩, ⟨ESC⟩ (`revealControls`, applied by
`clipboardPreview`) rather than obeyed: a U+202E copied with a web page
used to reverse the preview's text after it, the *hidden text* badge and
the Copy button included, so the one warning built for that input read as
garbage. Tag characters and zero-width ones are counted by the badge and
left alone, since a flag emoji is made of tags.

**A fold moves the selection only out of the folded section.** ← folds
the selected row's group or pack, and the selection moves to its header
(above). A click on any other header, and Ctrl+→, leave the selection on the
row it was on: a click on "Everyday" used to carry the selection into
another pack, so the pointer changed what Enter pasted. ← closes a card
opened with →, and a second ← within 400 ms does nothing; it used to fold
the row's section, and folds are saved. While anything is folded the list
opens with a line that says so and names the key (`1 section folded ·
Ctrl → unfold`, a button that does the same); the status region adds the
count. Ctrl+→ was named nowhere at the default width.

**One inset.** Every strip of the popup shares the search box's edges, and
its content starts 8 px in: the search icon, the clipboard icon, a pack's
name, a row's icon, the first key of the hint bar. The list used to carry
2 px of side padding, so a row's fill was narrower than the box above it,
and the five strips began on five different lines (9, 8, 10, 6 and 4 px).
The search box's own padding is 8 px less its 1 px border (the manager's
filter box shares the class and moves with it). In the fill-in form and
the Ctrl+N view the boxes (fields, the preview, the button) run edge to
edge and the loose text (the title, labels, notes) starts 8 px in; fields
were inset 8 px, the preview 4 and the button 0. The list's scrollbar
lives in the shell's right padding, its 8 px reserved whether or not the
list scrolls (`scrollbar-gutter: stable`): inside the list it took the
rows' right edge 8 px short of the search box's whenever the list
scrolled, so the slot keys never lined up with the `Ctrl N` key above
them. The form's scroller keeps its scrollbar inside, where it shows only
in a window too short for the form.

**The pointer never moves the selection.** Hover is the grey on the row
and, after a pause, the preview card; the keyboard selection moves on keys
or a click, and a click pastes the row it lands on. A hover card is the
pointer's: the hint bar keeps speaking for the selected row, and PgUp,
PgDn and ← act only on a card opened with →. Any open card used to switch
the bar to `↵ paste · ← back`, so with the pointer resting on one row (the
popup opens at the cursor) the card showed one prompt and Enter pasted
another. A hover card sits under its row (or above it), like the one →
opens; hung from the pointer it covered the lower half of the row it
describes. Its Copy button carries no key: `Ctrl ↵` copies the selected
row, and the card printed that key over another row's prompt. The action
panel words its two picks as the hint bar does ("Paste, wraps last
prompt", "Copy, wraps last prompt") while the row would wrap the prompt
pasted last. A hover used to set the
selection too, so the pointer painted the selection tint (against
`DESIGN.md`'s Pointer Grey Rule) and a trackpad brush after summon changed
what Enter pasted. In the same spirit the search box's border takes the
focus colour only while the box has focus: it used to stay lit while a
query was set, a second lit thing beside the selected row, and the × already
says a query is set (`searchBoxClass`, both windows). Clearing a query
scrolls the browsing list back to the top: the offset a search left behind
outlived its results, and with the selection already at 0 the keep-in-view
effect had nothing to do, so the Pinned header sat under the fold.

**What a screen reader hears of a row** is the option's name, its title,
and a description: the `{N}` badge's "Asks for N values before pasting",
the clipboard line when the row would paste a hole, the card when it is
open. The first line, the pill and the slot key are `aria-hidden`: visible
text an option's name doesn't contain is read as a mismatch, and the
badge's words reach assistive tech through the description instead. The
clipboard line's key is named "New prompt from clipboard (Ctrl N)", its
visible text in its name for anyone who says what they see, and the
window's content is one `main` landmark.

**The list is a listbox of options and named groups, nothing else, to
assistive tech.** A pack's or group's header row (its fold button and
filter funnel) is `aria-hidden`: a listbox may hold only options and
groups of them, and the buttons inside it had Lighthouse report the tree
as malformed and a screen reader meet "Everyday 12" and "Filter by
@Everyday" as list content. The `group` around each pack and group carries
the name, the fold is reachable with ← and Ctrl+→ and the filter by typing
`@pack` or `>group`, and the buttons are `tabIndex` -1, so nothing hidden
is in the tab order (clicking one hands focus straight back to the search
box). A tree of `treeitem`s, like the sidebar, was the other way; it would
have made the headers keyboard rows, which they have never been here.

**The list's rhythm.** Rows sit 2 px apart (the rounded fill already
parts them) and packs 8 px apart; pack and group headers are 24 px tall.
It was 6 and 12 with 28 px headers, a 50 px pitch for a 44 px row, which
showed seven prompts in the default window where eight now fit (twelve in
Compact). A group's rows are not indented: every title in the list starts
on one edge, and every pack and group name sits on that same edge, so the
outer edge holds glyphs (row icons, the headers' chevrons, Pinned's pin,
Results' magnifier) and the inner one names and titles. Indented, titles
sat on two edges 10 px apart.

**The selected row carries a bar.** The keyboard's row, and the action
panel's highlighted item, have a 2 px Focus bar at the left edge over the
Selection tint (`SELECTED_BAR`). The tint alone is a dark blue-teal in
dark mode, and on the real screen it read as a green row nobody had
explained rather than as the cursor.

**A header never reads as a prompt.** A pack header (and Pinned, and
Results) is a band on Control grey, and no row is filled at rest; it
sticks to the top of the list while its rows scroll, so the pack a row
belongs to stays named, and rows keep a 28 px scroll margin so arrowing up
never parks the selection under it. A group header is a divider: its
chevron leads, its name in Ink 2 is followed by a hairline to its count.
Through 0.2.20 the headers were text alone, a pack's 600 one weight step
above a title's 500 and a group's name on the title edge with its chevron
at the far right, so a group read as a prompt whose first line was
missing (the manager's sidebar parts them with chevrons and guide lines;
the popup keeps its one edge and parts them with a fill and a rule). `Ctrl` is printed once, on
the first slot's key; the rows under it show their digit alone in the same
column. Five `Ctrl` caps down the right edge were the loudest thing in the
list and said one thing five times (critique popup, 2026-10-03).

**A row is a title, a first line and one pill.** The title line carries
the slot key at its right edge (`Ctrl 1` on the first, the digit alone
after it), the row's own address, and the
second line is the prompt's first line with one tag pill, a +N for the
rest and the `{N}` badge. It carried up to three pills and the key, which
left the first line, the thing that tells two similar titles apart, about
fifteen characters at the default width; one pill keeps the hue that tells
a debug prompt from a review one at a glance. The pills are text, not
buttons: a row is a listbox option, which may hold no interactive
descendant, and every row's pills used to be in the tab order (a screen
reader met fifty-odd "Filter by #…" buttons inside the list). A click at a
pill still filters by it: the pill carries its tag as `data-tag` and the
row's click handler looks for it before taking the click as a pick.
The "New prompt from clipboard…" bar under the list is gone; its Ctrl+N
key sits at the right end of the clipboard line, since the clipboard is
its subject, and the list has the 32 px back on every summon.

**The clipboard panel.** The clipboard line flattens what it holds to one
cut row, and the useful part of a stack trace is usually its end. Ctrl+↓,
or a click on the line's text (it carries a chevron), drops the whole
clipboard down from the line as a panel over the list: the lines as they
paste, in mono, numbered when there is more than one, indentation and
blank lines kept, controls shown as ⟨RLO⟩ in Warn rather than obeyed
(`clipboardLines` in core), at most 400 lines with a note that the rest
still paste. It reaches down to the list's bottom edge and no further, so
the hint bar under it says what the keys do: ↑ ↓ scroll and PgUp PgDn
page (when it overflows; the page keys from 440 px), Ctrl N saves it as
a prompt, Esc and Enter put it away. Enter closes rather than pastes
because the row it would paste is under the panel, and Ctrl+1..5 close
it for the same reason without pasting: both pick a row the user can't
see. After a failed paste the bar keeps "Ctrl V in the target" first
while the panel is up, since the panel then shows the prompt that did
not land; Ctrl N leaves the bar to make room (its key cap is on the
line). The resting bar names Ctrl ↓ from 560 px, where a seventh hint
fits on its line; below that the line's chevron and tooltip carry it.
←, Tab and Ctrl+↓ close it too, and typing closes it on the way
into the search box, as it closes the preview card. A press outside it,
a summon, a pick, the form, the create view and the action panel all put
it away, and with an empty clipboard there is nothing to open. While it
is up the rows open no hover card.

**The copy names the next step.** A fill-in field is labelled in sentence
case by one rule (`fieldLabel`: "Standing instructions", "Goal 2"), not by
a CSS `capitalize` that gave "Call To Action". A field that is really an
unset `{{config}}` parameter says so under itself ("set it once in the
manager's editor, under Placeholders, and it stops asking"): downgrading was silent,
so a parameter the user never set was asked for every day with nothing
saying it needn't be. Ctrl+N with nothing on the clipboard is one line in
the strip ("Copy something first — Ctrl+N saves the clipboard") rather
than the whole window turning into a form whose only content was that
sentence; a search with no match points at Ctrl+N the same way while the
clipboard holds something. The action panel's hint counts its own items
("1-5 pick"; it said 1-9). ← for folding was the one key with no mention
on screen: the hint bar names it from 440 px, in a window the user has
widened (the five resting hints fill the default 400 px, and a sixth
wrapped the bar and ate a row), and the pack and group headers name it in
their tooltip at every width. The `{N}` badge on a row is named "Asks for
N values before pasting" for a screen reader, which read its braces out.

**The action panel's items take focus.** Tab opens it with focus on the
highlighted item and the arrow keys move it, so a screen reader hears the
item change; Escape, or running an action, hands focus back to the search
box. The items used to be marked with `aria-current` while focus stayed in
the search box, which announced nothing as the highlight moved. The
preview card carries the prompt's whole title above its text: the row cuts
a long one and has no tooltip (the hover is the card), so the card is where
it can be read.

**The preview card never covers the row it describes.** → (or a hover)
opens it below the row when it fits there, above the row otherwise, and on
whichever side has more room, capped to that room and scrolling, when
neither fits; clamping it into the window used to slide it up over the
row near the bottom of the list. Its floor is the list's bottom edge, so it
never hangs over the feedback strip or the hint bar. One exception, since
2026-10-03: in a window too short to hold the card beside the row (under
120 px on the roomier side; the 320×280 minimum leaves about 85), a card
opened with → takes the list's place and covers its row. It carries that
row's whole title, and three lines beside the row showed neither the
prompt nor its clipboard. A hover never does this: a card under the
pointer would hide the rows the pointer is crossing.

**The card is read from the keyboard.** Its text scrolls inside it and
PgUp / PgDn scroll it (→ is the keyboard's only way to see what will be
pasted, and a long prompt or a short window left the rest out of reach).
It opens with the clipboard's place in the prompt in view, one line of the
prompt above it: the card exists to show the clipboard in the prompt, and
it used to open on the opening words the row already shows. Copy is a row
of its own under the text, always in view, carrying `Ctrl ↵`; it used to
trail the prompt's last word like part of the sentence and scroll away
with it. While the card is open the hint bar reads `↵ paste · PgUp PgDn
scroll · ← back · Esc close`, the page keys only when there is more than
fits. The card is a `note`, not a `tooltip`, which may not hold a button.

**The card is always the selected row's, or closed.** Typing a query moves
the selection to the top result, and the card used to stay open on its old
position in the list: it showed one prompt while Enter pasted another, at
the moment the card is read to check what Enter will send. Any change of
the query closes it, before paint, as the arrow keys do; so does the list
changing under it for another reason (the library reloading, an Undo, a
fold), when the prompt at the card's position is no longer the one it
opened on.

**The minimum size keeps what matters in view.** In the Ctrl+N view the
fields scroll and **Save prompt** does not (it was the last thing in the
scroller, below the fold at 320×280, under a hint bar that said Enter
saves). An error in the strip gets three lines where a confirmation gets
two: the failed paste's message ends with how to recover, and two lines
cut it off before that at 320 px. The action panel is capped to the
window above the hint bar and scrolls, for a larger UI scale. The hint
bar drops its least-used hints
(actions, preview, newline) below 360 px, because at the 320 px minimum
width it wrapped to two lines and ate a row. Ctrl+N's pre-filled title is
the clipboard's first line cut at a word boundary within 40 characters
(`titleFromClipboard`), not mid-word. Title ties everywhere — the popup's
ranking and the manager's orders — compare numerically, so "Bulk prompt
2" comes before "Bulk prompt 10".

**Keep open** (Ctrl+K, or the toggle at the right of the search box) turns
the popup from a one-shot into a palette beside the work, for runs of short
replies to an agent. While it is on (`AppState.keep_open`):

- The popup no longer hides when it loses focus, nor after a paste or a
  copy: the paste thread hands the focus to the target and the popup waits
  beside it, saying "Pasted …" in the strip. The next pick waits about
  300 ms, for the paste thread's Ctrl+V.
- A paste goes to the **last window outside Promptline** the user was in,
  not the one the popup was summoned over (`paste_window`). Rust follows
  the foreground window for the life of the process with an out-of-context
  `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` on the main thread
  (`platform::track_foreground`), skipping its own process's windows and
  the shell's (the taskbar, the desktop, the Alt+Tab and Task View
  switchers: `is_shell_class`), so a click on the taskbar to reach the
  popup doesn't become the target. Until another window has come to the
  front, the summon's window is used. A target that refuses (elevated)
  fails as any paste does.
- The hotkey only focuses the popup (it is already visible), so no
  `popup-shown` refreshes it; the clipboard is read again whenever the
  window gets the focus instead, and typing lands in the search box.
- The frame (the shell's padding and the gaps between strips) drags the
  window (`data-tauri-drag-region`, which Tauri honours only on the element
  itself, so no control loses its click); it stays where it is dragged until
  Keep open ends, and a later summon opens at the cursor again.
- The hint bar shows `Ctrl K kept open` where `Esc close` was.

Every `hide_popup` ends it, so **Esc** closes and turns it off at once, and
it is never saved: a summon or a restart always starts without it. Ctrl+K
turns it off and leaves the popup up until the next blur.

## Placeholders

Handled in `ui/core.js`, shared by both windows so the popup's previews and
the manager's overview cards can never disagree.

| Token | Resolved |
|---|---|
| `{clipboard}` `{date}` `{time}` | At paste time, from the environment |
| `{lowercase_name}` | Runtime field — the popup asks, every time, starting empty |
| `{{lowercase_name}}` | Config parameter — from `configValues`, silently |

**Previews show the clipboard, not the word "clipboard".** `{clipboard}`
expands at paste time, so every preview — the popup's card, the fill-in
form's "Will paste", the overview's cards — substitutes the clipboard as it
is now, one line and cut at 240 characters (`clipboardPreview`), on the
builtin's tint so it still reads as a placeholder. An empty clipboard shows
"(clipboard is empty)": that is what would paste, and hiding it is how a
hole gets pasted. A clipboard holding hidden characters (the import rule
under *Packs and their files*) gets a *hidden text* badge after it, with the
kinds in its tooltip: copied web text is where hidden instructions for a
model come from, and the preview is the last look before the paste. The overview re-reads the clipboard when the manager's
window regains focus and after a copy or cut in it; the popup already
re-reads on every summon and copy. The editor has no preview of its own
since 0.2.10: it showed the same expansion under the text it was typed in,
with a Copy button the popup's Ctrl+Enter already covers, and the prompt
is seen expanded wherever it is used instead.

Two rules that exist because their absence was worse:

- **An unset `{{config}}` downgrades to a runtime field** rather than pasting an
  empty hole. Silently pasting a gap into a prompt is the failure nobody notices
  until the AI answers the wrong question.
- **A name is lowercase letters, digits and `_`, never starting with a digit**
  (`isValidParam`). `{File}` and `{1st}` are named as plain text in a note
  under the editor's prompt field, and drawn as near-misses in every
  preview, rather than silently treated as literal text; `{0}` and `{1}` stay
  text, so format-string slots in pasted code never turn into questions.
  Every pattern that substitutes a name (`fillFields`, `expandConfig`,
  `downgradeUnsetConfig`) uses this same rule, or a valid name would be
  asked for and then never filled.

**One name, one value; a numbered copy asks again.** Writing `{goal}` twice
pastes the one value in both places. For a second value of the same kind,
the editor's chip for a field already in the text carries a +, which
inserts the next free numbered copy (`nextCopyName`: `{goal_2}`, then
`{goal_3}`, all counted from the same stem, whichever copy's + is used).
The first `{goal}` is never renamed, so its remembered value keeps working;
the fill-in form labels the copy "Goal 2".

## Packs and their files

A pack is just a name. It has no independent existence — `packNames()` is the
union of declared `PackMeta` and every `snippet.pack` in the library, so naming
a pack on a prompt conjures it. Imports and moves create packs this way.

**Packs are A–Z until the user arranges them, then in their order, in both
windows.** A pack moves one place at a time from its ⋯ menu (Move up,
Move down) or with Alt+Up/Down on its header, in the sidebar only; 0.2.13
also let a header be dragged, and that went in the next release because
the header's click is the fold. A move sends the whole list as drawn to
`arrange_packs`, which reorders
`config.packs` to match and sets `packsArranged`: an order, not a registry,
so locks and files stay as they are on disk, a pack the list doesn't name
(one the popup made meanwhile) keeps its place at the end, and a name
without metadata (an empty draft's pack, see `packs_in_play`) is skipped
rather than declared. `C.orderPacks` is the one rule both windows and
`packTree` read: the registry's order once arranged, any pack it doesn't
hold after it A–Z; before that, A–Z whatever order the registry grew in, so
a library from before the flag looks the same until its first move. A new
pack in an arranged library therefore lands at the bottom. Pack order is
separate from the prompt order (Most used, A–Z, Custom): moving a pack
doesn't switch the prompts to Custom, and every prompt order keeps the
packs where the user put them. The popup reads the order with the config
on each show; the overview draws one pack and has nothing to arrange.

**A group moves within its pack the same way, but its order is the
library's.** A group has no metadata: its place is where its prompts first
appear among the pack's rows (`packTree`). So Move up/down on a group
(its ⋯ menu, Alt+Up/Down) takes the list as drawn (`C.displayOrder`),
swaps the group past its neighbour with `C.moveGroup`, which lays the
pack's prompts back into the slots they held (ungrouped run first, then
the groups in their new order; every other pack and every row inside a
group stays put), and saves it, switching the list to Custom as a prompt
drag does, or Most used would put the old order straight back. The popup
follows it: it ranks prompts by use, so it can't take the order from its
rows, and instead places each group where it first appears in the library
array (`C.groupOrder`), which is the manager's Custom order, the order a
move saves, and an imported pack's file order. Until 0.2.15 the popup sorted
groups A–Z, so an unarranged library can show its groups in a new order
there after the update: the order they were made or imported in.

**The manager's New asks where.** Its menu makes a pack straight away (named
"New pack", selected, its name open for typing), a group in a pack the user
picks, or a prompt in a pack or group the user picks from the library's
tree; locked packs are listed but disabled. There is no default placement
there: a New that guessed put prompts in packs nobody chose. A group, being
a label, starts life on a draft prompt, and is what gets selected and named;
the draft waits inside it, so a group left with only that draft goes when
the draft is swept (below). An empty library has one empty state, in the
pane, and its primary action is that same New menu (Generate beside it as
the secondary); the sidebar keeps only its New button. It used to show a
second "No prompts yet" of its own with a "New pack" button while the
pane's offered a "New prompt" that guessed a pack.

**Where a new prompt goes** when nothing chose — the popup's Ctrl+N, the
editor's and overview's empty-state buttons — is one rule for both windows
(`defaultPackFor` in `ui/core.js`): the pack that last received a prompt if it still exists and
is unlocked, else the default pack if it exists and is unlocked, else the
first unlocked pack, else a fresh "Unsorted"; a library with no packs at all
starts with the default pack. Both windows used to have their own version
and they disagreed once "My prompts" was locked. Only packs that exist are
candidates: the rule used to skip that check for the default pack, so a
library that had deleted "My prompts" saw Ctrl+N pre-select it and conjure
it again on save. The popup's pack select lists the packs that exist plus
the form's own choice, never a phantom default.

**A group is the same kind of thing one level down**: `snippet.group`, a
label scoped to its pack, empty meaning ungrouped. It has no metadata, no lock,
no file. Renaming a group rewrites the label on every prompt that carries it,
and renaming onto an existing name merges the two. Deleting a group deletes its
prompts, so it goes through the delete dialog, and the status bar offers Undo
afterwards. Since 0.2.19 every delete in the manager asks in that one
dialog (a prompt, a selection, a pack, a group), which names what goes and
that Undo follows; until then a prompt's delete was an armed button in the
editor and a pack's an armed menu item that disarmed on a timer, three ways
to confirm one kind of action. Ungroup on a selection clears the
label and nothing else: it used to move every selected prompt into the
first one's pack, so a selection spanning packs (one list view, a search)
was silently gathered into one. Pack files carry the label as an
optional `"group"` on each prompt; older files and libraries load with it
empty.

A prompt's group is set from the Move-to menu (a row's right-click, the
editor's crumb chevron): each pack is a submenu of its groups with "No
group" first and "New group…" last, the prompt's own place checked. Until
0.2.19 the editor had a free-text group field with a chevron for the
pack's groups (and before that a `<datalist>`, which Chromium filters by
what is typed, so a prompt already in a group was offered only that group).

**Pack operations that touch metadata and prompts happen in one Rust step
or in a fixed order.** `ensure_packs_backed` runs inside every save, so a
rename done as two frontend writes let it see prompts still carrying the old
name and conjure a second pack; `rename_pack` renames both at once. A delete
removes the prompts first (`save_snippets`, with Undo) and the metadata
second (`delete_pack`), for the same reason. And because the reconciler can
add metadata on any write, the manager re-reads pack metadata after every
write rather than trusting its own copy.

**Pack metadata is written by intent, never as a list.** Lock, delete, add
and "Create pack file…" (once "Give this pack a file…", which named the
mechanism rather than what the file is for: sharing, or an agent to write
into; the hint says so) are `set_pack_locked`, `delete_pack`, `add_pack` and
`add_pack_file`, each a read-modify-write of `config.json` under the store
lock that answers with the registry as `get_config` returns it, which the
manager takes as its copy. The manager used to hand back its whole pack
list (`save_packs`), and Rust retired every file the list no longer named:
a list from a stale render retired and re-created pack files, and a pack
that was empty in the library saw its real content move to `packs/deleted/`
with a fresh empty file in its place. `add_pack` refuses a name that reads
as an existing pack's (case variants share a file name on Windows), the
same check `rename_pack` makes; a file that can't be created is a notice
and the pack exists anyway, since a pack is just a name, and the next sync
tries the file again. Locking a pack that exists only as a name on prompts
gives it metadata, as renaming does. The Undo of a pack delete restores
the prompts (which conjures the pack again, with a fresh file) and then
puts its lock back with `set_pack_locked`.

That is why file backing is reconciled rather than handled at creation.
**`ensure_packs_backed`** runs at startup and before every sync, giving every
name in play a `PackMeta` and a `.json` of its own. Handling it only in
`addPack` would miss every other route.

**`sync_pack_files`** writes each pack's shareable content — title, tags, text,
group, never `uses`/`pinned`/`configValues` — to its file on every save, but
only when the bytes would actually change: an autosave touches one prompt,
and rewriting every pack file each time only fed file watchers (the Generate
dialog polls its file, editors and sync clients watch the folder). Pack files
are a supported interchange surface: an agent can write one and the user
imports it.

**One tag rule everywhere** (`normalizeTag` in `ui/core.js`): lowercase,
with everything outside `[a-z0-9_-]` dropped. The editor's tag field, the
menu's "Add tag…" and `parsePacks` on import all apply it. They used to
differ: the editor and imports only trimmed and lowercased, so a pack could
carry "code review" as a tag that `#code review` could never find (the
filter parses it as `#code`); on import such a tag now becomes
`codereview`, which is what "Add tag…" already made of it.

Two guards follow from that:

- **An empty pack never overwrites its file.** The library's view of a pack is
  empty both when the user emptied it and when an agent has just written prompts
  that haven't been imported yet. The two are indistinguishable here, and only
  one of them is safe to act on. The one exception is a file holding nothing but
  the manager's own swept "New prompt" drafts: that is the library's earlier
  output, not an agent's, and it is emptied so the draft doesn't linger.
- **Deleting a pack moves its file to `packs/deleted/`** instead of unlinking
  it, for the same reason (`delete_pack` retires the named pack's file;
  a rename moves or keeps the file, below, so nothing is ever retired by
  a rename).
- **A rename takes the file along when the app named it.** A file directly
  in `packs/` in the old name's series (`new-pack.json`, `new-pack-3.json`
  for "New pack") becomes the new name's (`workflow-prompts.json`, or the
  next free number) in the same `rename_pack` call, so a pack doesn't live
  on in `new-pack-3.json` forever. A file with any other name, one outside
  `packs/`, or one in `generated/` keeps its path: someone chose it, and a
  colleague or an agent may be writing into it. A case-only rename names
  the same file. If the registry then fails to save, the file is moved
  back. Until 0.2.22 every rename kept the file, so packs renamed before
  it keep their old file names until they are renamed again.

**An export goes to the clipboard or to a file, in the JSON an import
reads.** A pack's menu and Settings → Backup and import each offer *Export to
clipboard* and *Export to file…*: a pack as one pack document
(`C.packToJson`: title, text, tags and group, none of the personal state),
the library as an array of every pack that holds a prompt. The file goes
through `export_pack_file`, whose Save dialog is Rust's and suggests the
name a pack file would take (`git-commands.json`, `promptline-library.json`);
the webview hands over the text and a name, never a path, like every other
command. It is a copy the user keeps, not a pack's file: nothing tracks it,
and exporting into `packs/` makes an orphan that a pack of the same name
could later adopt, as any file dropped there. Windows opens the dialog in
the folder last used from the app, which is often `packs/` after an import.

**An import flags hidden characters and leaves those prompts unticked**
(`hiddenChars` in `ui/core.js`, checked over the pack name, title, group and
text). A pack from a colleague, a website or an AI reply can carry text the
checklist cannot show but whatever it is pasted into receives: Unicode tag
characters, which models read as ASCII ("ASCII smuggling"); bidi controls,
which make a line display differently from how it reads; control
characters such as ESC, a terminal escape sequence; and zero-width and other
invisible characters. The row carries a *hidden text* badge whose tooltip
counts them by kind, the header counts the rows, and the row starts unticked
like a dupe, so adding it takes a deliberate tick. Nothing is stripped: the
text may be honest, and rewriting what the user imports would be a surprise
of its own. Invisibles with everyday uses pass when alone: a joiner inside an
emoji or a Persian word, a variation selector after an emoji (and the
selector-joiner pair in ❤️‍🔥), a direction mark in right-to-left text, a
soft hyphen, the tag run of a subdivision flag such as Scotland's; in a run
of two or more, or beside a hidden character, they count, since a run is how
zero-width steganography encodes its bits.

**A pack's path is stored relative to `packs/`** (`work.json`), and only a
file placed outside that folder keeps an absolute path. They used to be
absolute throughout, so a profile restored under another user name, moved
to another drive or roamed between machines pointed every pack at a folder
that no longer existed, and every pack write failed with nothing said.
`resolve_pack_path` turns the stored form into a path to open wherever one
is used; `relativize_pack_path` turns a path back into the stored form
(`add_pack`, `add_pack_file`, `ensure_packs_backed`), and a config from
before this (0.2.9) is brought over once on load. The frontend shows, reads
and reveals the path and never hands one back, so `get_config` and every
pack command resolve each path on the way out. A pack file that can't be
written is logged and raised as a notice once per session (the library
itself is safe in `snippets.json`), not on every autosave.

Orphans are never swept automatically. A file in `packs/` that no pack claims
may be one an agent just dropped there for importing. **Backing a pack adopts
such a file when it declares that very pack's name** (`pack_file_slot`): the
Generate dialog creates a pack's file before the pack exists, so an import that
conjures the pack used to find `<name>.json` taken and back the pack with
`<name>-2.json`, leaving the agent's file orphaned beside it. An adopted file is
never written over on adoption — it may still hold prompts the library has not
imported. A file claimed by another pack, or one that isn't a readable pack
document, is never taken.

**`packs/generated/`** holds scratch files for the Generate dialog's survey mode
(agent path, empty topic). An agent writes the project's pack into one, with a
group per practice, and the pack is created on import under whatever name the
agent gave it. The scratch file backs no pack, so it lives below the top-level
`packs/` that metadata points into, and it stays there afterwards as a record
of what was generated.

## State and where it lives

`%APPDATA%\io.github.bekalpaslan.promptline\` (the bundle identifier; it was
`com.promptline.app` until 0.2.9, a domain the project never owned, and
`migrate_data_dir` moves the old folder's contents into the new one on the
first start after the change, bringing the packs' file paths, absolute
until then, to their relative form in the moved config; a folder the move
cannot touch stays where it is and raises a notice):

| File | Holds |
|---|---|
| `snippets.json` | `Vec<Snippet>` — the library |
| `config.json` | Hotkey, pack metadata, prefs, popup size, first-run flag |
| `packs/*.json` | Per-pack shareable content, derived from the library |
| `packs/deleted/*.json` | Files of deleted packs, retired rather than unlinked (numbered on repeats) |
| `packs/generated/*.json` | Scratch files the Generate dialog's survey mode hands to an agent |
| `*.corrupt-<unix seconds>` | A data file that failed to parse, moved aside untouched |
| `promptline.log` | Warnings and errors from the Rust side, the file to attach to a bug report |

**The log file is the release build's only voice.** `main.rs` builds
without a console, so everything the code used to `let _ =` away — a pack
file that wouldn't write, a retirement that failed, `SetForegroundWindow`
refusing a window, the autostart entry — was unobservable in the shipped
binary. `tauri-plugin-log` writes `warn` and above to `promptline.log` in
the data folder (one file, started over past 512 KB, local time; a debug
build echoes it to stdout), and every `notify` lands there too. Paths and
error text only, never prompt content. Registered in `setup` rather than
on the builder because the folder needs the app handle to locate; the
webview never calls it, so it has no capability.

**Every write goes through `write_atomic`**: the bytes land in a sibling
`.tmp` file that is flushed to disk (`sync_all`) and then renamed over the
target, so a crash or power loss mid-write leaves the previous file whole
instead of a truncated one. The rename is retried five times over about
300 ms when Windows answers "access denied" or a sharing violation: a sync
client, an indexer or a scanner holds a just-changed file for tens of
milliseconds, and an autosave that hit that window used to show "Couldn't
save" and throw the keystrokes away. A write that still fails removes its
`.tmp` so nothing is left behind.

**A file that won't parse is quarantined, never replaced in place.** Loading
distinguishes three cases. Missing means a first run and yields the starter
pack. Unparseable means the file is renamed to `<name>.corrupt-<timestamp>`,
a `Notice` is raised, and the library starts *empty* — starting with the
starters instead would look like a reset rather than a loss, and the first
autosave would have buried the only copy of the user's prompts. An I/O error
(a lock, a permission problem) is an error the command returns; nothing is
written, because the file may be perfectly good.

`Notice`s are the channel for anything the user must see that can happen
before the manager's webview is listening: they are stored in `AppState`, the
manager drains them with `take_notices` on startup and receives later ones
through the `notice` event, and shows each as a toast that stays until
dismissed.

Disk is the single source of truth; both windows re-read rather than caching
across each other. When one window writes, Rust emits an event so the other
re-fetches:

| Event | Meaning |
|---|---|
| `snippets-changed` | Another window wrote the library — re-fetch before saving over it; payload is the new revision |
| `edit-prompt` | Popup asked the manager to open a prompt |
| `popup-shown` / `first-popup` | Popup opened; the second only ever fires once |
| `paste-failed` | The paste thread could not focus the target or send Ctrl+V; the popup is re-shown and shows the payload's `message` |
| `notice` | Rust hit something the user must see (quarantined file, refused hotkey); shown until dismissed |

Every delete in the manager goes through one `deleteWithUndo`, and both the
delete and the Undo read the *live* library, never the array captured by the
render that started them. An Undo built from a render's snapshot re-added the
deleted prompts on top of a list that still contained them, and the next
autosave wrote the duplicates to disk. The same rule covers every other
write from a closure that outlives its render: context-menu actions (pin,
move, tag, ungroup) and the Undo of a merge or a regroup pass `persist` an
*updater* that is applied to the latest library. An array captured at
`ctx.open` time carried the state of that moment back to disk up to 12 s
later, reverting a title typed in the editor or a use count bumped by the
popup in between — and the revision check could not see it, because the
manager's own reloads had kept the revision current while the closure's
array went stale.

**A library that can't be read is said so in the pane.** Until
`get_snippets` answers, the pane shows nothing; when the call fails, it
says the library didn't load and points at Settings → Backup and import → Open
folder, beside the persistent toast carrying the error. It used to show
the empty-library start ("No prompts yet", New), which read as an
invitation to begin over while the prompts sat unreadable on disk.
Clipboard and shell actions in the manager (copying a path, Show in
folder, reading the clipboard for an import or the Generate dialog) can
fail too, with another program holding the clipboard open or a folder
moved, and each says so in a toast rather than doing nothing.

`snippets-changed` exists because the manager used to cache at startup: a prompt
created in the popup stayed invisible until reload, and the manager's next
autosave would clobber it with its stale copy.

**Writes are intent-level where they can be, and revision-checked where they
can't.** The popup never sends the whole library: it creates with
`add_snippet`, pins with `patch_snippet`, deletes with
`delete_snippet`, and the editor's autosave is `update_snippet` with only the
fields the editor owns — each a read-modify-write on disk in Rust, so a
snapshot that is seconds old can't overwrite what the other window wrote
meanwhile (`uses`, `pinned` are the popup's; title, text, tags,
pack, group, `configValues` are the editor's). The manager's bulk operations
(move, tag, reorder, delete with Undo) still replace the array, so
`save_snippets` carries the revision the manager loaded and Rust refuses it as
`stale` if the file has moved on; the manager then reloads, tells the user,
and the change has to be redone. Every snippet command returns the library
with its revision, every pack command (lock, delete, add, file) returns the
pack registry, and the store lock serialises every read-modify-write.

**A pin remembers when it was pinned.** `pinnedAt` (ms since epoch, personal
state next to `uses` and `pinned`) is stamped when a prompt is pinned and
cleared when it is unpinned, and `rankSnippets` draws pinned rows in that
order. Ordering them by `uses` like the rest of the list made Ctrl+1..5 slots
swap as soon as one pin was pasted more often than another, which is the
opposite of what a pin is for. Legacy pins carry no stamp (0) and sort by
title among themselves. Every pin path goes through `C.withPin` (manager) or
`patch_snippet` (popup) so the stamp can't be forgotten. A popup pack heading
counts every prompt in the pack, its pinned ones included, even though those
rows are drawn up in the Pinned section — the count answers "how big is this
pack", the same number the manager's sidebar shows.

**Preferences are mirrored into `localStorage`** as well as `config.json`. The
popup must apply theme, scale and font on first paint — a round-trip to Rust
would show a flash of the wrong theme on every summon.

**The manager sweeps abandoned drafts at startup.** "+ New" creates a real
prompt titled "New prompt" with an empty body so the editor has something to
autosave into; one that was never filled in (that title, no text, never used)
is deleted when the manager next starts (roadmap 0.7). The popup cannot make
one: with an empty clipboard it refuses to save (L7), and a saved popup prompt
always has a body. Until the sweep runs, `rankSnippets` keeps such a draft out
of the popup's list and its Ctrl+1..5 slots (`isEmptyDraft`) — there is nothing
to paste from it — while the manager still lists and edits it. Such a draft
also backs no pack (`packs_in_play`): "New prompt" lands in the default pack,
and declaring that pack with metadata and a file the moment the draft was
written left a permanent empty "My prompts" behind once the draft was moved
to the pack the user meant, or swept. The pack is declared by the first save
that gives the draft a body or a title, like any other prompt's pack.

Migrations run on load in `apply_snippet_migrations` (v2 `category` becomes the
first tag; packless prompts get a default pack) and via `#[serde(default)]` on
every field added since. Old data must keep opening.

## Launching and quitting

**One process.** `tauri-plugin-single-instance` hands a second launch's
arguments to the running instance and exits it. Two processes over the same
files each kept their own revision counter, so the stale-write check could
not see the other's writes, and the second showed a second tray icon while
the first kept the hotkey. A second launch with no arguments (the Start
menu, the installer's finish page) opens the running instance's manager,
the same as a tray click.

**Autostart stays in the tray.** The autostart entry passes `--hidden`, and
`setup` hides the main window before it paints when it sees that argument.
The window is declared visible in `tauri.conf.json` so a normal launch shows
the manager straight away; a login launch of a tray app that opened a
1000×800 window over the desktop was the opposite of what autostart is for.

Tray Quit is a handshake, not an `app.exit`: Rust emits `quit-requested`,
the manager runs the editor's pending autosave (the 600 ms debounce would
otherwise lose the last edit) and answers with `quit_now`; Rust exits on
its own after 1.5 s if the webview never answers, so Quit can't hang.
`beforeunload` would not have done it — `app.exit` tears the webview down
without firing it.

**Shutting Windows down flushes the same way.** Shutdown, restart and
sign-out send every top-level window `WM_QUERYENDSESSION`, then
`WM_ENDSESSION`, and the process can be killed once that is answered. Tao
turns `WM_ENDSESSION` into `RunEvent::Exit`, by which point the webview can
send nothing, so the query is where the flush happens:
`platform::on_session_end` subclasses the manager's window, and on the
query emits the same `quit-requested`, then holds its reply while it keeps
dispatching the thread's messages (the webview's invokes arrive through
them) until the manager's `quit_now` lands or 2 s pass. While
`session_ending` is set, `quit_now` only records that the flush is done;
Windows does the exiting. Tray Quit clears the flag, so a late answer from
a cancelled shutdown can't leave Quit waiting. The reply is always yes: an
app that holds up a shutdown gets Windows' "this app is preventing
shutdown" screen after 5 s. Measured against the debug build by sending the
query to the process's windows 5 ms after an edit: every reply was back and
the edit on disk within about 75 ms, well inside the 600 ms debounce.
Tao ends its loop on `WM_ENDSESSION` and panics on the next message it
handles ("cannot move state from Destroyed") if the process is still
alive; at a real shutdown Windows has killed it by then, and a test that
sends `WM_ENDSESSION` by hand sees the panic, 0.2.14 included.

**Closing a window hides it, whichever window it is.** The main window going
to the tray is the visible half of that; the popup needs it just as much,
because it is created once at startup and never rebuilt — Alt+F4 on it used to
destroy the window, and `show_popup` then had nothing to show, leaving the
hotkey dead until a restart. The popup's size is persisted on the way out, the
same as on a blur — under the store lock, which every hide path
(`hide_popup`, `paste_snippet`, the close and blur handlers) releases
*before* hiding: hiding fires `Focused(false)`, whose handler takes the
same lock. It never deadlocked only because the focus event arrives
asynchronously, which is nothing to build on.

## Updates

**A GitHub-installed copy checks for a newer release on its own.** Once
about 10 s after startup, then whenever 24 h of wall-clock time have passed
(checked hourly rather than slept for a day at a stretch, so the check
survives the machine sleeping through the exact moment it was due, and a
switch flipped in Settings meanwhile takes effect without a restart),
`update.rs` fetches one fixed URL — `https://promptline.cc/latest.json`,
the same for every install, with no version, target or arch baked into it
(D-12) — through `tauri-plugin-updater`'s own request (`tauri-plugin-updater/2.12.0`
as its User-Agent, `Accept: application/json`). Nothing about the user goes
into the request beyond what that GET inevitably carries: the IP address
to GitHub Pages, and later the installer download from GitHub Releases if
the user accepts. This is Rust talking to promptline.cc, never the webview,
so the Content Security Policy below needs no `connect-src` change.

**The switch is `Config.updateCheck`, on by default.** Unlike the hotkey,
an install upgrading from 0.2.16 or earlier gets it on too — there is no
pin, the release notes say so instead (D-01, D-02). Settings can turn it
off; the daily loop re-reads the config on every wake, so the change needs
no restart. Turning it off does not remove the manual button (03-03):
a user who wants no background network can still check by hand.

**A version notifies once.** `Config.updateNotified` remembers the last
version the user was told about — by the toast, by pressing Later, or by
checking by hand — and a check that finds the same version again shows
nothing more; a newer one notifies again (`should_notify`). Finding a
version also adds *Update to X.Y.Z* to the tray menu, between *Open
Promptline* and *Quit*, which stays offered until the update installs,
even past a toast that was silenced. Clicking either the toast or the tray
item shows the manager and emits `update-offer` with `{ version, notes }`;
opening only ever happens on that click, so nothing steals focus from
whatever the user was doing (D-05).

**The offer shows the release's own notes, as plain text.** `UpdateOffer.tsx`
renders "Promptline X.Y.Z is available", then `notes` run through
`releaseNotesBlocks` (`ui/core.js`) — `### heading`s, `-`/`*` items, and
paragraphs, inline marks (`` `code` ``, `*em*`, `**strong**`, `[text](url)`)
dropped — as `<h3>`/`<ul>`/`<p>` in a scrollable region, never as HTML: no
link from the feed is ever live, and nothing it carries reaches
`innerHTML`. **Install and restart** flushes the editor's pending autosave
first (`pendingFlush`, the same one `quit-requested` uses) — the updater
plugin ends the process once the install starts, so anything still only
debounced would otherwise be lost — then calls `install_update`; both
buttons read disabled and "Installing…" until it either restarts the app
or fails, when it says why and re-enables them. **Later** calls
`dismiss_update(version)` (silencing just that version, D-07) and closes,
same as Escape or a click on the overlay. A store build's `supported:
false` means `App.tsx` never opens the dialog at all, whatever event
arrives.

**Settings → About mirrors the same state.** A *Check for updates* button
beside the Version row (D-04, works with the automatic check off) calls
`check_for_updates` by hand: a version opens the same offer, none says
"You're on the latest version", and a failure says why. When the state
already holds a found version (from a startup/daily check, or from Later
on the offer) a second button, *Update to X.Y.Z*, reopens the offer
without asking again — the About card keeps offering what Later put off.
A *Check for updates automatically* checkbox saves through
`set_update_check`, optimistic with a revert and a toast on failure. All
of this — the buttons, the checkbox, and its help paragraph naming
`promptline.cc/latest.json` and how to turn the check off — is gated on
`update?.supported`: a store build's Settings shows none of it (UPD-03).

**The toast is a real Windows notification, not the webview.** Shown under
the app's AUMID (`update::APP_ID`, the same string as `tauri.conf.json`'s
`identifier`), claimed at startup with
`SetCurrentProcessExplicitAppUserModelID` before any window exists, so
taskbar grouping and the toast's origin agree with the Start Menu shortcut
the installer made. A debug build skips claiming it — it has no installed
shortcut to agree with — and shows the toast under PowerShell's id instead
(`Toast::POWERSHELL_APP_ID`), which is expected and only affects how the
toast's origin reads while developing. The `Toast` itself is intentionally
leaked once per version shown: `tauri-winrt-notification`'s `Toast` isn't
`Send`, so it can't live in the `Mutex` the pending update does, and it has
to outlive the moment `show_toast` returns for a later click to still
reach its handler.

**A failed check is silent.** Whether it's offline, a bad response or a
bad signature, the automatic check only writes a warning to
`promptline.log` — nothing is shown, so a flaky connection never
interrupts anyone. A manual check (03-03's button) reports what happened,
including "you're on the latest version".

**Installing verifies the signature first, then runs the passive
installer.** `tauri-plugin-updater` checks the download against
`plugins.updater.pubkey` before anything runs; only then does it invoke
the installer in passive mode (a small progress window, no clicks, D-08),
which relaunches Promptline once it's done — install itself is Rust
awaiting `download_and_install`, then `app.restart()` for the platforms
where the installer doesn't already relaunch it.

**A store build has none of this.** `--no-default-features` (paired with
`tauri.store.conf.json`, which also drops `plugins.updater` from the
bundle) compiles the plugin, the loop, the toast and the tray item out
entirely — not merely turned off at runtime — and `get_update_state`
answers `supported: false`, so the manager shows no update controls at
all. The store updates that copy on its own; Promptline never checks for
itself there.

## Content Security Policy

`tauri.conf.json` sets a CSP: only the app's own scripts, styles (inline
allowed — Tailwind and Base UI set style attributes), `data:` images (the
editor's select chevron) and fonts; `connect-src` is the IPC only. Tauri
injects it into the HTML it serves, so it is live in a release build and in
a dev build that uses the embedded assets; a page served by the Vite dev
server carries no CSP at all, which is why `devCsp` looks permissive (Fast
Refresh needs inline scripts and the HMR websocket) yet changes nothing
under `npm run dev`. Anything new that loads a remote resource, an inline
script, or a `blob:` URL has to be added to the policy first. The update
check and its download are made by Rust (see *Updates*), not the webview,
so neither adds anything here.

## The hotkey

**New installs default to Ctrl+Alt+V; a hotkey an install already has
never moves.** Ctrl+Shift+V, the default up to 0.2.16, is paste in
Windows Terminal and "paste without formatting" in browsers, the first
shortcut a developer trying the app would lose. The default lives in
`default_hotkey()` (`store.rs`), and serde fills it into any
`config.json` without a `hotkey` key, so changing it alone would have
moved every install that never recorded one. `settle_default_hotkey`
(`migrations.rs`) runs at startup after the folder moves and before
`ensure_packs_backed`, whose first save would otherwise write the new
default: a `config.json` without the key gets `ctrl+shift+v` written
into it, and a library (`snippets.json` or a file in `packs/`) with no
`config.json` gets a `config.json` holding `ctrl+shift+v`. Only a data
folder with none of the three (the log file doesn't count; the log
plugin creates it first) is a fresh install, and it takes Ctrl+Alt+V. A
`config.json` that fails to parse is still quarantined and replaced by
defaults, now Ctrl+Alt+V; the notice says the old hotkey is in the
quarantined file. Settings' Reset offers Ctrl+Alt+V to every install, old
or new, and its help text says who still has Ctrl+Shift+V.

The decision fails toward "existing install", because the two mistakes
are not equal: calling an existing install fresh moves its hotkey for
good, while calling a fresh one existing only costs it Ctrl+Shift+V.
`is_fresh_install` therefore counts only a plain "not found" as
absence; a lock or permission error on `config.json`, `snippets.json` or
`packs/` means existing. When the pin itself fails (`config.json` held
for longer than the rename retries, or read-only), `settle_default_hotkey`
returns false and startup does not call `ensure_packs_backed`, whose
save would write the new default over the install's hotkey; the session
registers the hotkey `config.json` still records, else Ctrl+Shift+V
(`session_hotkey`), and the next launch tries the pin again. The same
holds after a failed folder move (`migrate_data_dir` returns false): the
new folder is empty and would look fresh, but the library and its hotkey
are still in the old one, and a `config.json` written now would stop the
next launch's move from carrying the old one over.

The manager holds the hotkey as unknown until `get_config` answers, and
loads the config apart from the library, so a library that fails to load
(its own notice) cannot leave the first-run banner, the gear's tooltip,
the editor's empty-state hint and Settings naming a default the install
never registered. While it is unknown they say nothing about a specific
combination (the banner waits, the tooltip is just "Settings", the hint
says "the popup hotkey") and Settings shows an empty field with no
Reset button; a config that fails to load has its own notice.

A combination the OS refuses at startup — another program owns it — is a
notice, not a fatal error: the tray and the manager still come up, because
Settings is the only place the user could fix it. Changing the hotkey
registers the new combination *before* releasing the old one, so a refusal
leaves the old one working and the config unchanged. The `hotkey` field is
serde-defaulted like every other: a `config.json` without it (hand-edited,
or half-written) used to fail to parse and be quarantined, taking every
pack's lock and file path with it. A combination without a modifier is
refused in both places (`parse_hotkey`): the parser takes a bare `a`, and
a hand-edited config with one would capture that letter system-wide, so
`set_hotkey` returns an error and `resolve_hotkey` falls back to the
default, the same as for a string that doesn't parse at all.

The recorder in Settings emits only what `parse_hotkey` reads
(`hotkeyFromEvent` in `ui/core.js`: the held modifiers in a fixed order,
then a letter, digit, F1–F12, punctuation or named key such as `space` or
`arrowup`), and a Rust test parses every entry of that vocabulary with
every modifier. A keydown whose key the parser has no name for — Shift+1
arrives as `!`, a dead key as `Dead` — is refused at the recorder with a
message; it used to be recorded and fail at Apply.

## Theming

**Two axes: a theme and a mode.** The theme is a palette with a light and
a dark side; the mode picks the side. Settings → Appearance has Theme
(Instrument, the default, or Indigo) as a select and Mode (System / Light
/ Dark) as a segmented control, next to density, font and scale, where the
other appearance choices already were; the sidebar used to carry a Light /
Dark toggle in its footer, permanent real estate for a choice made once.
System is the default mode for a fresh install and follows Windows live
(`resolveTheme` in `ui/core.js` turns the saved preference and the
`prefers-color-scheme` match into the class; `applyPrefs` listens for the
OS switching). An explicit choice saved by an older build stays what it
was, and the legacy "sand"/"sundown" values still read as dark. Instrument
is the theme every install had before there was a choice: a config without
the field reads as Instrument (`resolvePalette`), so an upgrade changes
nothing. In config.json and localStorage the mode is still `theme` and
the theme is `palette`, the names from before there was a second axis;
renaming the key would have meant a migration for a label. With the footer
gone and the "Prompts" heading with it (the window is Promptline and the
list is visibly prompts; the landmark keeps its name through
`aria-label`), the sidebar is search, Display, New and the tree, nothing
else; the Settings gear sits at the top-right of the pane, above whatever
the pane shows.

`.dark` on `<html>` swaps CSS custom properties. It also sets `color-scheme`,
which is what makes native UI the webview paints itself — scrollbars, `<select>`
popups, form controls — follow the theme. Tokens alone leave those light.
`data-theme` on `<html>` picks the palette the same way: `design/tokens.json`
is Instrument and `design/indigo.tokens.json` is Indigo, the same format
and the same contrast floors, rendered by `npm run tokens` into regions
under `:root[data-theme="indigo"]` and `:root[data-theme="indigo"].dark`
(the attribute outranks `.dark` alone, so each theme keeps both modes).
Indigo is the AI Chat UI Pro look: a near-black ground, indigo as the one
accent, 10 px controls and 14 px cards. Three things differ between the
themes beyond colours, each a token so the components stay one definition:
the search boxes' radius (`radius-search`, a pill in Indigo), how much of
a tag's hue a resting chip's ground and edge carry (`chip-tint` and
`chip-edge`, the `mix` section; Indigo's chips are tint plus edge, the
file's state pills), and the ground under the popup's hover card
(`code-ground`, the file's code block). The one exception is the sidebar's
New button: Instrument keeps it a dashed outline, because the accent is
text only there, and Indigo fills it, because the file leads with a filled
primary; a `data-theme` rule in `index.css` does that, not a token. A
theme never chooses the font: Inter ships beside Outfit under Font, and
picking Indigo leaves the font where it was.

Three things are tokens on purpose and not literals, because each failed in
the theme it was not tuned for: the placeholder-kind colours
(`--param-builtin/-field/-config`, darker in light so chip text clears 4.5:1
on white), the segmented controls (`--segment-track/-active`, a raised tile in
dark instead of a hole), and the popup's floating shadows (`--shadow-pop`,
navy in light, black in dark). Focus is one colour (`--focus`) through one
utility (`focus-ring`, keyboard focus only). Tag hues stay dark-tuned in
`ui/core.js`; a chip sets `--tag` and the `tag-text` / `tag-tint` utilities
darken or fade it per theme — a `var(--tag)` inside a `:root` token would
resolve at `:root`, where `--tag` is unset.

**Every size is in rem, so Settings' UI scale reaches it.** The scale sets
the root font size; `text-ui` (13px at 100%, the body) was a literal
`13px`, so row titles, the search box and group headers stayed put at 125%
while the 12px first line grew to 15px and the 16px pack headers to 20px.
It and `text-micro` (11px: chips, key caps, the popup's hint bar, the `xs`
button) are the two named steps below Tailwind's `sm`; there is no
`text-[11px]` or `text-[13px]` anywhere. Pack titles in the popup's list
are the body size at 600, as in the sidebar, where they were `text-base`,
the largest text in the popup above the prompt titles the window is for.
The `{N}` badge on a row is on the fill-in tint (it counts fill-ins) rather
than the warn tint, whose text read 4.1:1 on its 15% ground in light; and
a tag's text on a dark surface is the hue lifted a fifth towards white
(`tag-text-dark`), since the raw hues clear 4.5:1 on the page but not on
the selected row's tint, where the first row always sits. A confirmation
in the popup's strip (copied, saved, restored) is Success text with no
fill, as every confirmation in `DESIGN.md`; notes (undo offered, press Esc
again) keep the neutral fill.

What a prompt looks like in a list is drawn by one module for both windows,
`src/components/prompt-bits.tsx`: the key cap, the underline that marks a
search match, the token preview (popup hover card, fill-in form, overview
card), and the Chip. Every small label is a Chip — #tags,
`{placeholders}`, the `{N}` and `+N` badges, add-suggestions, the sidebar's
search scope, the import badges — and its whole look is the `chipVariants`
table there: a `tone` for what it is, a `size` for where it sits (16px in a
row, 20px beside an editor input, inline in wrapping text). There were
thirteen hand-styled versions once, in three text sizes and three weights,
and they drifted. A difference between chips belongs in that table, never at
a call site. Two lookalikes stay apart on purpose: a key cap is a key, not a
label, and the sidebar's search-box chip draws under the input's text, so it
cannot take padding.

The rest of what both windows draw follows the same rule, one definition
each: the preview box (`PREVIEW_BOX`, grey, 13px), a pack or group's `Count`
(the bare number), key combinations (`Keys`, one cap per key), menus
(`components/menu-styles.ts`: the popup's panel for the context menus too),
fields (`components/field.tsx`: every input, textarea and select filled and
borderless; the two search boxes are the bordered exception, being the field
each window is built around), the segmented control, and the two heading
roles (`section-title` on a manager panel, `section-label` over a run of
items in a list or menu). Hover is `--hover` grey everywhere; the accent
marks what is selected and nothing else.

## Windows-specific code

Confined to `platform.rs`: `foreground_window`, `focus_window`,
`send_ctrl_v`, `left_button_down`, `open_url`. Everything else is portable.
A macOS port reimplements that file (CGEventPost, plus the Accessibility
permission) and nothing else.

The rest of the crate is split by concern, each file with its own tests:
`store.rs` (the data files: atomic writes, typed loads and quarantine, the
revision, the intent-level merges, notices), `packs.rs` (pack metadata and
paths, the reconciler, the file sync, adoption, retirement, the pack
commands' pure halves), `commands.rs` (what the webviews invoke, the
hotkey parser included), `paste.rs` (`show_popup`, `paste_snippet`, the
clamp, the popup's hide paths), `migrations.rs` (the v1 folder, the
pre-0.2.9 data folder, the v2 snippet shape), and `lib.rs` (`AppState`,
the tray, the window events, `run`). One `first_free` numbers every file
series (retired, quarantined, generated and pack files) and one
`since_epoch` stamps every time; both used to be written out per call
site. `AppState` also caches `popup_seen`, so a hotkey press no longer
parses `config.json` to learn whether it is the first.

**What the webview may point Rust at.** `read_pack_file` and
`show_in_folder` take a path from the frontend and admit it only when it
canonicalises to a file under the data folder (`path_within`, so `..` and
junctions can't escape); every path the frontend can know comes from
there. `open_data_dir` (Settings → "Open folder") takes no path at all:
it opens the data folder itself, the one place the library, the packs and
the log file all are. `open_url` opens only the addresses listed in
`OPENABLE_URLS` (today the one behind Settings' "Buy me a coffee"; the
scheme's case doesn't matter, the rest must match exactly) and refuses
anything else, then hands the listed string to `ShellExecuteW` as one
string, where the earlier `explorer <url>` let explorer parse the string
as its own command line. None of this matters
unless the bundle is compromised, which is the case it is for.

One oddity lives outside it: the popup hides on blur, but starting a
border-resize drag on an undecorated window *is* a blur, which would slam the
window shut mid-drag. `is_resize_drag` recognises the case — left button held,
cursor on or just outside the frame — and reclaims focus instead of hiding.

## Tests

```sh
npm test           # tests/*.test.js under node --test (see below)
npm run test:e2e   # e2e/*.spec.ts, both windows in Chromium on the fake backend
npm run test:rust  # the storage layer and its policies (see below)
npm run typecheck  # tsc over both windows
```

`npm test` runs two files. `tests/core.test.js` covers `ui/core.js`:
placeholders, fuzzy search and ranking, pack parsing, the rules the two
windows share (`defaultPackFor`, `removeParamToken`, pins). `tests/mock.test.js`
checks command parity: it scans `src/**` for every `invoke("…")`, `lib.rs`
for the `generate_handler![…]` list (each entry named by its module,
`commands::get_snippets`) and `src/lib/dev-mock.ts` for the
commands the fake backend answers, and fails when the three disagree — a
command the UI calls but the mock ignores hides a whole flow from the
browser walk, and one Rust never registered fails at runtime.

`npm run test:rust` is around 46 tests, each beside the module it covers
(`store.rs`, `packs.rs`, `commands.rs`, `paste.rs`, `migrations.rs`, with
the scratch folder and sample snippet they share in `lib.rs`), covering the
storage layer end to end: `write_atomic` (temp file, rename, nothing left behind),
loading with the missing / unparseable / I/O-error split and the byte-exact
quarantine of an unreadable file, the snippet and config migrations with
every field serde-defaulted (including a config without a hotkey), the
intent-level merges (`update` keeps what the popup owns, `patch` changes only
what is given, `add` replaces a duplicate id, `delete` reports change), the
pin stamp, pack filename sanitising and reserved Windows device names, pack
file adoption and write-only-when-changed, drafts backing no pack and a
draft-only file being emptied, `rename_pack` moving metadata and prompts
together and treating case variants as taken, the pack commands' pure halves
(lock finds or makes metadata, remove names the file to retire, a new name
is refused when it reads as an existing pack's, backing records the file),
the data-dir move from
`com.promptline.app` rewriting pack paths, and the starter pack's ids.

`npm run test:e2e` is the UI wiring, under Playwright: `e2e/popup.spec.ts`
and `e2e/manager.spec.ts` open each window at its real size against the
fake backend (`?mock`, the same `src/lib/dev-mock.ts` a manual browser walk
uses) and drive it the way a user does, through roles, names and keys. The
popup's cases follow "The paste pipeline": search tiers, `#tag`, Enter and
Ctrl+Enter and what `paste_snippet` was asked, the `"copied"` answer, the
double-Enter guard, the fill-in form and its empty-field button, Escape's
ladder, `paste-failed` staying until Esc, the action panel's armed delete
and the bare-U undo, Ctrl+N's title. The manager's follow "Shape": the
tree's counts and its single tab stop, folding, the editor's autosave
caption and one `update_snippet`, Ctrl+F and the `#tag` / `>group` filter,
the overview and Escape going up, Settings and the theme preference, New →
Pack and New → Prompt, delete-with-Undo through `save_snippets`, the
update offer (its title, notes and buttons, Install asking `install_update`,
Later silencing through `dismiss_update`, and the About card still
offering it afterward), the manual check's three outcomes and the
automatic-check switch through `set_update_check`, and a store build
showing no update controls anywhere in the manager. What
the backend was asked is read from `window.__mock.calls`, so a case can
say what would have been pasted without a paste happening.

The split reflects what is worth testing: pure functions and file-level
policies with real edge cases, and the two windows' own decisions through
the fake backend. What only Rust and Windows do — the paste itself, the
hotkey, window focus, file dialogs — is verified by running the app
(`CLAUDE.md`, "Verifying UI changes").
