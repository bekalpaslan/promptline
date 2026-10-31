import { RiFilterLine, RiPushpin2Line, RiSearchLine } from "@remixicon/react"
import { C, type PackMeta } from "@/lib/core"
import { cn } from "@/lib/utils"
import { Count } from "@/components/prompt-bits"
import { SELECTED_BAR } from "@/components/menu-styles"
import { PackSwatch, TREE_GLYPH, TreeChevron, TreeName, treeFillClass, treeHeaderClass } from "@/components/tree"

// The option a selected header is announced as (the header itself is hidden)
export const HEAD_OPTION_ID = "header-stop"

// What a screen reader hears of a selected header: the header is
// hidden, so an option says it in its place
export function HeadOption({ label, count, folded }: { label: string; count: number; folded: boolean }) {
  return (
    <div id={HEAD_OPTION_ID} role="option" aria-selected className="sr-only">
      {`${label}, ${folded ? "folded" : "open"}, ${C.plural(count, "prompt")}`}
    </div>
  )
}

// Funnel at the right of a pack / group header: shown on hover, or always
// while its filter is on
function Funnel({ prefix, name, active, onClick }: { prefix: "@" | ">"; name: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-pressed={active}
      title={active ? `Clear ${prefix}${name} filter` : `Filter by ${prefix}${name}`}
      aria-label={active ? `Clear ${prefix}${name} filter` : `Filter by ${prefix}${name}`}
      // Off, it waits over the count (shown on the header's hover) instead
      // of holding a 24 px slot: the slot put every header count 26 px in
      // from the rows' keys and chips, two right edges where one should be
      // (critique popup, 2026-10-09). On, it is a state and takes the slot.
      className={cn(
        "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md",
        active
          ? "bg-(--focus)/20 text-(--focus)"
          : "absolute right-0 top-0 bg-inherit text-muted-foreground opacity-0 hover:bg-hover hover:text-foreground focus-visible:opacity-100 group-hover/hdr:opacity-100"
      )}
      onClick={onClick}
    >
      <RiFilterLine className="size-3.5" />
    </button>
  )
}

// The headers are the shared tree's (components/tree.tsx): the
// sidebar's pack and group headers, drawn here on buttons. The
// 2026-10-09 band and hairline went with the one-edge layout
// (2026-10-10): the two lists are one tree on two windows.
// A section's header: a pack's (a disclosure button with the funnel at
// its right), or the plain heading of Pinned or Results.
export function PackHeader({
  name,
  count,
  collapsible,
  collapsed,
  underPinned,
  selected,
  bar,
  filtered,
  color,
  onToggle,
  onFilter,
}: {
  name: string
  /** What the heading shows: for a pack, every prompt it holds, pinned ones included */
  count: number
  /** A pack folds; Pinned and Results are plain headings */
  collapsible: boolean
  collapsed: boolean
  /** The app's own Pinned list, not a pack the user named "Pinned" */
  underPinned: boolean
  /** The keyboard is on this header */
  selected: boolean
  /** An arrow key has moved the selection since the summon: the selection bar shows only then */
  bar: boolean
  /** The pack's @filter is on */
  filtered: boolean
  color: PackMeta["color"] | undefined
  /** The header's click: fold or unfold it (and give the search box the focus back) */
  onToggle: () => void
  /** The funnel's click: the pack's @filter on or off */
  onFilter: () => void
}) {
  // The section's glyph sits in the rows' icon column: the tree's
  // chevron on a pack, a pin on Pinned, a magnifier on Results
  const Lead = underPinned ? RiPushpin2Line : RiSearchLine
  const headerClass = cn(treeHeaderClass("pack"), "flex-1 text-left", !collapsible && "cursor-default")
  const headerBody = (
    <>
      <span className={cn(TREE_GLYPH, "text-muted-foreground")}>
        {collapsible ? <TreeChevron open={!collapsed} /> : <Lead className="size-4" />}
      </span>
      <TreeName>{name}</TreeName>
      {/* The pack's colour, as in the sidebar; Pinned and Results are not packs */}
      {collapsible && <PackSwatch color={color} />}
      <Count>{count}</Count>
    </>
  )
  // Pack title, as in the sidebar: a disclosure button (← / Ctrl+→
  // from a row do the same); Pinned / Results are plain headings.
  // Hidden from assistive tech: a listbox may hold only options
  // and groups of them, and these buttons inside it had the tree
  // reported as malformed (audit popup P1). The group above
  // carries the name; the fold and the filter are reachable by
  // keyboard (← / Ctrl+→, typing @pack), and the buttons are
  // tabIndex -1 so nothing hidden is in the tab order.
  // Sticky, so the pack a row belongs to stays named while it
  // scrolls; the shell's own ground behind it hides rows passing
  // under it and the 2 px below it (painted here, pulled back by
  // the children's own 2 px). The shell's ground, so a folded
  // pack stays a plain row, as in the sidebar (the frame's card
  // ground made it a filled bar, 2026-10-10; the frame itself
  // went 2026-10-16).
  return (
    <div aria-hidden className="sticky top-0 z-10 -mb-0.5 bg-sidebar pb-0.5">
      {collapsible ? (
        <div
          data-selected={selected || undefined}
          className={cn(
            "group/hdr relative flex items-center rounded-md",
            selected && bar ? SELECTED_BAR : filtered ? "bg-(--focus)/10" : treeFillClass(false)
          )}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-expanded={!collapsed}
            title={collapsed ? "Unfold (Ctrl+→ unfolds all)" : "Fold (← on a row folds its pack or group)"}
            className={headerClass}
            onClick={onToggle}
          >
            {headerBody}
          </button>
          <Funnel prefix="@" name={name} active={filtered} onClick={onFilter} />
        </div>
      ) : (
        <div className={headerClass}>{headerBody}</div>
      )}
    </div>
  )
}

// A group's header under its pack's: the fold, the name, the count and the
// funnel, with the selection bar or the filter's tint behind it as the
// pack's has
export function GroupHeader({
  name,
  count,
  collapsed,
  selected,
  bar,
  filtered,
  onToggle,
  onFilter,
}: {
  name: string
  count: number
  collapsed: boolean
  /** The keyboard is on this header */
  selected: boolean
  /** An arrow key has moved the selection since the summon: the selection bar shows only then */
  bar: boolean
  /** The group's >filter is on */
  filtered: boolean
  /** The header's click: fold or unfold it (and give the search box the focus back) */
  onToggle: () => void
  /** The funnel's click: the group's >filter on or off */
  onFilter: () => void
}) {
  return (
    <div
      aria-hidden
      data-selected={selected || undefined}
      className={cn(
        "group/hdr relative flex scroll-mt-[30px] items-center rounded-md",
        selected && bar ? SELECTED_BAR : filtered ? "bg-(--focus)/10" : treeFillClass(false)
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-expanded={!collapsed}
        title={collapsed ? "Unfold (Ctrl+→ unfolds all)" : "Fold (← on a row folds its pack or group)"}
        // A group name is the user's words: shown as typed, never uppercased
        className={cn(treeHeaderClass("group"), "flex-1 text-left")}
        onClick={onToggle}
      >
        <span className={cn(TREE_GLYPH, "text-muted-foreground")}>
          <TreeChevron open={!collapsed} />
        </span>
        <TreeName>{name}</TreeName>
        <Count>{count}</Count>
      </button>
      <Funnel prefix=">" name={name} active={filtered} onClick={onFilter} />
    </div>
  )
}
