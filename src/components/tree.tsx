import type { ComponentProps, ReactNode } from "react"
import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react"

import { cn } from "@/lib/utils"
import { SELECTED_BAR } from "@/components/menu-styles"

// A pinned prompt's mark in both trees: the selection bar's shape in the
// Warn colour, at the row's left edge; the selection bar wins on a row
// that is both. The sidebar's legend names the two colours.
export const PINNED_BAR = "shadow-[inset_1.5px_0_0_var(--warn)]"

// The library tree, one look in both windows. The manager's sidebar and
// the popup's list are the same tree on different windows (decision
// 2026-10-10), so what a level looks like is written once here: a pack
// header bold in the strong heading ink, a group header medium in the
// secondary one, each with its fold chevron on the outer edge and its
// count at the right; a pack's children stepped 12 px in, a group's hung
// from a guide line under its chevron. What a header *is* differs by
// window (a treeitem with a roving tab stop in the sidebar, an aria-hidden
// button in the popup), so the windows keep their own elements and
// handlers and draw them with these parts.

export type TreeLevel = "pack" | "group"

// The header row's layout and type; the element and its fill are the
// caller's. The same 8 px side padding as a prompt row, so a header's
// count ends on the rows' right edge (keys, chips) in both windows.
export const treeHeaderClass = (level: TreeLevel) =>
  cn(
    "flex min-w-0 cursor-pointer select-none items-center gap-1 rounded-md px-2 py-1 text-ui",
    level === "pack" ? "font-semibold text-(--heading-strong)" : "font-medium text-(--heading)"
  )

// A header's fill: the hover grey under the pointer; the shown or
// selected pack or group carries the bar instead of a tint (SELECTED_BAR)
export const treeFillClass = (selected: boolean) => (selected ? SELECTED_BAR : "hover:bg-hover")

// A prompt row's layout and type; the element, its fill and its bars are
// the caller's. A title-only row is the compact one, 24 px: the sidebar's
// rows are always that, and the popup's in Compact density (the user
// liked the popup's compact tree and asked for the sidebar to match it,
// 2026-10-10); the popup's two-line row in Comfortable takes 4 px more
// each side for its excerpt line.
export const treeRowClass = (compact: boolean) =>
  cn("flex min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 text-ui font-medium", compact ? "py-0.5" : "py-1")

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
// one row gap short of a row, let the packs run together; 2026-10-10)
export function TreeSection({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mb-4", className)} {...props} />
}

// One group inside a pack: its header and, unfolded, its rows
export function TreeGroup({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-0.5", className)} {...props} />
}

// The run of rows under a header, 2 px apart. A pack's step in 12 px; a
// group's hang from a guide line centred under the group's chevron (the
// header's 8 px padding plus half the 16 px chevron), 4 px past it.
export function TreeChildren({ level, className, ...props }: ComponentProps<"div"> & { level: TreeLevel }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5",
        level === "pack" ? "mt-0.5 pl-3" : "ml-4 border-l border-border pl-1",
        className
      )}
      {...props}
    />
  )
}
