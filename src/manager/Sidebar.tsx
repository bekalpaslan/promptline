import { useEffect, useMemo, useRef, useState } from "react"
import {
  RiAddLine,
  RiDraggable,
  RiEqualizer2Line,
  RiLock2Fill,
  RiSearchLine,
  RiSettings3Line,
} from "@remixicon/react"
import { C, type OrderBy, type Snippet, type TreeRow } from "@/lib/core"
import { cn } from "@/lib/utils"
import { Chip, Count, MATCH_HIT } from "@/components/prompt-bits"
import { footClass } from "@/components/foot"
import { PINNED_BAR, TreeChevron, TreeChildren, TreeGroup, TreeName, TreeSection, treeFillClass, treeHeaderClass, treeRowClass } from "@/components/tree"
import { SearchClear, commitKey, searchBoxClass } from "@/components/field"
import { SELECTED_BAR } from "@/components/menu-styles"
import { DEFAULT_PACK, useManager, type LibraryFocus } from "./state"
import { useCtxMenu } from "./ctx-menu"
import { MenuDots, groupKey, useLibraryMenus } from "./menus"
import { say, sayUndo } from "./status"

// The filter's text, drawn under a transparent input so its #tag, @pack and
// >group terms read as chips while the input stays a plain input (caret,
// selection, undo). Colour and a ground only, never padding: the mirror has
// to lay out exactly like the input's own text, or the caret drifts.
function QueryMirror({ query }: { query: string }) {
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

// The prompt orders as the Display menu names them
const ORDER_LABELS: Record<OrderBy, string> = { uses: "Most used", title: "A–Z", custom: "Custom" }
// The pack or group header a lifted row would drop into: the hover fill
// and a 1 px Focus ring, nothing animated
const DROP_TARGET = "bg-hover ring-1 ring-inset ring-(--focus)"

// A title with the filter's free-text words marked: each word's first
// occurrence, overlaps merged, case-insensitive like the match itself
function marked(title: string, words: string[]): React.ReactNode {
  const lower = title.toLowerCase()
  const spans = words
    .map((w) => [lower.indexOf(w), lower.indexOf(w) + w.length] as const)
    .filter(([a]) => a !== -1)
    .sort((x, y) => x[0] - y[0])
  if (!spans.length) return title
  const out: React.ReactNode[] = []
  let at = 0
  for (const [a, b] of spans) {
    if (b <= at) continue
    const from = Math.max(a, at)
    if (from > at) out.push(title.slice(at, from))
    out.push(
      <span key={from} className={MATCH_HIT}>
        {title.slice(from, b)}
      </span>
    )
    at = b
  }
  if (at < title.length) out.push(title.slice(at))
  return out
}

// The sidebar's width as dragged at its right edge (BEHAVIOR.md → Shape).
// A view choice like group-by-pack, so localStorage holds it; null is the
// CSS default. Clamped again on every window resize (C.sidebarWidth), so a
// wide sidebar from a big window can't crowd the pane out of a small one.
const WIDTH_KEY = "sidebarWidth"
function useSidebarWidth() {
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

export function Sidebar() {
  const m = useManager()
  // The filter is the manager's (the overview shows only its hits)
  const { query, setQuery } = m
  // The order is the manager's, shared with the overview (C.sortPrompts)
  const { orderBy, setOrderBy } = m
  // Group-by-pack is the default view
  const { grouped, setGrouped } = m
  // The folds are the manager's (folds.ts): a rename or a New from the
  // overview carries and opens them too
  const { packs: collapsed, groups: collapsedGroups } = m.folds
  const { togglePackFold: toggleCollapsed, toggleGroupFold: toggleCollapsedGroup, foldAll } = m
  // A search started while a pack or group is shown stays inside it until
  // the chip in the field is dismissed; clearing the search drops it
  const [scope, setScope] = useState<LibraryFocus | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const display = useCtxMenu()
  const visibleIdsRef = useRef<string[]>([])
  const rowsRef = useRef<TreeRow[]>([])
  // The row the keyboard is on (its key), so Tab comes back to it
  const [focusKey, setFocusKey] = useState<string | null>(null)
  // A click on a pack or group title selects it: the pane beside the
  // sidebar shows what it holds (the overview), the way a prompt row shows
  // the prompt. The sidebar stays, so a double-click still reaches the rename.
  const shown = m.view.kind === "overview" ? m.view.focus : null

  // Drag-to-move: a short press-and-hold lifts the row as a ghost under the
  // pointer (so the gesture is discoverable), the pack or group under the
  // pointer is highlighted, and the release moves the prompt there, the
  // write the row's "Move to" menu makes. Nothing animates: the ghost is
  // drawn where the pointer is and the target header takes a fill and a
  // ring. It used to arrange instead: the rows parted and slid for the
  // lifted row and the drop saved an order. The user wanted a move, not an
  // arrangement (2026-10-10); ordering stays on Alt+Up/Down and the
  // menu's Move up/down. The ghost is the row's title at the row's width.
  const [drag, setDrag] = useState<{ id: string; pack: string; group: string; title: string; width: number } | null>(null)
  const [dropAt, setDropAt] = useState<{ pack: string; group: string } | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  // The scrolling list
  const listRef = useRef<HTMLDivElement>(null)
  // What a screen reader hears after a keyboard move
  const [announce, setAnnounce] = useState("")
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const downPos = useRef<{ x: number; y: number } | null>(null)
  const dragMoved = useRef(false)
  const suppressClick = useRef(false)

  const cancelHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
  }
  // The window losing focus mid-hold (Alt+Tab) would otherwise lift the row
  // once the delay passes, with no release ever coming to put it down
  useEffect(() => {
    window.addEventListener("blur", cancelHold)
    return () => window.removeEventListener("blur", cancelHold)
  }, [])
  // Press-and-hold on a row: `lift` runs once the hold delay passes without
  // the pointer wandering off (moving first means a click, not a drag)
  const holdToDrag = (lift: (row: HTMLElement) => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      const row = e.currentTarget
      downPos.current = { x: e.clientX, y: e.clientY }
      dragMoved.current = false
      cancelHold()
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null
        lift(row)
      }, 180)
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (!holdTimer.current || drag) return
      const d = downPos.current
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) cancelHold()
    },
    onPointerUp: cancelHold,
    onPointerLeave: () => {
      if (!drag) cancelHold()
    },
  })
  // A completed drag still fires a click on release — swallow it
  const swallowDragClick = () => {
    if (!suppressClick.current) return false
    suppressClick.current = false
    return true
  }

  const q = query.trim().toLowerCase()
  // The popup's syntax: #tag, @pack and >group terms, then free-text words
  // anywhere in the prompt (C.matchesQuery)
  const parsed = useMemo(() => C.parseQuery(query), [query])
  const words = useMemo(() => parsed.text.toLowerCase().split(/\s+/).filter(Boolean), [parsed])
  const inScope = (s: Snippet) =>
    !scope || ((s.pack || DEFAULT_PACK) === scope.pack && (!scope.group || s.group === scope.group))
  const hits = useMemo(
    () => (q ? m.snippets.filter((s) => C.matchesQuery({ ...s, pack: s.pack || DEFAULT_PACK }, parsed)) : m.snippets),
    [m.snippets, q, parsed]
  )
  const visible = useMemo(
    () => C.sortPrompts(q ? hits.filter(inScope) : [...m.snippets], orderBy),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hits, q, orderBy, scope]
  )
  const shownList = visible
  // Pack sizes, for the "hits / all" count a pack shows while searching
  const packTotals = useMemo(() => {
    const t = new Map<string, number>()
    for (const s of m.snippets) t.set(s.pack || DEFAULT_PACK, (t.get(s.pack || DEFAULT_PACK) || 0) + 1)
    return t
  }, [m.snippets])

  const setSearch = (next: string) => {
    // A search begins inside whatever pack or group the pane is showing
    if (!query.trim() && next.trim()) setScope(shown)
    if (!next.trim()) setScope(null)
    setQuery(next)
  }
  const clearSearch = () => {
    setQuery("")
    setScope(null)
  }
  // The filter's placeholder spells the grammar while there is room for it;
  // in a narrow sidebar (the window's minimum, a large UI scale) it used
  // to clip to "Filter #tag @pack >grou", so there it says "Filter" and the
  // grammar stays in the tooltip
  const asideRef = useRef<HTMLElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [drawnWidth, setDrawnWidth] = useState(0)
  useEffect(() => {
    const el = asideRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      setNarrow(entry.contentRect.width < 16 * rem)
      setDrawnWidth(Math.round(el.getBoundingClientRect().width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The edge handle: drag, or ←/→ from the keyboard (Shift for bigger
  // steps, Home/End for the bounds); a double-click goes back to the
  // default
  const width = useSidebarWidth()
  const edgeDrag = useRef<{ x: number; from: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const resizeHandle = (
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

  // Ctrl+F reaches the filter from anywhere in the manager
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key?.toLowerCase() === "f") {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  // The tree is pure core (tested), the one shape the overview draws too:
  // every pack name, even an empty one (it is real: it can be seen and
  // deleted from the menu; while searching, a pack without hits stays
  // listed, faded, so the tree keeps its shape and says where nothing
  // matched), then in each pack the ungrouped run and the groups in order
  // of first appearance, so a custom arrangement holds and any other order
  // carries through from the rows
  const { packNames } = m
  const tree = useMemo(() => (grouped ? C.packTree(shownList, packNames(), DEFAULT_PACK) : null), [shownList, grouped, packNames])

  // Every row as drawn, in order: the keyboard's tree (one tabbable row,
  // arrows move between them) and the flat id list for shift-range
  // selection are both read off it (C.treeRows: searching forces every
  // fold open, a pack with no hits is a faded header with nothing under
  // it). One list is one row per prompt.
  const rows: TreeRow[] = tree
    ? C.treeRows(tree, m.folds, !!q)
    : shownList.map((s) => ({ key: `snip:${s.id}`, kind: "prompt", id: s.id, level: 1 }))
  const rowByKey = new Map(rows.map((r) => [r.key, r]))
  rowsRef.current = rows
  visibleIdsRef.current = rows.flatMap((r) => (r.kind === "prompt" ? [r.id] : []))

  // Roving tabindex: the row last focused is the one Tab reaches, falling
  // back to the open prompt, the shown pack or group, then the first row
  const tabKey =
    (focusKey && rowByKey.has(focusKey) && focusKey) ||
    (m.activeId && rowByKey.has(`snip:${m.activeId}`) && `snip:${m.activeId}`) ||
    (shown && rowByKey.has(shown.group ? `group:${groupKey(shown.pack, shown.group)}` : `pack:${shown.pack}`)
      ? shown.group
        ? `group:${groupKey(shown.pack, shown.group)}`
        : `pack:${shown.pack}`
      : null) ||
    rows[0]?.key ||
    null

  // Move a snippet next to another in the master array and persist (the
  // keyboard's Alt+Up/Down and the menu's Move up/down); relative order
  // within every pack follows from the array order. The move is aimed in
  // the displayed order, so under "Most used" or "A–Z" the array is first
  // rebased to that order (C.displayOrder): the switch to "Custom" that
  // follows would otherwise reveal the array's own order, with every row
  // but the moved one reshuffled.
  const commitReorder = async (dragId: string, targetId: string, after: boolean) => {
    const before = C.displayOrder(m.snippets, orderBy, grouped, packNames(), DEFAULT_PACK)
    // Stepping past another group's rows moves the prompt into that group
    const all = C.placePrompt(before, dragId, targetId, after, grouped)
    if (!all) return
    const from = before.findIndex((s) => s.id === dragId)
    const item = before[from]
    const regrouped = all.find((s) => s.id === dragId)!.group !== item.group
    await m.persist(all)
    if (regrouped) {
      const target = all.find((s) => s.id === targetId)!
      // A drop among another group's rows changes the label as a side
      // effect; say so, and make it reversible. The Undo puts the prompt
      // back at its old index with its old label in the *current* library,
      // not this render's copy: edits made in the meantime must survive it
      sayUndo(
        target.group ? `Moved "${item.title}" into group "${target.group}"` : `Moved "${item.title}" out of its group`,
        () =>
          void m
            .persist((cur) => {
              const rest = cur.filter((s) => s.id !== item.id)
              const now = cur.find((s) => s.id === item.id)
              if (!now) return cur
              rest.splice(Math.min(from, rest.length), 0, { ...now, group: item.group })
              return rest
            })
            .then(() => say("Restored"))
      )
    }
    if (orderBy !== "custom") {
      setOrderBy("custom")
      say('Sorting is now "Custom" — switch back under list view options')
    }
  }

  // Keyboard reorder: swap with the neighbouring row of the same pack
  const moveRow = (id: string, dir: -1 | 1) => {
    const ids = visibleIdsRef.current
    const at = ids.indexOf(id)
    if (at === -1) return
    const me = m.snippets.find((s) => s.id === id)
    const neighbor = ids[at + dir]
    const other = neighbor ? m.snippets.find((s) => s.id === neighbor) : undefined
    if (!me || !other || (grouped && (other.pack || DEFAULT_PACK) !== (me.pack || DEFAULT_PACK))) {
      setAnnounce(`"${me?.title ?? ""}" is already at the ${dir < 0 ? "top" : "bottom"}`)
      return
    }
    void commitReorder(id, neighbor, dir > 0).then(() => setAnnounce(`Moved "${me.title}" ${dir < 0 ? "up" : "down"}`))
  }

  // Move a pack next to another, in the order the sidebar draws them (the
  // ⋯ menu's Move up/down, Alt+Up/Down). The first move turns A–Z into the
  // user's own order (arrange_packs), which both windows follow from then on.
  const commitPackMove = async (name: string, target: string, after: boolean) => {
    const order = packNames()
    const next = C.movePack(order, name, target, after)
    if (next.every((n, i) => n === order[i])) return
    await m.arrangePacks(next)
  }
  // Swap a pack with the one above or below
  const movePack = (name: string, dir: -1 | 1) => {
    const order = packNames()
    const neighbor = order[order.indexOf(name) + dir]
    if (!neighbor) {
      setAnnounce(`"${name}" is already at the ${dir < 0 ? "top" : "bottom"}`)
      return
    }
    void commitPackMove(name, neighbor, dir > 0).then(
      () => setAnnounce(`Moved "${name}" ${dir < 0 ? "up" : "down"}`),
      () => {} // already toasted
    )
  }

  // Swap a group with the one above or below in its pack (the ⋯ menu's
  // Move up/down, Alt+Up/Down). A group's place is where its prompts sit in
  // the library, so this rewrites the pack's prompts in the order drawn
  // (C.moveGroup) and, like a prompt drag, switches the list to "Custom" so
  // the new order is what the list shows
  const moveGroup = (pack: string, group: string, dir: -1 | 1) => {
    const shownOrder = () => C.displayOrder(m.snippets, orderBy, grouped, packNames(), DEFAULT_PACK)
    if (!C.moveGroup(shownOrder(), pack, group, dir, DEFAULT_PACK)) {
      setAnnounce(`"${group}" is already at the ${dir < 0 ? "top" : "bottom"}`)
      return
    }
    // An updater: the menu that calls this outlives its render
    void m
      .persist((cur) => C.moveGroup(C.displayOrder(cur, orderBy, grouped, packNames(), DEFAULT_PACK), pack, group, dir, DEFAULT_PACK) ?? cur)
      .then(
        () => {
          setAnnounce(`Moved "${group}" ${dir < 0 ? "up" : "down"}`)
          if (orderBy !== "custom") {
            setOrderBy("custom")
            say('Sorting is now "Custom" — switch back under list view options')
          }
        },
        () => {} // already toasted
      )
  }

  // A pack or group header's click (and Enter): the pane shows what it
  // holds, and the tree opens it so the two agree. It used to fold the pack
  // as well, like a folder in a file tree, which took the rows the pane was
  // about to show out of the sidebar on the most common click in the
  // window; folding is the chevron's, Left's and Collapse all's. A search
  // holds every fold open, so there it only shows.
  const openHeader = (pack: string, group?: string) => {
    if (!q) m.unfold(pack, group)
    m.openOverview(group === undefined ? { pack } : { pack, group })
  }

  // The drop's write is the row's "Move to" menu's: one updater on the
  // current library, since the drag outlives its render
  const moveTo = (id: string, pack: string, group: string) => {
    const title = m.snippets.find((s) => s.id === id)?.title ?? ""
    return m
      .persist((cur) => cur.map((s) => (s.id === id ? { ...s, pack, group } : s)))
      .then(
        () => say(group ? `Moved "${title}" to "${pack}" › "${group}"` : `Moved "${title}" to "${pack}"`),
        () => {} // already toasted
      )
  }
  // While a drag is live: the ghost follows the pointer, the pack or group
  // under it is the target, and the release moves the prompt there
  useEffect(() => {
    if (!drag) return
    // What the pointer is over resolves to a pack or a group: a header, or
    // any row under it (a row inside a group means the group, an ungrouped
    // row its pack). The prompt's own place and a locked pack are no target.
    const targetAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      const section = el?.closest<HTMLElement>("[data-pack]")
      if (!section || !listRef.current?.contains(section)) return null
      const pack = section.dataset.pack!
      const group = el!.closest<HTMLElement>("[data-group]")?.dataset.group ?? ""
      if (m.isLocked(pack) || (pack === drag.pack && group === drag.group)) return null
      return { pack, group }
    }
    const move = (e: PointerEvent) => {
      dragMoved.current = true
      setGhost({ x: e.clientX, y: e.clientY })
      const t = targetAt(e.clientX, e.clientY)
      // Only a change re-renders the tree
      setDropAt((cur) => (cur?.pack === t?.pack && cur?.group === t?.group ? cur : t))
    }
    const up = (e: PointerEvent) => {
      // The button that lifted the row is the one that drops it
      if (e.button !== 0) return
      const t = targetAt(e.clientX, e.clientY)
      if (t) void moveTo(drag.id, t.pack, t.group)
      if (dragMoved.current) suppressClick.current = true
      setDrag(null)
      setDropAt(null)
      setGhost(null)
    }
    // Broken off, not finished: the browser took the pointer (pointercancel),
    // the window lost focus (Alt+Tab), or Escape. Nothing is written; the
    // release that came after the window was back used to drop the row
    // wherever the pointer had last been. Only Escape is followed by a
    // click to swallow: after a blur or a cancel none comes, and a flag
    // left set would eat the next click on a row
    const cancel = (swallowClick: boolean) => {
      if (swallowClick && dragMoved.current) suppressClick.current = true
      setDrag(null)
      setDropAt(null)
      setGhost(null)
    }
    const onCancel = () => cancel(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      cancel(true)
    }
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", up)
    document.addEventListener("pointercancel", onCancel)
    window.addEventListener("blur", onCancel)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointermove", move)
      document.removeEventListener("pointerup", up)
      document.removeEventListener("pointercancel", onCancel)
      window.removeEventListener("blur", onCancel)
      document.removeEventListener("keydown", onKey, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, m.snippets])

  // Mouse and keyboard events both carry the modifier flags this reads
  const handleRowClick = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, id: string) => {
    if (swallowDragClick()) return
    m.showSettings(false)
    let sel: Set<string>
    let anchor: string | null = m.selectionAnchor
    if (e.ctrlKey || e.metaKey) {
      sel = new Set(m.selection)
      if (sel.has(id)) sel.delete(id)
      else sel.add(id)
      anchor = id
    } else if (e.shiftKey && m.selectionAnchor) {
      const ids = visibleIdsRef.current
      const a = ids.indexOf(m.selectionAnchor)
      const b = ids.indexOf(id)
      sel = a !== -1 && b !== -1 ? new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)) : new Set([id])
    } else {
      sel = new Set([id])
      anchor = id
    }
    m.setSelection(sel, anchor)
    m.select(sel.size === 1 ? [...sel][0] : null)
  }

  // The keyboard on the tree, one handler for every row: Up/Down move,
  // Home/End jump, Right unfolds a pack or group or steps into it, Left
  // folds or steps out to the parent, Enter/Space is the click (with its
  // modifiers, so Ctrl and Shift select), Alt+Up/Down is the drag, and
  // the Menu key or Shift+F10 is the right-click. The chevron and the
  // three dots are hidden from assistive tech because these keys reach
  // the same actions.
  // Found by comparing keys, not by a selector: a group's key holds a NUL
  // (groupKey), which CSS.escape turns into U+FFFD, so a selector never
  // matched a group row and Left from a grouped prompt went nowhere
  const focusRow = (key: string) => {
    setFocusKey(key)
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-key]") ?? []
    for (const el of rows) if (el.dataset.key === key) return el.focus()
  }
  const toggleFold = (row: TreeRow) => {
    if (row.kind === "pack") toggleCollapsed(row.name)
    else if (row.kind === "group") toggleCollapsedGroup(groupKey(row.pack, row.group))
  }
  const openRowMenu = (el: HTMLElement, row: TreeRow) => {
    const r = el.getBoundingClientRect()
    if (row.kind === "pack") openPackCtx(r.left + 24, r.bottom, row.name, row.count)
    else if (row.kind === "group") openGroupCtx(r.left + 24, r.bottom, row.pack, row.group, row.count)
    else {
      const ids = m.selection.has(row.id) ? m.selection : new Set([row.id])
      if (!m.selection.has(row.id)) m.setSelection(ids, row.id)
      openRowCtx(r.left + 24, r.bottom, ids)
    }
  }
  const onTreeKey = (e: React.KeyboardEvent<HTMLElement>, row: TreeRow) => {
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault()
      openRowMenu(e.currentTarget, row)
      return
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      if (row.kind === "prompt") handleRowClick(e, row.id)
      else if (row.kind === "pack") openHeader(row.name)
      else openHeader(row.pack, row.group)
      return
    }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault()
      const dir = e.key === "ArrowUp" ? -1 : 1
      if (row.kind === "pack") movePack(row.name, dir)
      else if (row.kind === "group") moveGroup(row.pack, row.group, dir)
      else moveRow(row.id, dir)
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    const all = rowsRef.current
    const at = all.findIndex((r) => r.key === row.key)
    const go = (i: number) => {
      const r = all[Math.max(0, Math.min(all.length - 1, i))]
      if (r) focusRow(r.key)
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        go(at + 1)
        break
      case "ArrowUp":
        e.preventDefault()
        go(at - 1)
        break
      case "Home":
        e.preventDefault()
        go(0)
        break
      case "End":
        e.preventDefault()
        go(all.length - 1)
        break
      case "ArrowRight":
        e.preventDefault()
        if (row.kind === "prompt") break
        // Searching holds every fold open, so there is nothing to unfold
        if (!row.expanded) {
          if (!q) toggleFold(row)
        } else if (row.hasChildren) go(at + 1) // the first child is the next row
        break
      case "ArrowLeft":
        e.preventDefault()
        if (row.kind !== "prompt" && row.expanded && !q) toggleFold(row)
        else if (row.parent) focusRow(row.parent)
        break
    }
  }
  // A click on a row's chevron or dots must not take focus off the row
  // (they are hidden from assistive tech, so focus has no business there)
  const keepRowFocus = (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault()
    e.currentTarget.closest<HTMLElement>("[data-key]")?.focus()
  }
  // Attributes every row shares: its place in the tree and the roving tab stop
  const treeitemProps = (row: TreeRow) => ({
    role: "treeitem" as const,
    "data-key": row.key,
    "aria-level": row.level,
    tabIndex: tabKey === row.key ? 0 : -1,
    onFocus: () => setFocusKey(row.key),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => onTreeKey(e, row),
  })

  // The pack, group and prompt menus, shared with the overview
  const {
    element: menus,
    renaming,
    setRenaming,
    renamingGroup,
    setRenamingGroup,
    renamePack,
    renameGroup,
    openPackCtx,
    openGroupCtx,
    openRowCtx,
    openNewMenu,
  } = useLibraryMenus({ surface: "sidebar", moveRow, movePack, moveGroup })

  // A new prompt or pack can land below the fold of a long list, and a pack
  // opened from the editor's crumbs may sit there too: bring what is shown
  // into view (the popup does the same for its selection)
  useEffect(() => {
    if (m.activeId) listRef.current?.querySelector(`[data-id="${CSS.escape(m.activeId)}"]`)?.scrollIntoView({ block: "nearest" })
  }, [m.activeId])
  const shownPack = shown && !shown.group ? shown.pack : null
  useEffect(() => {
    if (shownPack)
      requestAnimationFrame(() =>
        listRef.current?.querySelector(`[data-pack="${CSS.escape(shownPack)}"]`)?.scrollIntoView({ block: "nearest" })
      )
  }, [shownPack])

  // Group header: quieter than the pack title, sits among its rows
  const groupTitle = (pack: string, group: string, count: number, isCollapsed: boolean) => {
    const key = groupKey(pack, group)
    const selected = shown?.pack === pack && shown.group === group
    const dropHere = dropAt?.pack === pack && dropAt.group === group
    return (
      <div
        {...treeitemProps(rowByKey.get(`group:${key}`)!)}
        data-drop-target={dropHere || undefined}
        aria-expanded={!isCollapsed}
        aria-selected={selected}
        aria-label={`${group}, ${count} prompt${count === 1 ? "" : "s"}`}
        title={`${group} — right-click or ⋯ for actions`}
        className={cn(treeHeaderClass("group"), treeFillClass(selected), "group focus-ring", dropHere && DROP_TARGET)}
        onClick={() => openHeader(pack, group)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setRenamingGroup(key)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          openGroupCtx(e.clientX, e.clientY, pack, group, count)
        }}
      >
        {/* The chevron is the fold; the title selects. Hidden from assistive
            tech (← → fold), and a click on it keeps focus on the row */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          title={isCollapsed ? "Expand" : "Collapse"}
          className="flex shrink-0 cursor-pointer rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
          onMouseDown={keepRowFocus}
          onClick={(e) => {
            e.stopPropagation()
            toggleCollapsedGroup(key)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <TreeChevron open={!isCollapsed} />
        </button>
        {renamingGroup === key ? (
          <input
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            aria-label={`Rename group ${group}`}
            defaultValue={group}
            spellCheck={false}
            className="min-w-0 flex-1 -my-0.5 rounded-sm bg-secondary px-1 py-0.5 text-ui font-medium text-foreground focus-ring"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              // The header above toggles on Enter / Space; typing must not reach it
              e.stopPropagation()
              if (e.key === "Escape") setRenamingGroup(null)
              if (commitKey(e)) {
                void renameGroup(pack, group, e.currentTarget.value.trim())
              }
            }}
            // Enter commits, leaving the field cancels: a misclick must not rename
            onBlur={() => setRenamingGroup(null)}
          />
        ) : (
          <TreeName>{group}</TreeName>
        )}
        {/* Hover-revealed way into the same menu right-click opens */}
        <MenuDots
          label={`Actions for group ${group}`}
          reveal="group-hover:opacity-100"
          decorative
          onOpen={(x, y) => openGroupCtx(x, y, pack, group, count)}
        />
        <Count>{count}</Count>
      </div>
    )
  }

  // Prompt row: bordered card, grey fill when active
  const snipRow = (s: Snippet, where?: string) => {
    const multi = m.selection.size > 1 && m.selection.has(s.id)
    const active = s.id === m.activeId && m.selection.size <= 1
    const lifted = drag?.id === s.id
    const title = s.title || "(untitled)"
    return (
      <div
        key={s.id}
        data-id={s.id}
        {...treeitemProps(rowByKey.get(`snip:${s.id}`)!)}
        aria-selected={active || multi}
        aria-label={`${title}${s.pinned ? ", pinned" : ""}${where ? `, in ${where}` : ""}`}
        title={title}
        data-snip-id={s.id}
        className={cn(
          // The compact row the popup's Compact density draws (tree.tsx)
          treeRowClass(true),
          "group focus-ring",
          active
            ? cn("text-foreground", SELECTED_BAR)
            : cn("text-foreground hover:bg-hover", s.pinned && PINNED_BAR),
          multi && "outline outline-1 -outline-offset-1 outline-primary",
          // Lifted: the row stays in place, dimmed, while its ghost travels
          lifted ? "opacity-40" : grouped && "hover:cursor-grab"
        )}
        {...(grouped
          ? holdToDrag((row) => {
              setGhost(downPos.current)
              setDrag({ id: s.id, pack: s.pack || DEFAULT_PACK, group: s.group || "", title, width: row.getBoundingClientRect().width })
            })
          : {})}
        onClick={(e) => handleRowClick(e, s.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          const ids = m.selection.has(s.id) ? m.selection : new Set([s.id])
          if (!m.selection.has(s.id)) m.setSelection(ids, s.id)
          openRowCtx(e.clientX, e.clientY, ids)
        }}
      >
        {/* Resting affordance for press-and-hold drag: a grip on hover */}
        <RiDraggable className="absolute left-1 size-3 opacity-0 transition-opacity group-hover:opacity-50" aria-hidden />
        {/* A <bdi>, as the popup's rows: the title is the user's text, so a
            Hebrew one keeps its direction and a pasted-in direction control
            can't reorder what sits beside it */}
        {where ? (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">
              <bdi>{marked(title, words)}</bdi>
            </span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              <bdi>{where}</bdi>
            </span>
          </span>
        ) : (
          <span className="truncate">
            <bdi>{marked(title, words)}</bdi>
          </span>
        )}
      </div>
    )
  }

  const sectionTitle = (name: string, count: number, isCollapsed: boolean, faded = false) => {
    const selected = shown?.pack === name && !shown.group
    const total = packTotals.get(name) ?? count
    const dropHere = dropAt?.pack === name && dropAt.group === ""
    return (
      <div
        {...treeitemProps(rowByKey.get(`pack:${name}`)!)}
        data-drop-target={dropHere || undefined}
        aria-expanded={!isCollapsed}
        aria-selected={selected}
        aria-label={`${name}, ${q ? `${count} of ${total}` : count} prompt${total === 1 ? "" : "s"}${m.isLocked(name) ? ", locked" : ""}`}
        // Short: a native tooltip cuts around 80 characters, and the keys
        // are in the menu's hints and BEHAVIOR.md rather than every row
        title={`${name} — right-click or ⋯ for actions`}
        className={cn(treeHeaderClass("pack"), treeFillClass(selected), "group focus-ring", faded && "opacity-45", dropHere && DROP_TARGET)}
        onClick={() => openHeader(name)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setRenaming(name)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          openPackCtx(e.clientX, e.clientY, name, count)
        }}
      >
        {/* The chevron is the fold; the title selects (see the group's) */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          title={isCollapsed ? "Expand" : "Collapse"}
          className="flex shrink-0 cursor-pointer rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
          onMouseDown={keepRowFocus}
          onClick={(e) => {
            e.stopPropagation()
            toggleCollapsed(name)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <TreeChevron open={!isCollapsed} />
        </button>
        {renaming === name ? (
          <input
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            aria-label={`Rename pack ${name}`}
            defaultValue={name}
            spellCheck={false}
            className="min-w-0 flex-1 -my-0.5 rounded-sm bg-secondary px-1 py-0.5 text-ui font-semibold text-(--heading-strong) focus-ring"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Escape") setRenaming(null)
              if (commitKey(e)) {
                void renamePack(name, e.currentTarget.value.trim())
              }
            }}
            onBlur={() => setRenaming(null)}
          />
        ) : (
          <TreeName>{name}</TreeName>
        )}
        <MenuDots
          label={`Actions for pack ${name}`}
          reveal="group-hover:opacity-100"
          decorative
          onOpen={(x, y) => openPackCtx(x, y, name, count)}
        />
        {m.isLocked(name) && <RiLock2Fill className="size-3 shrink-0 text-(--warn)" aria-hidden />}
        {/* While searching: the hits out of the pack's size */}
        <Count>{q ? `${count} / ${total}` : count}</Count>
      </div>
    )
  }

  return (
    // The floor is 13rem, not 15: at the 125% UI scale and the window's
    // minimum width the pane kept 260px beside a 300px sidebar
    // A dragged width (useSidebarWidth) overrides it
    <aside
      ref={asideRef}
      aria-label="Prompts"
      className={cn("relative flex w-[clamp(13rem,28%,20rem)] shrink-0 flex-col border-r border-border bg-sidebar", drag && "cursor-grabbing")}
      style={width.width == null ? undefined : { width: width.width }}
    >
      {/* The lifted row's ghost: its title at its width, under the pointer,
          over everything and letting the pointer through to the tree */}
      {drag && ghost && (
        <div
          aria-hidden
          data-drag-ghost
          className="pointer-events-none fixed z-50 truncate rounded-md border border-border bg-background px-2 py-1 text-ui text-foreground shadow-lg"
          style={{ left: ghost.x - 12, top: ghost.y - 14, width: drag.width }}
        >
          <bdi>{drag.title}</bdi>
        </div>
      )}
      {/* No heading: the window is Promptline and the list is visibly prompts;
          the landmark keeps its name through aria-label. What is shown (the
          filter) apart from how it is shown (Display) */}
      <div className="flex gap-1.5 px-3 pt-3 pb-2">
        <label className={cn(searchBoxClass(), "min-w-0 flex-1")}>
          <RiSearchLine className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {scope && (
            <Chip size="md" className="max-w-[45%]" onRemove={() => setScope(null)} removeLabel="Search everywhere">
              <span className="truncate" title={scope.group ? `Searching in ${scope.pack} › ${scope.group}` : `Searching in ${scope.pack}`}>
                in {scope.group ?? scope.pack}
              </span>
            </Chip>
          )}
          <span className="relative flex min-w-0 flex-1">
          {/* Same font and box as the input; scrolled with it when the text runs long */}
          <div
            ref={mirrorRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre text-foreground"
          >
            <QueryMirror query={query} />
          </div>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setSearch(e.target.value)}
            onScroll={(e) => {
              if (mirrorRef.current) mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft
            }}
            onSelect={(e) => {
              if (mirrorRef.current) mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft
            }}
            onKeyDown={(e) => {
              // Esc clears the filter first, then leaves the field
              if (e.key === "Escape") {
                e.preventDefault()
                if (query) clearSearch()
                else e.currentTarget.blur()
              }
            }}
            placeholder={narrow ? "Filter" : "Filter  #tag @pack >group"}
            aria-label="Filter prompts"
            title="Filter (Ctrl+F): #tag, @pack and >group narrow it, Esc clears"
            spellCheck={false}
            className="relative min-w-0 flex-1 bg-transparent text-transparent caret-foreground outline-none selection:bg-(--link)/30 selection:text-transparent placeholder:text-muted-foreground"
          />
          </span>
          {query ? (
            <SearchClear
              label="Clear the filter"
              title="Clear (Esc)"
              onClick={() => {
                clearSearch()
                searchRef.current?.focus()
              }}
            />
          ) : null}
        </label>
        <button
          type="button"
          // The dot says the display is off its defaults; the title says which way
          title={`Display: ${grouped ? "packs" : "one list"}, ${ORDER_LABELS[orderBy]}${!grouped || orderBy !== "uses" ? " (changed from the defaults)" : ""}`}
          aria-label={`Display options: ${grouped ? "packs" : "one list"}, ${ORDER_LABELS[orderBy]}`}
          aria-haspopup="menu"
          className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-hover hover:text-foreground"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const orders: [OrderBy, string][] = [["uses", ORDER_LABELS.uses], ["title", ORDER_LABELS.title], ["custom", `${ORDER_LABELS.custom} — Alt+↑/↓ to arrange`]]
            display.open(r.left, r.bottom + 4, [
              { kind: "header", text: "View" },
              { kind: "item", label: "Packs", checked: grouped, run: () => setGrouped(true) },
              { kind: "item", label: "One list", checked: !grouped, run: () => setGrouped(false) },
              { kind: "sep" },
              { kind: "header", text: "Order" },
              ...orders.map(([o, label]) => ({ kind: "item" as const, label, checked: orderBy === o, run: () => setOrderBy(o) })),
              { kind: "sep" },
              { kind: "item", label: "Collapse all", disabled: !grouped, run: () => foldAll(true) },
              { kind: "item", label: "Expand all", disabled: !grouped, run: () => foldAll(false) },
            ])
          }}
        >
          <RiEqualizer2Line className="size-4" />
          {/* Off the defaults (packs, most used): say so on the button */}
          {(!grouped || orderBy !== "uses") && (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-(--link)" aria-hidden />
          )}
        </button>
      </div>

      {q && (
        <div className="px-4 pb-2 text-xs text-muted-foreground" aria-live="polite">
          {visible.length === 0 && !(scope && hits.length) ? (
            "No matches"
          ) : scope ? (
            <>
              {visible.length} in {scope.group ?? scope.pack}
              {hits.length > visible.length && (
                <>
                  {" · "}
                  <button type="button" className="cursor-pointer text-(--link) hover:underline" onClick={() => setScope(null)}>
                    {hits.length - visible.length} more elsewhere
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {visible.length} match{visible.length === 1 ? "" : "es"}
              {grouped && ` in ${new Set(visible.map((s) => s.pack || DEFAULT_PACK)).size} pack${new Set(visible.map((s) => s.pack || DEFAULT_PACK)).size === 1 ? "" : "s"}`}
            </>
          )}
        </div>
      )}

      {/* Create bar: one dashed "empty slot" card, echoing the row shape.
          New asks what and where — a pack, a group in a pack, a prompt in
          a pack or group — so nothing lands in a default place. It sits
          above the scrolling list, not in it, so the list's scrollbar
          gutter never narrows it against the filter row. */}
      <div className="px-3 pb-2">
        <button
          type="button"
          aria-haspopup="menu"
          className="sidebar-new flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background text-ui font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            openNewMenu(r.left, r.bottom + 4)
          }}
        >
          <RiAddLine className="size-4" />
          New
        </button>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 pt-1 pb-3">
        {/* pt-1 (taken from the row above) is room for a drag's insertion mark
            above the first row, which the scroll box would otherwise clip */}
        {/* An empty library: the pane says what to do; the void under New
            says only that it is a void, not a list still loading */}
        {rows.length === 0 && !q && m.libraryState === "ready" && (
          <p className="px-1 pt-1 text-xs text-muted-foreground">No packs yet. New makes one.</p>
        )}
        {/* One tree for assistive tech: packs at level 1, their prompts and
            groups at 2, a group's prompts at 3 (a flat list at 1); the
            wrappers between are presentation so each run of children is
            owned by the row above it. The look is the shared tree's
            (components/tree.tsx), the popup's list draws the same */}
        <div role="tree" aria-label="Library" aria-multiselectable="true">
          {tree ? (
            tree.map((p) => {
              // Searching: a pack with no hits is only its faded header
              const faded = !!q && p.count === 0
              const isCollapsed = faded || (!q && collapsed.has(p.name))
              return (
                <TreeSection key={p.name} open={!isCollapsed} data-pack={p.name} role="presentation">
                  {sectionTitle(p.name, p.count, isCollapsed, faded)}
                  {!isCollapsed && (
                    <TreeChildren level="pack" role="group">
                      {p.ungrouped.map((s) => snipRow(s))}
                      {p.groups.map((g) => {
                        const gc = !q && collapsedGroups.has(groupKey(p.name, g.name))
                        return (
                          <TreeGroup key={g.name} role="presentation" data-group={g.name}>
                            {groupTitle(p.name, g.name, g.items.length, gc)}
                            {/* A group's rows sit where the pack's own do (tree.tsx) */}
                            {!gc && (
                              <TreeChildren level="group" role="group">
                                {g.items.map((s) => snipRow(s))}
                              </TreeChildren>
                            )}
                          </TreeGroup>
                        )
                      })}
                    </TreeChildren>
                  )}
                </TreeSection>
              )
            })
          ) : (
            // One list: each row says where it lives, since no header does
            <div role="presentation" className="flex flex-col gap-0.5">
              {shownList.map((s) => snipRow(s, s.group ? `${s.pack || DEFAULT_PACK} › ${s.group}` : s.pack || DEFAULT_PACK))}
            </div>
          )}
        </div>
      </div>

      {/* The foot: the legend for the two bars a row can carry, and the
          Settings gear at the right (it stood alone in the bar above the
          pane until 2026-10-10; that bar is the crumb line's now). The
          legend is decoration to assistive tech; the gear is not. */}
      <div className={cn(footClass, "gap-x-3")}>
        <span aria-hidden className="flex items-center gap-1.5">
          <span className="size-1.5 bg-(--focus)" />
          viewed
        </span>
        <span aria-hidden className="flex items-center gap-1.5">
          <span className="size-1.5 bg-(--warn)" />
          pinned
        </span>
        <button
          type="button"
          aria-label="Settings"
          aria-pressed={m.settingsOpen}
          title={m.hotkey ? `Settings — popup hotkey: ${C.fmtHotkey(m.hotkey)}` : "Settings"}
          className={cn(
            "ml-auto flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-hover hover:text-foreground focus-ring",
            m.settingsOpen && "bg-secondary text-foreground"
          )}
          onClick={() => m.showSettings(!m.settingsOpen)}
        >
          <RiSettings3Line className="size-4" />
        </button>
      </div>
      {menus}
      {display.element}
      <div role="status" aria-live="polite" className="sr-only">{announce}</div>
      {resizeHandle}
    </aside>
  )
}
