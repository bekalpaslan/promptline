import { useCallback, useEffect, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { RiAddLine, RiArrowLeftSLine, RiCheckLine, RiFileCopyLine, RiFolderLine, RiLock2Fill, RiPushpinFill } from "@remixicon/react"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { Count, InputsBadge, PromptTokens, TagList } from "@/components/prompt-bits"
import { DEFAULT_PACK, useManager, type LibraryFocus } from "./state"
import { EmptyState } from "./EmptyState"
import { MenuDots, groupKey, useLibraryMenus } from "./menus"
import { copyPrompt as copyText } from "./copy"

// The overview: what a pack or group selected in the sidebar holds, in the
// pane where the editor sits for a prompt. The sidebar stays beside it, so
// this is one more thing a selection can show, not a place to go: no folds
// of its own and no way back to find. Each prompt is a preview card (the
// clipboard substituted, as everywhere); a click opens it in the editor. A
// pack lists its ungrouped prompts, then each group under a heading that
// opens that group; a group lists its prompts.

// Tag pills on a card before the rest fold into a "+N" pill
const MAX_CARD_TAGS = 3
// More than three lines of a card's excerpt could show at any width or scale
const EXCERPT_CHARS = 800

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
          // Typing replaces the name (a New pack's "New pack"), as in the sidebar
          onFocus={(e) => e.currentTarget.select()}
          defaultValue={label}
          spellCheck={false}
          aria-label={`Rename ${label}`}
          className={cn(
            "section-title min-w-0 flex-1 rounded-sm bg-secondary px-1 py-0.5 text-foreground focus-ring",
            strong && "text-lg font-semibold"
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
          // The overview's title is the editor's title treatment, the
          // heading size nothing else in the pane uses; it was 20px at 700,
          // the largest and heaviest text in a window capped at 18/600
          className={cn(
            "flex min-w-0 items-baseline gap-1.5 rounded-sm focus-ring",
            strong ? "text-lg font-semibold" : "section-title text-(--heading)",
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
          <span className="truncate">
            <bdi>{label}</bdi>
          </span>
          {/* To assistive tech the count says what it counts, as the tree's does */}
          <Count>
            <span aria-hidden>{count}</span>
            <span className="sr-only">, {C.plural(count, "prompt")}</span>
          </Count>
        </button>
      )}
      {/* The sidebar's three dots, resting faint rather than hidden: a
          heading has no hover to reveal them on a touch screen, and the
          menu is the heading's only way to its actions without a right-click */}
      <MenuDots label={`Actions for ${label}`} reveal="opacity-50 group-hover/hdr:opacity-100" onOpen={onMenu} />
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
      New prompt
    </button>
  )
}

// One prompt as a preview: title, the first lines of its body, its tags and
// what it asks for. A click opens it in the editor; the copy button in its
// corner (or Ctrl+C on the card) copies it.
function PromptCard({
  s,
  clipboard,
  onOpen,
  onMenu,
  onCopy,
  place,
}: {
  s: Snippet
  clipboard: string | null
  /** Where the prompt lives (pack › group), on a card that has no heading above it to say so */
  place?: string
  onOpen: () => void
  onMenu: (x: number, y: number) => void
  /** Copies the prompt; resolves true once it is on the clipboard */
  onCopy: () => Promise<boolean>
}) {
  // The icon turns to a check for a moment where the click was, as well as
  // the toast at the window's edge
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])
  const copy = () => void onCopy().then((ok) => ok && setCopied(true))
  const tags = s.tags || []
  const inputs = C.requiredInputs(s)
  // The excerpt is the same token preview as the editor's and the popup's,
  // so it too shows the clipboard, not the word "clipboard" (BEHAVIOR.md).
  // Three lines show, so only the head of the text is tokenized and drawn:
  // a prompt that holds a pasted document is not rendered whole on every
  // card of its pack
  const excerpt = s.text.slice(0, EXCERPT_CHARS).replace(/\s+/g, " ")
  // To assistive tech the card is its title, described by what it asks for
  // and its pin: without a name of its own it read out the whole excerpt,
  // the clipboard's stack trace included, once per card
  const badgeId = `card-${s.id}-asks`
  const name = s.title || "(untitled)"
  return (
    // The card and its copy button are siblings, not one inside the other:
    // a button may not hold a button. The copy button sits over the card's
    // title row, which keeps its right edge clear for it.
    <div className="group/card relative flex min-w-0">
    <button
      type="button"
      aria-label={`${name}${s.pinned ? ", pinned" : ""}`}
      aria-describedby={inputs.length ? badgeId : undefined}
      title={`${name} — click edits, Ctrl+C copies, right-click for actions`}
      className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1.5 rounded-lg border border-border bg-background p-3 text-left text-ui text-foreground transition-colors group-hover/card:border-primary focus-ring"
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
        // A focused card copies the way selected text would
        if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "c") {
          e.preventDefault()
          copy()
        }
      }}
    >
      <span className="flex min-w-0 items-center gap-1.5 pr-7">
        {s.pinned && <RiPushpinFill className="size-3.5 shrink-0 text-(--warn)" aria-hidden />}
        <span className="min-w-0 flex-1 truncate font-medium">
          <bdi>{s.title || "(untitled)"}</bdi>
        </span>
        <InputsBadge inputs={inputs} id={badgeId} />
        {s.uses > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{s.uses}×</span>}
      </span>
      {/* The sidebar's one-list row says the same under its title */}
      {place && (
        <span className="-mt-1 truncate text-xs text-muted-foreground">
          <bdi>{place}</bdi>
        </span>
      )}
      <span className="line-clamp-3 break-words text-ui text-muted-foreground">
        {excerpt.trim() ? <PromptTokens text={excerpt} clipboard={clipboard} configValues={s.configValues} /> : <i>(empty)</i>}
      </span>
      {tags.length > 0 && (
        <span className="flex flex-wrap items-center gap-1">
          <TagList tags={tags} max={MAX_CARD_TAGS} />
        </span>
      )}
    </button>
    {/* Faint at rest rather than hidden, like the headings' dots: there is
        no hover on a touch screen, and a copy found only by hovering is a
        copy most people never find. Centred on the title line. */}
    <button
      type="button"
      aria-label={`Copy ${name}`}
      title={inputs.length ? "Copy (fill-in fields stay as typed, for you to fill in)" : "Copy"}
      className={cn(
        "absolute right-2 top-2.5 flex size-6 cursor-pointer items-center justify-center rounded-md transition-[opacity,color] hover:bg-hover hover:text-foreground focus-ring",
        copied ? "text-(--success) opacity-100" : "text-muted-foreground opacity-60 group-hover/card:opacity-100 focus-visible:opacity-100"
      )}
      onClick={copy}
    >
      {copied ? <RiCheckLine className="size-3.5" aria-hidden /> : <RiFileCopyLine className="size-3.5" aria-hidden />}
    </button>
    </div>
  )
}

// `focus` null: every prompt, the overview of the sidebar's One list
// display, in its order (pins first, then the chosen sort), each card
// saying where it lives since no heading does
export function Overview({ focus }: { focus: LibraryFocus | null }) {
  const m = useManager()
  const { snippets, orderBy, packNames } = m
  // The same menus as the sidebar's three dots (rename, lock, export, file,
  // new group, delete; ungroup; pin, move to, tag, export, delete)
  const menus = useLibraryMenus({ surface: "overview" })

  // The clipboard for the card excerpts, read the way the editor reads it:
  // on open, when the window comes back, and after a copy or cut here
  const [clipboard, setClipboard] = useState<string | null>(null)
  const refreshClipboard = useCallback(() => void invoke<string>("get_clipboard_text").then(setClipboard).catch(() => {}), [])
  useEffect(() => {
    const refresh = refreshClipboard
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
  }, [refreshClipboard])

  // The tree is pure core (tested); rows follow the sidebar's order
  const tree = useMemo(
    () => C.packTree(C.sortPrompts(snippets, orderBy), packNames(), DEFAULT_PACK),
    [snippets, orderBy, packNames]
  )
  const pack = focus ? tree.find((p) => p.name === focus.pack) : undefined
  // A group that is gone (deleted, ungrouped, emptied by moves) leaves its
  // pack's overview in its place
  const group = focus?.group ? pack?.groups.find((g) => g.name === focus.group) : undefined
  // The sidebar's filter reaches the cards: while a query is set the
  // overview shows only the hits and says how many of the pack's or
  // group's prompts they are, so the two views never disagree in one frame
  const snippetsInOrder = useMemo(() => C.sortPrompts(snippets, orderBy), [snippets, orderBy])
  const filtering = m.query.trim() !== ""
  const parsed = useMemo(() => C.parseQuery(m.query), [m.query])
  const hit = (s: Snippet) => !filtering || C.matchesQuery({ ...s, pack: s.pack || DEFAULT_PACK }, parsed)

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
  // The shared copy (./copy); the excerpts then show the new clipboard
  const copyPrompt = async (s: Snippet) => {
    const ok = await copyText(s)
    if (ok) refreshClipboard()
    return ok
  }
  const cards = (items: Snippet[]) => (
    <div className="grid gap-2 @xl:grid-cols-2 @4xl:grid-cols-3">
      {items.filter(hit).map((s) => (
        <PromptCard
          key={s.id}
          s={s}
          clipboard={clipboard}
          onOpen={() => open(s)}
          onMenu={(x, y) => cardMenu(s, x, y)}
          onCopy={() => copyPrompt(s)}
        />
      ))}
    </div>
  )
  // "2 of 12 match the filter" under the heading while a query is set
  const matchLine = (items: Snippet[]) => {
    if (!filtering) return null
    const n = items.filter(hit).length
    return (
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {n === 0 ? `None of the ${C.plural(items.length, "prompt")} here match the filter` : `${n} of ${items.length} match the filter`}
      </p>
    )
  }
  // One list: every prompt, as the sidebar lists them. No pack is shown,
  // so the title is the library's, New prompt goes where Ctrl+N would put
  // it, and each card names its pack and group.
  if (!focus) {
    const shown = snippetsInOrder.filter(hit)
    return (
      <div className="@container flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3 animate-in fade-in duration-150" role="region" aria-label="All prompts">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="flex min-w-0 items-baseline gap-1.5 text-lg font-semibold">
            <span className="truncate">All prompts</span>
            <Count>
              <span aria-hidden>{snippetsInOrder.length}</span>
              <span className="sr-only">, {C.plural(snippetsInOrder.length, "prompt")}</span>
            </Count>
          </h2>
          <span className="ml-auto flex shrink-0 items-center">
            <AddPrompt where="the library" onClick={() => void m.newPrompt()} />
          </span>
        </div>
        {matchLine(snippetsInOrder)}
        {snippetsInOrder.length === 0 && <p className="text-ui text-muted-foreground">No prompts yet. New prompt starts the library.</p>}
        <div className="grid gap-2 @xl:grid-cols-2 @4xl:grid-cols-3">
          {shown.map((s) => (
            <PromptCard
              key={s.id}
              s={s}
              clipboard={clipboard}
              place={[s.pack || DEFAULT_PACK, s.group].filter(Boolean).join(" › ")}
              onOpen={() => open(s)}
              onMenu={(x, y) => cardMenu(s, x, y)}
              onCopy={() => copyPrompt(s)}
            />
          ))}
        </div>
        {menus.element}
      </div>
    )
  }

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
        {/* One New prompt per overview: the pack's at its heading, a group's
            only when the group is what is shown. Six dashed buttons down one
            pane made the sidebar's New wallpaper; a group heading's ⋯ and
            right-click still offer New prompt in it. */}
        {!locked && isTitle && (
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
      {/* A group's crumb goes up to its pack (Escape does the same). A pack
          has no crumb: the "Pack" and "Group" labels that sat here said what
          the tree's indentation and the heading already say. */}
      {group && (
        <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <button
            type="button"
            className="flex min-w-0 cursor-pointer items-center gap-0.5 rounded-sm font-medium hover:text-foreground focus-ring"
            title={`Show all of ${pack.name} (Esc)`}
            onClick={() => m.openOverview({ pack: pack.name })}
          >
            <RiArrowLeftSLine className="size-3.5 shrink-0" />
            <span className="truncate">
              <bdi>{pack.name}</bdi>
            </span>
          </button>
        </div>
      )}

      {group ? (
        <>
          {groupHeading(group.name, group.items.length, true)}
          {matchLine(group.items)}
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
            {!locked && pack.count > 0 && <AddPrompt where={pack.name} onClick={() => void m.newPrompt({ pack: pack.name })} />}
          </Heading>
          {/* The one action an empty pack has sits with the words, not at
              the heading's far right where it read as a dead end */}
          {pack.count === 0 && (
            <div className="flex flex-wrap items-center gap-2 text-ui text-muted-foreground">
              {locked ? "Empty pack, and locked: unlock it from its menu to add prompts" : "Empty pack. The first prompt starts it."}
              {!locked && <AddPrompt where={pack.name} onClick={() => void m.newPrompt({ pack: pack.name })} />}
            </div>
          )}
          {matchLine([...pack.ungrouped, ...pack.groups.flatMap((g) => g.items)])}
          {pack.ungrouped.some(hit) && cards(pack.ungrouped)}
          {pack.groups.filter((g) => g.items.some(hit)).map((g) => (
            // A group is a heading over a hairline, not a panel: the pack is
            // the one container here, so nothing repeats its title's look.
            // While filtering, a group with no hits is left out; the match
            // line above says how many of the pack's prompts remain.
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
