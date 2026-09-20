import { memo } from "react"
import { RiClipboardLine, RiEdit2Line, RiFileTextLine, RiPushpinFill } from "@remixicon/react"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { Kbd as UiKbd } from "@/components/ui/kbd"

// The popup's list row and the pieces it is made of. Its own module so the
// design-system bundle (design/entry.tsx) can render the real row, not a copy.

export type Entry = { s: Snippet; indices: number[] | null }

// Tag pills shown on a row before the rest fold into a "+N" overflow pill
const MAX_ROW_TAGS = 3

// The shared Kbd in the kit's 16px bordered-square idiom
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <UiKbd className="h-4 min-w-4 shrink-0 rounded-sm border border-border bg-background px-0.5 font-mono text-[11px] font-normal text-muted-foreground">
      {children}
    </UiKbd>
  )
}


// One #tag pill; `active` when the tag is a filter term in the query
export function TagPill({ tag, active, onClick }: { tag: string; active?: boolean; onClick?: (tag: string) => void }) {
  const c = C.tagColor(tag)
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-pressed={active}
      className={cn(
        "flex h-4 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-sm border px-1 text-xs tag-text tag-border dark:tag-text-dark dark:tag-border-dark",
        active && "tag-fill",
      )}
      style={{ "--tag": c } as React.CSSProperties}
      title={active ? `Clear #${tag} filter` : `Filter by #${tag}`}
      aria-label={active ? `Clear #${tag} filter` : `Filter by #${tag}`}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(tag)
      }}
    >
      {tag}
    </button>
  )
}


// The kit highlights matched characters with an underline. Segments come
// from core so UTF-16 match indices line up with code points (emoji).
export function HighlightedTitle({ title, indices }: { title: string; indices: number[] | null }) {
  if (!indices?.length) return <span className="truncate">{title}</span>
  return (
    <span className="truncate">
      {C.highlightSegments(title, indices).map((seg, i) => (
        <span key={i} className={seg.hit ? "underline decoration-solid underline-offset-2" : undefined}>
          {seg.text}
        </span>
      ))}
    </span>
  )
}


// library load, not once per row per keystroke
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
          <span className="truncate text-xs font-normal text-muted-foreground">{s.text.replace(/\s+/g, " ")}</span>
        )}
      </div>
      {/* Up to three pills keep the row single-line; the rest fold into +N */}
      {tags.slice(0, MAX_ROW_TAGS).map((tag) => (
        <TagPill key={tag} tag={tag} active={activeTags.includes(tag.toLowerCase())} onClick={onTag} />
      ))}
      {tags.length > MAX_ROW_TAGS && (
        <span
          className="flex h-4 shrink-0 items-center whitespace-nowrap rounded-sm border border-border px-1 text-xs tabular-nums text-muted-foreground"
          title={tags.slice(MAX_ROW_TAGS).map((t) => `#${t}`).join(", ")}
        >
          +{tags.length - MAX_ROW_TAGS}
        </span>
      )}
      {inputs.length > 0 && (
        <span
          className="flex h-4 shrink-0 items-center rounded-sm border border-(--warn)/40 px-1 text-xs tabular-nums text-(--warn)"
          title={`Asks for ${inputs.length} value${inputs.length === 1 ? "" : "s"} before pasting: ${inputs.join(", ")}`}
        >
          {"{"}{inputs.length}{"}"}
        </span>
      )}
      {slot && (
        <span className="flex shrink-0 gap-1">
          <Kbd>Ctrl</Kbd>
          <Kbd>{slot}</Kbd>
        </span>
      )}
    </div>
  )
})
