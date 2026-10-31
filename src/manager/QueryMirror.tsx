import { C } from "@/lib/core"
import { cn } from "@/lib/utils"

// The filter's text, drawn under a transparent input so its #tag, @pack and
// >group terms read as chips while the input stays a plain input (caret,
// selection, undo). Colour and a ground only, never padding: the mirror has
// to lay out exactly like the input's own text, or the caret drifts.
export function QueryMirror({ query }: { query: string }) {
  const parts = query.match(/[#@>]"[^"]*"|\s+|\S+/g) || []
  return (
    <>
      {parts.map((part, i) => {
        const prefix = part[0]
        const value = part.slice(1).replace(/^"|"$/g, "")
        if (!/^[#@>]/.test(part) || !value) return <span key={i}>{part}</span>
        return (
          <span
            key={i}
            className={cn(
              "rounded-[2px] shadow-[0_0_0_1px_var(--border)]",
              prefix === "#" ? "tag-text dark:tag-text-dark bg-secondary" : "bg-secondary text-foreground"
            )}
            style={prefix === "#" ? ({ "--tag": C.tagColor(value) } as React.CSSProperties) : undefined}
          >
            {part}
          </span>
        )
      })}
    </>
  )
}
