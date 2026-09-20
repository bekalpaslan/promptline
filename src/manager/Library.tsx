import { useMemo, useState } from "react"
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiLock2Fill,
  RiMoreLine,
  RiPushpinFill,
} from "@remixicon/react"
import { Kbd } from "@/components/ui/kbd"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { DEFAULT_PACK, useManager, type LibraryFocus } from "./state"
import { groupKey, useLibraryMenus } from "./menus"

// Library view: the library spanning the window, drawn as what it is —
// packs holding groups holding prompts — with the room to show each prompt
// as a preview card. It opens on the pack or group that was clicked in the
// sidebar, expanded one level down (a pack shows its prompts and its group
// headers; a group shows its prompts) with everything else folded, so the
// view answers "what is in here" without a wall of text. Each container
// folds like the editor's Advanced options card. Folds live only as long as
// the view: the next entry opens on whatever was clicked then.
//
// Clicking a prompt card opens it in the editor, which is prompt view; that
// is the way back, along with the Prompts button and Escape.

// Tag pills on a card before the rest fold into a "+N" pill
const MAX_CARD_TAGS = 3

// A container's header: the Advanced-options toggle idiom (title, chevron),
// with the count beside it and the pack's lock where there is one
function Fold({
  open,
  onToggle,
  label,
  count,
  strong,
  locked,
  onMenu,
  renaming,
  onStartRename,
  onRename,
  onRenameCancel,
  children,
}: {
  open: boolean
  onToggle: () => void
  label: string
  count: number
  /** Pack titles are a step deeper than group titles, as in the sidebar */
  strong?: boolean
  locked?: boolean
  /** Opens the three-dot menu at a point: the ⋯ button, a right-click, the Menu key */
  onMenu: (x: number, y: number) => void
  /** The title is being renamed inline (double-click, or Rename in the menu) */
  renaming: boolean
  onStartRename: () => void
  onRename: (next: string) => void
  onRenameCancel: () => void
  /** What sits at the right of the header (an add action) */
  children?: React.ReactNode
}) {
  const Chev = open ? RiArrowDownSLine : RiArrowRightSLine
  return (
    <div
      className="group/hdr flex min-w-0 items-center gap-2"
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onMenu(e.clientX, e.clientY)
      }}
    >
      {renaming ? (
        <input
          autoFocus
          defaultValue={label}
          spellCheck={false}
          aria-label={`Rename ${label}`}
          className={cn(
            "section-title min-w-0 flex-1 rounded-sm bg-secondary px-1 py-0.5 text-foreground focus-ring",
            strong && "text-base"
          )}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Escape") onRenameCancel()
            if (e.key === "Enter") onRename(e.currentTarget.value.trim())
          }}
          // Enter commits, leaving the field cancels: a misclick must not rename
          onBlur={onRenameCancel}
        />
      ) : (
        <button
          type="button"
          aria-expanded={open}
          title={`${label} — click folds, double-click renames, right-click for actions`}
          className={cn(
            "section-title flex min-w-0 cursor-pointer items-center gap-1 hover:text-primary focus-ring rounded-sm",
            strong ? "text-base text-(--heading-strong)" : "text-(--heading)",
            !open && "opacity-70 hover:opacity-100"
          )}
          onClick={onToggle}
          onDoubleClick={(e) => {
            e.stopPropagation()
            onStartRename()
          }}
          onKeyDown={(e) => {
            if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              onMenu(r.left + 24, r.bottom)
            }
          }}
        >
          <span className="truncate">{label}</span>
          <span className="shrink-0 font-medium text-muted-foreground">({count})</span>
          <Chev className="size-3.5 shrink-0" />
        </button>
      )}
      {/* The sidebar's three dots: hover-revealed way into the same menu right-click opens */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Actions for ${label}`}
        title="Actions"
        className="rounded-sm p-0.5 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground group-hover/hdr:opacity-100 focus-visible:opacity-100"
        onClick={(e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          onMenu(r.left, r.bottom)
        }}
      >
        <RiMoreLine className="size-4" />
      </button>
      {locked && <RiLock2Fill className="size-3 shrink-0 text-(--warn)" aria-label="locked" />}
      <span className="ml-auto flex shrink-0 items-center">{children}</span>
    </div>
  )
}

// The dashed "empty slot" from the sidebar's create bar, sized for a header
function AddPrompt({ where, onClick }: { where: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={`New prompt in ${where}`}
      aria-label={`New prompt in ${where}`}
      className="flex h-6 cursor-pointer items-center gap-1 rounded-md border border-dashed border-border px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      onClick={onClick}
    >
      <RiAddLine className="size-3.5" />
      prompt
    </button>
  )
}

// One prompt as a preview: title, the first lines of its body, its tags and
// what it asks for. A click opens it in the editor.
function PromptCard({ s, onOpen, onMenu }: { s: Snippet; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const tags = s.tags || []
  const inputs = C.requiredInputs(s)
  return (
    <button
      type="button"
      title={`${s.title || "(untitled)"} — click edits, right-click for actions`}
      className="flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg border border-border bg-background p-3 text-left text-ui text-foreground transition-colors hover:border-primary focus-ring"
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      onKeyDown={(e) => {
        if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          onMenu(r.left + 24, r.bottom)
        }
      }}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {s.pinned && <RiPushpinFill className="size-3.5 shrink-0 text-(--warn)" aria-label="pinned" />}
        <span className="min-w-0 flex-1 truncate font-semibold">{s.title || "(untitled)"}</span>
        {inputs.length > 0 && (
          <span
            className="flex h-4 shrink-0 items-center rounded-sm border border-(--warn)/40 px-1 text-xs tabular-nums text-(--warn)"
            title={`Asks for ${inputs.length} value${inputs.length === 1 ? "" : "s"} before pasting: ${inputs.join(", ")}`}
          >
            {"{"}{inputs.length}{"}"}
          </span>
        )}
        {s.uses > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{s.uses}×</span>}
      </span>
      <span className="line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground">
        {s.text.trim() ? s.text.replace(/\s+/g, " ") : <i>(empty)</i>}
      </span>
      {tags.length > 0 && (
        <span className="flex flex-wrap items-center gap-1">
          {tags.slice(0, MAX_CARD_TAGS).map((tag) => (
            <span
              key={tag}
              className="flex h-4 shrink-0 items-center whitespace-nowrap rounded-sm border px-1 text-xs tag-text tag-border dark:tag-text-dark dark:tag-border-dark"
              style={{ "--tag": C.tagColor(tag) } as React.CSSProperties}
            >
              {tag}
            </span>
          ))}
          {tags.length > MAX_CARD_TAGS && (
            <span
              className="flex h-4 shrink-0 items-center rounded-sm border border-border px-1 text-xs tabular-nums text-muted-foreground"
              title={tags.slice(MAX_CARD_TAGS).map((t) => `#${t}`).join(", ")}
            >
              +{tags.length - MAX_CARD_TAGS}
            </span>
          )}
        </span>
      )}
    </button>
  )
}

export function Library({ focus }: { focus: LibraryFocus | null }) {
  const m = useManager()
  const { snippets, orderBy, packNames } = m
  // The same menus as the sidebar's three dots (rename, lock, export, file,
  // new group, delete; ungroup; pin, move to, tag, export, delete)
  const menus = useLibraryMenus()

  // The tree is pure core (tested); rows follow the sidebar's order
  const tree = useMemo(
    () => C.packTree(C.sortPrompts(snippets, orderBy), packNames(), DEFAULT_PACK),
    [snippets, orderBy, packNames]
  )
  const allPacks = useMemo(() => tree.map((p) => p.name), [tree])
  const allGroups = useMemo(
    () => tree.flatMap((p) => p.groups.map((g) => groupKey(p.name, g.name))),
    [tree]
  )

  // Opened one level down on the focus, everything else folded (the App
  // keys this component on the focus, so these initialisers see the entry)
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(allPacks.filter((n) => n !== focus?.pack))
  )
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(allGroups.filter((k) => !(focus?.group && k === groupKey(focus.pack, focus.group))))
  )

  const togglePack = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const anyFolded = collapsed.size > 0 || collapsedGroups.size > 0
  const foldAll = () => {
    setCollapsed(new Set(allPacks))
    setCollapsedGroups(new Set(allGroups))
  }
  const unfoldAll = () => {
    setCollapsed(new Set())
    setCollapsedGroups(new Set())
  }

  const open = (s: Snippet) => {
    m.setSelection(new Set([s.id]), s.id)
    m.select(s.id)
  }
  // A card's menu acts on that card: the selection is set to it first, the
  // way a sidebar right-click does, so the menu and the pane agree
  const cardMenu = (s: Snippet, x: number, y: number) => {
    m.setSelection(new Set([s.id]), s.id)
    menus.openRowCtx(x, y, new Set([s.id]))
  }
  const cards = (items: Snippet[]) => (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {items.map((s) => (
        <PromptCard key={s.id} s={s} onOpen={() => open(s)} onMenu={(x, y) => cardMenu(s, x, y)} />
      ))}
    </div>
  )
  const groupCount = allGroups.length

  return (
    <div
      className="flex min-w-0 flex-1 flex-col animate-in fade-in slide-in-from-left-4 duration-200"
      role="region"
      aria-label="Library"
    >
      {/* Title row: the way back, the page title, the counts, one fold toggle */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
        <button
          type="button"
          className="flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-ui font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-ring"
          title="Back to the prompt view (Esc)"
          onClick={m.closeLibrary}
        >
          <RiArrowLeftSLine className="size-4" />
          Prompts
          <Kbd className="ml-0.5">Esc</Kbd>
        </button>
        <h1 className="text-xl font-bold">Library</h1>
        <span className="text-xs tabular-nums text-muted-foreground">
          {m.snippets.length} prompt{m.snippets.length === 1 ? "" : "s"} · {tree.length} pack{tree.length === 1 ? "" : "s"}
          {groupCount > 0 && ` · ${groupCount} group${groupCount === 1 ? "" : "s"}`}
        </span>
        <button
          type="button"
          className="ml-auto cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground focus-ring rounded-sm"
          onClick={anyFolded ? unfoldAll : foldAll}
        >
          {anyFolded ? "Expand all" : "Collapse all"}
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {tree.map((pack) => {
          const isOpen = !collapsed.has(pack.name)
          const locked = m.isLocked(pack.name)
          return (
            <section key={pack.name} className="module flex flex-col" aria-label={pack.name}>
              <Fold
                open={isOpen}
                onToggle={() => togglePack(pack.name)}
                label={pack.name}
                count={pack.count}
                strong
                locked={locked}
                onMenu={(x, y) => menus.openPackCtx(x, y, pack.name, pack.count)}
                renaming={menus.renaming === pack.name}
                onStartRename={() => menus.setRenaming(pack.name)}
                onRename={(next) => void menus.renamePack(pack.name, next)}
                onRenameCancel={() => menus.setRenaming(null)}
              >
                {!locked && <AddPrompt where={pack.name} onClick={() => void m.newPrompt({ pack: pack.name })} />}
              </Fold>
              {isOpen && (
                <div className="mt-3 flex flex-col gap-3">
                  {pack.count === 0 && <div className="px-1 text-ui text-muted-foreground">Empty pack</div>}
                  {pack.ungrouped.length > 0 && cards(pack.ungrouped)}
                  {pack.groups.map((g) => {
                    const key = groupKey(pack.name, g.name)
                    const gOpen = !collapsedGroups.has(key)
                    return (
                      <section key={g.name} className="module flex flex-col bg-secondary/50" aria-label={g.name}>
                        <Fold
                          open={gOpen}
                          onToggle={() => toggleGroup(key)}
                          label={g.name}
                          count={g.items.length}
                          onMenu={(x, y) => menus.openGroupCtx(x, y, pack.name, g.name, g.items.length)}
                          renaming={menus.renamingGroup === key}
                          onStartRename={() => menus.setRenamingGroup(key)}
                          onRename={(next) => void menus.renameGroup(pack.name, g.name, next)}
                          onRenameCancel={() => menus.setRenamingGroup(null)}
                        >
                          {!locked && (
                            <AddPrompt
                              where={`${pack.name} › ${g.name}`}
                              onClick={() => void m.newPrompt({ pack: pack.name, group: g.name })}
                            />
                          )}
                        </Fold>
                        {gOpen && <div className="mt-3">{cards(g.items)}</div>}
                      </section>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </div>
      {menus.element}
    </div>
  )
}
