import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { RiCheckLine } from "@remixicon/react"
import { cn } from "@/lib/utils"
import { MENU_ITEM, MENU_PANEL } from "@/components/menu-styles"
import { fieldVariants } from "@/components/field"

// Imperative context menu, ported from the legacy openCtx(): menus are built
// from data at open time (pack lists, selection counts), positioned at the
// cursor, and support armed destructive items and inline inputs.
export type CtxItem =
  // `name`: the text is something the user wrote (a pack, a group, a prompt
  // title) and is shown as typed, never uppercased like the app's own labels
  | { kind: "header"; text: string; name?: boolean }
  | { kind: "sep" }
  | { kind: "input"; placeholder: string; onSubmit: (value: string) => void }
  /** Hover opens a nested panel of items to the right; click runs `run` if given. */
  | { kind: "submenu"; label: string; disabled?: boolean; hint?: string; items: CtxItem[]; run?: () => void | "keep" }
  | {
      kind: "item"
      label: string
      danger?: boolean
      disabled?: boolean
      /** Tooltip — say why a disabled item is disabled, or what a key does */
      hint?: string
      /** Second label shown after the first click; the second click runs. */
      confirm?: string
      /** One choice of several (a radio item): set on every item of the set, true on the current one */
      checked?: boolean
      /** Drawn one step in, under the item before it (a group under its pack) */
      indent?: boolean
      /** Return "keep" to leave the menu open (e.g. to swap in a submenu). */
      run: () => void | "keep"
    }

type OpenState = { x: number; y: number; items: CtxItem[] } | null

// Focusable entries of one panel, in visual order: enabled items and inputs
const focusables = (root: HTMLElement | null): HTMLElement[] =>
  root ? [...root.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled), input')] : []

export function useCtxMenu() {
  const [state, setState] = useState<OpenState>(null)
  const [armed, setArmed] = useState<number | null>(null)
  // Open submenu: which top-level index, and where its panel anchors
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  // Where focus was when the menu opened, to give it back on close
  const opener = useRef<HTMLElement | null>(null)

  const open = useCallback((x: number, y: number, items: CtxItem[]) => {
    if (!opener.current) opener.current = document.activeElement as HTMLElement | null
    setArmed(null)
    setSub(null)
    setState({ x, y, items })
  }, [])
  const close = useCallback(() => {
    setState(null)
    setArmed(null)
    setSub(null)
    const back = opener.current
    opener.current = null
    // Give focus back to whatever opened the menu (a row, a header)
    if (back && document.contains(back)) back.focus()
  }, [])

  useEffect(() => {
    if (!state) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !subRef.current?.contains(t)) close()
    }
    // Roving focus: Up/Down/Home/End within the open panel, Right/Enter opens
    // a submenu, Left closes it, Escape closes the menu. An inline input keeps
    // its own keys except Escape.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        close()
        return
      }
      const active = document.activeElement as HTMLElement | null
      if (active instanceof HTMLInputElement) return
      const inSub = !!subRef.current
      const panel = inSub ? subRef.current : ref.current
      const items = focusables(panel)
      if (!items.length) return
      const at = items.indexOf(active as HTMLElement)
      const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus()
      if (e.key === "ArrowDown") { e.preventDefault(); focusAt(at + 1) }
      else if (e.key === "ArrowUp") { e.preventDefault(); focusAt(at - 1) }
      else if (e.key === "Home") { e.preventDefault(); focusAt(0) }
      else if (e.key === "End") { e.preventDefault(); focusAt(items.length - 1) }
      else if ((e.key === "ArrowRight" || e.key === "Enter") && !inSub && active?.dataset.submenu !== undefined) {
        e.preventDefault()
        const r = active.getBoundingClientRect()
        setSub({ index: Number(active.dataset.submenu), x: r.right + 2, y: r.top - 4 })
      } else if (e.key === "ArrowLeft" && inSub) {
        e.preventDefault()
        const parent = ref.current?.querySelector<HTMLElement>(`[data-submenu="${sub?.index}"]`)
        setSub(null)
        parent?.focus()
      }
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [state, sub, close])

  // Clamp into the viewport once rendered, then focus the first item so the
  // keyboard can drive it (Shift+F10 / the Menu key open it with no pointer).
  // A layout effect, so the clamp lands before the frame is painted: in a
  // plain effect a menu opened near an edge showed for a frame off-screen.
  useLayoutEffect(() => {
    if (!state || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const left = Math.min(state.x, window.innerWidth - rect.width - 8)
    const top = Math.min(state.y, window.innerHeight - rect.height - 8)
    ref.current.style.left = `${Math.max(4, left)}px`
    ref.current.style.top = `${Math.max(4, top)}px`
    const first = focusables(ref.current)[0]
    if (first && !(first instanceof HTMLInputElement)) first.focus()
  }, [state])

  // Submenu opens to the right of its item, flipping left when it would overflow
  useLayoutEffect(() => {
    if (!sub || !subRef.current) return
    const rect = subRef.current.getBoundingClientRect()
    const left = sub.x + rect.width + 8 > window.innerWidth ? sub.x - rect.width - (ref.current?.offsetWidth ?? 0) : sub.x
    const top = Math.min(sub.y, window.innerHeight - rect.height - 8)
    subRef.current.style.left = `${Math.max(4, left)}px`
    subRef.current.style.top = `${Math.max(4, top)}px`
    // Opened from the keyboard: land on its first item
    if (ref.current?.contains(document.activeElement)) focusables(subRef.current)[0]?.focus()
  }, [sub])

  // One item renderer for both panels; `onSub` is only wired for the top level
  const renderItem = (it: CtxItem, i: number, onSub?: (i: number, el: HTMLElement) => void, id?: string) => {
    if (it.kind === "header") {
      return (
        <div key={i} id={id} className={cn(it.name ? "name-label truncate" : "section-label", "px-2 pb-0.5 pt-1.5")}>
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
          className={cn(fieldVariants({ size: "sm" }), "w-full")}
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
          type="button"
          role="menuitem"
          tabIndex={-1}
          aria-haspopup="menu"
          aria-expanded={onSub ? sub?.index === i : undefined}
          data-submenu={onSub ? i : undefined}
          disabled={it.disabled}
          title={it.hint}
          className={cn(
            MENU_ITEM,
            "justify-between gap-3 hover:bg-hover focus-visible:bg-accent",
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
        type="button"
        role={it.checked === undefined ? "menuitem" : "menuitemradio"}
        aria-checked={it.checked}
        tabIndex={-1}
        disabled={it.disabled}
        title={it.hint}
        className={cn(
          MENU_ITEM,
          "hover:bg-hover focus-visible:bg-accent",
          it.danger && "text-destructive",
          it.indent && "pl-5"
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
        {it.checked !== undefined && (
          <RiCheckLine className={cn("size-3.5 shrink-0", !it.checked && "invisible")} aria-hidden />
        )}
        {it.confirm && armed === i ? it.confirm : it.label}
      </button>
    )
  }

  // A header followed by radio items (the Display menu's View and Order) is
  // a labelled group, so assistive tech says which choice a radio belongs
  // to; indices stay the items' own, which `armed` and `sub` are keyed by
  const groupId = useId()
  const renderPanel = (items: CtxItem[], onSub?: (i: number, el: HTMLElement) => void) => {
    const out: React.ReactNode[] = []
    for (let i = 0; i < items.length; ) {
      const it = items[i]
      let j = i + 1
      if (it.kind === "header") {
        for (; j < items.length; j++) {
          const x = items[j]
          if (x.kind !== "item" || x.checked === undefined) break
        }
      }
      if (it.kind === "header" && j > i + 1) {
        const id = `${groupId}-${i}`
        out.push(
          <div key={i} role="group" aria-labelledby={id}>
            {renderItem(it, i, onSub, id)}
            {items.slice(i + 1, j).map((x, k) => renderItem(x, i + 1 + k, onSub))}
          </div>
        )
        i = j
      } else {
        out.push(renderItem(it, i, onSub))
        i++
      }
    }
    return out
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
            role="menu"
            className={cn("fixed z-40 min-w-48", MENU_PANEL)}
            style={{ left: state.x, top: state.y }}
          >
            {renderPanel(state.items, openSub)}
          </div>
          {subItems?.kind === "submenu" && (
            <div
              ref={subRef}
              role="menu"
              aria-label={subItems.label}
              // A long library's pack and group list scrolls rather than
              // running off the window
              className={cn("fixed z-40 max-h-[calc(100dvh-1rem)] min-w-40 overflow-y-auto", MENU_PANEL)}
              style={{ left: sub!.x, top: sub!.y }}
            >
              {renderPanel(subItems.items)}
            </div>
          )}
        </>,
        document.body
      )
    : null

  return { open, close, element }
}
