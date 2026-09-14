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
  /** Hover opens a nested panel of items to the right; click runs `run` if given. */
  | { kind: "submenu"; label: string; disabled?: boolean; items: CtxItem[]; run?: () => void | "keep" }
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
  // Open submenu: which top-level index, and where its panel anchors
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)

  const open = useCallback((x: number, y: number, items: CtxItem[]) => {
    setArmed(null)
    setSub(null)
    setState({ x, y, items })
  }, [])
  const close = useCallback(() => {
    setState(null)
    setArmed(null)
    setSub(null)
  }, [])

  useEffect(() => {
    if (!state) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !subRef.current?.contains(t)) close()
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

  // Submenu opens to the right of its item, flipping left when it would overflow
  useEffect(() => {
    if (!sub || !subRef.current) return
    const rect = subRef.current.getBoundingClientRect()
    const left = sub.x + rect.width + 8 > window.innerWidth ? sub.x - rect.width - (ref.current?.offsetWidth ?? 0) : sub.x
    const top = Math.min(sub.y, window.innerHeight - rect.height - 8)
    subRef.current.style.left = `${Math.max(4, left)}px`
    subRef.current.style.top = `${Math.max(4, top)}px`
  }, [sub])

  // One item renderer for both panels; `onSub` is only wired for the top level
  const renderItem = (it: CtxItem, i: number, onSub?: (i: number, el: HTMLElement) => void) => {
    if (it.kind === "header") {
      return (
        <div key={i} className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
    if (it.kind === "submenu") {
      return (
        <button
          key={i}
          disabled={it.disabled}
          className={cn(
            "flex w-full cursor-pointer items-center justify-between gap-3 whitespace-nowrap rounded-sm px-2 py-1 text-left text-xs text-foreground hover:bg-accent disabled:cursor-default disabled:opacity-40",
            onSub && sub?.index === i && "bg-accent"
          )}
          onMouseEnter={(e) => onSub?.(i, e.currentTarget)}
          onClick={(e) => {
            e.stopPropagation()
            if (!it.run) {
              onSub?.(i, e.currentTarget)
              return
            }
            const keep = it.run()
            if (keep !== "keep") close()
          }}
        >
          <span>{it.label}</span>
          <span className="text-muted-foreground">›</span>
        </button>
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
        onMouseEnter={() => {
          if (onSub) setSub(null) // moving onto a plain top-level item closes the submenu
        }}
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
  }

  const openSub = (i: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setSub({ index: i, x: r.right + 2, y: r.top - 4 })
  }
  const subItems = sub !== null && state ? state.items[sub.index] : null

  const element = state
    ? createPortal(
        <>
          <div
            ref={ref}
            className="fixed z-40 min-w-48 rounded-md border border-border bg-popover p-1 shadow-lg"
            style={{ left: state.x, top: state.y }}
          >
            {state.items.map((it, i) => renderItem(it, i, openSub))}
          </div>
          {subItems?.kind === "submenu" && (
            <div
              ref={subRef}
              className="fixed z-40 min-w-40 rounded-md border border-border bg-popover p-1 shadow-lg"
              style={{ left: sub!.x, top: sub!.y }}
            >
              {subItems.items.map((it, i) => renderItem(it, i))}
            </div>
          )}
        </>,
        document.body
      )
    : null

  return { open, close, element }
}
