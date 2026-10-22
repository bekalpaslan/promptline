import type { ComponentProps, ReactNode } from "react"
import { RiArrowDownSLine, RiArrowRightSLine, RiPushpinLine } from "@remixicon/react"

import { cn } from "@/lib/utils"
import { SELECTED_BAR } from "@/components/menu-styles"

// A pinned prompt's mark in the manager: a quiet pin at the right of its
// row in the sidebar and of its card's title in the overview, the muted
// ink and small. The popup draws none: its Pinned section says it. It
// was a 1.5 px Warn bar at the row's left edge in both trees and on the
// card, with a legend at the sidebar's foot, until 2026-10-10, when the
// user found the bar a glow and asked for a colourless pin instead.
export function PinMark() {
  return <RiPushpinLine data-pin aria-hidden className="size-3 shrink-0 text-muted-foreground opacity-70" />
}

// The library tree, one look in both windows. The manager's sidebar and
// the popup's list are the same tree on different windows (decision
// 2026-10-10), so what a level looks like is written once here: a pack
// header bold and a group header medium, both in the body ink, each
// with its fold chevron before its name and its
// count at the right; every row and group header under it spanning the
// pack's width, each level's titles one glyph slot (24 px) further in
// than the level above (the indent, below); no frame, ground or edge
// around an open pack (it was the expandable panel from 2026-10-10 to
// 2026-10-16, when the user found the card look wrong in the sidebar and
// had it go). What a header *is* differs by
// window (a treeitem with a roving tab stop in the sidebar, an aria-hidden
// button in the popup), so the windows keep their own elements and
// handlers and draw them with these parts. Both headers are set one
// step above the rows (14 px to the rows' 13, Tailwind's `sm` over the
// body `text-ui`, on the same 20 px line so the 28 and 24 px rows keep
// their height): the user found a pack's or group's name lost among its
// rows at the body size (2026-10-22), where weight and ink alone had
// told the levels apart since 2026-10-10. The size says "a heading" and
// the weight and ink still say which; the rows stay the body, since
// they are what both windows are for.

export type TreeLevel = "pack" | "group"

// Keyboard focus on a sidebar row or header: the hover grey and a 1 px
// hairline inside the row's edge in the input-edge ink, no ring and no
// hue. The focus ring (a 2 px glow in the Focus colour) sat around the
// focused header or row, over the bar that then said which row was the
// cursor; the user wanted the glow gone (2026-10-10), and the fill alone
// stood for the cursor until 2026-10-16, when the critique found that a
// pointer resting on the tree drew a second cursor in the same grey. The
// hairline tells the keyboard's row from the pointer's; on a selected
// row (below) the fill stays the selection's and the hairline alone says
// the cursor is here.
export const TREE_FOCUS = "outline-none not-aria-selected:focus-visible:bg-hover focus-visible:shadow-[inset_0_0_0_1px_var(--input)]"

// The sidebar's selection: the open prompt's row, the shown pack's or
// group's header and every row in a multi-select carry the Band grey, a
// step heavier than the hover grey in both modes and no hue, so a glance
// back from the pane finds the prompt the pane shows; the hover grey goes
// on the rest under the pointer. The selection was unmarked from
// 2026-10-10 (the Focus bar read as a glow on the real screen, and the
// Selection tint before it as a green row) to 2026-10-16, when the
// critique found the cursor lost at every Tab to the pane and back.
export const TREE_SELECTED = "aria-selected:bg-band not-aria-selected:hover:bg-hover"

// Each level of the tree steps one glyph slot (24 px, TREE_GLYPH below)
// further in, on the text, never on the box. A row's or header's box
// spans the pack's width, so the hover grey, the drop highlight and the
// right-edge column (counts, keys, pins) stay edge to edge; what moves is
// where its chevron or title starts: a pack's slot flush at the box's
// edge (its chevron 4 px in, centred in the slot) and its name at 24,
// the pack's own rows and a group's slot at 24, a group's name and its
// rows at 48. So a group's rows sit under the group's name, the pack's
// own under the pack's, and a title says its level by where it stands
// even when the header above has scrolled away. The children's run
// (TreeChildren) sets the inset for everything in it as `--tree-indent`;
// a header or row outside any run (a pack header, the sidebar's flat
// list while sorting by uses or title) starts at the edge. In rem so the
// UI scale carries it. No side padding, as the dicehub kit's tree has
// none: the user's call on 2026-10-22, after 4 px for a day and 8 px
// (with a 20 px step, the 16 px chevron and its 4 px gap, which put the
// chevron on the popup's search-icon column) from 2026-10-16; the rest
// of that comparison stayed (28 px pack headers, counts, the rounded
// fill, no guide line, no per-row delete). From 2026-10-10 to 2026-10-16
// every title stood on the chevron column and the levels differed by
// weight and ink alone; the critique of 2026-10-16 found a group's
// prompts indistinguishable from the pack's own once the group's header
// had scrolled off, and the user chose the full step.
const INDENT_PACK_CHILDREN = "[--tree-indent:1.5rem]"
const INDENT_GROUP_CHILDREN = "[--tree-indent:3rem]"
const INDENT = "pl-[var(--tree-indent,0px)] pr-0"

// The glyph slot a header's chevron (or the pin and search glyphs on the
// popup's Pinned and Results headers) sits in: 24 px wide and the row's
// 20 px line tall (so a header keeps its height), the 16 px glyph
// centred, so the next level's text starts one slot in. The
// header's 4 px gap would push the name to 28; the slot's negative
// margin folds that gap under itself, so the name starts at the slot's
// edge and the 24 px step holds. The sidebar's fold button is the slot
// itself (its hover fill is the slot); the popup wraps its glyph in a
// span with it.
export const TREE_GLYPH = "-mr-1 flex h-5 w-6 shrink-0 items-center justify-center"

// The header row's layout and type; the element and its fill are the
// caller's. A pack header is 28 px and starts at the box's edge; a
// group header is 24 px, a row's height, and takes its run's inset
// (above), so its chevron lands under the pack's rows' titles and its
// name one column further; every count ends on the rows' right edge
// (keys, chips) in both windows. The group header was 28 px like the
// pack's until 2026-10-16: the two headers had one silhouette and only
// the ink told them apart, so the pack keeps the taller row and a group
// is a quieter line among its rows. Both names are a step larger than a
// row's title (`text-sm`, see the top) and both in the body ink
// (`--heading-strong`), the bright lines over the rows' secondary grey
// (treeRowClass): the user asked for "prompts secondary gray and groups
// body ink" on 2026-10-22, once the groups had grown to the headers'
// size and read as bigger but dimmer than their own rows. A group was
// the secondary ink (`--heading`, the module titles') from 2026-10-10,
// a quieter line by colour; now it is quieter by weight alone. The
// count beside a name keeps its own size and ink (`Count`,
// prompt-bits.tsx).
export const treeHeaderClass = (level: TreeLevel) =>
  cn(
    "flex min-w-0 cursor-pointer select-none items-center gap-1 rounded-md text-sm text-(--heading-strong)",
    level === "pack" ? "py-1 font-semibold" : `${INDENT} py-0.5 font-medium`
  )

// A header's fill: the hover grey under the pointer, or, in the popup once
// an arrow key has moved the selection onto it, the bar (SELECTED_BAR,
// menu-styles.ts). The sidebar's shown pack or group carries no mark.
export const treeFillClass = (bar: boolean) => (bar ? SELECTED_BAR : "hover:bg-hover")

// A prompt row's layout and type; the element, its fill and its bars are
// the caller's. 2 px above and below in every row, in both windows: a
// title-only row is 24 px (the sidebar's always, the popup's in Compact
// density), and the popup's Comfortable row is the same row with its
// excerpt line under the title, 40 px. A row's box spans the pack's width
// like a header's; its title starts at its run's inset (above), under the
// name of the header it belongs to. The sidebar's drag grip sits at the
// row's right, absolute, so it adds nothing; the popup's rows keep that
// empty. The title is the secondary grey (`muted-foreground`, the ink
// the counts and the popup's first lines already wear), so the headers
// in the body ink are the bright lines and the prompts the quiet run
// under them (user, 2026-10-22; the rows were the body ink before, and
// the groups the grey). Weight and size still part a title from the
// popup's first line under it (13/500 over 12/400).
export const treeRowClass = `relative flex min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-md ${INDENT} py-0.5 text-ui font-medium text-muted-foreground`

// The fold chevron's glyph; the slot it sits in is the caller's (TREE_GLYPH)
export function TreeChevron({ open, className }: { open: boolean; className?: string }) {
  const Chev = open ? RiArrowDownSLine : RiArrowRightSLine
  return <Chev className={cn("size-4 shrink-0", className)} />
}

// A pack or group name: the user's words, shown as typed, truncated, and
// isolated so a Hebrew name or a pasted direction control can't reorder
// what sits beside it
export function TreeName({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 flex-1 truncate">
      <bdi>{children}</bdi>
    </span>
  )
}

// One pack: its header and, unfolded, its children; 2 px to the next
// pack, the rows' own gap, so the list is one flat run that the indent
// alone divides, as the dicehub kit's tree is (2026-10-22). It was 16 px
// from 2026-10-10 (8 before, and the packs ran together in a list of
// compact rows) until the user, setting the tree against that kit's,
// chose its flat rhythm with the 24 px step to tell the levels apart.
// Open or folded, a pack draws nothing of its own: the header is a row
// like any other and the children sit under it on the list's ground.
// From 2026-10-10 to 2026-10-16 an open pack was the expandable panel
// (components/panel.tsx), the header on its head ground and the rows on
// its body ground inside a 1 px edge; the user found the card look wrong
// in the sidebar and had it go. The panel stays where a thing folds open
// to something other than rows (the editor's Prompt, Settings' pack
// cards, the popup's clipboard).
export function TreeSection({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mb-0.5", className)} {...props} />
}

// One group inside a pack: its header and, unfolded, its rows, with the
// run's 2 px above and below like any row: the rhythm is 2 / 2 / 2 for
// pack / group / row since 2026-10-22, the dicehub kit's flat run. From
// 2026-10-16 a group had 6 px of its own above it (8 with the gap, half
// the 16 between packs), because through 2026-10-16 a pack's loose rows,
// a group's header and the group's rows had read as one run at the rows'
// 2 px; they are one run again by the user's choice, and the 24 px step
// now tells them apart.
export function TreeGroup({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-0.5", className)} {...props} />
}

// The run of rows under a header, 2 px apart, the first 2 px under its
// header like the rest, edge to edge, so a row's box and a group's
// header span the pack's width like the pack's header. The run sets the
// inset its rows and headers start at (`--tree-indent`, see the top): a
// pack's run puts its rows' titles and its groups' chevrons on the
// pack's name column, a group's run puts its rows' titles on the group's
// name column, one glyph slot further. The rows hung from a guide line
// under the group's chevron until 2026-10-10, then sat where the pack's
// own did until 2026-10-16.
export function TreeChildren({ level, className, ...props }: ComponentProps<"div"> & { level: TreeLevel }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5",
        level === "pack" ? `pt-0.5 ${INDENT_PACK_CHILDREN}` : INDENT_GROUP_CHILDREN,
        className
      )}
      {...props}
    />
  )
}
