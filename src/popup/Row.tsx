import { memo } from "react"
import { RiClipboardLine, RiEdit2Line, RiFileTextLine, RiPushpinFill } from "@remixicon/react"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { HighlightedTitle, InputsBadge, Kbd, TagList } from "@/components/prompt-bits"

// The popup's list row. Its own module so the design-system bundle
// (design/entry.tsx) can render the real row, not a copy; the pieces it is
// made of are shared with the manager (components/prompt-bits).

export type Entry = { s: Snippet; indices: number[] | null }

// Tag pills shown on a row before the rest fold into a "+N" overflow pill
const MAX_ROW_TAGS = 3

// What a row shows beyond its snippet, worked out once per library load,
// not once per row per keystroke
export type Derived = { inputs: string[]; Icon: typeof RiFileTextLine }
export function derive(s: Snippet): Derived {
  const inputs = C.requiredInputs(s)
  const Icon = s.pinned ? RiPushpinFill : inputs.length ? RiEdit2Line : s.text.includes("{clipboard}") ? RiClipboardLine : RiFileTextLine
  return { inputs, Icon }
}

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
  const { inputs, Icon } = derived
  const usesClip = clipEmpty && s.text.includes("{clipboard}")
  // Up to three pills keep a line to itself; the rest fold into +N
  const chips = (
    <>
      <TagList tags={tags} max={MAX_ROW_TAGS} activeTags={activeTags} onTag={onTag} />
      <InputsBadge inputs={inputs} />
    </>
  )
  return (
    <div
      id={`row-${s.id}`}
      role="option"
      aria-selected={selected}
      aria-describedby={previewed ? "popup-preview" : undefined}
      aria-label={s.title}
      // No name tooltip: it would sit on top of the preview card the same
      // hover opens. Only the empty-clipboard warning is worth a title.
      title={usesClip ? "Clipboard is empty — {clipboard} will paste nothing" : undefined}
      data-selected={selected}
      className={cn(
        "flex min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 text-ui font-medium",
        compact ? "py-0.5" : "py-1",
        selected ? "bg-accent text-foreground" : "text-foreground hover:bg-hover",
        picked && "bg-primary/20"
      )}
      onClick={(e) => onPick(s, !e.ctrlKey)}
      onMouseMove={(e) => onMove(index, e)}
      onMouseLeave={onLeave}
    >
      <Icon className={cn("size-3.5 shrink-0", s.pinned ? "text-(--warn)" : "opacity-70")} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="flex min-w-0 items-center">
          <HighlightedTitle title={s.title} indices={indices} />
        </span>
        {!compact && (
          // The chips sit on the preview's line, level with its text, and
          // leave the title the row's full width
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground">{s.text.replace(/\s+/g, " ")}</span>
            {chips}
          </span>
        )}
      </div>
      {compact && chips}
      {slot && (
        <span className="flex shrink-0 gap-1">
          <Kbd>Ctrl</Kbd>
          <Kbd>{slot}</Kbd>
        </span>
      )}
    </div>
  )
})
