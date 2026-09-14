import { useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiEqualizerLine,
  RiFileAddLine,
  RiFolderAddLine,
  RiLock2Fill,
  RiMoonClearLine,
  RiPushpinFill,
  RiSettings3Line,
  RiSunLine,
} from "@remixicon/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { DEFAULT_PACK, MAX_PINS, useManager } from "./state"
import { useCtxMenu, type CtxItem } from "./ctx-menu"
import { say, sayErr } from "./status"

// "custom" = the snippets array order itself, arranged by drag-and-drop
const SORTS: Record<string, (a: Snippet, b: Snippet) => number> = {
  uses: (a, b) => b.uses - a.uses || a.title.localeCompare(b.title),
  title: (a, b) => a.title.localeCompare(b.title),
}
const withPins = (cmp: (a: Snippet, b: Snippet) => number) => (a: Snippet, b: Snippet) =>
  (+b.pinned - +a.pinned) || cmp(a, b)

function loadCollapsed(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"))
  } catch {
    return new Set()
  }
}

// Groups are labels on prompts, scoped to a pack; this is their identity key
const groupKey = (pack: string, group: string) => `${pack}\u0000${group}`

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
  const ctx = useCtxMenu()
  const [query, setQuery] = useState("")
  const [orderBy, setOrderBy] = useState(
    ["uses", "title", "custom"].includes(localStorage.getItem("orderBy") ?? "")
      ? localStorage.getItem("orderBy")!
      : "uses"
  )
  // Group-by-pack is the default view
  const [grouped, setGrouped] = useState(localStorage.getItem("groupByPack") !== "0")
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed("collapsedPacks"))
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => loadCollapsed("collapsedGroups"))
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null) // a groupKey
  const [deleteGroupAsk, setDeleteGroupAsk] = useState<{ pack: string; group: string; count: number } | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [newPackInput, setNewPackInput] = useState(false)
  const visibleIdsRef = useRef<string[]>([])

  // Drag-to-reorder: a short press-and-hold lifts the row (so the gesture is
  // discoverable), then moving it slides an insertion mark between rows.
  const [drag, setDrag] = useState<{ id: string; pack: string } | null>(null)
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
    // Custom order is the array order itself — no sort, pins included
    if (orderBy === "custom") return pool
    return pool.sort(withPins(SORTS[orderBy] || SORTS.uses))
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
    const moved = grouped && target.group !== item.group ? { ...item, group: target.group } : item
    if (after) to += 1
    all.splice(to, 0, moved)
    await m.persist(all)
    if (orderBy !== "custom") {
      setOrderBy("custom")
      localStorage.setItem("orderBy", "custom")
      say('Sorting is now "Custom" — switch back under list view options')
    }
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

  const handleRowClick = (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
    // A completed drag still fires a click on release — swallow it
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    m.showSettings(false)
    let sel: Set<string>
    let anchor: string | null = m.selectionAnchor
    if ((e as React.MouseEvent).ctrlKey || (e as React.MouseEvent).metaKey) {
      sel = new Set(m.selection)
      if (sel.has(id)) sel.delete(id)
      else sel.add(id)
      anchor = id
    } else if ((e as React.MouseEvent).shiftKey && m.selectionAnchor) {
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

  // ---- Pack operations (sidebar-first) ----
  const renamePack = async (name: string, next: string) => {
    setRenaming(null)
    if (!next || next === name) return
    if (m.packNames().includes(next)) {
      sayErr(`Pack "${next}" already exists`)
      return
    }
    const nextMeta = m.packMeta.map((p) => (p.name === name ? { ...p, name: next } : p))
    await m.persistPacks(nextMeta)
    await m.persist(m.snippets.map((s) => ((s.pack || DEFAULT_PACK) === name ? { ...s, pack: next } : s)))
    say(`Renamed to "${next}"`)
  }

  const packToJson = (name: string) =>
    C.packToJson(name, m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === name))

  // ---- Group operations: a group is a label, so these rewrite the prompts that carry it ----
  const renameGroup = async (pack: string, group: string, next: string) => {
    setRenamingGroup(null)
    if (!next || next === group) return
    const merging = m.snippets.some((s) => (s.pack || DEFAULT_PACK) === pack && s.group === next)
    await m.persist(
      m.snippets.map((s) => ((s.pack || DEFAULT_PACK) === pack && s.group === group ? { ...s, group: next } : s))
    )
    say(merging ? `Merged into "${next}"` : `Renamed to "${next}"`)
  }

  const deleteGroup = async (pack: string, group: string) => {
    setDeleteGroupAsk(null)
    const ids = m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === pack && s.group === group).map((s) => s.id)
    await m.deleteWithUndo(ids, `Deleted group "${group}" (${ids.length} prompts)`)
  }

  const openGroupCtx = (x: number, y: number, pack: string, group: string, count: number) => {
    ctx.open(x, y, [
      { kind: "header", text: `${pack} › ${group}` },
      { kind: "item", label: "Rename group", run: () => setRenamingGroup(groupKey(pack, group)) },
      {
        kind: "item",
        label: "Ungroup prompts",
        run: () => {
          void m
            .persist(
              m.snippets.map((s) =>
                (s.pack || DEFAULT_PACK) === pack && s.group === group ? { ...s, group: "" } : s
              )
            )
            .then(() => say(`Ungrouped ${count}`))
        },
      },
      { kind: "sep" },
      {
        kind: "item",
        label: "Delete group…",
        danger: true,
        run: () => setDeleteGroupAsk({ pack, group, count }),
      },
    ])
  }

  // Undo restores the prompts and the pack's metadata (its lock flag); the
  // file was retired to packs/deleted/ and a fresh one is made
  const deletePack = async (name: string) => {
    const ids = m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === name).map((s) => s.id)
    const pack = m.packMeta.find((p) => p.name === name) ?? { name, locked: false }
    await m.persistPacks(m.packMeta.filter((p) => p.name !== name))
    await m.deleteWithUndo(ids, `Deleted pack "${name}" (${ids.length} prompt${ids.length === 1 ? "" : "s"})`, { pack })
  }

  // File actions for file-backed packs; non-backed packs get an upgrade action
  const packFileItems = (name: string): CtxItem[] => {
    const meta = m.packMeta.find((p) => p.name === name)
    if (!meta?.path) {
      return [
        {
          kind: "item",
          label: "Back with a file…",
          run: () => {
            void (async () => {
              try {
                const path = await invoke<string>("create_pack_file", { name })
                const next = meta
                  ? m.packMeta.map((p) => (p.name === name ? { ...p, path } : p))
                  : [...m.packMeta, { name, locked: false, path }]
                await m.persistPacks(next)
                await m.persist([...m.snippets]) // triggers the sync that fills the fresh file
                say(`"${name}" is now file-backed`)
              } catch (e) {
                sayErr(String(e))
              }
            })()
          },
        },
      ]
    }
    return [
      {
        kind: "item",
        label: "Copy file path",
        run: () => {
          void invoke("set_clipboard_text", { text: meta.path }).then(() => say("Path copied"))
        },
      },
      { kind: "item", label: "Show in folder", run: () => void invoke("show_in_folder", { path: meta.path }) },
    ]
  }

  const openPackCtx = (x: number, y: number, name: string, count: number) => {
    const locked = m.isLocked(name)
    ctx.open(x, y, [
      { kind: "header", text: name },
      { kind: "item", label: "Rename", run: () => setRenaming(name) },
      {
        kind: "item",
        label: locked ? "Unlock" : "Lock",
        run: () => {
          const existing = m.packMeta.find((p) => p.name === name)
          const next = existing
            ? m.packMeta.map((p) => (p.name === name ? { ...p, locked: !p.locked } : p))
            : [...m.packMeta, { name, locked: true }]
          void m.persistPacks(next).then(() => say(locked ? `Pack "${name}" unlocked` : `Pack "${name}" locked`))
        },
      },
      {
        kind: "item",
        label: "Export pack",
        run: () => {
          void invoke("set_clipboard_text", { text: JSON.stringify(packToJson(name), null, 2) }).then(() =>
            say(`Pack "${name}" copied to clipboard`)
          )
        },
      },
      ...packFileItems(name),
      { kind: "sep" },
      {
        // A group is a label, so it starts life on a prompt: this creates a
        // draft in the group and opens it in the editor
        kind: "item",
        label: locked ? "New group (locked)" : "New group…",
        disabled: locked,
        run: () => {
          ctx.open(x, y, [
            { kind: "header", text: `New group in ${name}` },
            {
              kind: "input",
              placeholder: "Group name — creates a first prompt in it",
              onSubmit: (g) => {
                if (!g) return
                if (collapsed.has(name)) toggleCollapsed(name)
                void m.newPrompt({ pack: name, group: g })
              },
            },
          ])
          return "keep"
        },
      },
      {
        kind: "item",
        label: locked ? "Delete (locked)" : "Delete pack…",
        danger: true,
        disabled: locked,
        confirm: count ? `Really delete ${count} prompts?` : "Really delete pack?",
        run: () => void deletePack(name),
      },
      { kind: "sep" },
      {
        kind: "item",
        label: "New pack…",
        run: () => {
          ctx.open(x, y, [
            { kind: "header", text: "New pack" },
            { kind: "input", placeholder: "Pack name", onSubmit: (n) => void m.addPack(n) },
          ])
          return "keep"
        },
      },
    ])
  }

  // ---- Multi-select context menu ----
  // Takes the target ids explicitly: the caller may have just replaced the
  // selection, and reading m.selection here would still see the old one
  // (stale render) — showing the previous prompt's menu.
  const openRowCtx = (x: number, y: number, idSet: Set<string>) => {
    const ids = [...idSet]
    const n = ids.length
    // Unpin when everything selected is pinned; otherwise pin the rest
    const selected = m.snippets.filter((s) => ids.includes(s.id))
    const allPinned = selected.length > 0 && selected.every((s) => s.pinned)
    const items: CtxItem[] = [
      {
        kind: "header",
        text: n === 1 ? m.snippets.find((s) => s.id === ids[0])?.title || "1 prompt" : `${n} prompts`,
      },
      {
        kind: "item",
        label: allPinned ? (n === 1 ? "Unpin" : `Unpin ${n}`) : n === 1 ? "Pin" : `Pin ${n}`,
        run: () => {
          if (allPinned) {
            void m
              .persist(m.snippets.map((s) => (ids.includes(s.id) ? { ...s, pinned: false } : s)))
              .then(() => say(n === 1 ? "Unpinned" : `Unpinned ${n}`))
            return
          }
          // Rows in the selection that are already pinned take no new slot
          const plan = C.pinPlan(m.snippets, ids, MAX_PINS)
          if (!plan.ok) {
            sayErr(
              `Max ${MAX_PINS} pins — ${plan.already} already pinned, so you can pin ${plan.room === 0 ? "no" : plan.room} more`
            )
            return
          }
          void m
            .persist(m.snippets.map((s) => (ids.includes(s.id) ? { ...s, pinned: true } : s)))
            .then(() => say(plan.toPin === 1 ? "Pinned" : `Pinned ${plan.toPin}`))
        },
      },
      { kind: "header", text: "Move to" },
    ]
    // One submenu per pack: hovering lists its groups (a group lives in a
    // pack, so moving into one moves across packs too); clicking the pack
    // itself moves there ungrouped
    const homePack = selected[0]?.pack || DEFAULT_PACK
    const groupsOf = (pk: string) =>
      [...new Set(m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === pk && s.group).map((s) => s.group))].sort(
        (a, b) => a.localeCompare(b)
      )
    const moveTo = (pk: string, g: string) =>
      void m
        .persist(m.snippets.map((s) => (ids.includes(s.id) ? { ...s, pack: pk, group: g } : s)))
        .then(() => say(g ? `Moved ${n} to "${pk}" › "${g}"` : `Moved ${n} to "${pk}"`))
    for (const p of m.packNames()) {
      const locked = m.isLocked(p)
      const gs = groupsOf(p)
      items.push({
        kind: "submenu",
        label: (locked ? "🔒 " : "") + p,
        disabled: locked,
        run: () => moveTo(p, ""),
        items: [
          { kind: "header", text: p },
          { kind: "item", label: "No group", run: () => moveTo(p, "") },
          ...gs.map((g): CtxItem => ({ kind: "item", label: g, run: () => moveTo(p, g) })),
          { kind: "sep" },
          {
            kind: "item",
            label: "New group…",
            run: () => {
              ctx.open(x, y, [
                { kind: "header", text: `New group in ${p}` },
                { kind: "input", placeholder: "Group name", onSubmit: (g) => g && moveTo(p, g) },
              ])
              return "keep"
            },
          },
        ],
      })
    }
    if (selected.some((s) => s.group))
      items.push({ kind: "item", label: "Ungroup", run: () => moveTo(homePack, "") })
    items.push(
      { kind: "sep" },
      {
        kind: "item",
        label: "Add tag…",
        run: () => {
          ctx.open(x, y, [
            { kind: "header", text: `Add tag to ${n} prompt${n === 1 ? "" : "s"}` },
            {
              kind: "input",
              placeholder: "tag name",
              onSubmit: (raw) => {
                const tag = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "")
                if (!tag) return
                void m
                  .persist(
                    m.snippets.map((s) =>
                      ids.includes(s.id) && !(s.tags || []).includes(tag)
                        ? { ...s, tags: [...(s.tags || []), tag] }
                        : s
                    )
                  )
                  .then(() => say(`Tagged ${n} with #${tag}`))
              },
            },
          ])
          return "keep"
        },
      },
      {
        kind: "item",
        label: "Export selection",
        run: () => {
          const pack = C.packToJson(
            "Selection",
            ids.map((id) => m.snippets.find((s) => s.id === id)).filter((s): s is Snippet => !!s)
          )
          void invoke("set_clipboard_text", { text: JSON.stringify(pack, null, 2) }).then(() =>
            say(`Copied ${n} prompts to clipboard`)
          )
        },
      },
      { kind: "sep" },
      {
        kind: "item",
        label: `Delete ${n}…`,
        danger: true,
        confirm: `Really delete ${n}?`,
        run: () => void m.deleteWithUndo(ids, `Deleted ${n} prompts`),
      }
    )
    ctx.open(x, y, items)
  }

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
        tabIndex={0}
        className={cn(
          "flex cursor-pointer select-none items-center gap-1 rounded-md px-1 py-1 text-xs font-semibold uppercase tracking-[0.05em]",
          isCollapsed ? "text-muted-foreground/70 hover:text-foreground" : "text-muted-foreground"
        )}
        onClick={() => toggleCollapsedGroup(key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            toggleCollapsedGroup(key)
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
        {renamingGroup === key ? (
          <input
            autoFocus
            defaultValue={group}
            spellCheck={false}
            className="min-w-0 flex-1 -mx-1 -my-0.5 rounded-sm bg-secondary px-1 py-0.5 text-xs font-semibold uppercase tracking-[0.05em] text-foreground outline-none"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRenamingGroup(null)
              if (e.key === "Enter") void renameGroup(pack, group, e.currentTarget.value.trim())
            }}
            onBlur={(e) => void renameGroup(pack, group, e.target.value.trim())}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">
            {group} <span className="font-medium opacity-70">({count})</span>
          </span>
        )}
        <Chev className="size-3.5 shrink-0" />
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
        data-snip-id={s.id}
        className={cn(
          "flex min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] font-semibold transition-[transform,box-shadow] duration-150",
          active
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:border-ring/40 hover:text-foreground",
          multi && "outline outline-1 -outline-offset-1 outline-primary",
          lifted && "z-10 scale-[1.02] cursor-grabbing shadow-lg ring-1 ring-ring/40",
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
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          const ids = m.selection.has(s.id) ? m.selection : new Set([s.id])
          if (!m.selection.has(s.id)) m.setSelection(ids, s.id)
          openRowCtx(e.clientX, e.clientY, ids)
        }}
      >
        {s.pinned && <RiPushpinFill className="size-3 shrink-0 text-amber-500" />}
        <span className="truncate">{s.title || "(untitled)"}</span>
      </div>
    )
  }

  const sectionTitle = (name: string, count: number, isCollapsed: boolean) => {
    const Chev = isCollapsed ? RiArrowRightSLine : RiArrowDownSLine
    return (
      <div
        tabIndex={0}
        className={cn(
          "flex cursor-pointer select-none items-center gap-1.5 rounded-lg px-1 py-2 text-sm font-bold",
          isCollapsed ? "text-muted-foreground hover:text-foreground" : "text-foreground"
        )}
        onClick={() => toggleCollapsed(name)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            toggleCollapsed(name)
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
        {renaming === name ? (
          <input
            autoFocus
            defaultValue={name}
            spellCheck={false}
            className="min-w-0 flex-1 -mx-1 -my-0.5 rounded-sm bg-secondary px-1 py-0.5 text-sm font-bold text-foreground outline-none"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRenaming(null)
              if (e.key === "Enter") void renamePack(name, e.currentTarget.value.trim())
            }}
            onBlur={(e) => void renamePack(name, e.target.value.trim())}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">
            {name} <span className="font-semibold text-muted-foreground">({count})</span>
          </span>
        )}
        {m.isLocked(name) && <RiLock2Fill className="size-3 shrink-0 text-amber-500" />}
        <Chev className="size-4 shrink-0 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex w-[clamp(15rem,28%,20rem)] flex-col border-r border-border">
      {/* Title row: page title + view-config toggle + round add button */}
      <div className="flex items-center gap-1.5 p-3">
        <h2 className="min-w-0 flex-1 truncate text-2xl font-bold">Prompts</h2>
        <button
          title="List view options"
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
            spellCheck={false}
            className="rounded-lg bg-background px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">Order by</span>
            <select
              value={orderBy}
              onChange={(e) => {
                setOrderBy(e.target.value)
                localStorage.setItem("orderBy", e.target.value)
              }}
              className="min-w-0 flex-1 cursor-pointer truncate rounded-lg bg-background px-2 py-1 text-xs text-foreground outline-none"
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
          className="mx-3 mb-3 flex cursor-pointer items-center gap-1 self-start rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setQuery("")}
        >
          filter: "{query.trim()}" ✕
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
              className="rounded-lg border border-dashed border-primary bg-background px-3.5 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
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
              className="cursor-pointer self-start px-1 text-xs text-muted-foreground hover:text-primary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setNewPackInput(false)
                m.openGenerate()
              }}
            >
              ✦ or generate a pack with Claude…
            </button>
          </div>
        ) : (
          <div className="mb-3 flex gap-1.5">
            <button
              className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              onClick={() => void m.newPrompt()}
            >
              <RiFileAddLine className="size-4" />
              New prompt
            </button>
            <button
              className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              onClick={() => setNewPackInput(true)}
            >
              <RiFolderAddLine className="size-4" />
              New pack
            </button>
          </div>
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
        <div className="flex items-center gap-1 rounded-lg bg-secondary/80 p-1">
          {(["light", "dark"] as const).map((t) => {
            const Icon = t === "light" ? RiSunLine : RiMoonClearLine
            const active = m.prefs.theme === t
            return (
              <button
                key={t}
                className={cn(
                  "flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm text-sm font-semibold capitalize",
                  active
                    ? "bg-background text-foreground shadow-[0px_4px_6px_rgba(28,29,34,0.08)]"
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
            title={`Settings — popup hotkey: ${C.fmtHotkey(m.hotkey)}`}
            className={cn(
              "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm",
              m.settingsOpen
                ? "bg-background text-foreground shadow-[0px_4px_6px_rgba(28,29,34,0.08)]"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => m.showSettings(!m.settingsOpen)}
          >
            <RiSettings3Line className="size-4" />
          </button>
        </div>
      </div>
      {ctx.element}

      {/* Deleting a group deletes its prompts — a real dialog, not an armed menu item */}
      <Dialog open={deleteGroupAsk !== null} onOpenChange={(v) => !v && setDeleteGroupAsk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-sm">Delete group "{deleteGroupAsk?.group}"?</DialogTitle>
            <DialogDescription>
              This deletes {deleteGroupAsk?.count === 1 ? "the 1 prompt" : `all ${deleteGroupAsk?.count ?? 0} prompts`} in
              it from "{deleteGroupAsk?.pack}". To keep the prompts, choose Ungroup instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="secondary" onClick={() => setDeleteGroupAsk(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deleteGroupAsk && void deleteGroup(deleteGroupAsk.pack, deleteGroupAsk.group)}
            >
              Delete {deleteGroupAsk?.count ?? 0} prompt{deleteGroupAsk?.count === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
