import { memo } from "react"
import { RiClipboardFill, RiClipboardLine, RiEdit2Line, RiFileTextLine, RiPushpinFill } from "@remixicon/react"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { HighlightedTitle, InputsBadge, Keys, TagList } from "@/components/prompt-bits"

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
// not once per row per keystroke. A prompt that wraps the clipboard gets a
// filled clipboard icon; the row hollows it while the clipboard is empty
// (`usesClip` below), so a paste that would leave a hole is visible before
// Enter, not in the terminal after it (critique popup P1).
export type Derived = { inputs: string[]; Icon: typeof RiFileTextLine; clip: boolean }
export function derive(s: Snippet): Derived {
  const inputs = C.requiredInputs(s)
  const clip = s.text.includes("{clipboard}")
  const Icon = s.pinned ? RiPushpinFill : inputs.length ? RiEdit2Line : clip ? RiClipboardFill : RiFileTextLine
  return { inputs, Icon, clip }
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
}) {
  const { s, indices } = entry
  const tags = s.tags || []
  const { inputs, Icon, clip } = derived
  const usesClip = clipEmpty && clip
  // An empty clipboard hollows the icon; a pinned or fill-in row keeps its
  // own icon and is still described by the clipboard line
  const RowIcon = usesClip && Icon === RiClipboardFill ? RiClipboardLine : Icon
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
  const slotKey = slot ? <Keys combo={`Ctrl+${slot}`} /> : null
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
      title={usesClip ? "Clipboard is empty — {clipboard} will paste nothing" : undefined}
      data-selected={selected}
      className={cn(
        "flex min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 text-ui font-medium",
        compact ? "py-0.5" : "py-1",
        selected ? "bg-accent text-foreground" : "text-foreground hover:bg-hover",
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
      <RowIcon className={cn("size-3.5 shrink-0", s.pinned ? "text-(--warn)" : usesClip ? "opacity-40" : "opacity-70")} aria-hidden />
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
            <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground">{s.text.replace(/\s+/g, " ")}</span>
            {chips}
          </span>
        )}
      </div>
      {compact && <span aria-hidden className="contents">{chips}</span>}
      {compact && slotKey && <span aria-hidden className="contents">{slotKey}</span>}
    </div>
  )
})
