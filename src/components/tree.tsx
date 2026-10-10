import type { ComponentProps, ReactNode } from "react"
import { RiArrowDownSLine, RiArrowRightSLine, RiPushpinLine } from "@remixicon/react"

import { cn } from "@/lib/utils"
import { SELECTED_BAR } from "@/components/menu-styles"
import { panelBodyClass, panelClass } from "@/components/panel"

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
// secondary one, each with its fold chevron on the outer edge and its
// count at the right; an open pack framed, every row and group header
// inside it spanning the frame, titles under the chevrons. What a
// header *is* differs by
// window (a treeitem with a roving tab stop in the sidebar, an aria-hidden
// button in the popup), so the windows keep their own elements and
// handlers and draw them with these parts.

export type TreeLevel = "pack" | "group"

// Keyboard focus on a tree row or header: the hover grey, no ring. The
// focus ring (a 2 px glow in the Focus colour) sat around the sidebar's
// focused header or row, over the bar that already says which row is the
// cursor; the user wanted the glow gone (2026-10-10). The fill still
// shows a keyboard user where they are, as it shows a pointer.
export const TREE_FOCUS = "outline-none focus-visible:bg-hover"

// The header row's layout and type; the element and its fill are the
// caller's. Pack and group headers alike span the frame, 8 px of padding
// each side, so a group's chevron lands under the pack's and its name on
// the pack's name column, and every count ends on the rows' right edge
// (keys, chips) in both windows.
export const treeHeaderClass = (level: TreeLevel) =>
  cn(
    "flex min-w-0 cursor-pointer select-none items-center gap-1 rounded-md px-2 py-1 text-ui",
    level === "pack" ? "font-semibold text-(--heading-strong)" : "font-medium text-(--heading)"
  )

// A header's fill: the hover grey under the pointer, or, in the popup once
// an arrow key has moved the selection onto it, the bar (SELECTED_BAR,
// menu-styles.ts). The sidebar's shown pack or group carries no mark.
export const treeFillClass = (bar: boolean) => (bar ? SELECTED_BAR : "hover:bg-hover")

// A prompt row's layout and type; the element, its fill and its bars are
// the caller's. 2 px above and below in every row, in both windows: a
// title-only row is 24 px (the sidebar's always, the popup's in Compact
// density), and the popup's Comfortable row is the same row with its
// excerpt line under the title, 40 px. A row's box spans the frame like
// a header's, with the header's 8 px padding, so its title starts where
// the chevrons do, 20 px left of the names: the frame says what the rows
// belong to, so they need no step (the user's calls, 2026-10-10; the
// steps tried before are in BEHAVIOR.md and the log). The sidebar's
// drag grip sits at the row's right, absolute, so it adds nothing; the
// popup's rows keep that empty.
export const treeRowClass = "relative flex min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-0.5 text-ui font-medium"

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
// Open, the pack is the expandable panel (components/panel.tsx), the
// editor's Prompt panel in small: the header on the panel's head ground
// as its title line, and its rows and groups on the body ground under it,
// the way the Prompt field sits under its title (the user asked for the
// frame, 2026-10-10). The frame pulls out by its own 1 px edge, so the
// header and the rows keep the x they have folded and the chevron stays
// in the strips' glyph column; the scroller around the tree keeps a
// pixel of padding for it (the sidebar's 12, the popup list's own 1), or
// the edge is clipped and the list scrolls sideways by one. Folded, a
// pack is a header row like any other.
export function TreeSection({ open, className, ...props }: ComponentProps<"div"> & { open?: boolean }) {
  return <div className={cn("mb-4", open && cn(panelClass, "-mx-px"), className)} {...props} />
}

// One group inside a pack: its header and, unfolded, its rows
export function TreeGroup({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-0.5", className)} {...props} />
}

// The run of rows under a header, 2 px apart. A pack's are the panel's
// body, with 2 px of air above and below, edge to edge, so a row's box
// and a group's header span the frame like the pack's header (their
// titles under the chevrons, see treeRowClass). A group's rows sit where
// the pack's own do: the row's inset is margin enough, and the group
// header above says whose they are (the user's call, 2026-10-10; they
// hung from a guide line under the group's chevron, 21 px further in,
// before).
export function TreeChildren({ level, className, ...props }: ComponentProps<"div"> & { level: TreeLevel }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5",
        level === "pack" && cn(panelBodyClass, "py-0.5"),
        className
      )}
      {...props}
    />
  )
}
