import { C } from "@/lib/core"
import { TOKEN_CHIP } from "@/lib/library"
import { cn } from "@/lib/utils"
import { Kbd as UiKbd } from "@/components/ui/kbd"

// The small pieces both windows draw for a prompt: key caps, #tag pills, the
// {N} and +N badges, match highlights, tokenized prompt text. One definition
// each, so the popup and the manager cannot drift apart; the design-system
// bundle (design/entry.tsx) renders these same components.

// The shared Kbd in the kit's 16px bordered-square idiom
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <UiKbd className="h-4 min-w-4 shrink-0 rounded-sm border border-border bg-background px-0.5 font-mono text-[11px] font-normal text-muted-foreground">
      {children}
    </UiKbd>
  )
}

const PILL = "flex shrink-0 items-center whitespace-nowrap rounded-sm border text-xs"

// One #tag pill. With `onClick` it is a filter button (`active` when the tag
// is a filter term in the query, drawn filled); without, plain text, so it can
// sit inside another button. `md` is the editor's size, level with the
// {param} chips beside it; the look is otherwise the same everywhere.
export function TagPill({
  tag,
  active,
  onClick,
  size = "sm",
  title,
  children,
}: {
  tag: string
  active?: boolean
  onClick?: (tag: string) => void
  size?: "sm" | "md"
  title?: string
  /** Extra content after the name, such as the editor's delete badge */
  children?: React.ReactNode
}) {
  const className = cn(
    PILL,
    "relative tag-text tag-border dark:tag-text-dark dark:tag-border-dark",
    size === "sm" ? "h-4 px-1" : "select-none px-2.5 py-0.5",
    active && "tag-fill"
  )
  const style = { "--tag": C.tagColor(tag) } as React.CSSProperties
  if (!onClick)
    return (
      <span className={className} style={style} title={title}>
        {tag}
        {children}
      </span>
    )
  const label = active ? `Clear #${tag} filter` : `Filter by #${tag}`
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-pressed={active}
      className={cn(className, "cursor-pointer")}
      style={style}
      title={title ?? label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick(tag)
      }}
    >
      {tag}
      {children}
    </button>
  )
}

// A prompt's first `max` tags as pills, the rest folded into a +N pill whose
// tooltip names them. A fragment, so the pills lay out in the caller's row.
export function TagList({
  tags,
  max,
  activeTags,
  onTag,
}: {
  tags: readonly string[]
  max: number
  /** Lower-cased #terms in the query; a matching pill renders filled */
  activeTags?: readonly string[]
  onTag?: (tag: string) => void
}) {
  return (
    <>
      {tags.slice(0, max).map((tag) => (
        <TagPill key={tag} tag={tag} active={activeTags?.includes(tag.toLowerCase())} onClick={onTag} />
      ))}
      {tags.length > max && (
        <span
          className={cn(PILL, "h-4 border-border px-1 tabular-nums text-muted-foreground")}
          title={tags.slice(max).map((t) => `#${t}`).join(", ")}
        >
          +{tags.length - max}
        </span>
      )}
    </>
  )
}

// {N}: the prompt asks for N values before it pastes
export function InputsBadge({ inputs }: { inputs: readonly string[] }) {
  if (!inputs.length) return null
  return (
    <span
      className={cn(PILL, "h-4 border-(--warn)/40 px-1 tabular-nums text-(--warn)")}
      title={`Asks for ${inputs.length} value${inputs.length === 1 ? "" : "s"} before pasting: ${inputs.join(", ")}`}
    >
      {"{"}{inputs.length}{"}"}
    </span>
  )
}

// How a search match is marked in a title, in either window: the kit's
// underline, which leaves the text's own colour alone
export const MATCH_HIT = "underline decoration-solid underline-offset-2"

// A title with its matched characters marked. Segments come from core so
// UTF-16 match indices line up with code points (emoji).
export function HighlightedTitle({ title, indices }: { title: string; indices: number[] | null }) {
  if (!indices?.length) return <span className="truncate">{title}</span>
  return (
    <span className="truncate">
      {C.highlightSegments(title, indices).map((seg, i) => (
        <span key={i} className={seg.hit ? MATCH_HIT : undefined}>
          {seg.text}
        </span>
      ))}
    </span>
  )
}

// Prompt text with its placeholders as typed chips, the one renderer for every
// preview. {clipboard} shows the clipboard as it is now (BEHAVIOR.md: it
// expands at paste time, so a preview must show what would go in), on the
// builtin's tint so it still reads as a placeholder; so does a filled-in
// field. A config parameter shows its saved value when there is one.
export function PromptTokens({
  text,
  clipboard,
  configValues,
  fieldValues,
}: {
  text: string
  /** The clipboard as it is now; null until it has been read */
  clipboard: string | null
  configValues?: Record<string, string>
  /** Values typed into the fill-in form so far */
  fieldValues?: Record<string, string>
}) {
  return (
    <>
      {C.tokenize(text).map((part, i) => {
        if (part.type === "text") return <span key={i}>{part.value}</span>
        const filled =
          part.type === "builtin" && part.name === "clipboard" && clipboard !== null
            ? C.clipboardPreview(clipboard)
            : part.type === "field" && fieldValues?.[part.name]
              ? fieldValues[part.name]
              : null
        if (filled !== null) {
          const tint = part.type === "field" ? "bg-(--param-field-bg)" : "bg-(--param-builtin-bg)"
          return (
            <span
              key={i}
              className={cn("rounded-sm px-0.5 text-foreground", tint)}
              title={part.type === "field" ? `${part.name}, as filled in` : "The clipboard as it is now"}
            >
              {filled}
            </span>
          )
        }
        let label: string
        if (part.type === "bad") {
          label = `${part.name} — not a param (lowercase letters, digits and _, not starting with a digit)`
        } else if (part.type === "config") {
          const v = (configValues?.[part.name] || "").replace(/\s+/g, " ")
          label = v ? (v.length > 40 ? v.slice(0, 40) + "…" : v) : `${part.name} — config (unset)`
        } else if (part.type === "builtin") {
          label = part.name
        } else {
          label = `${part.name} — fill-in`
        }
        return (
          <span key={i} className={cn("rounded-sm px-1 text-xs font-semibold", TOKEN_CHIP[part.type])}>
            {label}
          </span>
        )
      })}
    </>
  )
}
