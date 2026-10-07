import { memo } from "react"
import { RiClipboardFill, RiClipboardLine, RiEdit2Line, RiFileTextLine, RiPushpinFill } from "@remixicon/react"
import { C, type RowIconName, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { HighlightedTitle, InputsBadge, Keys, MatchText, TagList } from "@/components/prompt-bits"
import { SELECTED_BAR } from "@/components/menu-styles"

// The popup's list row. Its own module so the design-system bundle
// (design/entry.tsx) can render the real row, not a copy; the pieces it is
// made of are shared with the manager (components/prompt-bits).

export type Entry = { s: Snippet; indices: number[] | null }

// Tag pills shown on a row before the rest fold into a "+N" overflow pill:
// one, for the hue that tells a debug prompt from a review one at a glance.
// Three left the first line, the thing that tells two similar titles
// apart, about fifteen characters at the default width (critique popup P2).
const MAX_ROW_TAGS = 1

// What a row shows beyond its snippet, worked out once per library load,
// not once per row per keystroke: the values it asks for before pasting,
// and whether it wraps the clipboard. The row's icon is worked out from
// these, the pin and the clipboard's state (`rowIcon` below).
export type Derived = { inputs: string[]; clip: boolean }
export function derive(s: Snippet): Derived {
  return { inputs: C.requiredInputs(s), clip: s.text.includes("{clipboard}") }
}

// The one icon a row shows is core's call (`C.rowIcon`: a hole first, then
// the pin, then the kind); this is what each name draws
export function rowIcon(s: Snippet, d: Derived, clipEmpty: boolean, underPinned: boolean): RowIconName {
  return C.rowIcon({ pinned: s.pinned, asks: d.inputs.length > 0, clip: d.clip }, clipEmpty, underPinned)
}
const ROW_ICONS: Record<RowIconName, typeof RiFileTextLine> = {
  "clipboard-empty": RiClipboardLine,
  pin: RiPushpinFill,
  asks: RiEdit2Line,
  clipboard: RiClipboardFill,
  plain: RiFileTextLine,
}

// The clipboard line under the popup's search box; a row that would paste
// a hole is described by it, so a screen reader hears why
export const CLIP_LINE_ID = "popup-clip"

// One list row. Memoized so an arrow key re-renders only the two rows whose
// `selected` changed, not every visible row.
export const Row = memo(function Row({
  entry,
  index,
  selected,
  picked,
  compact,
  derived,
  onPick,
  onMove,
  onLeave,
  onTag,
  activeTags,
  previewed,
  clipEmpty,
  underPinned,
  queryText,
  slot,
}: {
  entry: Entry
  index: number
  /** Ctrl+digit slot (1..5) this row answers to, if any */
  slot?: number
  selected: boolean
  picked: boolean
  compact: boolean
  derived: Derived
  onPick: (s: Snippet, paste: boolean) => void
  onMove: (i: number, e: React.MouseEvent) => void
  onLeave: () => void
  onTag: (tag: string) => void
  /** Lower-cased #terms in the query; a matching pill renders filled */
  activeTags: readonly string[]
  /** The preview card is open for this row (it describes the row) */
  previewed: boolean
  /** Clipboard is empty, so a `{clipboard}` prompt would paste a hole */
  clipEmpty: boolean
  /** Drawn under the Pinned heading, which already says what a pin icon would */
  underPinned?: boolean
  /** The query's free text, for a row the search found by its body */
  queryText?: string
}) {
  const { s, indices } = entry
  const tags = s.tags || []
  const { inputs, clip } = derived
  const usesClip = clipEmpty && clip
  // An empty clipboard hollows the icon, on a pinned row too; a fill-in row
  // keeps its pencil (its form shows the hole before anything is pasted),
  // dimmed, and every such row is described by the clipboard line. Dimmed
  // to 55%, not 40%: a state icon has to clear 3:1, and at 40% it was
  // 2.5:1 on Paper and on the selection tint (critique popup, 2026-10-03)
  const icon = rowIcon(s, derived, clipEmpty, !!underPinned)
  const RowIcon = ROW_ICONS[icon]
  // Found by its body (no title match to underline): the second line is
  // where the body matched, not the prompt's opening words
  const excerpt = queryText && !indices?.length ? C.bodyExcerpt(queryText, s.text) : null
  // The {N} badge's words reach a screen reader through the description
  const asksId = inputs.length ? `row-${s.id}-asks` : null
  const describedBy = [asksId, previewed && "popup-preview", usesClip && CLIP_LINE_ID].filter(Boolean).join(" ") || undefined
  // One pill, the rest folded into +N. The pills are text, not buttons: a
  // row is a listbox option, which may hold no interactive descendant, and
  // every row's pills used to be in the tab order. A click at one still
  // filters, handled by the row below.
  // What a screen reader gets is the option's name (the title) and its
  // description: the {N} badge's "Asks for N values before pasting", the
  // clipboard line when the row would paste a hole, the card when it is
  // open. The first line, the pill and the slot key are decoration to it
  // (aria-hidden): visible text an option's name doesn't contain reads as
  // a mismatch, and the badge's words reach it through the description.
  const chips = (
    <>
      <TagList tags={tags} max={MAX_ROW_TAGS} activeTags={activeTags} rowTarget />
      <InputsBadge inputs={inputs} id={asksId ?? undefined} />
    </>
  )
  // Ctrl is printed once, on the first slot; the rows under it show their
  // digit alone, in the same column. Five "Ctrl" caps down the right edge
  // were the loudest thing in the list and said one thing five times.
  const slotKey = slot ? <Keys combo={slot === 1 ? "Ctrl+1" : String(slot)} /> : null
  return (
    <div
      id={`row-${s.id}`}
      role="option"
      aria-selected={selected}
      aria-describedby={describedBy}
      aria-label={s.title}
      // No name tooltip: it would sit on top of the preview card the same
      // hover opens (the card carries the full title). Only the
      // empty-clipboard warning is worth a title.
      title={usesClip ? "Clipboard is empty — this prompt pastes without it" : undefined}
      data-selected={selected}
      data-icon={icon}
      className={cn(
        "flex min-w-0 scroll-mt-7 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 text-ui font-medium",
        compact ? "py-0.5" : "py-1",
        selected ? cn("bg-accent text-foreground", SELECTED_BAR) : "text-foreground hover:bg-hover",
        picked && "bg-primary/20"
      )}
      onClick={(e) => {
        const pill = (e.target as HTMLElement).closest?.("[data-tag]") as HTMLElement | null
        if (pill?.dataset.tag) onTag(pill.dataset.tag)
        else onPick(s, !e.ctrlKey)
      }}
      onMouseMove={(e) => onMove(index, e)}
      onMouseLeave={onLeave}
    >
      <RowIcon className={cn("size-3.5 shrink-0", icon === "pin" ? "text-(--warn)" : usesClip ? "opacity-55" : "opacity-70")} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        {/* The slot key at the title's right edge: it is the row's own
            address, read with the title, not with the tags */}
        <span className="flex min-w-0 items-center gap-1.5">
          <HighlightedTitle title={s.title} indices={indices} />
          {!compact && slotKey && <span aria-hidden className="ml-auto flex shrink-0">{slotKey}</span>}
        </span>
        {!compact && (
          // The first line of the prompt, with the one pill and the {N}
          // badge after it, level with its text
          <span aria-hidden className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground">
              {excerpt ? <MatchText text={excerpt.text} indices={excerpt.indices} /> : s.text.replace(/\s+/g, " ")}
            </span>
            {chips}
          </span>
        )}
      </div>
      {compact && <span aria-hidden className="contents">{chips}</span>}
      {compact && slotKey && <span aria-hidden className="contents">{slotKey}</span>}
    </div>
  )
})
