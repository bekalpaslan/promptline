import { useRef } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { RiArrowDownSLine, RiCloseLine } from "@remixicon/react"
import { cn } from "@/lib/utils"

// Every text input, textarea and dropdown in both windows: a grey fill, no
// border, the one focus ring. `md` is a form field (the editor, Settings,
// the popup's forms), `sm` sits in a row beside other controls. The search
// boxes are the exception: each window's main field keeps a border.
export const fieldVariants = cva(
  "rounded-md bg-secondary text-ui text-foreground outline-none placeholder:text-muted-foreground focus-ring disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        sm: "px-2.5 py-1",
        md: "px-3 py-1.5",
      },
    },
    defaultVariants: { size: "md" },
  }
)

// Each window's search box: the one bordered field, so it reads as the place
// to type. The caller fills it (icon, input, a scope chip); `active` keeps the
// focus colour on the border while a query is set.
export const searchBoxClass = (active?: boolean) =>
  cn(
    "flex h-8 shrink-0 items-center gap-1.5 rounded-lg border bg-background px-2 text-ui focus-within:border-(--focus)",
    active ? "border-(--focus)" : "border-input"
  )

// The × that clears a search box
export function SearchClear({ label, title, onClick }: { label: string; title?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      className="flex shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:bg-hover hover:text-foreground"
      onClick={onClick}
    >
      <RiCloseLine className="size-4" />
    </button>
  )
}

// A segmented control: a sunken track of segments, the chosen one raised.
// Settings' theme control and the generate dialog's path picker.
export const SEGMENT_TRACK = "flex items-center gap-1 rounded-lg bg-(--segment-track) p-1"
export const segmentClass = (active: boolean) =>
  cn(
    "flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-sm text-ui font-semibold focus-ring",
    active ? "bg-(--segment-active) text-foreground shadow-(--shadow-segment)" : "text-muted-foreground hover:text-foreground"
  )

// A native select in the field look, with the one chevron (the native arrow
// differed by window and theme). `className` places the wrapper.
export function Select({
  size,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & VariantProps<typeof fieldVariants>) {
  return (
    <span className={cn("relative flex min-w-0", className)}>
      <select className={cn(fieldVariants({ size }), "w-full cursor-pointer appearance-none pr-7")} {...props}>
        {children}
      </select>
      <RiArrowDownSLine
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </span>
  )
}

// Free text with a list to pick from, beside a Select and looking like one:
// the same chevron, which calls `onList` with the field's box so the caller
// can open its menu under it; Arrow Down does the same from the keyboard.
// Not a <datalist>: Chromium's list filters by what is typed, so a field
// already holding a value offered only that value, and its popup and ▼ were
// the browser's, not the app's (the ▼ stays hidden in index.css for the tag
// field). No `onList`, no chevron. The field is as wide as its text (or
// placeholder); `className` places the wrapper and bounds it.
export function ComboInput({
  onList,
  listLabel,
  size,
  className,
  onKeyDown,
  ...props
}: Omit<React.ComponentProps<"input">, "size" | "list"> &
  VariantProps<typeof fieldVariants> & { onList?: (box: DOMRect) => void; listLabel?: string }) {
  const wrap = useRef<HTMLSpanElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const openList = () => {
    if (!onList || !wrap.current) return
    // The menu hands focus back to the field when it closes
    input.current?.focus()
    onList(wrap.current.getBoundingClientRect())
  }
  return (
    <span ref={wrap} className={cn("relative flex min-w-0", className)}>
      <input
        ref={input}
        aria-haspopup={onList ? "menu" : undefined}
        className={cn(fieldVariants({ size }), "min-w-0 flex-1 field-sizing-content", onList && "pr-7")}
        onKeyDown={(e) => {
          if (onList && e.key === "ArrowDown" && !e.nativeEvent.isComposing) {
            e.preventDefault()
            openList()
            return
          }
          onKeyDown?.(e)
        }}
        {...props}
      />
      {onList && (
        <button
          type="button"
          // The field is the tab stop; Arrow Down opens the list from there
          tabIndex={-1}
          aria-label={listLabel}
          title={listLabel}
          className="absolute inset-y-0 right-0 flex w-7 cursor-pointer items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openList}
        >
          <RiArrowDownSLine className="size-3.5" />
        </button>
      )}
    </span>
  )
}
