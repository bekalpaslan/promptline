import { useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiEqualizerLine,
  RiLock2Fill,
  RiMoonClearLine,
  RiPushpinFill,
  RiSettings3Line,
  RiSunLine,
} from "@remixicon/react"
import { Checkbox } from "@/components/ui/checkbox"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { DEFAULT_PACK, MAX_PINS, useManager } from "./state"
import { useCtxMenu, type CtxItem } from "./ctx-menu"
import { say, sayErr, sayUndo } from "./status"

const SORTS: Record<string, (a: Snippet, b: Snippet) => number> = {
  uses: (a, b) => b.uses - a.uses || a.title.localeCompare(b.title),
  title: (a, b) => a.title.localeCompare(b.title),
}
const withPins = (cmp: (a: Snippet, b: Snippet) => number) => (a: Snippet, b: Snippet) =>
  (+b.pinned - +a.pinned) || cmp(a, b)

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem("collapsedPacks") || "[]"))
  } catch {
    return new Set()
  }
}

export function Sidebar() {
  const m = useManager()
  const ctx = useCtxMenu()
  const [query, setQuery] = useState("")
  const [orderBy, setOrderBy] = useState(
    ["uses", "title"].includes(localStorage.getItem("orderBy") ?? "") ? localStorage.getItem("orderBy")! : "uses"
  )
  // Group-by-pack is the default view
  const [grouped, setGrouped] = useState(localStorage.getItem("groupByPack") !== "0")
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const visibleIdsRef = useRef<string[]>([])

  const q = query.trim().toLowerCase()
  // The list-view configuration deviates from defaults — surface a dot on the toggle
  const configActive = !!q || orderBy !== "uses" || !grouped

  const visible = useMemo(() => {
    const pool = q
      ? m.snippets.filter(
          (s) =>
            s.title.toLowerCase().includes(q) ||
            (s.tags || []).some((t) => t.toLowerCase().includes(q)) ||
            (s.pack || "").toLowerCase().includes(q) ||
            s.text.toLowerCase().includes(q)
        )
      : [...m.snippets]
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
      if (q || !collapsed.has(name)) for (const s of items) visibleIds.push(s.id)
    }
  } else {
    for (const s of visible) visibleIds.push(s.id)
  }
  visibleIdsRef.current = visibleIds

  const handleRowClick = (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
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

  const packToJson = (name: string) => ({
    name,
    prompts: m.snippets
      .filter((s) => (s.pack || DEFAULT_PACK) === name)
      .map(({ title, text, tags }) => ({ title, text, tags })),
  })

  const deletePack = async (name: string) => {
    const removed = m.snippets.filter((s) => (s.pack || DEFAULT_PACK) === name)
    const kept = m.snippets.filter((s) => (s.pack || DEFAULT_PACK) !== name)
    await m.persist(kept)
    await m.persistPacks(m.packMeta.filter((p) => p.name !== name))
    if (m.activeId && !kept.some((s) => s.id === m.activeId)) m.select(null)
    m.setSelection(new Set(), null)
    sayUndo(`Deleted pack "${name}" (${removed.length} prompts)`, () => {
      void m.persist([...m.snippets, ...removed]).then(() => say("Restored"))
    })
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
          const already = m.snippets.filter((s) => s.pinned && !ids.includes(s.id)).length
          const toPin = selected.filter((s) => !s.pinned).length
          if (already + selected.length > MAX_PINS) {
            sayErr(`Max ${MAX_PINS} pins — that would make ${already + selected.length}`)
            return
          }
          void m
            .persist(m.snippets.map((s) => (ids.includes(s.id) ? { ...s, pinned: true } : s)))
            .then(() => say(toPin === 1 ? "Pinned" : `Pinned ${toPin}`))
        },
      },
      { kind: "header", text: "Move to pack" },
    ]
    for (const p of m.packNames()) {
      items.push({
        kind: "item",
        label: (m.isLocked(p) ? "🔒 " : "") + p,
        disabled: m.isLocked(p),
        run: () => {
          void m
            .persist(m.snippets.map((s) => (ids.includes(s.id) ? { ...s, pack: p } : s)))
            .then(() => say(`Moved ${n} to "${p}"`))
        },
      })
    }
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
          const pack = {
            name: "Selection",
            prompts: ids
              .map((id) => m.snippets.find((s) => s.id === id))
              .filter((s): s is Snippet => !!s)
              .map(({ title, text, tags }) => ({ title, text, tags })),
          }
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
        run: () => {
          const removed = m.snippets.filter((s) => ids.includes(s.id))
          void m.persist(m.snippets.filter((s) => !ids.includes(s.id))).then(() => {
            m.setSelection(new Set(), null)
            if (ids.includes(m.activeId ?? "")) m.select(null)
            sayUndo(`Deleted ${removed.length} prompts`, () => {
              void m.persist([...m.snippets, ...removed]).then(() => say("Restored"))
            })
          })
        },
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

  // Prompt row: plain text pill, active = soft rounded fill (kit style).
  // Tree tick connects it to the section guide line when grouped.
  const snipRow = (s: Snippet, inTree: boolean) => {
    const multi = m.selection.size > 1 && m.selection.has(s.id)
    const active = s.id === m.activeId && m.selection.size <= 1
    return (
      <div
        key={s.id}
        role="button"
        tabIndex={0}
        className={cn(
          "flex min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold",
          inTree &&
            "relative before:absolute before:-left-3.5 before:top-1/2 before:h-px before:w-3 before:bg-border",
          active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          multi && "outline outline-1 -outline-offset-1 outline-primary"
        )}
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
          "flex cursor-pointer select-none items-center gap-1.5 rounded-lg px-1 py-2 text-[15px] font-bold",
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
            className="min-w-0 flex-1 rounded-sm bg-secondary px-2 py-0.5 text-sm font-normal text-foreground outline-none"
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
      <div className="flex items-center gap-1.5 p-4 pb-2">
        <h2 className="min-w-0 flex-1 truncate text-2xl font-bold">Prompts</h2>
        <button
          title="List view options"
          className={cn(
            "relative flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground",
            configOpen && "bg-secondary text-foreground"
          )}
          onClick={() => setConfigOpen((v) => !v)}
        >
          <RiEqualizerLine className="size-4" />
          {configActive && !configOpen && (
            <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary" />
          )}
        </button>
        <button
          title="New prompt, pack, or generated pack"
          className="flex size-7 cursor-pointer items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            ctx.open(r.right - 190, r.bottom + 4, [
              { kind: "item", label: "New prompt", run: () => void m.newPrompt() },
              {
                kind: "item",
                label: "New pack…",
                run: () => {
                  ctx.open(r.right - 190, r.bottom + 4, [
                    { kind: "header", text: "New pack" },
                    { kind: "input", placeholder: "Pack name", onSubmit: (n) => void m.addPack(n) },
                  ])
                  return "keep"
                },
              },
              { kind: "sep" },
              { kind: "item", label: "Generate pack with Claude…", run: () => m.openGenerate() },
            ])
          }}
        >
          <RiAddLine className="size-4.5" />
        </button>
      </div>

      {/* List-view configuration: filter, order, grouping — tucked away by default */}
      {configOpen && (
        <div className="mx-4 mb-2 flex flex-col gap-2 rounded-xl bg-secondary/60 p-3">
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
              className="cursor-pointer rounded-lg bg-background px-2 py-1 text-xs text-foreground outline-none"
            >
              <option value="uses">Most used</option>
              <option value="title">Title</option>
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
          className="mx-4 mb-2 flex cursor-pointer items-center gap-1 self-start rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setQuery("")}
        >
          filter: "{query.trim()}" ✕
        </button>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-2">
        {groups ? (
          groups.map(([name, items]) => {
            const isCollapsed = !q && collapsed.has(name)
            return (
              <div key={name} className="mb-1">
                {sectionTitle(name, items.length, isCollapsed)}
                {!isCollapsed && (
                  <div className="mb-2 ml-1.5 flex flex-col border-l border-border pl-3.5">
                    {items.map((s) => snipRow(s, true))}
                  </div>
                )}
              </div>
            )
          })
        ) : (
          <div className="flex flex-col">{visible.map((s) => snipRow(s, false))}</div>
        )}
      </div>

      {/* Light/Dark segmented mode toggle with the settings gear as a compact segment */}
      <div className="p-4 pt-2">
        <div className="flex items-center gap-1 rounded-[1.375rem] bg-secondary/80 p-1">
          {(["light", "dark"] as const).map((t) => {
            const Icon = t === "light" ? RiSunLine : RiMoonClearLine
            const active = m.prefs.theme === t
            return (
              <button
                key={t}
                className={cn(
                  "flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full text-sm font-semibold capitalize",
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
              "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full",
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
    </div>
  )
}
