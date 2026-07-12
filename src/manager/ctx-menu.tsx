import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

// Imperative context menu, ported from the legacy openCtx(): menus are built
// from data at open time (pack lists, selection counts), positioned at the
// cursor, and support armed destructive items and inline inputs.
export type CtxItem =
  | { kind: "header"; text: string }
  | { kind: "sep" }
  | { kind: "input"; placeholder: string; onSubmit: (value: string) => void }
  | {
      kind: "item"
      label: string
      danger?: boolean
      disabled?: boolean
      /** Second label shown after the first click; the second click runs. */
      confirm?: string
      /** Return "keep" to leave the menu open (e.g. to swap in a submenu). */
      run: () => void | "keep"
    }

type OpenState = { x: number; y: number; items: CtxItem[] } | null

export function useCtxMenu() {
  const [state, setState] = useState<OpenState>(null)
  const [armed, setArmed] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const open = useCallback((x: number, y: number, items: CtxItem[]) => {
    setArmed(null)
    setState({ x, y, items })
  }, [])
  const close = useCallback(() => {
    setState(null)
    setArmed(null)
  }, [])

  useEffect(() => {
    if (!state) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [state, close])

  // Clamp into the viewport once rendered
  useEffect(() => {
    if (!state || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const left = Math.min(state.x, window.innerWidth - rect.width - 8)
    const top = Math.min(state.y, window.innerHeight - rect.height - 8)
    ref.current.style.left = `${Math.max(4, left)}px`
    ref.current.style.top = `${Math.max(4, top)}px`
  }, [state])

  const element = state
    ? createPortal(
        <div
          ref={ref}
          className="fixed z-40 min-w-48 rounded-md border border-border bg-popover p-1 shadow-lg"
          style={{ left: state.x, top: state.y }}
        >
          {state.items.map((it, i) => {
            if (it.kind === "header") {
              return (
                <div key={i} className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {it.text}
                </div>
              )
            }
            if (it.kind === "sep") return <div key={i} className="mx-1 my-1 h-px bg-border" />
            if (it.kind === "input") {
              return (
                <input
                  key={i}
                  autoFocus
                  type="text"
                  placeholder={it.placeholder}
                  spellCheck={false}
                  className="w-full rounded-sm bg-secondary px-2 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      it.onSubmit(e.currentTarget.value.trim())
                      close()
                    }
                    if (e.key === "Escape") close()
                  }}
                />
              )
            }
            return (
              <button
                key={i}
                disabled={it.disabled}
                className={cn(
                  "block w-full cursor-pointer whitespace-nowrap rounded-sm px-2 py-1 text-left text-xs text-foreground hover:bg-accent disabled:cursor-default disabled:opacity-40",
                  it.danger && "text-destructive"
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  if (it.confirm && armed !== i) {
                    setArmed(i)
                    return
                  }
                  const keep = it.run()
                  if (keep !== "keep") close()
                }}
              >
                {it.confirm && armed === i ? it.confirm : it.label}
              </button>
            )
          })}
        </div>,
        document.body
      )
    : null

  return { open, close, element }
}
