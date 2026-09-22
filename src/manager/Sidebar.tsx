import { useEffect, useMemo, useRef, useState } from "react"
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiDraggable,
  RiEqualizer2Line,
  RiLock2Fill,
  RiMoonClearLine,
  RiPushpinFill,
  RiSearchLine,
  RiSettings3Line,
  RiSunLine,
} from "@remixicon/react"
import { C, type OrderBy, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { Chip, Count, MATCH_HIT } from "@/components/prompt-bits"
import { SEGMENT_TRACK, SearchClear, searchBoxClass, segmentClass } from "@/components/field"
import { DEFAULT_PACK, useManager, type LibraryFocus } from "./state"
import { useCtxMenu } from "./ctx-menu"
import { EmptyState } from "./EmptyState"
import { MenuDots, groupKey, useLibraryMenus } from "./menus"
import { say, sayUndo } from "./status"

// A pack's prompts split into the ungrouped run, then its groups in order of
// first appearance — so a custom arrangement holds, and any other sort order
// carries through from the rows themselves.
function splitGroups(items: Snippet[]): { ungrouped: Snippet[]; groups: [string, Snippet[]][] } {
  const ungrouped: Snippet[] = []
  const map = new Map<string, Snippet[]>()
  for (const s of items) {
    if (!s.group) ungrouped.push(s)
    else {
      if (!map.has(s.group)) map.set(s.group, [])
      map.get(s.group)!.push(s)
    }
  }
  return { ungrouped, groups: [...map.entries()] }
}

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

export function Sidebar() {
  const m = useManager()
  const [query, setQuery] = useState("")
  // The order is the manager's, shared with the overview (C.sortPrompts)
  const { orderBy, setOrderBy } = m
  // Group-by-pack is the default view
  const [grouped, setGrouped] = useState(localStorage.getItem("groupByPack") !== "0")
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
  // A click on a pack or group title selects it: the pane beside the
  // sidebar shows what it holds (the overview), the way a prompt row shows
  // the prompt. The sidebar stays, so a double-click still reaches the rename.
  const shown = m.view.kind === "overview" ? m.view.focus : null

  // Drag-to-reorder: a short press-and-hold lifts the row (so the gesture is
  // discoverable), then moving it slides an insertion mark between rows.
  const [drag, setDrag] = useState<{ id: string; pack: string } | null>(null)
  // What a screen reader hears after a keyboard move
  const [announce, setAnnounce] = useState("")
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const downPos = useRef<{ x: number; y: number } | null>(null)
  const dragMoved = useRef(false)
  const suppressClick = useRef(false)

  const cancelHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
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

  const groups = useMemo(() => {
    if (!grouped) return null
    const map = new Map<string, Snippet[]>()
    // Empty packs are real sections too — otherwise they exist only in the
    // registry and can never be seen or deleted from the menu
    // While searching, a pack without hits stays in the list, faded, so the
    // tree keeps its shape and says where nothing matched
    for (const name of m.packNames()) map.set(name, [])
    for (const s of visible) {
      const key = s.pack || DEFAULT_PACK
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, grouped, q, m.packNames])

  // Flat id list in display order, for shift-range selection
  const visibleIds: string[] = []
  if (groups) {
    for (const [name, items] of groups) {
      if (q || !collapsed.has(name))
        for (const s of items) if (q || !s.group || !collapsedGroups.has(groupKey(name, s.group))) visibleIds.push(s.id)
    }
  } else {
    for (const s of visible) visibleIds.push(s.id)
  }
  visibleIdsRef.current = visibleIds

  // The library in the order the rows are drawn: sorted, and by pack (the
  // ungrouped run, then each group) when the view is grouped. Under "custom"
  // that is the array itself.
  const displayedOrder = (list: Snippet[]) => {
    if (orderBy === "custom") return [...list]
    const sorted = C.sortPrompts(list, orderBy)
    if (!grouped) return sorted
    return C.packTree(sorted, [], DEFAULT_PACK).flatMap((p) => [...p.ungrouped, ...p.groups.flatMap((g) => g.items)])
  }

  // Move the dragged snippet next to the drop target in the master array and
  // persist; relative order within every pack follows from the array order.
  // The drop was aimed in the displayed order, so under "Most used" or
  // "A–Z" the array is first rebased to that order: the switch to "Custom"
  // that follows would otherwise reveal the array's own order, with every
  // row but the dragged one reshuffled.
  const commitReorder = async (dragId: string, targetId: string, after: boolean) => {
    const all = displayedOrder(m.snippets)
    const from = all.findIndex((s) => s.id === dragId)
    if (from === -1) return
    const [item] = all.splice(from, 1)
    let to = all.findIndex((s) => s.id === targetId)
    if (to === -1) return
    // Dropping among another group's rows moves the prompt into that group
    const target = all[to]
    const regrouped = grouped && target.group !== item.group
    const moved = regrouped ? { ...item, group: target.group } : item
    if (after) to += 1
    all.splice(to, 0, moved)
    await m.persist(all)
    if (regrouped) {
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

  // While a drag is live, track the row under the pointer and commit on release
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      dragMoved.current = true
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
        "[data-snip-id]"
      ) as HTMLElement | null
      const id = el?.dataset.snipId
      const snip = id ? m.snippets.find((s) => s.id === id) : undefined
      // Grouped view: only reorder within the pack the drag started in
      if (!snip || (grouped && (snip.pack || DEFAULT_PACK) !== drag.pack)) {
        setOver(null)
        return
      }
      const r = el!.getBoundingClientRect()
      setOver({ id: snip.id, after: e.clientY > r.top + r.height / 2 })
    }
    const up = () => {
      if (over && over.id !== drag.id) void commitReorder(drag.id, over.id, over.after)
      if (dragMoved.current) suppressClick.current = true
      setDrag(null)
      setOver(null)
    }
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", up)
    return () => {
      document.removeEventListener("pointermove", move)
      document.removeEventListener("pointerup", up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, over, grouped, m.snippets, orderBy])

  // Mouse and keyboard events both carry the modifier flags this reads
  const handleRowClick = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, id: string) => {
    // A completed drag still fires a click on release — swallow it
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
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
    newPack,
  } = useLibraryMenus({ surface: "sidebar", moveRow })

  // A new prompt or pack can land below the fold of a long list, and a pack
  // opened from the editor's crumbs may sit there too: bring what is shown
  // into view (the popup does the same for its selection)
  const listRef = useRef<HTMLDivElement>(null)
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
    const Chev = isCollapsed ? RiArrowRightSLine : RiArrowDownSLine
    return (
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        aria-current={shown?.pack === pack && shown.group === group ? "true" : undefined}
        title={`${group} — click shows its prompts, Enter folds it, right-click for actions`}
        className={cn(
          "group flex cursor-pointer select-none items-center gap-1 rounded-md px-1 py-1 text-ui font-medium text-(--heading) hover:bg-hover",
          shown?.pack === pack && shown.group === group && "bg-accent hover:bg-accent"
        )}
        onClick={() => m.openOverview({ pack, group })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            toggleCollapsedGroup(key)
          } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            openGroupCtx(r.left + 24, r.bottom, pack, group, count)
          }
        }}
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
        {/* The chevron is the fold; the title selects */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={isCollapsed ? `Expand group ${group}` : `Collapse group ${group}`}
          className="flex shrink-0 cursor-pointer rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            toggleCollapsedGroup(key)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Chev className="size-4" />
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
              if (e.key === "Enter") {
                void renameGroup(pack, group, e.currentTarget.value.trim())
              }
            }}
            // Enter commits, leaving the field cancels: a misclick must not rename
            onBlur={() => setRenamingGroup(null)}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{group}</span>
        )}
        {/* Hover-revealed way into the same menu right-click opens */}
        <MenuDots
          label={`Actions for group ${group}`}
          reveal="group-hover:opacity-100"
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
    const mark = drag && drag.id !== s.id && over?.id === s.id ? over.after : null
    return (
      <div
        key={s.id}
        data-id={s.id}
        role="button"
        tabIndex={0}
        aria-current={active ? "true" : undefined}
        aria-pressed={multi || undefined}
        title={s.title || "(untitled)"}
        data-snip-id={s.id}
        className={cn(
          "group flex min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-1 text-ui transition-[transform,box-shadow] duration-150",
          active
            ? "bg-accent text-foreground"
            : "text-foreground hover:bg-hover",
          multi && "outline outline-1 -outline-offset-1 outline-primary",
          lifted ? "z-10 scale-[1.02] cursor-grabbing shadow-lg ring-1 ring-ring/40" : "hover:cursor-grab",
          mark !== null &&
            (mark ? "shadow-[0_3px_0_0_var(--primary)]" : "shadow-[0_-3px_0_0_var(--primary)]")
        )}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          downPos.current = { x: e.clientX, y: e.clientY }
          dragMoved.current = false
          cancelHold()
          holdTimer.current = setTimeout(() => {
            holdTimer.current = null
            setDrag({ id: s.id, pack: s.pack || DEFAULT_PACK })
          }, 180)
        }}
        onPointerMove={(e) => {
          // Moving before the hold delay elapses means a click, not a drag
          if (!holdTimer.current || drag) return
          const d = downPos.current
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) cancelHold()
        }}
        onPointerUp={cancelHold}
        onPointerLeave={() => {
          if (!drag) cancelHold()
        }}
        onClick={(e) => handleRowClick(e, s.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            handleRowClick(e, s.id)
          } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            // The keyboard's drag
            e.preventDefault()
            moveRow(s.id, e.key === "ArrowUp" ? -1 : 1)
          } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
            // The keyboard's right-click: menu at the row, not at the pointer
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            const ids = m.selection.has(s.id) ? m.selection : new Set([s.id])
            if (!m.selection.has(s.id)) m.setSelection(ids, s.id)
            openRowCtx(r.left + 24, r.bottom, ids)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          const ids = m.selection.has(s.id) ? m.selection : new Set([s.id])
          if (!m.selection.has(s.id)) m.setSelection(ids, s.id)
          openRowCtx(e.clientX, e.clientY, ids)
        }}
      >
        {/* Resting affordance for press-and-hold drag: a grip on hover */}
        <RiDraggable className="-ml-1 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" aria-hidden />
        {s.pinned && <RiPushpinFill className="size-3 shrink-0 text-(--warn)" aria-label="pinned" />}
        {where ? (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{marked(s.title || "(untitled)", words)}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{where}</span>
          </span>
        ) : (
          <span className="truncate">{marked(s.title || "(untitled)", words)}</span>
        )}
      </div>
    )
  }

  const sectionTitle = (name: string, count: number, isCollapsed: boolean, faded = false) => {
    const Chev = isCollapsed ? RiArrowRightSLine : RiArrowDownSLine
    return (
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        aria-current={shown?.pack === name && !shown.group ? "true" : undefined}
        title={`${name} — click shows its prompts, Enter folds it, right-click for actions`}
        className={cn(
          "group flex cursor-pointer select-none items-center gap-1 rounded-md px-1 py-1 text-ui font-semibold text-(--heading-strong) hover:bg-hover",
          shown?.pack === name && !shown.group && "bg-accent hover:bg-accent",
          faded && "opacity-45"
        )}
        onClick={() => m.openOverview({ pack: name })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            toggleCollapsed(name)
          } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            openPackCtx(r.left + 24, r.bottom, name, count)
          }
        }}
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
        {/* The chevron is the fold; the title selects */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={isCollapsed ? `Expand pack ${name}` : `Collapse pack ${name}`}
          className="flex shrink-0 cursor-pointer rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            toggleCollapsed(name)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Chev className="size-4" />
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
              if (e.key === "Enter") {
                void renamePack(name, e.currentTarget.value.trim())
              }
            }}
            onBlur={() => setRenaming(null)}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{name}</span>
        )}
        <MenuDots
          label={`Actions for pack ${name}`}
          reveal="group-hover:opacity-100"
          onOpen={(x, y) => openPackCtx(x, y, name, count)}
        />
        {m.isLocked(name) && <RiLock2Fill className="size-3 shrink-0 text-(--warn)" aria-label="locked" />}
        {/* While searching: the hits out of the pack's size */}
        <Count>{q ? `${count} / ${packTotals.get(name) ?? count}` : count}</Count>
      </div>
    )
  }

  return (
    <aside aria-label="Prompts" className="flex w-[clamp(15rem,28%,20rem)] flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">Prompts</h1>
      </div>

      {/* What is shown (the filter) apart from how it is shown (Display) */}
      <div className="flex gap-1.5 px-3 pb-2">
        <label className={cn(searchBoxClass(!!q), "min-w-0 flex-1")}>
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
            placeholder="Filter  #tag @pack >group"
            aria-label="Filter prompts"
            title="Filter (Ctrl+F) · #tag, @pack and >group narrow it, Esc clears"
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
          title="Display: packs or one list, order, folding"
          aria-label="Display options"
          aria-haspopup="menu"
          className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-hover hover:text-foreground"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const orders: [OrderBy, string][] = [["uses", "Most used"], ["title", "A–Z"], ["custom", "Custom — drag to arrange"]]
            const setView = (on: boolean) => {
              setGrouped(on)
              localStorage.setItem("groupByPack", on ? "1" : "0")
            }
            display.open(r.left, r.bottom + 4, [
              { kind: "header", text: "View" },
              { kind: "item", label: "Packs", checked: grouped, run: () => setView(true) },
              { kind: "item", label: "One list", checked: !grouped, run: () => setView(false) },
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

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 pb-3">
        {/* Create bar: one dashed "empty slot" card, echoing the row shape.
            New asks what and where — a pack, a group in a pack, a prompt in
            a pack or group — so nothing lands in a default place */}
        <button
          type="button"
          aria-haspopup="menu"
          className="mb-3 flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background text-ui font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            openNewMenu(r.left, r.bottom + 4)
          }}
        >
          <RiAddLine className="size-4" />
          New
        </button>
        {/* Nothing at all — not even an empty pack — gets a way in, not a blank */}
        {m.snippets.length === 0 && m.packNames().length === 0 && (
          <EmptyState
            title="No prompts yet"
            hint="A pack holds your prompts: start with one"
            actions={[{ label: "New pack", onClick: () => void newPack(), primary: true }]}
          />
        )}
        {groups ? (
          groups.map(([name, items]) => {
            // Searching: a pack with no hits is only its faded header
            const faded = !!q && items.length === 0
            const isCollapsed = faded || (!q && collapsed.has(name))
            return (
              <div key={name} data-pack={name} className="mb-2">
                {sectionTitle(name, items.length, isCollapsed, faded)}
                {!isCollapsed &&
                  (() => {
                    const { ungrouped, groups: gs } = splitGroups(items)
                    return (
                      <div className="mt-0.5 flex flex-col gap-0.5 pl-4">
                        {ungrouped.map((s) => snipRow(s))}
                        {gs.map(([g, rows]) => {
                          const gc = !q && collapsedGroups.has(groupKey(name, g))
                          return (
                            <div key={g} className="flex flex-col gap-0.5">
                              {groupTitle(name, g, rows.length, gc)}
                              {/* The guide line ties a group's prompts to its header */}
                              {!gc && (
                                <div className="ml-[11px] flex flex-col gap-0.5 border-l border-border pl-2">
                                  {rows.map((s) => snipRow(s))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
              </div>
            )
          })
        ) : (
          // One list: each row says where it lives, since no header does
          <div className="flex flex-col gap-0.5">
            {visible.map((s) => snipRow(s, s.group ? `${s.pack || DEFAULT_PACK} › ${s.group}` : s.pack || DEFAULT_PACK))}
          </div>
        )}
      </div>

      {/* Light/Dark segmented mode toggle with the settings gear as a compact segment */}
      <div className="p-3">
        <div className={SEGMENT_TRACK}>
          {(["light", "dark"] as const).map((t) => {
            const Icon = t === "light" ? RiSunLine : RiMoonClearLine
            const active = m.prefs.theme === t
            return (
              <button
                key={t}
                type="button"
                aria-pressed={active}
                className={cn(segmentClass(active), "flex-1 capitalize")}
                onClick={() => void m.savePrefs({ theme: t })}
              >
                <Icon className="size-4" />
                {t}
              </button>
            )
          })}
          <button
            type="button"
            aria-label="Settings"
            aria-pressed={m.settingsOpen}
            title={`Settings — popup hotkey: ${C.fmtHotkey(m.hotkey)}`}
            className={cn(segmentClass(m.settingsOpen), "w-8 shrink-0")}
            onClick={() => m.showSettings(!m.settingsOpen)}
          >
            <RiSettings3Line className="size-4" />
          </button>
        </div>
      </div>
      {menus}
      {display.element}
      <div role="status" aria-live="polite" className="sr-only">{announce}</div>

    </aside>
  )
}
