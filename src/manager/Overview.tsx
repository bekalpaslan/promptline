import { useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { RiAddLine, RiArrowLeftSLine, RiFolderLine, RiLock2Fill, RiPushpinFill } from "@remixicon/react"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { Count, InputsBadge, PromptTokens, TagList } from "@/components/prompt-bits"
import { DEFAULT_PACK, useManager, type LibraryFocus } from "./state"
import { EmptyState } from "./EmptyState"
import { MenuDots, groupKey, useLibraryMenus } from "./menus"

// The overview: what a pack or group selected in the sidebar holds, in the
// pane where the editor sits for a prompt. The sidebar stays beside it, so
// this is one more thing a selection can show, not a place to go: no folds
// of its own and no way back to find. Each prompt is a preview card (the
// clipboard substituted, as everywhere); a click opens it in the editor. A
// pack lists its ungrouped prompts, then each group under a heading that
// opens that group; a group lists its prompts.

// Tag pills on a card before the rest fold into a "+N" pill
const MAX_CARD_TAGS = 3

// A title with the sidebar header's affordances: double-click renames,
// right-click, the Menu key and the hover-revealed dots open its menu, and a
// click opens it where there is somewhere to open (a group heading in a
// pack's overview)
function Heading({
  label,
  count,
  strong,
  locked,
  onOpen,
  onMenu,
  renaming,
  onStartRename,
  onRename,
  onRenameCancel,
  children,
}: {
  label: string
  count: number
  /** The overview's own title, a step bigger than a group heading in it */
  strong?: boolean
  locked?: boolean
  onOpen?: () => void
  /** Opens the three-dot menu at a point: the ⋯ button, a right-click, the Menu key */
  onMenu: (x: number, y: number) => void
  /** The title is being renamed inline (double-click, or Rename in the menu) */
  renaming: boolean
  onStartRename: () => void
  onRename: (next: string) => void
  onRenameCancel: () => void
  /** What sits at the right of the heading (an add action) */
  children?: React.ReactNode
}) {
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
            strong && "text-xl font-bold"
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
          title={`${label} — ${onOpen ? "click shows only this group, " : ""}double-click renames, right-click for actions`}
          className={cn(
            "flex min-w-0 items-baseline gap-1.5 rounded-sm focus-ring",
            strong ? "text-xl font-bold" : "section-title text-(--heading)",
            onOpen ? "cursor-pointer hover:text-primary" : "cursor-default"
          )}
          onClick={onOpen}
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
          <Count>{count}</Count>
        </button>
      )}
      {/* The sidebar's three dots: hover-revealed way into the same menu right-click opens */}
      <MenuDots label={`Actions for ${label}`} reveal="group-hover/hdr:opacity-100" onOpen={onMenu} />
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
function PromptCard({
  s,
  clipboard,
  onOpen,
  onMenu,
}: {
  s: Snippet
  clipboard: string | null
  onOpen: () => void
  onMenu: (x: number, y: number) => void
}) {
  const tags = s.tags || []
  const inputs = C.requiredInputs(s)
  // The excerpt is the same token preview as the editor's and the popup's,
  // so it too shows the clipboard, not the word "clipboard" (BEHAVIOR.md)
  const excerpt = s.text.replace(/\s+/g, " ")
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
        <InputsBadge inputs={inputs} />
        {s.uses > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{s.uses}×</span>}
      </span>
      <span className="line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground">
        {excerpt.trim() ? <PromptTokens text={excerpt} clipboard={clipboard} configValues={s.configValues} /> : <i>(empty)</i>}
      </span>
      {tags.length > 0 && (
        <span className="flex flex-wrap items-center gap-1">
          <TagList tags={tags} max={MAX_CARD_TAGS} />
        </span>
      )}
    </button>
  )
}

export function Overview({ focus }: { focus: LibraryFocus }) {
  const m = useManager()
  const { snippets, orderBy, packNames } = m
  // The same menus as the sidebar's three dots (rename, lock, export, file,
  // new group, delete; ungroup; pin, move to, tag, export, delete)
  const menus = useLibraryMenus()

  // The clipboard for the card excerpts, read the way the editor reads it:
  // on open, when the window comes back, and after a copy or cut here
  const [clipboard, setClipboard] = useState<string | null>(null)
  useEffect(() => {
    const refresh = () => void invoke<string>("get_clipboard_text").then(setClipboard).catch(() => {})
    const onCopy = () => setTimeout(refresh, 50)
    refresh()
    window.addEventListener("focus", refresh)
    document.addEventListener("copy", onCopy)
    document.addEventListener("cut", onCopy)
    return () => {
      window.removeEventListener("focus", refresh)
      document.removeEventListener("copy", onCopy)
      document.removeEventListener("cut", onCopy)
    }
  }, [])

  // The tree is pure core (tested); rows follow the sidebar's order
  const tree = useMemo(
    () => C.packTree(C.sortPrompts(snippets, orderBy), packNames(), DEFAULT_PACK),
    [snippets, orderBy, packNames]
  )
  const pack = tree.find((p) => p.name === focus.pack)
  // A group that is gone (deleted, ungrouped, emptied by moves) leaves its
  // pack's overview in its place
  const group = focus.group ? pack?.groups.find((g) => g.name === focus.group) : undefined

  if (!pack) {
    return (
      <EmptyState
        icon={RiFolderLine}
        title="That pack is gone"
        hint="Select a pack or a prompt in the sidebar"
        actions={[{ label: "New prompt", onClick: () => void m.newPrompt(), primary: true }]}
      />
    )
  }

  const locked = m.isLocked(pack.name)
  const open = (s: Snippet) => {
    m.setSelection(new Set([s.id]), s.id)
    m.select(s.id)
  }
  // A card's menu acts on that card: the selection is set to it first, the
  // way a sidebar right-click does, so the menu and the sidebar agree
  const cardMenu = (s: Snippet, x: number, y: number) => {
    m.setSelection(new Set([s.id]), s.id)
    menus.openRowCtx(x, y, new Set([s.id]))
  }
  const cards = (items: Snippet[]) => (
    <div className="grid gap-2 @xl:grid-cols-2 @4xl:grid-cols-3">
      {items.map((s) => (
        <PromptCard key={s.id} s={s} clipboard={clipboard} onOpen={() => open(s)} onMenu={(x, y) => cardMenu(s, x, y)} />
      ))}
    </div>
  )
  // A group's heading: the overview's title when the group is what's shown,
  // a way into it when it sits in its pack's overview
  const groupHeading = (name: string, count: number, isTitle: boolean) => {
    const key = groupKey(pack.name, name)
    return (
      <Heading
        label={name}
        count={count}
        strong={isTitle}
        onOpen={isTitle ? undefined : () => m.openOverview({ pack: pack.name, group: name })}
        onMenu={(x, y) => menus.openGroupCtx(x, y, pack.name, name, count)}
        renaming={menus.renamingGroup === key}
        onStartRename={() => menus.setRenamingGroup(key)}
        onRename={(next) => void menus.renameGroup(pack.name, name, next)}
        onRenameCancel={() => menus.setRenamingGroup(null)}
      >
        {!locked && (
          <AddPrompt where={`${pack.name} › ${name}`} onClick={() => void m.newPrompt({ pack: pack.name, group: name })} />
        )}
      </Heading>
    )
  }

  return (
    <div
      className="@container flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3 animate-in fade-in duration-150"
      role="region"
      aria-label={group ? `${pack.name} › ${group.name}` : pack.name}
    >
      {/* Where this sits, as the editor shows a prompt's place; a group's
          crumb goes up to its pack (Escape does the same) */}
      <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        {group ? (
          <>
            <button
              type="button"
              className="flex min-w-0 cursor-pointer items-center gap-0.5 rounded-sm font-medium hover:text-foreground focus-ring"
              title={`Show all of ${pack.name} (Esc)`}
              onClick={() => m.openOverview({ pack: pack.name })}
            >
              <RiArrowLeftSLine className="size-3.5 shrink-0" />
              <span className="truncate">{pack.name}</span>
            </button>
            <span aria-hidden>›</span>
            <span>Group</span>
          </>
        ) : (
          <span>Pack</span>
        )}
      </div>

      {group ? (
        <>
          {groupHeading(group.name, group.items.length, true)}
          {cards(group.items)}
        </>
      ) : (
        <>
          <Heading
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
          </Heading>
          {pack.count === 0 && <div className="text-ui text-muted-foreground">Empty pack</div>}
          {pack.ungrouped.length > 0 && cards(pack.ungrouped)}
          {pack.groups.map((g) => (
            // A group is a heading over a hairline, not a panel: the pack is
            // the one container here, so nothing repeats its title's look
            <section key={g.name} className="mt-2 flex flex-col gap-2" aria-label={g.name}>
              <div className="border-b border-border pb-1.5">{groupHeading(g.name, g.items.length, false)}</div>
              {cards(g.items)}
            </section>
          ))}
        </>
      )}
      {menus.element}
    </div>
  )
}
