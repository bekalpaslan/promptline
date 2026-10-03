import { useLayoutEffect, useRef, type RefObject } from "react"

/**
 * Rows that change place slide there rather than jump (FLIP). After each
 * render while `active`, every `[data-snip-id]` row under `root` is
 * measured; one whose top moved since the last measurement is offset back
 * to where it was with no transition, then released, so the row's own
 * `transition-[transform]` carries it to its new place. The lifted row
 * slides too: it is drawn in the slot the pointer would drop it in
 * (`placePrompt`), and the slide is what makes the rows read as parting
 * for it. Nothing is recorded while inactive, so an ordinary re-render
 * (a rename, a fold) never animates, and `prefers-reduced-motion`
 * collapses the slide through index.css like every other transition.
 */
export function useSlideRows(root: RefObject<HTMLElement | null>, active: boolean) {
  const last = useRef<Map<string, number>>(new Map())
  useLayoutEffect(() => {
    if (!active) {
      last.current = new Map()
      return
    }
    const rows = [...(root.current?.querySelectorAll<HTMLElement>("[data-snip-id]") ?? [])]
    // Layout positions, not where a slide still in flight has a row
    for (const el of rows) el.style.transform = "none"
    const next = new Map(rows.map((el) => [el.dataset.snipId!, el.getBoundingClientRect().top]))
    for (const el of rows) {
      const id = el.dataset.snipId!
      const was = last.current.get(id)
      const top = next.get(id)!
      if (was === undefined || Math.abs(was - top) < 1) {
        el.style.transform = ""
        continue
      }
      el.style.transition = "none"
      el.style.transform = `translateY(${was - top}px)`
      void el.offsetHeight // commit the offset before it is released
      el.style.transition = ""
      el.style.transform = ""
    }
    last.current = next
  })
}
