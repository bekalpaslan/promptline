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
// header bold in the strong heading ink, a group header medium in the
// secondary one, each with its fold chevron before its name and its
// count at the right; every row and group header under it spanning the
// pack's width, each level's titles one glyph column further in than the
// level above (the indent, below); no frame, ground or edge
// around an open pack (it was the expandable panel from 2026-10-10 to
// 2026-10-16, when the user found the card look wrong in the sidebar and
// had it go). What a header *is* differs by
// window (a treeitem with a roving tab stop in the sidebar, an aria-hidden
// button in the popup), so the windows keep their own elements and
// handlers and draw them with these parts.

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

// Each level of the tree steps one glyph column (20 px: the 16 px chevron
// and its 4 px gap) further in, on the text, never on the box. A row's or
// header's box spans the pack's width, so the hover grey, the drop
// highlight and the right-edge column (counts, keys, pins) stay edge to
// edge; what moves is where its chevron or title starts: a pack's chevron
// at 8 px and its name at 28, the pack's own rows and a group's chevron
// at 28, a group's name and its rows at 48. So a group's rows sit under
// the group's name, the pack's own under the pack's, and a title says its
// level by where it stands even when the header above has scrolled away.
// The children's run (TreeChildren) sets the inset for everything in it
// as `--tree-indent`; a header or row outside any run (a pack header, the
// sidebar's flat list while sorting by uses or title) starts at the 8 px
// side padding. In rem so the UI scale carries it. From 2026-10-10 to
// 2026-10-16 every title stood on the chevron column and the levels
// differed by weight and ink alone; the critique of 2026-10-16 found a
// group's prompts indistinguishable from the pack's own once the group's
// header had scrolled off, and the user chose the full step.
const INDENT_PACK_CHILDREN = "[--tree-indent:1.75rem]"
const INDENT_GROUP_CHILDREN = "[--tree-indent:3rem]"
const INDENT = "pl-[var(--tree-indent,0.5rem)] pr-2"

// The header row's layout and type; the element and its fill are the
// caller's. A pack header is 28 px and starts at the side padding; a
// group header is 24 px, a row's height, and takes its run's inset
// (above), so its chevron lands under the pack's rows' titles and its
// name one column further; every count ends on the rows' right edge
// (keys, chips) in both windows. The group header was 28 px like the
// pack's until 2026-10-16: the two headers had one silhouette and only
// the ink told them apart, so the pack keeps the taller row and a group
// is a quieter line among its rows.
export const treeHeaderClass = (level: TreeLevel) =>
  cn(
    "flex min-w-0 cursor-pointer select-none items-center gap-1 rounded-md text-ui",
    level === "pack" ? "px-2 py-1 font-semibold text-(--heading-strong)" : `${INDENT} py-0.5 font-medium text-(--heading)`
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
// empty.
export const treeRowClass = `relative flex min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-md ${INDENT} py-0.5 text-ui font-medium`

// The fold chevron, in the glyph column every row shares
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

// One pack: its header and, unfolded, its children; 16 px to the next
// pack, so a pack reads as its own block in a list of compact rows (8 px,
// one row gap short of a row, let the packs run together; 2026-10-10).
// Open or folded, a pack draws nothing of its own: the header is a row
// like any other and the children sit under it on the list's ground.
// From 2026-10-10 to 2026-10-16 an open pack was the expandable panel
// (components/panel.tsx), the header on its head ground and the rows on
// its body ground inside a 1 px edge; the user found the card look wrong
// in the sidebar and had it go. The panel stays where a thing folds open
// to something other than rows (the editor's Prompt, Settings' pack
// cards, the popup's clipboard).
export function TreeSection({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mb-4", className)} {...props} />
}

// One group inside a pack: its header and, unfolded, its rows. 6 px above
// it, so with the run's 2 px a group header stands 8 px off the row or
// header before it, half the gap between packs, and none below: the
// rhythm is 16 / 8 / 2 for pack / group / row. With the same 2 px before
// a group header as before any row (through 2026-10-16) a pack's loose
// rows, a group's header and the group's rows were one run.
export function TreeGroup({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-1.5 flex flex-col gap-0.5", className)} {...props} />
}

// The run of rows under a header, 2 px apart, the first 2 px under its
// header like the rest, edge to edge, so a row's box and a group's
// header span the pack's width like the pack's header. The run sets the
// inset its rows and headers start at (`--tree-indent`, see the top): a
// pack's run puts its rows' titles and its groups' chevrons on the
// pack's name column, a group's run puts its rows' titles on the group's
// name column, one glyph column further. The rows hung from a guide line
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
