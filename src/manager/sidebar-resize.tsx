import { useEffect, useRef, useState } from "react"
import { C } from "@/lib/core"
import { cn } from "@/lib/utils"

// The sidebar's width as dragged at its right edge (BEHAVIOR.md → Shape).
// A view choice like group-by-pack, so localStorage holds it; null is the
// CSS default. Clamped again on every window resize (C.sidebarWidth), so a
// wide sidebar from a big window can't crowd the pane out of a small one.
const WIDTH_KEY = "sidebarWidth"
export function useSidebarWidth() {
  const [saved, setSaved] = useState(() => localStorage.getItem(WIDTH_KEY))
  const [win, setWin] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWin(window.innerWidth)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const bounds = C.sidebarWidth(saved, win, rem())
  // `commit` writes it down; a drag commits once, on release
  const set = (px: number | null, commit = true) => {
    const width = px == null ? null : C.sidebarWidth(px, window.innerWidth, rem()).width
    const value = width == null ? null : String(width)
    setSaved(value)
    if (!commit) return
    if (value == null) localStorage.removeItem(WIDTH_KEY)
    else localStorage.setItem(WIDTH_KEY, value)
  }
  return { ...bounds, set }
}

// The edge handle: drag, or ←/→ from the keyboard (Shift for bigger
// steps, Home/End for the bounds); a double-click goes back to the
// default
export function ResizeHandle({
  width,
  drawnWidth,
  asideRef,
}: {
  /** The sidebar's width as dragged, with its bounds (useSidebarWidth) */
  width: ReturnType<typeof useSidebarWidth>
  /** The width as drawn, for the handle's value while none is saved */
  drawnWidth: number
  /** The aside the handle sits on the edge of */
  asideRef: React.RefObject<HTMLElement | null>
}) {
  const edgeDrag = useRef<{ x: number; from: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={width.min}
      aria-valuemax={width.max}
      aria-valuenow={width.width ?? drawnWidth}
      tabIndex={0}
      title="Drag to resize — double-click for the default width"
      data-dragging={dragging || undefined}
      className={cn(
        "absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none select-none outline-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:transition-colors",
        "hover:after:bg-primary/50 focus-visible:after:bg-primary data-dragging:after:bg-primary"
      )}
      onPointerDown={(e) => {
        if (e.button !== 0 || !asideRef.current) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        edgeDrag.current = { x: e.clientX, from: asideRef.current.getBoundingClientRect().width }
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (edgeDrag.current) width.set(edgeDrag.current.from + e.clientX - edgeDrag.current.x, false)
      }}
      onPointerUp={(e) => {
        if (!edgeDrag.current) return
        width.set(edgeDrag.current.from + e.clientX - edgeDrag.current.x)
        edgeDrag.current = null
        setDragging(false)
      }}
      // Capture lost without a release (the window lost focus): keep what is shown
      onLostPointerCapture={() => {
        if (!edgeDrag.current) return
        width.set(width.width)
        edgeDrag.current = null
        setDragging(false)
      }}
      onDoubleClick={() => width.set(null)}
      onKeyDown={(e) => {
        const now = width.width ?? drawnWidth
        const step = e.shiftKey ? 64 : 16
        let next: number
        if (e.key === "ArrowLeft") next = now - step
        else if (e.key === "ArrowRight") next = now + step
        else if (e.key === "Home") next = width.min
        else if (e.key === "End") next = width.max
        else return
        e.preventDefault()
        e.stopPropagation()
        width.set(next)
      }}
    />
  )
}
