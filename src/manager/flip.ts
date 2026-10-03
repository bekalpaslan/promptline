import { useCallback, useLayoutEffect, useRef, type RefObject } from "react"

/**
 * Rows that change place slide there rather than jump (FLIP). The caller
 * takes a `snapshot` of where every `[data-snip-id]` row under `root` is
 * drawn, right before the state change that reorders them; after that
 * render each row is offset back to where it was with no transition, then
 * released, so the row's own `transition-[transform]` carries it to its new
 * place. The lifted row slides too: it is drawn in the slot the pointer
 * would drop it in (`placePrompt`), and the slide is what makes the rows
 * read as parting for it.
 *
 * The snapshot is of the rows as drawn, a slide still in flight included,
 * and the new place is measured under that slide (the computed transform
 * is taken off the rect), so a row crossed twice in quick succession
 * continues from where it is rather than restarting from where it was.
 * Only a render that follows a snapshot animates: the pointer moves that
 * re-render the list without reordering it leave the slides alone, and an
 * ordinary re-render (a rename, a fold) never animates. Reduced motion
 * collapses the slide through index.css like every other transition.
 */
export function useSlideRows(root: RefObject<HTMLElement | null>) {
  const before = useRef<Map<string, number> | null>(null)
  const rows = () => [...(root.current?.querySelectorAll<HTMLElement>("[data-snip-id]") ?? [])]
  const snapshot = useCallback(() => {
    before.current = new Map(rows().map((el) => [el.dataset.snipId!, el.getBoundingClientRect().top]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    const was = before.current
    before.current = null
    if (!was) return
    for (const el of rows()) {
      const from = was.get(el.dataset.snipId!)
      if (from === undefined) continue
      // Where the row now lands, under whatever slide it is still on
      const delta = from - (el.getBoundingClientRect().top - translateY(el))
      if (Math.abs(delta) < 1) continue
      el.style.transition = "none"
      el.style.transform = `translateY(${delta}px)`
      void el.offsetHeight // commit the offset before it is released
      el.style.transition = ""
      el.style.transform = ""
    }
  })
  return snapshot
}

// The vertical part of an element's computed transform: `matrix(a, b, c,
// d, tx, ty)` while a slide is in flight, "none" at rest
function translateY(el: HTMLElement): number {
  const t = getComputedStyle(el).transform
  if (!t || t === "none") return 0
  const m = t.match(/matrix\(([^)]+)\)/)
  if (m) return Number(m[1].split(",")[5]) || 0
  const m3 = t.match(/matrix3d\(([^)]+)\)/)
  return m3 ? Number(m3[1].split(",")[13]) || 0 : 0
}
