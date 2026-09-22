import { cva, type VariantProps } from "class-variance-authority"
import { RiAddLine, RiCloseLine } from "@remixicon/react"
import { C } from "@/lib/core"
import { cn } from "@/lib/utils"
import { Kbd as UiKbd } from "@/components/ui/kbd"

// The small pieces both windows draw for a prompt: key caps, chips (#tags,
// placeholders, badges), match highlights, tokenized prompt text. One
// definition each, so the popup and the manager cannot drift apart; the
// design-system bundle (design/entry.tsx) renders these same components.

// The shared Kbd in the kit's 16px bordered-square idiom. A key, not a
// label: a label is a Chip.
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <UiKbd className="h-4 min-w-4 shrink-0 rounded-sm border border-border bg-background px-0.5 font-mono text-[11px] font-normal text-muted-foreground">
      {children}
    </UiKbd>
  )
}

// Every small label in the app is a Chip: #tags, {placeholders}, the {N} and
// +N badges, add-suggestions, the sidebar's scope, the import badges. The
// whole look lives in this table — change a chip here, never at a call site.
// `tone` says what the chip is, `size` where it sits: `sm` in a row or card,
// `md` level with an input in the editor, `inline` inside wrapping text.
export const chipVariants = cva(
  "rounded-sm border text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-transparent bg-secondary text-foreground",
        muted: "border-border text-muted-foreground",
        // hue from `--tag`, set by the Chip's `hue`
        tag: "tag-text tag-border dark:tag-text-dark dark:tag-border-dark",
        builtin: "border-transparent bg-(--param-builtin-bg) text-(--param-builtin)",
        field: "border-transparent bg-(--param-field-bg) text-(--param-field)",
        config: "border-transparent bg-(--param-config-bg) text-(--param-config)",
        bad: "border-transparent bg-destructive/15 text-destructive",
        warn: "border-(--warn)/40 text-(--warn)",
        primary: "border-transparent bg-primary/15 text-foreground",
      },
      size: {
        sm: "flex h-4 shrink-0 items-center gap-0.5 whitespace-nowrap px-1",
        md: "flex h-5 shrink-0 items-center gap-1 whitespace-nowrap px-2",
        inline: "box-decoration-clone px-1",
      },
      /** A filter term that is on */
      active: { true: "", false: "" },
      /** Offers to add itself: a + segment, muted until hovered */
      add: { true: "cursor-pointer gap-0 overflow-hidden px-0 text-muted-foreground transition-colors hover:border-primary", false: "" },
    },
    compoundVariants: [{ tone: "tag", active: true, className: "tag-fill" }],
    defaultVariants: { tone: "neutral", size: "sm", active: false, add: false },
  }
)

export type ChipTone = NonNullable<VariantProps<typeof chipVariants>["tone"]>

export function Chip({
  tone,
  size,
  active,
  hue,
  onClick,
  add,
  onRemove,
  removeLabel = "Remove",
  title,
  className,
  children,
  ...aria
}: VariantProps<typeof chipVariants> & {
  /** The tag hue, for tone="tag" */
  hue?: string
  /** Makes the chip a button; without it the chip is text, so it can sit inside one */
  onClick?: (e: React.MouseEvent) => void
  /** An inline × after the label */
  onRemove?: () => void
  removeLabel?: string
  title?: string
  className?: string
  children?: React.ReactNode
  "aria-label"?: string
  "aria-pressed"?: boolean
}) {
  const cls = cn(chipVariants({ tone, size, active, add }), onClick && "cursor-pointer", className)
  const style = hue ? ({ "--tag": hue } as React.CSSProperties) : undefined
  const body = add ? (
    <>
      <span className="flex items-center self-stretch px-1.5">
        <RiAddLine className="size-3" />
      </span>
      <span className="w-px self-stretch bg-border" />
      <span className="flex items-center pl-1.5 pr-2">{children}</span>
    </>
  ) : (
    <>
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          className="-mr-1 flex shrink-0 cursor-pointer rounded-sm opacity-70 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <RiCloseLine className="size-3.5" />
        </button>
      )}
    </>
  )
  if (!onClick)
    return (
      <span className={cls} style={style} title={title} {...aria}>
        {body}
      </span>
    )
  return (
    <button type="button" className={cls} style={style} title={title} onClick={onClick} {...aria}>
      {body}
    </button>
  )
}

// One #tag chip. With `onClick` it is a filter button (`active` when the tag
// is a filter term in the query, drawn filled); without, plain text.
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
  const label = active ? `Clear #${tag} filter` : `Filter by #${tag}`
  return (
    <Chip
      tone="tag"
      size={size}
      hue={C.tagColor(tag)}
      active={active}
      className="relative"
      title={title ?? (onClick ? label : undefined)}
      aria-label={onClick ? label : undefined}
      aria-pressed={onClick ? !!active : undefined}
      onClick={
        onClick &&
        ((e) => {
          e.stopPropagation()
          onClick(tag)
        })
      }
    >
      {tag}
      {children}
    </Chip>
  )
}

// A prompt's first `max` tags as chips, the rest folded into a +N chip whose
// tooltip names them. A fragment, so the chips lay out in the caller's row.
export function TagList({
  tags,
  max,
  activeTags,
  onTag,
}: {
  tags: readonly string[]
  max: number
  /** Lower-cased #terms in the query; a matching chip renders filled */
  activeTags?: readonly string[]
  onTag?: (tag: string) => void
}) {
  return (
    <>
      {tags.slice(0, max).map((tag) => (
        <TagPill key={tag} tag={tag} active={activeTags?.includes(tag.toLowerCase())} onClick={onTag} />
      ))}
      {tags.length > max && (
        <Chip tone="muted" className="tabular-nums" title={tags.slice(max).map((t) => `#${t}`).join(", ")}>
          +{tags.length - max}
        </Chip>
      )}
    </>
  )
}

// {N}: the prompt asks for N values before it pastes
export function InputsBadge({ inputs }: { inputs: readonly string[] }) {
  if (!inputs.length) return null
  return (
    <Chip
      tone="warn"
      className="tabular-nums"
      title={`Asks for ${inputs.length} value${inputs.length === 1 ? "" : "s"} before pasting: ${inputs.join(", ")}`}
    >
      {"{"}{inputs.length}{"}"}
    </Chip>
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
// field. Those are the prompt's own words, not labels, so not chips. A config
// parameter shows its saved value when there is one.
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
          <Chip key={i} tone={part.type} size="inline">
            {label}
          </Chip>
        )
      })}
    </>
  )
}
