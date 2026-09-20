import { useEffect, useMemo, useRef, useState } from "react"
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiDraggable,
  RiEqualizerLine,
  RiFileAddLine,
  RiFolderAddLine,
  RiLock2Fill,
  RiMoonClearLine,
  RiMoreLine,
  RiPushpinFill,
  RiSettings3Line,
  RiSunLine,
} from "@remixicon/react"
import { Checkbox } from "@/components/ui/checkbox"
import { C, type OrderBy, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { DEFAULT_PACK, useManager } from "./state"
import { EmptyState } from "./EmptyState"
import { groupKey, useLibraryMenus } from "./menus"
import { say, sayUndo } from "./status"

function loadCollapsed(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"))
  } catch {
    return new Set()
  }
}

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

export function Sidebar() {
  const m = useManager()
  const [query, setQuery] = useState("")
  // The order is the manager's, shared with the overview (C.sortPrompts)
  const { orderBy, setOrderBy } = m
  // Group-by-pack is the default view
  const [grouped, setGrouped] = useState(localStorage.getItem("groupByPack") !== "0")
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed("collapsedPacks"))
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => loadCollapsed("collapsedGroups"))
  const [configOpen, setConfigOpen] = useState(false)
  const [newPackInput, setNewPackInput] = useState(false)
  const visibleIdsRef = useRef<string[]>([])
  // A click on a pack or group title opens the library view on it, after a
  // beat: a double-click renames instead, and the view switching away on the
  // first click would unmount the input before the second one landed
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openLibraryLater = (focus: { pack: string; group?: string }) => {
    if (openTimer.current) clearTimeout(openTimer.current)
    openTimer.current = setTimeout(() => {
      openTimer.current = null
      m.openLibrary(focus)
    }, 220)
  }
  const cancelOpen = () => {
    if (openTimer.current) clearTimeout(openTimer.current)
    openTimer.current = null
  }

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
  // The list-view configuration deviates from defaults — surface a dot on the toggle

  const visible = useMemo(() => {
    const pool = q
      ? m.snippets.filter(
          (s) =>
            s.title.toLowerCase().includes(q) ||
            (s.tags || []).some((t) => t.toLowerCase().includes(q)) ||
            (s.pack || "").toLowerCase().includes(q) ||
            (s.group || "").toLowerCase().includes(q) ||
            s.text.toLowerCase().includes(q)
        )
      : [...m.snippets]
    return C.sortPrompts(pool, orderBy)
  }, [m.snippets, q, orderBy])

  const groups = useMemo(() => {
    if (!grouped) return null
    const map = new Map<string, Snippet[]>()
    // Empty packs are real sections too — otherwise they exist only in the
    // registry and can never be seen or deleted from the menu
    if (!q) for (const name of m.packNames()) map.set(name, [])
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

  // Move the dragged snippet next to the drop target in the master array and
  // persist; relative order within every pack follows from the array order.
  const commitReorder = async (dragId: string, targetId: string, after: boolean) => {
    const all = [...m.snippets]
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
    const before = m.snippets
    await m.persist(all)
    if (regrouped) {
      // A drop among another group's rows changes the label as a side
      // effect; say so, and make it reversible
      sayUndo(
        target.group ? `Moved "${item.title}" into group "${target.group}"` : `Moved "${item.title}" out of its group`,
        () => void m.persist(before).then(() => say("Restored"))
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

  // The pack, group and prompt menus, shared with the library view
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
  } = useLibraryMenus({
    // A group starts life on a prompt, drawn inside its pack: unfold it
    onNewGroup: (name) => {
      if (collapsed.has(name)) toggleCollapsed(name)
    },
    moveRow,
  })

  const toggleCollapsed = (name: string) => {
    const next = new Set(collapsed)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setCollapsed(next)
    localStorage.setItem("collapsedPacks", JSON.stringify([...next]))
  }

  const toggleCollapsedGroup = (key: string) => {
    const next = new Set(collapsedGroups)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setCollapsedGroups(next)
    localStorage.setItem("collapsedGroups", JSON.stringify([...next]))
  }

  // Group header: quieter than the pack title, sits among its rows
  const groupTitle = (pack: string, group: string, count: number, isCollapsed: boolean) => {
    const key = groupKey(pack, group)
    const Chev = isCollapsed ? RiArrowRightSLine : RiArrowDownSLine
    return (
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        title={`${group} — click opens it in the library, Enter folds it, right-click for actions`}
        className={cn(
          "group flex cursor-pointer select-none items-center gap-1 rounded-md px-1 py-1 text-xs font-semibold uppercase tracking-[0.06em]",
          isCollapsed ? "text-(--heading)/70 hover:text-(--heading)" : "text-(--heading)"
        )}
        onClick={() => openLibraryLater({ pack, group })}
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
          cancelOpen()
          setRenamingGroup(key)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          openGroupCtx(e.clientX, e.clientY, pack, group, count)
        }}
      >
        {renamingGroup === key ? (
          <input
            autoFocus
            defaultValue={group}
            spellCheck={false}
            className="min-w-0 flex-1 -mx-1 -my-0.5 rounded-sm bg-secondary px-1 py-0.5 text-xs font-semibold uppercase tracking-[0.06em] text-foreground focus-ring"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              // The header above toggles on Enter / Space; typing must not reach it
              e.stopPropagation()
              if (e.key === "Escape") setRenamingGroup(null)
              if (e.key === "Enter") void renameGroup(pack, group, e.currentTarget.value.trim())
            }}
            // Enter commits, leaving the field cancels: a misclick must not rename
            onBlur={() => setRenamingGroup(null)}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">
            {group} <span className="font-medium">({count})</span>
          </span>
        )}
        {/* Hover-revealed way into the same menu right-click opens */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Actions for group ${group}`}
          title="Actions"
          className="rounded-sm p-0.5 opacity-0 hover:bg-secondary group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            openGroupCtx(r.left, r.bottom, pack, group, count)
          }}
        >
          <RiMoreLine className="size-3.5" />
        </button>
        {/* The chevron is the fold; the title is the way into the library */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={isCollapsed ? `Expand group ${group}` : `Collapse group ${group}`}
          className="flex shrink-0 cursor-pointer rounded-sm hover:bg-secondary"
          onClick={(e) => {
            e.stopPropagation()
            toggleCollapsedGroup(key)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Chev className="size-4" />
        </button>
      </div>
    )
  }

  // Prompt row: bordered card, grey fill when active
  const snipRow = (s: Snippet) => {
    const multi = m.selection.size > 1 && m.selection.has(s.id)
    const active = s.id === m.activeId && m.selection.size <= 1
    const lifted = drag?.id === s.id
    const mark = drag && drag.id !== s.id && over?.id === s.id ? over.after : null
    return (
      <div
        key={s.id}
        role="button"
        tabIndex={0}
        aria-current={active ? "true" : undefined}
        aria-pressed={multi || undefined}
        title={s.title || "(untitled)"}
        data-snip-id={s.id}
        className={cn(
          "group flex min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-1 text-ui font-medium transition-[transform,box-shadow] duration-150",
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
        <span className="truncate">{s.title || "(untitled)"}</span>
      </div>
    )
  }

  const sectionTitle = (name: string, count: number, isCollapsed: boolean) => {
    const Chev = isCollapsed ? RiArrowRightSLine : RiArrowDownSLine
    return (
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        title={`${name} — click opens it in the library, Enter folds it, right-click for actions`}
        className={cn(
          "group flex cursor-pointer select-none items-center gap-1.5 rounded-md px-1 py-1.5 text-base font-semibold",
          isCollapsed ? "text-(--heading-strong)/70 hover:text-(--heading-strong)" : "text-(--heading-strong)"
        )}
        onClick={() => openLibraryLater({ pack: name })}
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
          cancelOpen()
          setRenaming(name)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          openPackCtx(e.clientX, e.clientY, name, count)
        }}
      >
        {renaming === name ? (
          <input
            autoFocus
            defaultValue={name}
            spellCheck={false}
            className="min-w-0 flex-1 -mx-1 -my-0.5 rounded-sm bg-secondary px-1 py-0.5 text-base font-semibold text-(--heading-strong) focus-ring"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Escape") setRenaming(null)
              if (e.key === "Enter") void renamePack(name, e.currentTarget.value.trim())
            }}
            onBlur={() => setRenaming(null)}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">
            {name} <span className="font-semibold text-muted-foreground">({count})</span>
          </span>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Actions for pack ${name}`}
          title="Actions"
          className="rounded-sm p-0.5 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            openPackCtx(r.left, r.bottom, name, count)
          }}
        >
          <RiMoreLine className="size-4" />
        </button>
        {m.isLocked(name) && <RiLock2Fill className="size-3 shrink-0 text-(--warn)" aria-label="locked" />}
        {/* The chevron is the fold; the title is the way into the library */}
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
      </div>
    )
  }

  return (
    <aside aria-label="Prompts" className="flex w-[clamp(15rem,28%,20rem)] flex-col border-r border-border bg-sidebar">
      {/* Title row: page title + view-config toggle + round add button */}
      <div className="flex items-center gap-1.5 p-3">
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">Prompts</h1>
        <button
          type="button"
          title="List view options"
          aria-label="List view options"
          aria-expanded={configOpen}
          className={cn(
            "relative flex h-7 cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground",
            configOpen && "bg-secondary text-foreground"
          )}
          onClick={() => setConfigOpen((v) => !v)}
        >
          <RiEqualizerLine className="size-4" />
          {/* Points at the panel that unfolds beneath; flips once it is open */}
          <RiArrowDownSLine className={cn("size-3.5 transition-transform", configOpen && "rotate-180")} />
        </button>
      </div>

      {/* List-view configuration: filter, order, grouping — tucked away by default */}
      {configOpen && (
        <div className="mx-3 mb-3 flex flex-col gap-3 rounded-lg bg-secondary/60 p-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter prompts…"
            aria-label="Filter prompts"
            spellCheck={false}
            className="rounded-lg bg-background px-3 py-1.5 text-ui text-foreground focus-ring placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">Order by</span>
            <select
              value={orderBy}
              onChange={(e) => setOrderBy(e.target.value as OrderBy)}
              className="min-w-0 flex-1 cursor-pointer truncate rounded-lg bg-background px-2 py-1 text-ui text-foreground focus-ring"
            >
              <option value="uses">Most used</option>
              <option value="title">Title</option>
              <option value="custom">Custom — drag to arrange</option>
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
            <Checkbox
              checked={grouped}
              onCheckedChange={(v) => {
                setGrouped(v === true)
                localStorage.setItem("groupByPack", v === true ? "1" : "0")
              }}
            />
            Group by pack
          </label>
        </div>
      )}
      {/* A hidden active filter must stay visible — chip clears it */}
      {!configOpen && q && (
        <button
          type="button"
          aria-label={`Filtering by "${query.trim()}" — clear`}
          className="mx-3 mb-3 flex cursor-pointer items-center gap-1 self-start rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setQuery("")}
        >
          Filtering by "{query.trim()}" — clear ✕
        </button>
      )}

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {/* Create bar: two dashed "empty slot" cards, echoing the row shape */}
        {newPackInput ? (
          <div className="mb-3 flex flex-col gap-1.5">
            <input
              autoFocus
              placeholder="Pack name — Enter to create, Esc to cancel"
              spellCheck={false}
              className="rounded-lg border border-dashed border-primary bg-background px-3.5 py-2 text-ui text-foreground focus-ring placeholder:text-muted-foreground/80"
              onKeyDown={(e) => {
                if (e.key === "Escape") setNewPackInput(false)
                if (e.key === "Enter") {
                  const name = e.currentTarget.value.trim()
                  setNewPackInput(false)
                  if (name) void m.addPack(name)
                }
              }}
              onBlur={() => setNewPackInput(false)}
            />
            <button
              className="cursor-pointer self-start px-1 text-ui text-muted-foreground hover:text-primary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setNewPackInput(false)
                m.openGenerate()
              }}
            >
              ✦ Generate pack with Claude…
            </button>
          </div>
        ) : (
          <div className="mb-3 flex gap-1.5">
            <button
              className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background text-ui font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              onClick={() => void m.newPrompt()}
            >
              <RiFileAddLine className="size-4" />
              New prompt
            </button>
            <button
              className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background text-ui font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              onClick={() => setNewPackInput(true)}
            >
              <RiFolderAddLine className="size-4" />
              New pack
            </button>
          </div>
        )}
        {/* Nothing at all — not even an empty pack — gets a way in, not a blank */}
        {m.snippets.length === 0 && m.packNames().length === 0 && (
          <EmptyState
            title="No prompts yet"
            hint="New prompt starts one; New pack groups them"
            actions={[{ label: "New prompt", onClick: () => void m.newPrompt(), primary: true }]}
          />
        )}
        {groups ? (
          groups.map(([name, items]) => {
            const isCollapsed = !q && collapsed.has(name)
            return (
              <div key={name} className="mb-3">
                {sectionTitle(name, items.length, isCollapsed)}
                {!isCollapsed &&
                  (() => {
                    const { ungrouped, groups: gs } = splitGroups(items)
                    return (
                      <div className="flex flex-col gap-1.5">
                        {ungrouped.map((s) => snipRow(s))}
                        {gs.map(([g, rows]) => {
                          const gc = !q && collapsedGroups.has(groupKey(name, g))
                          return (
                            <div key={g} className="flex flex-col gap-1.5 pl-2.5">
                              {groupTitle(name, g, rows.length, gc)}
                              {!gc && rows.map((s) => snipRow(s))}
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
          <div className="flex flex-col gap-1.5">{visible.map((s) => snipRow(s))}</div>
        )}
      </div>

      {/* Light/Dark segmented mode toggle with the settings gear as a compact segment */}
      <div className="p-3">
        <div className="flex items-center gap-1 rounded-lg bg-(--segment-track) p-1">
          {(["light", "dark"] as const).map((t) => {
            const Icon = t === "light" ? RiSunLine : RiMoonClearLine
            const active = m.prefs.theme === t
            return (
              <button
                key={t}
                type="button"
                aria-pressed={active}
                className={cn(
                  "flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm text-ui font-semibold capitalize",
                  active
                    ? "bg-(--segment-active) text-foreground shadow-(--shadow-segment)"
                    : "text-muted-foreground"
                )}
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
            className={cn(
              "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm",
              m.settingsOpen
                ? "bg-(--segment-active) text-foreground shadow-(--shadow-segment)"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => m.showSettings(!m.settingsOpen)}
          >
            <RiSettings3Line className="size-4" />
          </button>
        </div>
      </div>
      {menus}
      <div role="status" aria-live="polite" className="sr-only">{announce}</div>

    </aside>
  )
}
