import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiClipboardLine,
  RiFileCopyLine,
  RiFilterLine,
  RiPushpinLine,
  RiSearchLine,
} from "@remixicon/react"
import { C, type Library, type PackMeta, type Snippet, type SnippetPatch } from "@/lib/core"
import { applyPrefs, isCompact } from "@/lib/prefs"
import { type Config, DEFAULT_PACK, MAX_PINS, defaultPackFor, isLockedIn, packNames as packNamesOf } from "@/lib/library"
// Same key shape as the sidebar, so a group folds independently per pack
const groupKey = (pack: string, group: string) => `${pack}\u0000${group}`
// A stop in the arrow order: a row (its index in `visible`), or a pack's or
// group's header
type HeadStop = { pack: string; group?: string }
type Stop = { row: number } | HeadStop
const sameStop = (a: Stop, b: HeadStop) => !("row" in a) && a.pack === b.pack && a.group === b.group
// The option a selected header is announced as (the header itself is hidden)
const HEAD_OPTION_ID = "header-stop"
const EMPTY: ReadonlySet<string> = new Set()
import { cn } from "@/lib/utils"
import { CLIP_LINE_ID, type Entry, Row, derive, rowIcon } from "@/popup/Row"
import { ClipboardMarks, Count, Kbd, Keys, PREVIEW_BOX, PromptTokens } from "@/components/prompt-bits"
import { Button } from "@/components/ui/button"
import { MENU_ITEM, MENU_PANEL, SELECTED_BAR } from "@/components/menu-styles"
import { SearchClear, Select, fieldVariants, searchBoxClass } from "@/components/field"


// `configFields`: the fields that are really unset {{config}} parameters,
// downgraded to ask (BEHAVIOR.md); the form says so under each, since one
// asked for every day is one the user never learned could be set once
type FormState = { snippet: Snippet; base: string; fields: string[]; configFields: Set<string>; paste: boolean }
type PanelAction = { label: string; danger?: boolean; run: () => void }
// Where Delete sits in the action panel (its digit is this plus one)
const DELETE_AT = 4
type CreateState = { title: string; pack: string; group: string; prefilled: string }
// One line of feedback above the hint bar: the popup's only channel for an
// error (a failed paste or save), a confirmation that something landed
// (copied, saved, restored: Success text, no fill, as every confirmation in
// DESIGN.md) or a note (undo offered, press Esc again)
// `undo`: the note offers the last delete back, as a button in the strip.
// "fresh" in the session that deleted (bare U works while nothing is typed),
// "kept" on the one summon it survives (Ctrl+Z and the button only: U is
// the first letter of a query the user came back to type).
// `recover`: the paste failed after Rust put the prompt on the clipboard.
// While it shows, Enter dismisses it and does not pick (see the key handler)
type Notice = { text: string; kind: "error" | "info" | "success"; undo?: "fresh" | "kept"; recover?: boolean }


// window (125% scale, the mono font) wraps between hints instead of being
// clipped by the shell's overflow, and never splits a key from its label.
// A `minor` hint is dropped below 360 px: at the 320 px minimum the bar
// wrapped to two lines and ate a row (L20). A `wide` one shows only from
// 440 px, in a window the user has widened: the five resting hints fill
// the default 400 px, and a sixth wrapped the bar the same way.
// Those widths are the window's at 100% UI scale. The breakpoints are
// container queries on the bar, in rem (the window's width less the
// shell's 18 px of padding and border), so they grow with the UI scale:
// as viewport pixels they kept showing five hints at 125%, where the type
// is a quarter wider, and the bar wrapped at every width.
// A `warn` hint says what the key is about to do wrong, in Warn: text only,
// as every warning in DESIGN.md.
// A `wider` one waits for 500 px: beside the warning's long label, actions
// and preview fit on the line only there (at 440 px they wrapped the bar).
// `tiny`: gives way only in the narrowest bar there is, the 320 px minimum
// at a 125% UI scale (about 15 rem), where a Warn hint and one more hint
// wrapped the bar to two lines and took a row from the window
// `widest`: waits for 560 px, where a resting bar has room for a seventh
// hint (the clipboard panel's key; the six before it fill about 400 px of
// a 528 px line)
function Hint({ k, tiny, minor, wide, wider, widest, warn, children }: { k: string; tiny?: boolean; minor?: boolean; wide?: boolean; wider?: boolean; widest?: boolean; warn?: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1", tiny && "hidden @min-[17rem]:flex", minor && "hidden @min-[21.375rem]:flex", wide && "hidden @min-[26.375rem]:flex", wider && "hidden @min-[30.125rem]:flex", widest && "hidden @min-[33rem]:flex")}>
      <Keys combo={k} />
      <span className={cn(warn && "text-(--warn)")}>{children}</span>
    </span>
  )
}

// `name`: the text is the user's (a prompt title), shown as typed; uppercase
// is for the app's own labels only
function SectionHeader({ children, name }: { children: React.ReactNode; name?: boolean }) {
  return (
    <div className={cn(name ? "name-label truncate" : "section-label", "px-2 pb-0.5 pt-1.5")}>
      {children}
    </div>
  )
}

export function App() {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [clip, setClip] = useState("")
  // One test for "empty", shared by the clipboard line, the rows and the
  // hint bar: whitespace alone pastes a hole as surely as nothing does, and
  // the line used to call it empty while the rows did not
  const clipEmpty = !clip.trim()
  const [query, setQuery] = useState("")
  const [sel, setSel] = useState(0)
  // The prompt whose paste is in flight: its row is tinted, and no other
  // pick is taken until it lands. Mirrored in a ref because a second Enter
  // arrives before React has re-rendered with the state (L14).
  const [pickedId, setPickedId] = useState<string | null>(null)
  const pickedRef = useRef<string | null>(null)
  const setPicked = useCallback((id: string | null) => {
    pickedRef.current = id
    setPickedId(id)
  }, [])
  const [form, setForm] = useState<FormState | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  // The field the caret is in: what Enter does depends on what is empty after it
  const [formFocus, setFormFocus] = useState(0)
  const [panelSel, setPanelSel] = useState(0)
  const [panelFor, setPanelFor] = useState<Snippet | null>(null)
  const [panelNote, setPanelNote] = useState<string | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)
  // Where the preview card anchors: its top-left at (x, y) when it fits
  // below, its bottom edge at `above` otherwise. The cursor on hover, the
  // selected row on keyboard → (so the card never covers that row). `key`:
  // opened from the keyboard, which is what lets it take the list's place
  // in a window too short to hold it beside the row (below).
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number; above: number; key?: boolean } | null>(null)
  // The card's measured height, so a short card near the bottom is clamped by
  // what it takes up rather than by its max; null until the card is measured
  const previewCardRef = useRef<HTMLDivElement>(null)
  const [previewH, setPreviewH] = useState<number | null>(null)
  // The card's text scrolls inside it; its Copy button does not. Whether
  // there is more than fits decides if the hint bar offers PgDn.
  const previewBodyRef = useRef<HTMLDivElement>(null)
  const [previewScrolls, setPreviewScrolls] = useState(false)
  // The list's top and bottom edges as they are with the card open, measured
  // after the commit: opening the card changes the hint bar, which can wrap
  // (a larger UI scale) and move the list's bottom edge up under the card
  const [previewList, setPreviewList] = useState<{ top: number; bottom: number } | null>(null)
  const [compact, setCompact] = useState(isCompact())
  const [packMeta, setPackMeta] = useState<PackMeta[]>([])
  const [packsArranged, setPacksArranged] = useState(false)
  const [create, setCreate] = useState<CreateState | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  // The failed paste's message is up: read by `pick`, the one gate every
  // way of picking goes through
  const recoverRef = useRef(false)
  recoverRef.current = !!notice?.recover
  // The popup's own undo: the last deleted prompt, offered for a few seconds
  // (D8: popup-local, so it works with the manager closed)
  const lastDeleted = useRef<{ snippet: Snippet; summoned: boolean } | null>(null)
  // Escape in create mode with an edited title asks once before discarding
  const createEscArmed = useRef(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Keyboard/mouse arbitration: ignore hover-selection during keyboard nav and
  // when the list scrolls under a stationary cursor
  const suppressHoverUntil = useRef(0)
  const lastMouse = useRef({ x: -1, y: -1 })
  // The first mouse-move a summon sees is the pointer being where it already
  // was — the window appeared under it — not the user aiming at a row. It
  // seeds `lastMouse` and nothing else; otherwise a resting pointer took the
  // selection off the top row and opened that row's preview.
  const mouseSeeded = useRef(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The 600 ms "Copied" pause before the popup hides itself. Held so a
  // summon inside that window cancels it: a hotkey press right after a
  // Ctrl+Enter used to have the new popup hidden under the user (L22)
  const copyHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // What the last pick put on the clipboard, as Rust writes it ({clipboard}
  // expanded from what the clipboard held then). The prompt stays on the
  // clipboard after a paste on purpose (BEHAVIOR.md), so the next summon
  // can say the clipboard holds a prompt, not an error: firing two
  // {clipboard} prompts in a row wraps the first's output, and nothing
  // used to say so.
  const lastSent = useRef<{ text: string; verb: "pasted" | "copied" } | null>(null)

  // Ranking is a pure core function (tested); this only memoizes it
  const filtered = useMemo<Entry[]>(() => C.rankSnippets(query, snippets), [snippets, query])
  const derived = useMemo(() => new Map(snippets.map((s) => [s.id, derive(s)])), [snippets])
  const groupAt = useMemo(() => C.groupOrder(snippets, DEFAULT_PACK), [snippets])

  const hasQuery = !!C.parseQuery(query).text
  // A filter-only query (#tag, @pack, >group, no free text) keeps the pack
  // layout, and every pack and group that holds a hit is drawn open so the
  // hits are on screen. Folds made while that filter is on are remembered
  // per filter, not saved, so the browsing layout is untouched.
  const filterKey = useMemo(() => {
    const q = C.parseQuery(query)
    return q.text || (!q.tags.length && !q.packs.length && !q.groups.length)
      ? ""
      : JSON.stringify([q.tags, q.packs, q.groups])
  }, [query])

  // Browsing groups by pack (collapsible); searching stays a flat ranked list.
  // `visible` is what the keyboard navigates — collapsed packs drop out of it.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("popupCollapsedPacks") || "[]"))
    } catch {
      return new Set()
    }
  })
  // Where the selection goes once the list has been rebuilt: a prompt to
  // follow — pinning, unpinning or restoring one moves its row between
  // sections — or the pack a collapse toggled. `visible` is a memo, so the
  // new row order isn't known at the moment of the action; the effect below
  // lands the selection as soon as it is. A plain index survived neither:
  // it left the highlight on whatever prompt had taken the old row, and
  // resetting it to 0 threw a click on a far-down pack back to the top.
  // `follow` a prompt wherever its row went; land on a `pack` (or a `group`
  // in it) that was just expanded; or land `at` an index, clamped — the row
  // that took a collapsed section's place, or the last row when it was last
  type PendingSel =
    | { follow: string }
    | { pack: string; group?: string; expanding: true }
    | { at: number }
  const pendingAnchor = useRef<PendingSel | null>(null)
  // Every pack and group header is a stop in the arrow order, as in the
  // sidebar's tree: the keyboard's only way back into a fold used to be
  // Ctrl+→, which opens everything. While one is selected, `headSel` names
  // it and `sel` is set aside; Enter folds or unfolds it, ← folds, → opens.
  const [headSel, setHeadSel] = useState<HeadStop | null>(null)
  const headSelRef = useRef<HeadStop | null>(null)
  // What the list showed when a fold was toggled, for the anchor above
  const visibleRef = useRef<Entry[]>([])
  // …and the row the keyboard was on
  const selRef = useRef(0)
  // When ← last closed a preview card: the same key folds a section, and a
  // second press on its heels folded one for good (critique popup 5)
  const cardClosedAt = useRef(0)
  // Folds made under a filter, keyed by that filter so a new filter opens
  // everything again
  const [filterFolds, setFilterFolds] = useState<{ key: string; packs: Set<string>; groups: Set<string> }>({
    key: "",
    packs: new Set(),
    groups: new Set(),
  })
  // Groups fold the same way, keyed by pack + group so two packs' "Drafts"
  // fold independently. Same key shape as the sidebar's collapsedGroups.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("popupCollapsedGroups") || "[]"))
    } catch {
      return new Set()
    }
  })
  const folds = filterKey && filterFolds.key === filterKey ? filterFolds : null
  const effCollapsed = filterKey ? (folds?.packs ?? EMPTY) : collapsed
  const effCollapsedGroups = filterKey ? (folds?.groups ?? EMPTY) : collapsedGroups
  const toggleCollapsed = useCallback((name: string) => {
    const base = filterKey ? (folds?.packs ?? EMPTY) : collapsed
    const next = new Set(base)
    const expanding = next.has(name)
    if (expanding) next.delete(name)
    else next.add(name)
    if (filterKey) {
      setFilterFolds({ key: filterKey, packs: next, groups: folds?.groups ?? new Set() })
    } else {
      setCollapsed(next)
      localStorage.setItem("popupCollapsedPacks", JSON.stringify([...next]))
    }
    // The selection moves only when its row is in the section that was
    // toggled (← on that row, which is how the keyboard folds). A click on
    // another section's header used to carry the selection there, so the
    // pointer changed what Enter pasted (critique popup 5).
    const cur = visibleRef.current[selRef.current]
    if (cur && !(!cur.s.pinned && (cur.s.pack || DEFAULT_PACK) === name)) pendingAnchor.current = { follow: cur.s.id }
    else if (expanding) pendingAnchor.current = { pack: name, expanding }
    else {
      // The row that takes the section's place is the first one below it
      const first = visibleRef.current.findIndex((e) => !e.s.pinned && (e.s.pack || DEFAULT_PACK) === name)
      pendingAnchor.current = { at: first < 0 ? 0 : first }
    }
  }, [collapsed, filterKey, folds])
  // Same as a pack fold: the selection stays by the toggled group instead
  // of jumping to the top of the list
  const toggleCollapsedGroup = useCallback((key: string) => {
    const base = filterKey ? (folds?.groups ?? EMPTY) : collapsedGroups
    const next = new Set(base)
    const expanding = next.has(key)
    if (expanding) next.delete(key)
    else next.add(key)
    if (filterKey) {
      setFilterFolds({ key: filterKey, packs: folds?.packs ?? new Set(), groups: next })
    } else {
      setCollapsedGroups(next)
      localStorage.setItem("popupCollapsedGroups", JSON.stringify([...next]))
    }
    const [pack, group] = key.split("\u0000")
    const cur = visibleRef.current[selRef.current]
    if (cur && !(!cur.s.pinned && (cur.s.pack || DEFAULT_PACK) === pack && cur.s.group === group)) pendingAnchor.current = { follow: cur.s.id }
    else if (expanding) pendingAnchor.current = { pack, group, expanding }
    else {
      const first = visibleRef.current.findIndex(
        (e) => !e.s.pinned && (e.s.pack || DEFAULT_PACK) === pack && e.s.group === group
      )
      pendingAnchor.current = { at: first < 0 ? 0 : first }
    }
  }, [collapsedGroups, filterKey, folds])
  // Ctrl+→, and the "N folded" line: every pack and group open again, the
  // selection on the row it was on
  const unfoldAll = useCallback(() => {
    const cur = visibleRef.current[selRef.current]
    // A selected header stays selected; a row is followed to its new place
    if (cur && !headSelRef.current) pendingAnchor.current = { follow: cur.s.id }
    if (filterKey) {
      setFilterFolds({ key: filterKey, packs: new Set(), groups: new Set() })
    } else {
      setCollapsed(new Set())
      setCollapsedGroups(new Set())
      localStorage.setItem("popupCollapsedPacks", "[]")
      localStorage.setItem("popupCollapsedGroups", "[]")
    }
  }, [filterKey])

  // `count` is what the heading shows: for a pack, every prompt it holds,
  // pinned ones included, so the popup agrees with the manager's sidebar even
  // though the pins are drawn up in the Pinned section.
  type Section = { name: string; entries: Entry[]; count: number; collapsible: boolean; isCollapsed: boolean }
  const { sections, visible, stops } = useMemo(() => {
    if (hasQuery) {
      const sections: Section[] =
        filtered.length > 0
          ? [{ name: "Results", entries: filtered, count: filtered.length, collapsible: false, isCollapsed: false }]
          : []
      return { sections, visible: filtered, stops: filtered.map((_, i): Stop => ({ row: i })) }
    }
    const pinned = filtered.filter((e) => e.s.pinned)
    const rest = filtered.filter((e) => !e.s.pinned)
    const inPack = new Map<string, number>()
    for (const e of filtered) {
      const key = e.s.pack || DEFAULT_PACK
      inPack.set(key, (inPack.get(key) || 0) + 1)
    }
    const map = new Map<string, Entry[]>()
    for (const e of rest) {
      const key = e.s.pack || DEFAULT_PACK
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    // Within a pack: ungrouped prompts first, then groups in the library's
    // order (C.groupOrder, what the manager's Move up/down arranges), so the
    // list can render a sub-header wherever the group changes. Sorted here so
    // keyboard order (visible) matches what is drawn (sections); the sort is
    // stable, so each group's prompts keep their rank.
    const rank = (e: Entry) => (e.s.group ? (groupAt.get(groupKey(e.s.pack || DEFAULT_PACK, e.s.group)) ?? 0) : -1)
    const byGroup = (a: Entry, b: Entry) => rank(a) - rank(b)
    // Packs in the manager's order: A–Z, or as the user arranged them
    const packs = C.orderPacks([...map.keys()], packsArranged ? packMeta.map((p) => p.name) : null).map(
      (n) => [n, [...map.get(n)!].sort(byGroup)] as [string, Entry[]]
    )
    const sections: Section[] = []
    if (pinned.length)
      sections.push({ name: "Pinned", entries: pinned, count: pinned.length, collapsible: false, isCollapsed: false })
    for (const [name, entries] of packs)
      sections.push({
        name,
        entries,
        count: inPack.get(name) ?? entries.length,
        collapsible: true,
        isCollapsed: effCollapsed.has(name),
      })
    const visible = [
      ...pinned,
      ...packs.flatMap(([n, es]) =>
        effCollapsed.has(n) ? [] : es.filter((e) => !e.s.group || !effCollapsedGroups.has(groupKey(n, e.s.group)))
      ),
    ]
    // The arrow order: every row, and every pack and group header above its rows
    const stops: Stop[] = pinned.map((_, i) => ({ row: i }))
    let at = pinned.length
    for (const [n, es] of packs) {
      stops.push({ pack: n })
      if (effCollapsed.has(n)) continue
      let last: string | undefined
      for (const e of es) {
        const g = e.s.group
        if (g && g !== last) stops.push({ pack: n, group: g })
        if (!g || !effCollapsedGroups.has(groupKey(n, g))) stops.push({ row: at++ })
        last = g
      }
    }
    return { sections, visible, stops }
  }, [filtered, hasQuery, effCollapsed, effCollapsedGroups, packMeta, packsArranged, groupAt])

  // Row index within `visible`, for selection
  const rowIndex = useMemo(() => new Map(visible.map((e, i) => [e.s.id, i])), [visible])
  // Ctrl+1..5 slots: the rule is core's (tested); this memoizes it over
  // what the list shows, so a folded pack's or group's entries take no slot
  const slotEntries = useMemo(
    () => C.slotEntries(filtered, visible.map((e) => e.s.id), MAX_PINS),
    [filtered, visible]
  )
  const slotOf = useMemo(() => new Map(slotEntries.map((e, i) => [e.s.id, i + 1])), [slotEntries])

  // Collapsing can strand the selection past the end
  useEffect(() => {
    if (sel >= visible.length && visible.length > 0) setSel(visible.length - 1)
  }, [sel, visible.length])

  // The packs that exist, plus the one the create form holds (an empty
  // library has none, and the form still needs its choice listed)
  const packNames = useMemo(() => packNamesOf(packMeta, snippets, { extra: create?.pack, arranged: packsArranged }), [packMeta, snippets, create?.pack, packsArranged])
  const isLocked = useCallback((name: string) => isLockedIn(packMeta, name), [packMeta])

  const hidePreview = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setPreviewIdx(null)
  }, [])
  // A card opened with → belongs to the selected row: the hint bar speaks
  // for it and PgUp, PgDn and ← act on it. A hover card belongs to the
  // pointer's row, which Enter does not paste, so it changes neither. It
  // used to switch the bar to "↵ paste · ← back" while Enter pasted the
  // selected row, another prompt than the one on the card (critique popup
  // 4, P1); the popup opens at the cursor, so the pointer is always on a row.
  const keyCard = previewIdx !== null && !!previewPos?.key

  // The clipboard panel: the whole clipboard, as the lines it pastes,
  // dropped from the clipboard line over the list (Ctrl+↓ or a click on the
  // line). The line flattens a stack trace to one cut row, and the error's
  // useful part is usually its end. Open, it takes ↑ ↓ PgUp PgDn to scroll;
  // Esc, Enter, ← and Ctrl+↓ put it away, and typing closes it on the way
  // into the search box. A ref for the row hover, which must not open a
  // card under it.
  const [clipOpen, setClipOpen] = useState(false)
  const clipOpenRef = useRef(false)
  clipOpenRef.current = clipOpen
  const clipLineRef = useRef<HTMLDivElement>(null)
  const clipBodyRef = useRef<HTMLDivElement>(null)
  const [clipBox, setClipBox] = useState<{ top: number; room: number } | null>(null)
  const [clipScrolls, setClipScrolls] = useState(false)
  const clipLines = useMemo(() => (clipOpen ? C.clipboardLines(clip) : null), [clipOpen, clip])

  // The panel's items take keyboard focus while it is open (below), so
  // closing it hands focus back to the search box
  const panelRef = useRef<HTMLDivElement>(null)
  const closePanel = useCallback(() => {
    setPanelFor(null)
    setPanelNote(null)
    setDeleteArmed(false)
    setPanelSel(0)
    inputRef.current?.focus()
  }, [])
  // Focus follows the highlighted item: a menu whose items are only marked
  // while focus stays in the search box announces nothing as ArrowDown
  // moves (critique popup, Sam). The document listener still gets the keys.
  useEffect(() => {
    if (!panelFor) return
    const items = panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    items?.[panelSel]?.focus()
  }, [panelFor, panelSel])

  const fail = useCallback((what: string, e: unknown) => {
    setNotice({ text: `Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`, kind: "error" })
  }, [])

  // paste_snippet answers "pasted" (the paste thread is running and the
  // popup is hidden), "copied" (the manager was the foreground window when
  // the popup was summoned, so Rust copied only and left the popup up), or
  // null from an older Rust, which means pasted.
  const send = useCallback(async (snippet: Snippet, text: string, paste: boolean) => {
    let result: string | null
    try {
      result = await invoke<string | null>("paste_snippet", { text, paste, id: snippet.id })
    } catch (e) {
      // Rust writes the clipboard before hiding, so on failure the popup is
      // still on screen to show this; the pick is over, so a retry is allowed
      fail(paste ? "paste" : "copy", e)
      setPicked(null)
      return
    }
    // The clipboard now holds this, expanded the way Rust expands it
    lastSent.current = {
      text: text.split("{clipboard}").join(clip),
      verb: !paste || result === "copied" ? "copied" : "pasted",
    }
    if (!paste || result === "copied") {
      // Copy-only: Rust leaves the popup up; confirm, then hide
      // Named: Ctrl+Enter copies the selected row, and with a hover card
      // open on another row the bare "Copied to clipboard" let the user
      // believe the card's prompt had been copied
      const what = snippet.title.trim() ? `Copied "${snippet.title.trim()}" to clipboard` : "Copied to clipboard"
      setNotice({
        text: result === "copied" && paste ? `${what} — the manager was in front` : what,
        kind: "success",
      })
      setPicked(null)
      if (copyHideTimer.current) clearTimeout(copyHideTimer.current)
      copyHideTimer.current = setTimeout(() => {
        copyHideTimer.current = null
        void invoke("hide_popup")
      }, 600)
    }
  }, [fail, setPicked, clip])

  // --- Create prompt from clipboard -------------------------------------------
  const openCreate = useCallback(() => {
    hidePreview()
    closePanel()
    // Nothing to save from: say so in the strip rather than switching the
    // whole window to a form whose only content is that message
    if (!clip.trim()) {
      setNotice({ text: "Copy something first — Ctrl+N saves the clipboard", kind: "info" })
      return
    }
    // The clipboard's first line, cut at a word boundary (core); the draft
    // title when there is nothing to cut from
    const title = C.titleFromClipboard(clip) || C.DRAFT_TITLE
    // Prefer the pack that last received a prompt (one rule with the manager)
    const pack = defaultPackFor(packMeta, snippets)
    createEscArmed.current = false
    setCreate({ title, pack, group: "", prefilled: title })
  }, [clip, packMeta, snippets, hidePreview, closePanel])

  const saveCreate = useCallback(async () => {
    if (!create || !clip) return
    const snip: Snippet = {
      id: crypto.randomUUID(),
      title: create.title.trim() || "(untitled)",
      text: clip,
      tags: [],
      pack: create.pack,
      group: create.group,
      uses: 0,
      pinned: false,
      pinnedAt: 0,
      configValues: {},
    }
    // Rust appends on disk; this window never sends the whole library
    try {
      const lib = await invoke<Library>("add_snippet", { snippet: snip })
      setSnippets(lib.snippets)
    } catch (e) {
      fail("save the prompt", e)
      return
    }
    localStorage.setItem("lastPack", create.pack)
    setCreate(null)
    setQuery("")
    // The new prompt sorts last (uses 0) and its pack may be collapsed, so
    // say where it went rather than hoping the row is visible
    setNotice({ text: `Saved "${snip.title}" to ${create.pack}${create.group ? ` › ${create.group}` : ""}`, kind: "success" })
  }, [create, clip, fail])

  // One prompt's pin state, merged on disk.
  // Resolves false when the write failed (already reported).
  const patch = useCallback(async (id: string, patch: SnippetPatch): Promise<boolean> => {
    try {
      const lib = await invoke<Library>("patch_snippet", { id, patch })
      setSnippets(lib.snippets)
      return true
    } catch (e) {
      fail("save", e)
      return false
    }
  }, [fail])

  // `{clipboard}` expands at paste time (BEHAVIOR.md), so the "Will paste"
  // preview must show the clipboard as it is now, not as it was when the
  // popup opened: a Ctrl+C inside a fill-in field changes it.
  const refreshClip = useCallback(() => {
    void invoke<string>("get_clipboard_text").then(setClip).catch(() => {})
  }, [])
  useEffect(() => {
    // The clipboard is written after the event fires, hence the tick
    const on = () => setTimeout(refreshClip, 50)
    document.addEventListener("copy", on)
    document.addEventListener("cut", on)
    return () => {
      document.removeEventListener("copy", on)
      document.removeEventListener("cut", on)
    }
  }, [refreshClip])

  const pick = useCallback((snippet: Snippet, paste: boolean) => {
    // One paste at a time: a second Enter inside the ~150 ms before Rust
    // hides the window used to run paste_snippet twice (two Ctrl+V, uses +2).
    // Nor while "Copied to clipboard" is up: the popup is about to hide, and
    // an Enter in those 600 ms pasted what Ctrl+Enter had only copied.
    if (pickedRef.current || copyHideTimer.current) return
    // The prompt that failed to paste is on the clipboard: no way of picking
    // sends again while that message is up. The first pick only clears it,
    // as Enter does. The guard was on Enter alone, so a slot key, a click
    // and the action panel still re-sent the row into the window that had
    // refused it, a {clipboard} row wrapped in itself (critique popup 5, P1).
    if (recoverRef.current) {
      setNotice(null)
      return
    }
    hidePreview()
    closePanel()
    let base = C.expandConfig(snippet.text, snippet.configValues)
    // Unset config params become fill-in fields instead of pasting holes
    base = C.downgradeUnsetConfig(base)
    const fields = C.customFields(base)
    if (fields.length) {
      // Every field starts empty: nothing typed last time is kept
      setFormValues(Object.fromEntries(fields.map((f) => [f, ""])))
      setFormFocus(0)
      // A passing remark about the list ("Copy something first") has no
      // business under the form's button; an Undo offer and an error stay
      setNotice((n) => (n && n.kind === "info" && !n.undo ? null : n))
      const configFields = new Set(C.configNames(snippet.text).filter((n) => fields.includes(n)))
      setForm({ snippet, base, fields, configFields, paste })
      if (base.includes("{clipboard}")) refreshClip()
      return
    }
    setPicked(snippet.id)
    setTimeout(() => send(snippet, C.expandBuiltins(base), paste), 90)
  }, [hidePreview, closePanel, send, refreshClip, setPicked])

  const submitForm = useCallback(async (forceCopy: boolean) => {
    // The same guard as pick: the form's Enter fires again before React has
    // unmounted the textarea, and once it has, the list's Enter is next
    if (!form || pickedRef.current || copyHideTimer.current) return
    // A function replacer in core: a value containing `$&` or `$$` must paste
    // as typed, not as a replacement pattern
    const text = C.fillFields(form.base, formValues)
    const { snippet } = form
    const paste = forceCopy ? false : form.paste
    setPicked(snippet.id)
    setForm(null)
    await send(snippet, C.expandBuiltins(text), paste)
  }, [form, formValues, send, setPicked])

  const togglePin = useCallback(async (s: Snippet) => {
    if (!s.pinned && snippets.filter((x) => x.pinned).length >= MAX_PINS) {
      setPanelNote(`Max ${MAX_PINS} pins — unpin something first`)
      return
    }
    // The row moves into or out of the Pinned section: the highlight goes with it
    pendingAnchor.current = { follow: s.id }
    if (await patch(s.id, { pinned: !s.pinned })) closePanel()
  }, [snippets, patch, closePanel])

  const deleteSnippet = useCallback(async (s: Snippet) => {
    try {
      const lib = await invoke<Library>("delete_snippet", { id: s.id })
      setSnippets(lib.snippets)
    } catch (e) {
      fail("delete", e)
      return
    }
    closePanel()
    // No clock on the offer: it lasts this session and the next summon
    // (`reload`), then goes. Eight seconds was shorter than reading the
    // strip, and Esc or a paste in that time made the delete permanent
    // (critique popup P1, 2026-10-03).
    lastDeleted.current = { snippet: s, summoned: false }
    setNotice({ text: `Deleted "${s.title}"`, kind: "info", undo: "fresh" })
  }, [closePanel, fail])

  // Put the last deleted prompt back, with everything it had (same id, uses,
  // pins): add_snippet replaces by id
  const undoDelete = useCallback(async () => {
    const last = lastDeleted.current
    if (!last) return
    lastDeleted.current = null
    // Highlight what came back, wherever the ranking puts it
    pendingAnchor.current = { follow: last.snippet.id }
    try {
      const lib = await invoke<Library>("add_snippet", { snippet: last.snippet })
      setSnippets(lib.snippets)
      setNotice({ text: `Restored "${last.snippet.title}"`, kind: "success" })
    } catch (e) {
      fail("restore", e)
    }
  }, [fail])

  const panelActions = useMemo<PanelAction[]>(() => {
    if (!panelFor) return []
    // The panel covers the hint bar's warning with its own hints, so its
    // Paste and Copy say what the bar said: this row sends a hole
    const d = derived.get(panelFor.id)
    const hole = !!d && rowIcon(panelFor, d, clipEmpty, false) === "clipboard-empty"
    // The same warning as the hint bar's, for the same rows
    const wraps = !!d && !clipEmpty && lastSent.current?.text === clip && rowIcon(panelFor, d, true, false) === "clipboard-empty"
    return [
      { label: hole ? "Paste without clipboard" : wraps ? "Paste, wraps last prompt" : "Paste", run: () => pick(panelFor, true) },
      { label: hole ? "Copy without clipboard" : wraps ? "Copy, wraps last prompt" : "Copy only", run: () => pick(panelFor, false) },
      { label: panelFor.pinned ? "Unpin" : "Pin", run: () => void togglePin(panelFor) },
      { label: "Edit in manager", run: () => void invoke("edit_in_manager", { id: panelFor.id }) },
      {
        label: deleteArmed ? "Really delete?" : "Delete",
        danger: true,
        // Arming takes the highlight with it, however it was armed (its
        // digit, a click, Enter): "Really delete?" used to sit under a
        // highlight still on Paste, so the Enter that answered it pasted
        // the prompt into the terminal (critique popup P1, 2026-10-03)
        run: () => {
          if (deleteArmed) void deleteSnippet(panelFor)
          else {
            setDeleteArmed(true)
            setPanelSel(DELETE_AT)
          }
        },
      },
    ]
  }, [panelFor, deleteArmed, pick, togglePin, deleteSnippet, derived, clipEmpty, clip])

  const reload = useCallback(async () => {
    applyPrefs()
    setCompact(isCompact())
    closePanel()
    setForm(null)
    setCreate(null)
    // A delete's undo survives one hide and summon: the popup is gone in a
    // keystroke, and "undoable, never lost" can't depend on not pressing
    // Esc. The summon after that starts clean.
    const last = lastDeleted.current
    if (last && !last.summoned) {
      last.summoned = true
      setNotice({ text: `Deleted "${last.snippet.title}"`, kind: "info", undo: "kept" })
    } else {
      lastDeleted.current = null
      setNotice(null)
    }
    if (copyHideTimer.current) clearTimeout(copyHideTimer.current)
    copyHideTimer.current = null
    hidePreview()
    setClipOpen(false)
    setPicked(null)
    setQuery("")
    setSel(0)
    setHeadSel(null)
    mouseSeeded.current = false
    lastMouse.current = { x: -1, y: -1 }
    // A summon starts at the top of the list. The scroll offset outlives
    // hiding the window, and the keep-in-view effect can't undo it: row 0
    // only scrolls to the nearest edge (leaving its section header above the
    // fold), and with `sel` already 0 the effect doesn't run at all.
    if (listRef.current) listRef.current.scrollTop = 0
    inputRef.current?.focus()
    try {
      const [lib, clipboard, config] = await Promise.all([
        invoke<Library>("get_snippets"),
        invoke<string>("get_clipboard_text"),
        invoke<Config>("get_config"),
      ])
      setSnippets(lib.snippets)
      setClip(clipboard)
      setPackMeta(Array.isArray(config.packs) ? config.packs : [])
      setPacksArranged(!!config.packsArranged)
    } catch (e) {
      fail("load the library", e)
    }
  }, [closePanel, hidePreview, fail, setPicked])

  useEffect(() => {
    const un = listen("popup-shown", () => void reload())
    // Rust re-shows the popup when it could not focus the target window or
    // send Ctrl+V (an elevated window) and says why; the prompt is still on
    // the clipboard. An error, so it stays until Esc or the next summon.
    const unFailed = listen<{ message: string }>("paste-failed", (e) => {
      setNotice({ text: e.payload.message, kind: "error", recover: true })
      setPicked(null)
      // The clipboard is the prompt now, not what was copied before: the
      // line under the search box said "Clipboard TypeError…" beside a
      // message saying the prompt is on the clipboard
      refreshClip()
    })
    void reload()
    return () => {
      void un.then((f) => f())
      void unFailed.then((f) => f())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    pendingAnchor.current = null
    setSel(0)
    setHeadSel(null)
    // Back to the browsing list: start it at the top. The offset a search
    // left behind outlived the results, and the keep-in-view effect can't
    // undo it (sel is already 0), so the Pinned header sat under the fold.
    if (!query && listRef.current) listRef.current.scrollTop = 0
  }, [query])

  // The card describes one prompt, and Enter pastes the selected row. A
  // query typed while the card was open moved the selection to the top
  // result and left the card on its old index: it showed one prompt while
  // Enter pasted another (critique popup 3, P1). Typing closes it, before
  // paint, like the arrow keys do.
  useLayoutEffect(() => {
    hidePreview()
  }, [query, hidePreview])
  // The clipboard panel goes the same way, and with whatever takes the
  // window over (the form, the create view, the action panel, a paste in
  // flight), or with the clipboard itself
  useLayoutEffect(() => {
    setClipOpen(false)
  }, [query])
  useEffect(() => {
    if (form || create || panelFor || pickedId || clipEmpty) setClipOpen(false)
  }, [form, create, panelFor, pickedId, clipEmpty])
  // Hung from the clipboard line, as far down as the list goes: it covers
  // the rows, never the strips and the hint bar under them, which say what
  // the keys do to it. Measured before paint, and again when the window is
  // resized under it.
  useLayoutEffect(() => {
    if (!clipOpen) {
      setClipBox(null)
      return
    }
    const measure = () => {
      const line = clipLineRef.current?.getBoundingClientRect()
      const list = listRef.current?.getBoundingClientRect()
      if (!line || !list) return
      const top = Math.round(line.bottom + 4)
      setClipBox({ top, room: Math.max(48, Math.round(list.bottom) - top) })
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [clipOpen])
  useLayoutEffect(() => {
    const body = clipBodyRef.current
    setClipScrolls(!!body && body.scrollHeight > body.clientHeight + 1)
  }, [clipBox, clip])
  // A press anywhere else puts it away, as a menu does. The line's own
  // toggle is left out: it closes the panel by its click.
  useEffect(() => {
    if (!clipOpen) return
    const away = (e: PointerEvent) => {
      const t = e.target as Node
      if (clipBodyRef.current?.parentElement?.contains(t) || clipLineRef.current?.contains(t)) return
      setClipOpen(false)
    }
    document.addEventListener("pointerdown", away)
    return () => document.removeEventListener("pointerdown", away)
  }, [clipOpen])
  const toggleClip = useCallback(() => {
    if (clipEmpty) return
    hidePreview()
    setClipOpen((o) => !o)
  }, [clipEmpty, hidePreview])
  // The list can also change under an open card with the query untouched
  // (the library reloads, an Undo puts a row back, a section folds): the
  // index then points at another prompt, or at none. The card closes
  // rather than change its subject.
  const previewOf = useRef<{ idx: number; id: string } | null>(null)
  useLayoutEffect(() => {
    if (previewIdx === null) {
      previewOf.current = null
      return
    }
    const id = visible[previewIdx]?.s.id
    const was = previewOf.current
    if (!id || (was && was.idx === previewIdx && was.id !== id)) {
      previewOf.current = null
      hidePreview()
      return
    }
    previewOf.current = { idx: previewIdx, id }
  }, [visible, previewIdx, hidePreview])

  // Form and create mode replace the whole tree, so the search input is
  // unmounted while they are up; give it focus back once the list returns
  // (Escape out of a form, or saving a new prompt) — a synchronous focus()
  // right after setState finds no input yet.
  const wasInMode = useRef(false)
  useEffect(() => {
    const inMode = !!(form || create)
    if (wasInMode.current && !inMode) inputRef.current?.focus()
    wasInMode.current = inMode
  }, [form, create])

  // The list was just rebuilt for a pending action: land the selection.
  // Following a prompt keeps the highlight on it wherever its row went; a
  // collapse keeps the selection by the toggled pack rather than at the top —
  // expanding takes its first row, collapsing the first row below the
  // section, or the last row above it when the pack was the last one.
  useEffect(() => {
    const anchor = pendingAnchor.current
    if (!anchor) return
    pendingAnchor.current = null
    if (!visible.length) {
      setSel(0)
      return
    }
    if ("follow" in anchor) {
      const i = visible.findIndex((e) => e.s.id === anchor.follow)
      // Gone from the list (deleted, or filtered out): leave the clamp to it
      if (i >= 0) setSel(i)
      return
    }
    if ("at" in anchor) {
      setSel(Math.min(anchor.at, visible.length - 1))
      return
    }
    const packOf = (e: Entry) => e.s.pack || DEFAULT_PACK
    const i = visible.findIndex(
      (e) => !e.s.pinned && packOf(e) === anchor.pack && (anchor.group === undefined || e.s.group === anchor.group)
    )
    setSel(i < 0 ? 0 : i)
  }, [visible])
  useEffect(() => {
    visibleRef.current = visible
  }, [visible])
  useEffect(() => {
    selRef.current = sel
  }, [sel])
  useEffect(() => {
    headSelRef.current = headSel
  }, [headSel])
  // The selected header went away: a group's, folded inside its pack (the
  // pack's header takes it), or one a filter left out (its first row, if
  // any). And a list with no rows, everything folded, starts on its first
  // header, so Enter has something to do.
  useEffect(() => {
    if (headSel && !stops.some((t) => sameStop(t, headSel))) {
      if (headSel.group !== undefined && stops.some((t) => sameStop(t, { pack: headSel.pack }))) {
        setHeadSel({ pack: headSel.pack })
        return
      }
      setHeadSel(null)
      const i = visible.findIndex(
        (e) =>
          !e.s.pinned &&
          (e.s.pack || DEFAULT_PACK) === headSel.pack &&
          (headSel.group === undefined || e.s.group === headSel.group)
      )
      if (i >= 0) setSel(i)
    } else if (!headSel && !visible.length && stops.length && !("row" in stops[0])) {
      setHeadSel(stops[0])
    }
  }, [stops, visible, headSel])
  // Folds outlive the popup (they are saved), hide rows, and the key that
  // undoes them was named nowhere at the default width. While anything is
  // folded the list says so, with the key, as its first line.
  const foldedCount = useMemo(() => {
    let n = 0
    for (const sec of sections) {
      if (!sec.collapsible) continue
      if (sec.isCollapsed) {
        n++
        continue
      }
      for (const g of new Set(sec.entries.map((e) => e.s.group).filter(Boolean))) {
        if (effCollapsedGroups.has(groupKey(sec.name, g))) n++
      }
    }
    return n
  }, [sections, effCollapsedGroups])

  // Keep the selected row in view
  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" })
  }, [sel, visible, headSel])

  // --- Keyboard ---------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Autofill sends keydowns with no key, and an IME's keydowns during
      // composition carry a key (Enter commits the candidate) but are not
      // the user's command: nothing to act on either way (L21)
      if (!e.key || e.isComposing) return
      // A key the form or create view already acted on is spent: they close
      // themselves, so whether this listener still sees them mounted depends
      // on when React re-runs this effect. The guard makes that timing
      // irrelevant — nothing here re-handles a key handled in a view.
      if (e.defaultPrevented) return
      if (panelFor) {
        // An armed delete is a question: Esc answers no and stays in the
        // panel, and moving off the item withdraws it, so it can't be
        // found still armed on the way back
        if (e.key === "Escape") { e.preventDefault(); if (deleteArmed) setDeleteArmed(false); else closePanel() }
        else if (e.key === "ArrowDown") { e.preventDefault(); setDeleteArmed(false); setPanelSel((p) => (p + 1) % panelActions.length) }
        else if (e.key === "ArrowUp") { e.preventDefault(); setDeleteArmed(false); setPanelSel((p) => (p - 1 + panelActions.length) % panelActions.length) }
        else if (e.key === "Enter") { e.preventDefault(); panelActions[panelSel]?.run() }
        else if (/^[1-9]$/.test(e.key)) { e.preventDefault(); panelActions[Number(e.key) - 1]?.run() }
        else if (e.key === "Tab") { e.preventDefault(); closePanel() }
        return
      }
      if (clipOpen) {
        // The panel covers the rows: Enter would paste one the user can't
        // see, so it puts the panel away like Esc, and the next Enter pastes.
        // A slot key is the same pick by number, so it does the same: the
        // panel closes and the rows, key caps and all, are back. The arrows
        // scroll it, a line at a time. Typing and Ctrl+N go on to where they
        // always go, and typing closes the panel through the query.
        const body = clipBodyRef.current
        if (e.key === "Escape" || e.key === "Enter" || e.key === "Tab" || (e.key === "ArrowLeft" && !e.ctrlKey) || (e.ctrlKey && (e.key === "ArrowDown" || e.key === "ArrowUp" || /^[1-5]$/.test(e.key)))) {
          e.preventDefault()
          setClipOpen(false)
          return
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "PageDown" || e.key === "PageUp") {
          e.preventDefault()
          const page = e.key === "PageDown" || e.key === "PageUp"
          const down = e.key === "ArrowDown" || e.key === "PageDown"
          if (body) body.scrollTop += (down ? 1 : -1) * (page ? Math.max(32, body.clientHeight - 32) : 16)
          return
        }
      } else if (e.ctrlKey && e.key === "ArrowDown" && !form && !create) {
        // Ctrl+↓ drops the clipboard down from its line, as Alt+↓ opens a
        // combo box (Alt is the window menu's key on Windows)
        e.preventDefault()
        if (!clipEmpty) toggleClip()
        return
      }
      if (e.key === "Escape") {
        if (form) setForm(null)
        else if (create) {
          // An edited title is work; ask once before throwing it away
          if (create.title !== create.prefilled && !createEscArmed.current) {
            createEscArmed.current = true
            setNotice({ text: `Press Esc again to discard "${create.title}"`, kind: "info" })
            return
          }
          setCreate(null)
          setNotice(null)
        }
        else if (notice?.kind === "error") setNotice(null)
        else void invoke("hide_popup")
        return
      }
      if (form || create) return // form/create views handle their own keys
      // Undo: Ctrl+Z always, bare "u" only while nothing has been typed. The
      // search box is where every other key goes, so an unconditional "u"
      // made a query like "unit tests" impossible to type after a delete.
      if (
        lastDeleted.current &&
        !e.altKey &&
        !e.metaKey &&
        ((e.ctrlKey && e.key.toLowerCase() === "z") ||
          (!e.ctrlKey && e.key.toLowerCase() === "u" && query === "" && !lastDeleted.current.summoned))
      ) {
        e.preventDefault()
        void undoDelete()
        return
      }
      if (e.ctrlKey && /^[1-5]$/.test(e.key)) {
        e.preventDefault()
        const entry = slotEntries[Number(e.key) - 1]
        if (entry) pick(entry.s, true)
        return
      }
      if (e.ctrlKey && e.key.toLowerCase() === "n") {
        e.preventDefault()
        openCreate()
        return
      }
      // The open card scrolls from the keyboard. → is the only way a
      // keyboard has of reading what will be pasted, and a long prompt or a
      // short window used to leave the rest of it out of reach (critique
      // popup, 2026-10-03).
      if (keyCard && (e.key === "PageDown" || e.key === "PageUp")) {
        e.preventDefault()
        const body = previewBodyRef.current
        if (body) body.scrollTop += (e.key === "PageDown" ? 1 : -1) * Math.max(40, body.clientHeight - 20)
        return
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        hidePreview()
        suppressHoverUntil.current = Date.now() + 250
      }
      if (headSel) {
        const isGroup = headSel.group !== undefined
        const folded = isGroup
          ? effCollapsedGroups.has(groupKey(headSel.pack, headSel.group!))
          : effCollapsed.has(headSel.pack)
        const toggle = () =>
          isGroup ? toggleCollapsedGroup(groupKey(headSel.pack, headSel.group!)) : toggleCollapsed(headSel.pack)
        const right = e.key === "ArrowRight" && !e.ctrlKey
        if (folded && (e.key === "Enter" || right)) {
          // Open it and stay on it, as in the sidebar's tree (→ again steps
          // in). Landing on its first row threw the selection to the top of
          // the list when a pack's groups were all folded: there was no row.
          e.preventDefault()
          toggle()
          return
        }
        if (!folded && (e.key === "Enter" || e.key === "ArrowLeft")) {
          // Fold it; the selection stays on the header, so → opens it again
          e.preventDefault()
          toggle()
          return
        }
        if (folded && e.key === "ArrowLeft" && isGroup) {
          // ← steps out a level, as in the sidebar's tree: on a folded group
          // it folds the pack
          e.preventDefault()
          toggleCollapsed(headSel.pack)
          setHeadSel({ pack: headSel.pack })
          return
        }
        if (e.key === "Tab" || e.key === "ArrowLeft" || (right && folded)) {
          // Nothing to act on, nothing more to fold
          e.preventDefault()
          return
        }
      }
      // → on an open header steps into it, like ↓
      const into = !!headSel && e.key === "ArrowRight" && !e.ctrlKey
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || into) {
        // Through the rows and the headers between them
        e.preventDefault()
        if (!stops.length) return
        const here = headSel
          ? stops.findIndex((t) => sameStop(t, headSel))
          : stops.findIndex((t) => "row" in t && t.row === sel)
        const step = e.key === "ArrowUp" ? -1 : 1
        const next = stops[here < 0 ? (step > 0 ? 0 : stops.length - 1) : (here + step + stops.length) % stops.length]
        if ("row" in next) {
          setHeadSel(null)
          setSel(next.row)
        } else setHeadSel(next)
        return
      }
      if (e.key === "ArrowRight" && e.ctrlKey) {
        // Keyboard path for the pack and group headers (with ← below):
        // Ctrl+→ unfolds everything, since folded rows leave `visible` and
        // there is no row to unfold from. Unconditional: it used to clear
        // packs only, and only while one was folded, so a folded group had
        // no keyboard way back (audit M6).
        e.preventDefault()
        unfoldAll()
      } else if (
        e.key === "ArrowRight" &&
        inputRef.current?.selectionStart === inputRef.current?.value.length
      ) {
        // At the end of the query, Right shows the full-prompt preview card
        if (visible[sel]) {
          e.preventDefault()
          const rect = listRef.current
            ?.querySelector('[data-selected="true"]')
            ?.getBoundingClientRect()
          setPreviewPos(rect ? { x: rect.left + 16, y: rect.bottom + 4, above: rect.top - 4, key: true } : null)
          setPreviewIdx(sel)
        }
      } else if (e.key === "ArrowLeft" && keyCard) {
        e.preventDefault()
        hidePreview()
        cardClosedAt.current = Date.now()
      } else if (e.key === "ArrowLeft" && !hasQuery && visible[sel] && !visible[sel].s.pinned) {
        // ← folds the selected row's group; on an ungrouped row, its pack
        e.preventDefault()
        // …but not on the heels of the ← that closed the card: "back" and
        // "fold" are one key, and the second of two quick presses folded a
        // section, which is saved
        if (Date.now() - cardClosedAt.current < 400) return
        // The selection stays on the fold it made, so → undoes it
        const { pack, group } = visible[sel].s
        const p = pack || DEFAULT_PACK
        if (group) toggleCollapsedGroup(groupKey(p, group))
        else toggleCollapsed(p)
        setHeadSel(group ? { pack: p, group } : { pack: p })
      } else if (e.key === "Tab") {
        e.preventDefault()
        if (visible[sel]) { hidePreview(); setPanelFor(visible[sel].s); setPanelSel(0) }
      } else if (e.key === "Enter") {
        e.preventDefault()
        // The prompt that failed to paste is on the clipboard. Enter here
        // used to send the row again, into the same window, and a
        // {clipboard} row would wrap the prompt in itself. The recovery is
        // Ctrl+V in the target; Enter, like Esc, only clears the message,
        // and the next Enter picks as usual.
        if (notice?.recover) setNotice(null)
        else if (visible[sel]) pick(visible[sel].s, !e.ctrlKey)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [panelFor, panelActions, panelSel, deleteArmed, clipOpen, clipEmpty, toggleClip, form, create, notice, visible, stops, headSel, effCollapsed, effCollapsedGroups, slotEntries, sel, keyCard, pick, openCreate, closePanel, hidePreview, undoDelete, query, hasQuery, unfoldAll, toggleCollapsed, toggleCollapsedGroup])

  // Stable handlers for the memoized rows: they read the live preview index
  // through a ref instead of closing over it. The pointer never moves the
  // keyboard selection (DESIGN.md's Pointer Grey Rule): hover is the grey
  // on the row and, after a pause, the preview card; the selection moves
  // on keys or a click, and a click pastes the row it lands on. A hover
  // used to paint the selection tint, so a trackpad brush after summon
  // changed what Enter pasted (audit popup P2).
  const previewRef = useRef(previewIdx)
  previewRef.current = previewIdx
  const onItemMouseMove = useCallback((i: number, e: React.MouseEvent) => {
    const moved = e.clientX !== lastMouse.current.x || e.clientY !== lastMouse.current.y
    lastMouse.current = { x: e.clientX, y: e.clientY }
    if (!mouseSeeded.current) {
      mouseSeeded.current = true
      return
    }
    if (!moved || Date.now() < suppressHoverUntil.current || clipOpenRef.current) return
    if (previewRef.current !== i) {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      // Under the row, or above it, like the card → opens: hung from the
      // pointer it covered the lower half of the row it describes
      const row = e.currentTarget as HTMLElement
      hoverTimer.current = setTimeout(() => {
        const r = row.getBoundingClientRect()
        setPreviewPos({ x: lastMouse.current.x + 12, y: r.bottom + 4, above: r.top - 4 })
        setPreviewIdx(i)
      }, 350)
    }
  }, [])
  const onItemMouseLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hideTimer.current = setTimeout(() => setPreviewIdx(null), 150)
  }, [])
  // Measure the card once it is in the DOM, before paint, so the clamp below
  // uses its real height; a new card starts from the max-height fallback
  useLayoutEffect(() => {
    setPreviewH(previewIdx === null ? null : previewCardRef.current?.offsetHeight ?? null)
    const r = previewIdx === null ? null : listRef.current?.getBoundingClientRect()
    setPreviewList((was) => (!r ? null : was && was.top === r.top && was.bottom === r.bottom ? was : { top: r.top, bottom: r.bottom }))
  }, [previewIdx, previewPos])
  // Once the card has its final box: does its text overflow, and if the
  // clipboard's place in the prompt is below the fold, start there. The
  // card exists to show the clipboard in the prompt; opening on the
  // prompt's first lines with the clipboard out of sight showed the part
  // the row already shows.
  useLayoutEffect(() => {
    const body = previewBodyRef.current
    if (previewIdx === null || !body) {
      setPreviewScrolls(false)
      return
    }
    const chip = body.querySelector("[data-clip]")
    if (chip) {
      const c = chip.getBoundingClientRect()
      const b = body.getBoundingClientRect()
      // One line of the prompt stays above it for context
      if (c.bottom > b.bottom) body.scrollTop += c.top - b.top - 24
    }
    setPreviewScrolls(body.scrollHeight > body.clientHeight + 1)
  }, [previewIdx, previewPos, previewH, previewList])
  // A pill or header funnel toggles its filter term: first click adds it to
  // the query, second click removes it again, other terms stay put
  const toggleFilter = useCallback((prefix: "#" | "@" | ">", name: string) => {
    setQuery((q) => {
      const term = C.filterTerm(prefix, name.toLowerCase())
      const terms = q.match(/[#@>]"[^"]*"|\S+/g) || []
      const rest = terms.filter((t) => t.toLowerCase() !== term)
      const next = rest.length < terms.length ? rest : [...rest, term]
      return next.length ? next.join(" ") + " " : ""
    })
    inputRef.current?.focus()
  }, [])
  const onTagClick = useCallback((tag: string) => toggleFilter("#", tag), [toggleFilter])
  const parsed = useMemo(() => C.parseQuery(query), [query])
  const activeTags = parsed.tags
  const packActive = (name: string) => parsed.packs.includes(name.toLowerCase())
  const groupActive = (name: string) => parsed.groups.includes(name.toLowerCase())
  // Funnel at the right of a pack / group header: shown on hover, or always
  // while its filter is on
  const funnel = (prefix: "@" | ">", name: string, active: boolean) => (
    <button
      type="button"
      tabIndex={-1}
      aria-pressed={active}
      title={active ? `Clear ${prefix}${name} filter` : `Filter by ${prefix}${name}`}
      aria-label={active ? `Clear ${prefix}${name} filter` : `Filter by ${prefix}${name}`}
      className={cn(
        "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md",
        active
          ? "bg-(--focus)/20 text-(--focus)"
          : "text-muted-foreground opacity-0 hover:bg-hover hover:text-foreground focus-visible:opacity-100 group-hover/hdr:opacity-100"
      )}
      onClick={() => toggleFilter(prefix, name)}
    >
      <RiFilterLine className="size-3.5" />
    </button>
  )

  // --- Hint bar (kit kbd-chip idiom) -------------------------------------------
  const headFolded =
    !!headSel &&
    (headSel.group !== undefined
      ? effCollapsedGroups.has(groupKey(headSel.pack, headSel.group))
      : effCollapsed.has(headSel.pack))
  // The selected row wraps the clipboard, the clipboard is empty and no
  // fill-in form will show the hole first: the same test as the row's hollow
  // icon (`rowIcon`), for the row Enter is about to send
  const selEntry = visible[sel]
  const selDerived = selEntry ? derived.get(selEntry.s.id) : undefined
  const selHole = !!selEntry && !!selDerived && rowIcon(selEntry.s, selDerived, clipEmpty, false) === "clipboard-empty"
  // The other two things Enter can send that are not what the row promises,
  // said the same way, in Warn on the Enter hint (critique popup 4):
  // the clipboard is the prompt this popup sent last and the selected row
  // would wrap it (the same rows that hollow their icon on an empty
  // clipboard: a fill-in row shows the clipboard in its form first)…
  const selSelfWrap =
    !clipEmpty && lastSent.current?.text === clip &&
    !!selEntry && !!selDerived && rowIcon(selEntry.s, selDerived, true, false) === "clipboard-empty"
  // …and a form whose Enter sends now, with fields still empty
  const formEmpty = form ? form.fields.filter((f) => !(formValues[f] ?? "").trim()).length : 0
  const formSends = !!form && C.nextEmptyField(form.fields, formValues, formFocus) === -1
  const formVerb = form?.paste ? "paste" : "copy"
  const hint = panelFor && deleteArmed ? (
    // The question on screen, answered in the bar: what Enter does now
    <><Hint k="↵">delete</Hint><Hint k="Esc">cancel</Hint></>
  ) : panelFor ? (
    <><Hint k="↵">run</Hint><Hint k={`1-${panelActions.length}`}>pick</Hint><Hint k="Esc">back</Hint></>
  ) : form ? (
    // Enter in a field goes to the next empty one and sends only when none
    // is left ahead; the bar says which, since it is where the eye checks
    // what Enter does
    // Sending with fields empty is allowed and never silent: the button
    // counts them, and so does the bar, in Warn, in the button's words. The
    // longer label takes the room of copy and newline in a narrow window.
    <>
      {!formSends ? (
        <Hint k="↵">next field</Hint>
      ) : formEmpty ? (
        <Hint k="↵" warn>{`${formVerb} with ${C.plural(formEmpty, "field")} empty`}</Hint>
      ) : (
        <Hint k="↵">{formVerb}</Hint>
      )}
      {form.paste && <Hint k="Ctrl ↵" minor={formSends && formEmpty > 0}>copy</Hint>}
      <Hint k="⇧ ↵" minor={!(formSends && formEmpty > 0)} wider={formSends && formEmpty > 0}>newline</Hint>
      <Hint k="Esc" tiny={formSends && formEmpty > 0}>back</Hint>
    </>
  ) : create ? (
    <><Hint k="↵">save</Hint><Hint k="Esc">back</Hint></>
  ) : clipOpen ? (
    // The clipboard panel: scroll when there is more of it than fits, save
    // it as a prompt, or put it away (Enter too: the row it would paste is
    // under the panel). After a failed paste the recovery stays first: the
    // panel is where the user checks what is on the clipboard, which is
    // the prompt that did not land. The page keys only from 440 px. Beside
    // the recovery Ctrl N leaves the bar (its key cap is on the clipboard
    // line, above the panel), the page keys wait for 500 px and scrolling
    // gives way below 360, so the bar is one line at every width.
    <>
      {notice?.recover && <Hint k="Ctrl V" tiny>in the target</Hint>}
      {clipScrolls && (
        <>
          <Hint k="↑ ↓" minor={!!notice?.recover}>scroll</Hint>
          <Hint k="PgUp PgDn" wide={!notice?.recover} wider={!!notice?.recover}>page</Hint>
        </>
      )}
      {!notice?.recover && <Hint k="Ctrl N">new prompt</Hint>}
      <Hint k="Esc ↵">back</Hint>
    </>
  ) : notice?.recover ? (
    // The paste failed and the prompt is on the clipboard: the bar leads
    // with the recovery, and says Enter no longer pastes
    <><Hint k="Ctrl V" tiny>in the target</Hint><Hint k="↵ Esc">dismiss</Hint></>
  ) : headSel ? (
    // A header is selected: the keys that fold or open it, and leave it
    <>
      {headFolded ? <Hint k="→ ↵">unfold</Hint> : <Hint k="← ↵">fold</Hint>}
      <Hint k="↑ ↓" minor>move</Hint>
      <Hint k="Esc">{notice?.kind === "error" ? "dismiss" : "close"}</Hint>
    </>
  ) : !visible.length ? (
    // No rows: paste, copy, actions and preview have nothing to act on.
    // What can be done is save the clipboard as a prompt, or leave.
    <>
      {!clipEmpty && <Hint k="Ctrl N">new prompt</Hint>}
      <Hint k="Esc">{notice?.kind === "error" ? "dismiss" : "close"}</Hint>
    </>
  ) : selHole ? (
    // Enter on this row pastes a hole where the clipboard should be, and the
    // bar is where the eye checks what Enter does. The longer label takes the
    // room of the hints it pushes out: copy goes below 360 px, actions and
    // preview below 500 px, so the bar stays one line at every width.
    <>
      <Hint k="↵" warn>paste without clipboard</Hint>
      <Hint k="Ctrl ↵" minor>copy</Hint>
      <Hint k="Tab" wider>actions</Hint>
      <Hint k="→" wider>preview</Hint>
      <Hint k="Esc" tiny>{notice?.kind === "error" ? "dismiss" : "close"}</Hint>
    </>
  ) : selSelfWrap ? (
    // The clipboard holds the prompt pasted last, and this row would paste
    // it again inside itself. Rarely meant; said, not blocked, like the
    // empty clipboard, and with the same room rules.
    <>
      <Hint k="↵" warn>paste, wraps last prompt</Hint>
      <Hint k="Ctrl ↵" minor>copy</Hint>
      <Hint k="Tab" wider>actions</Hint>
      <Hint k="→" wider>preview</Hint>
      <Hint k="Esc" tiny>{notice?.kind === "error" ? "dismiss" : "close"}</Hint>
    </>
  ) : keyCard ? (
    // The card is open: what the keys do to it. The page keys only when
    // there is more of it than fits, and both of them: the card opens at
    // the clipboard, which is often its end. Copy is on the card's own
    // button, with its key.
    <>
      <Hint k="↵">paste</Hint>
      {previewScrolls && <Hint k="PgUp PgDn">scroll</Hint>}
      <Hint k="←">back</Hint>
      <Hint k="Esc">{notice?.kind === "error" ? "dismiss" : "close"}</Hint>
    </>
  ) : (
    <>
      <Hint k="↵">paste</Hint>
      <Hint k="Ctrl ↵">copy</Hint>
      <Hint k="Tab" minor>actions</Hint>
      <Hint k="→" minor>preview</Hint>
      {/* ← folds the row's pack or group (Ctrl+→ unfolds all); it was the
          one key with no mention on screen. Room for it only in a widened
          window; the pack and group headers name it in their tooltip */}
      <Hint k="←" wide>fold</Hint>
      {/* The clipboard panel's key; the line's chevron says it opens, this
          says by which key, where there is room for a seventh hint */}
      {!clipEmpty && <Hint k="Ctrl ↓" widest>clipboard</Hint>}
      {/* An error stays until Esc; the bar says so where the strip used to
          append it and get truncated (critique popup P1) */}
      <Hint k="Esc">{notice?.kind === "error" ? "dismiss" : "close"}</Hint>
    </>
  )

  // The line under the search box: what the clipboard holds, since every
  // {clipboard} row pastes it and the row itself only shows the word. Empty
  // is said in words (the rows hollow their icon too); a clipboard that
  // still holds the last pick is named as that prompt, not shown as if it
  // were an error the user copied.
  const anyUsesClip = useMemo(() => [...derived.values()].some((d) => d.clip), [derived])
  const clipLine = (() => {
    // Empty: the fact first, in Warn while it costs something, then what it
    // costs, in the words the hint bar and the action panel use ("paste
    // without clipboard"). It said "{clipboard} rows paste nothing", which
    // they don't: they paste the prompt, with nothing where the clipboard
    // goes; and at 35 characters it was cut short at the default width.
    if (clipEmpty) return { label: "Clipboard is empty", detail: anyUsesClip ? "— prompts paste without it" : null, warn: anyUsesClip, text: null }
    const last = lastSent.current
    const label = last && last.text === clip ? (last.verb === "pasted" ? "Last pasted prompt" : "Last copied prompt") : "Clipboard"
    // In Warn while the selected row would wrap that prompt in itself
    return { label, detail: null, warn: selSelfWrap, text: C.clipboardPreview(clip) }
  })()

  // What a screen reader hears when the state changes (UM14)
  // What the list says when it has no rows: a first run, a filter that
  // excludes everything, or a query nothing answers
  const emptyText = !snippets.length
    ? "No prompts yet — copy some text and press Ctrl+N to save it as one, or left-click the Promptline tray icon to open the manager"
    : parsed.tags.length || parsed.packs.length || parsed.groups.length
      ? "No matches — #tag, @pack and >group terms narrow the list; remove one to widen it"
      : clipEmpty
        ? "No matches"
        : "No matches — Ctrl+N saves the clipboard as a new prompt"

  // The strip's Undo button, and the keys it can honestly show: the form,
  // the create view and the action panel take the keyboard for themselves;
  // bare U is the list's, in the session that deleted, while nothing is typed
  const onUndo = () => {
    void undoDelete()
    inputRef.current?.focus()
  }
  const undoKeys =
    panelFor || form || create ? [] : notice?.undo === "fresh" && query === "" ? ["U", "Ctrl+Z"] : ["Ctrl+Z"]

  // The armed item keeps focus and only changes its label, which a screen
  // reader does not re-read; the status region says the question
  const announce = panelFor
    ? deleteArmed
      ? `Really delete ${panelFor.title}? Enter deletes it, Escape cancels`
      : `Actions for ${panelFor.title}`
    : form
      ? `Fill in ${C.plural(form.fields.length, "field")} for ${form.snippet.title}`
      : create
        ? "New prompt from clipboard"
        : clipOpen
          ? `Clipboard, ${C.plural(C.lineCount(clip), "line")}`
        : // Any query narrows the list, a #tag as much as a word; and one
          // prompt matches, it doesn't "match"
          // With no rows it says what the list says: that message sits in
          // the listbox, where only options are read, so it was never heard
          !visible.length
          ? emptyText
          : query.trim()
            ? visible.length === 1 ? "1 prompt matches" : `${visible.length} prompts match`
            : foldedCount
              ? `${C.plural(visible.length, "prompt")}, ${C.plural(foldedCount, "section")} folded`
              : C.plural(visible.length, "prompt")

  // --- Create-from-clipboard confirmation --------------------------------------
  if (create) {
    return (
      <Shell hint={hint} notice={notice} announce={announce} onUndo={onUndo} undoKeys={undoKeys}>
        {/* The fields scroll; Save does not. At the minimum height the
            button used to be the last thing in the scroller, below the fold
            of a form whose hint bar said Enter saves. */}
        <div
          className="flex min-h-0 flex-1 flex-col gap-2"
          // Enter saves from any field, as the hint bar promises: the pack and
          // group selects have no Enter of their own, and the document listener
          // stays out of this view. Arrow keys reach the selects untouched, and
          // a focused button keeps its native Enter (that is already a click).
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing || e.target instanceof HTMLButtonElement) return
            e.preventDefault()
            // Saving unmounts this view; the same keydown must not reach the
            // document listener and be taken for a list pick
            e.stopPropagation()
            void saveCreate()
          }}
        >
          {/* Boxes (fields, the preview, the button) run edge to edge like
              the search box; loose text (headings, labels, notes) starts 8 px
              in, like a row's. The scroller bleeds 4 px into the shell's
              padding so a field's focus ring, drawn outside it, isn't clipped */}
          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-1">
          <SectionHeader>New prompt from clipboard</SectionHeader>
          <div>
            {/* Real labels, as the fill-in form's: a screen reader names each control */}
            <label htmlFor="create-title" className="mb-1 block px-2 text-xs font-medium tracking-[0.04em] text-muted-foreground">Title</label>
            <input
              id="create-title"
              autoFocus
              value={create.title}
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setCreate((c) => c && { ...c, title: e.target.value })}
              className={cn(fieldVariants(), "w-full")}
            />
          </div>
          <div>
            <label htmlFor="create-pack" className="mb-1 block px-2 text-xs font-medium tracking-[0.04em] text-muted-foreground">Pack</label>
            <Select
              id="create-pack"
              value={create.pack}
              onChange={(e) => setCreate((c) => c && { ...c, pack: e.target.value, group: "" })}
            >
              {packNames.map((p) => (
                <option key={p} value={p} disabled={isLocked(p)}>
                  {isLocked(p) ? `🔒 ${p}` : p}
                </option>
              ))}
            </Select>
          </div>
          {(() => {
            // Groups already in the chosen pack; a group is a label so any is fine
            const gs = [...new Set(snippets.filter((s) => s.pack === create.pack && s.group).map((s) => s.group))].sort(
              (a, b) => a.localeCompare(b)
            )
            if (!gs.length) return null
            return (
              <div>
                <label htmlFor="create-group" className="mb-1 block px-2 text-xs font-medium tracking-[0.04em] text-muted-foreground">Group</label>
                <Select
                  id="create-group"
                  value={create.group}
                  onChange={(e) => setCreate((c) => c && { ...c, group: e.target.value })}
                >
                  <option value="">No group</option>
                  {gs.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </div>
            )
          })()}
          <SectionHeader>Prompt body — current clipboard</SectionHeader>
          <div className={cn(PREVIEW_BOX, "min-h-15 flex-1 overflow-y-auto")}>
            {clip || "(clipboard is empty)"}
          </div>
          {/* The clipboard is the body: with nothing copied there is nothing
              to save, and an empty draft would only be swept by the manager */}
          {!clip && (
            <div className="px-2 text-xs text-destructive">Copy something first — the clipboard is the prompt body</div>
          )}
          </div>
          <Button size="lg" className="shrink-0" onClick={() => void saveCreate()} disabled={!clip}>
            Save prompt
          </Button>
        </div>
      </Shell>
    )
  }

  // --- Form mode ----------------------------------------------------------------
  if (form) {
    // An empty field pastes an empty hole — allowed (a deliberate blank is
    // legitimate) but never silent: the field says so in its placeholder, the
    // preview keeps its chip, and the button counts them. Quietly: red on
    // every field of a new form shouted at a state that is only unfinished.
    const emptyCount = form.fields.filter((f) => !(formValues[f] ?? "").trim()).length
    const verb = form.paste ? "Paste" : "Copy"
    const submitLabel =
      emptyCount === 0 ? verb : `${verb} with ${C.plural(emptyCount, "field")} empty`
    return (
      <Shell hint={hint} notice={notice} announce={announce} onUndo={onUndo} undoKeys={undoKeys}>
        {/* Fields and preview scroll; the button stays in reach below them */}
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-1">
          <SectionHeader name>{form.snippet.title}</SectionHeader>
          {form.fields.map((f, i) => (
            <div key={f}>
              <label htmlFor={`field-${f}`} className="mb-0.5 block px-2 text-xs font-medium tracking-[0.04em] text-muted-foreground">
                {C.fieldLabel(f)}
              </label>
              <textarea
                id={`field-${f}`}
                autoFocus={i === 0}
                // Sized by its content (wrapped lines too, not just
                // newlines) from one line to exactly three, then scrolls;
                // the padding above the first line and below the last is
                // the same at every height
                rows={1}
                value={formValues[f] ?? ""}
                placeholder="Empty — pastes nothing"
                spellCheck={false}
                onChange={(e) => setFormValues((v) => ({ ...v, [f]: e.target.value }))}
                onFocus={() => setFormFocus(i)}
                onKeyDown={(e) => {
                  // An IME's Enter commits the candidate, not the form
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    // Submitting closes the form; this keydown is spent here
                    // and must not bubble on to the list's Enter
                    e.stopPropagation()
                    // Enter after a value is a reflex, and it used to send
                    // the prompt with every later field a hole (critique
                    // popup 3, P1). While a field ahead is empty Enter goes
                    // there; from the last one it sends, blanks and all.
                    // Ctrl+Enter stays "copy now": it is asked for by name.
                    const next = e.ctrlKey ? -1 : C.nextEmptyField(form.fields, formValues, i)
                    if (next !== -1) {
                      // In a short window the next field is under the fold
                      // of the scroller: bring it and its ring in whole
                      // (the field's scroll margins), not just its top edge
                      const el = document.getElementById(`field-${form.fields[next]}`)
                      el?.focus({ preventScroll: true })
                      el?.scrollIntoView({ block: "nearest" })
                    } else void submitForm(e.ctrlKey)
                  }
                }}
                className={cn(
                  fieldVariants(),
                  "block field-sizing-content max-h-[calc(3lh+1rem)] min-h-[calc(1lh+1rem)] w-full scroll-mt-6 scroll-mb-1 resize-none overflow-y-auto py-2 leading-5 placeholder:text-muted-foreground"
                )}
                aria-describedby={form.configFields.has(f) ? `field-${f}-note` : undefined}
              />
              {form.configFields.has(f) && (
                <div id={`field-${f}-note`} className="mt-0.5 px-2 text-xs text-muted-foreground">
                  A config parameter: set it once in the manager's editor, under Placeholders, and it stops asking
                </div>
              )}
            </div>
          ))}
          {/* A form opened to copy says so here too, as its button does */}
          <SectionHeader>{form.paste ? "Will paste" : "Will copy"}</SectionHeader>
          <div className={cn(PREVIEW_BOX, "min-h-15 flex-1 overflow-y-auto")}>
            <PromptTokens text={C.expandBuiltins(form.base)} clipboard={clip} fieldValues={formValues} />
          </div>
        </div>
        <Button
          size="lg"
          className="shrink-0"
          onClick={(e) => void submitForm(e.ctrlKey)}
          // A button's own Enter is a click, but Ctrl+Enter is not: the bar
          // offers "Ctrl ↵ copy" and it did nothing with focus here
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.ctrlKey) {
              e.preventDefault()
              e.stopPropagation()
              void submitForm(true)
            }
          }}
        >
          {submitLabel}
        </Button>
      </Shell>
    )
  }

  // --- List mode ------------------------------------------------------------------
  const row = (entry: Entry, i: number, underPinned: boolean) => (
    <Row
      key={entry.s.id}
      entry={entry}
      index={i}
      selected={!headSel && i === sel}
      picked={pickedId === entry.s.id}
      compact={compact}
      derived={derived.get(entry.s.id) ?? derive(entry.s)}
      onPick={pick}
      onMove={onItemMouseMove}
      onLeave={onItemMouseLeave}
      onTag={onTagClick}
      activeTags={activeTags}
      previewed={previewIdx === i}
      clipEmpty={clipEmpty}
      underPinned={underPinned}
      queryText={parsed.text}
      slot={slotOf.get(entry.s.id)}
    />
  )

  return (
    <Shell hint={hint} notice={notice} announce={announce} onUndo={onUndo} undoKeys={undoKeys}>
      {/* Search: the same box as the manager's filter */}
      <div role="search" className={searchBoxClass()}>
        <RiSearchLine className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          id="popup-search"
          name="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search  #tag @pack >group"
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-label="Search prompts"
          aria-autocomplete="list"
          aria-expanded={visible.length > 0}
          aria-controls="popup-list"
          aria-activedescendant={headSel ? HEAD_OPTION_ID : visible[sel] ? `row-${visible[sel].s.id}` : undefined}
          aria-describedby={CLIP_LINE_ID}
          className="min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <SearchClear
            label="Clear search"
            onClick={() => {
              setQuery("")
              inputRef.current?.focus()
            }}
          />
        )}
      </div>

      {/* The clipboard, one line: the text on the builtin's tint as in every
          preview, its marks (hidden text, line count) before it so they
          survive the truncation, and at the right the key that saves it as
          a prompt. That key was a 32 px bar of its own under the list
          ("New prompt from clipboard…") on every summon; the clipboard is
          its subject, so it lives on the clipboard's line. The describing
          span leaves the key out, so a row described by the line hears the
          clipboard, not a shortcut. */}
      <div ref={clipLineRef} className="flex h-5 shrink-0 items-center gap-1.5 px-2 text-xs text-muted-foreground">
        <RiClipboardLine className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <span id={CLIP_LINE_ID} className="flex min-w-0 flex-1 items-center gap-1.5">
          {/* The label keeps its width; what follows it gives way: the
              clipboard's text, or, empty, the consequence. At the 320 px
              minimum "Clipboard is empty" is what must survive. */}
          <span className={cn("shrink-0", clipLine.warn && "text-(--warn)")}>{clipLine.label}</span>
          {clipLine.detail && <>{" "}<span className="min-w-0 truncate">{clipLine.detail}</span></>}
          {clipLine.text && (
            <>
              <ClipboardMarks clipboard={clip} />
              {/* On Control grey here, not the built-in tint: in Instrument
                  that tint is the selection's own colour, and the line sits
                  right above the selected row, so two things glowed where
                  DESIGN.md allows one. In a preview, inside the prompt's
                  text, the tint still marks what was inserted. */}
              {/* The text is the panel's handle: a click drops the whole
                  clipboard down under it, and the chevron says it will */}
              <button
                type="button"
                tabIndex={-1}
                aria-expanded={clipOpen}
                aria-controls={clipOpen ? "popup-clipboard" : undefined}
                title={clipOpen ? "Hide the clipboard (Esc)" : "Show the whole clipboard (Ctrl+↓)"}
                className={cn(
                  "focus-ring flex min-w-0 flex-1 cursor-pointer items-center rounded-sm bg-secondary text-left text-foreground hover:bg-hover",
                  clipOpen && "bg-hover"
                )}
                onClick={() => {
                  toggleClip()
                  inputRef.current?.focus()
                }}
              >
                <bdi className="min-w-0 flex-1 truncate px-1">{clipLine.text}</bdi>
                <RiArrowDownSLine
                  aria-hidden
                  className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-150", clipOpen && "rotate-180")}
                />
              </button>
            </>
          )}
        </span>
        <button
          type="button"
          tabIndex={-1}
          // The visible text (the key caps) is part of the name, for anyone
          // who says what they see (WCAG 2.5.3)
          aria-label="New prompt from clipboard (Ctrl N)"
          // Nothing to save from an empty clipboard: the key is drawn
          // unavailable. It still answers, with the strip's "Copy something
          // first", so pressing it is never silent.
          aria-disabled={clipEmpty || undefined}
          title={clipEmpty ? "Copy something first — Ctrl+N saves the clipboard as a new prompt" : "New prompt from clipboard (Ctrl+N)"}
          className={cn("focus-ring flex shrink-0 cursor-pointer items-center rounded-sm hover:bg-hover", clipEmpty && "opacity-50")}
          onClick={openCreate}
        >
          <Keys combo="Ctrl+N" />
        </button>
      </div>

      <div
        ref={listRef}
        id="popup-list"
        role="listbox"
        aria-label="Prompts"
        // No side padding: a row's fill runs edge to edge under the search
        // box, and every strip's content starts 8 px in (the row's own
        // padding). The list was 2 px narrower than the box above it, and
        // five strips began their content on five different lines.
        // The scrollbar's 8 px live in the shell's right padding, reserved
        // whether or not the list scrolls: inside the list they took the
        // rows' right edge 8 px short of the search box's whenever it
        // scrolled, which is nearly always.
        className="-mr-2 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
        onScroll={hidePreview}
      >
        {/* Hidden from assistive tech here (a listbox holds only options);
            the status region says the same words */}
        {foldedCount > 0 && (
          // Hidden from assistive tech like the headers (a listbox holds
          // only options); the status region says the count
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            title="Unfold every pack and group"
            className="mb-1 flex h-5 w-full cursor-pointer select-none items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-hover hover:text-foreground"
            onClick={() => {
              unfoldAll()
              inputRef.current?.focus()
            }}
          >
            <span>{C.plural(foldedCount, "section")} folded</span>
            <Keys combo="Ctrl →" />
            <span>unfold</span>
          </button>
        )}
        {filtered.length === 0 && (
          <div aria-hidden className="px-4 py-4 text-center text-ui text-muted-foreground">{emptyText}</div>
        )}
        {sections.map((sec) => {
          // A pack's rows split like the sidebar: the ungrouped run, then one
          // block per group. Pinned and Results are cross-pack lists in rank
          // order, drawn flat so the drawn order matches `visible` (highlight,
          // arrows, Ctrl+digits); a group label means little there anyway.
          const flat = !sec.collapsible
          const ungrouped = flat ? sec.entries : sec.entries.filter((e) => !e.s.group)
          const groups = new Map<string, Entry[]>()
          if (!flat) {
            for (const e of sec.entries) {
              if (!e.s.group) continue
              if (!groups.has(e.s.group)) groups.set(e.s.group, [])
              groups.get(e.s.group)!.push(e)
            }
          }
          // The app's own Pinned list, not a pack the user named "Pinned"
          // (a pack is collapsible)
          const underPinned = flat && sec.name === "Pinned"
          const rows = (es: Entry[]) => es.map((entry) => row(entry, rowIndex.get(entry.s.id)!, underPinned))
          // The section's glyph sits in the rows' icon column: a chevron on a
          // pack, a pin on Pinned, a magnifier on Results
          const Lead = sec.collapsible ? (sec.isCollapsed ? RiArrowRightSLine : RiArrowDownSLine) : underPinned ? RiPushpinLine : RiSearchLine
          const filtered = sec.collapsible && packActive(sec.name)
          // The keyboard is on this pack's header
          const packSel = !!headSel && headSel.pack === sec.name && headSel.group === undefined
          // What a screen reader hears of a selected header: the header is
          // hidden, so an option says it in its place
          const headOption = (label: string, n: number, folded: boolean) => (
            <div id={HEAD_OPTION_ID} role="option" aria-selected className="sr-only">
              {`${label}, ${folded ? "folded" : "open"}, ${C.plural(n, "prompt")}`}
            </div>
          )
          // A pack title as in the sidebar: the body size at 600 in Graphite,
          // a group's 500 in Ink 2 below it. Weight alone did not part it
          // from a row's 500 title, so the header is a band on Control grey
          // (no row is filled at rest) with its glyph leading, like the
          // sidebar's chevrons. 24 px tall, not 28: four headers above the
          // fold cost a row.
          const headerClass = cn(
            "flex min-w-0 flex-1 select-none items-center gap-1.5 rounded-md px-2 py-0.5 text-left text-ui font-semibold",
            sec.collapsible && "cursor-pointer",
            sec.isCollapsed ? "text-(--heading-strong)/70 hover:text-(--heading-strong)" : "text-(--heading-strong)"
          )
          const headerBody = (
            <>
              <Lead className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{sec.name}</span>
              <Count>{sec.count}</Count>
            </>
          )
          return (
            // Rhythm: 2 px between rows (the rounded fill already parts
            // them), 8 px between packs. It was 6 and 12, a pitch of 50 px
            // for a 44 px row, which showed seven prompts in the default
            // window; the same window now shows nine or ten.
            <div key={sec.name} className="mb-2" role="group" aria-label={sec.name}>
              {/* Pack title, as in the sidebar: a disclosure button (← / Ctrl+→
                  from a row do the same); Pinned / Results are plain headings.
                  Hidden from assistive tech: a listbox may hold only options
                  and groups of them, and these buttons inside it had the tree
                  reported as malformed (audit popup P1). The group above
                  carries the name; the fold and the filter are reachable by
                  keyboard (← / Ctrl+→, typing @pack), and the buttons are
                  tabIndex -1 so nothing hidden is in the tab order. */}
              {/* Sticky, so the pack a row belongs to stays named while it
                  scrolls; the Paper behind the band hides rows passing its
                  rounded corners and the 2 px under it */}
              <div aria-hidden className="sticky top-0 z-10 bg-background pb-0.5">
              {sec.collapsible ? (
                <div
                  data-selected={packSel || undefined}
                  className={cn(
                    "group/hdr flex items-center rounded-md pr-0.5",
                    packSel ? cn("bg-accent", SELECTED_BAR) : filtered ? "bg-(--focus)/10" : "bg-secondary"
                  )}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-expanded={!sec.isCollapsed}
                    title={sec.isCollapsed ? "Unfold (Ctrl+→ unfolds all)" : "Fold (← on a row folds its pack or group)"}
                    className={headerClass}
                    onClick={() => {
                      toggleCollapsed(sec.name)
                      // A mouse click focuses the button even at tabIndex -1;
                      // typing must keep landing in the search box
                      inputRef.current?.focus()
                    }}
                  >
                    {headerBody}
                  </button>
                  {funnel("@", sec.name, filtered)}
                </div>
              ) : (
                <div className={cn(headerClass, "bg-secondary")}>{headerBody}</div>
              )}
              </div>
              {packSel && headOption(sec.name, sec.count, sec.isCollapsed)}
              {!sec.isCollapsed && (
                <div className="flex flex-col gap-0.5">
                  {rows(ungrouped)}
                  {[...groups.entries()].map(([g, es]) => {
                    const key = groupKey(sec.name, g)
                    const gc = effCollapsedGroups.has(key)
                    const GChev = gc ? RiArrowRightSLine : RiArrowDownSLine
                    const gf = groupActive(g)
                    const gSel = !!headSel && headSel.pack === sec.name && headSel.group === g
                    return (
                      // No indent on a group's rows: every title in the
                      // list starts on one edge. The outer edge holds the
                      // glyphs (row icons, the chevrons), the inner one every
                      // name and title; indented, titles sat on two edges
                      // 10 px apart. A hairline runs from the group's name
                      // to its count, so the header reads as a divider and
                      // not as a prompt whose first line is missing.
                      <div key={g} className="flex flex-col gap-0.5" role="group" aria-label={g}>
                        <div
                          aria-hidden
                          data-selected={gSel || undefined}
                          className={cn(
                            "group/hdr flex scroll-mt-7 items-center rounded-md pr-0.5",
                            gSel ? cn("bg-accent", SELECTED_BAR) : gf && "bg-(--focus)/10"
                          )}
                        >
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-expanded={!gc}
                            title={gc ? "Unfold (Ctrl+→ unfolds all)" : "Fold (← on a row folds its pack or group)"}
                            className={cn(
                              // A group name is the user's words: shown as typed, never uppercased
                              "flex min-w-0 flex-1 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-0.5 text-left text-ui font-medium",
                              gc ? "text-(--heading)/70 hover:text-(--heading)" : "text-(--heading)"
                            )}
                            onClick={() => {
                              toggleCollapsedGroup(key)
                              inputRef.current?.focus()
                            }}
                          >
                            <GChev className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 truncate">{g}</span>
                            <span className="h-px min-w-3 flex-1 bg-border" />
                            <Count>{es.length}</Count>
                          </button>
                          {funnel(">", g, gf)}
                        </div>
                        {gSel && headOption(g, es.length, gc)}
                        {!gc && rows(es)}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {previewIdx !== null && visible[previewIdx] && (() => {
        // Anchored to the trigger point: below it when the card fits there,
        // else above it, else on whichever side has more room with the card
        // capped to that room (it scrolls). Clamping alone slid the card up
        // over the row it describes near the bottom of the list (L20). The
        // cap is always the chosen side's room, so the measured height that
        // feeds the next render never exceeds it and the choice holds.
        const pad = 8
        const maxH = 220
        const natural = Math.min(previewH ?? maxH, maxH)
        const width = Math.min(320, window.innerWidth - pad * 2)
        const pos = previewPos ?? { x: 16, y: 56, above: 56 }
        const left = Math.max(pad, Math.min(pos.x, window.innerWidth - width - pad))
        // The floor is the list's bottom edge, not the window's: the card
        // used to hang over the feedback strip and the hint bar, the one
        // place that says which keys act on it
        const list = previewList
        const floor = list ? list.bottom : window.innerHeight - pad
        const roomBelow = floor - pos.y
        const roomAbove = pos.above - pad
        const below = natural <= roomBelow || (natural > roomAbove && roomBelow >= roomAbove)
        let cap = Math.min(maxH, Math.max(60, below ? roomBelow : roomAbove))
        let top = below ? pos.y : Math.max(pad, pos.above - Math.min(natural, cap))
        // A window too short to hold the card on either side of the row (the
        // 320×280 minimum leaves it about 85 px): opened from the keyboard,
        // the card takes the list's place instead. It covers the row it
        // describes, the one case where it may, because it carries that
        // row's whole title; a strip three lines tall showed neither the
        // prompt nor its clipboard. A hover never does this: a card under
        // the pointer would hide the rows the pointer is moving across.
        if (pos.key && list && Math.max(roomBelow, roomAbove) < 120 && natural > cap) {
          top = list.top
          cap = list.bottom - list.top
        }
        return (
          <div
            ref={previewCardRef}
            id="popup-preview"
            // A note, not a tooltip: it holds a button, which a tooltip may not
            role="note"
            aria-label="Preview"
            className="fixed z-10 flex flex-col rounded-xl border border-border bg-(--code-ground) p-2 shadow-(--shadow-pop)"
            style={{ left, top, width, maxHeight: cap }}
            onMouseEnter={() => { if (hideTimer.current) clearTimeout(hideTimer.current) }}
            onMouseLeave={onItemMouseLeave}
          >
            <div
              ref={previewBodyRef}
              className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-ui leading-relaxed text-muted-foreground"
            >
              {/* The whole title: the row cuts a long one and has no tooltip
                  (the hover is this card), so this is where it can be read */}
              <div className="name-label mb-1 break-words">{visible[previewIdx].s.title}</div>
              <PromptTokens
                text={visible[previewIdx].s.text}
                clipboard={clip}
                configValues={visible[previewIdx].s.configValues}
              />
            </div>
            {/* A row of its own under the text, always in view: it trailed
                the prompt's last word like part of the sentence, and scrolled
                away with it. The same copy-only path as Ctrl+↵ (asks for
                fill-ins first), so it carries that key. */}
            <div className="mt-1.5 flex shrink-0 items-center">
              <Button
                variant="secondary"
                size="sm"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  pick(visible[previewIdx].s, false)
                }}
              >
                <RiFileCopyLine aria-hidden />
                Copy
                {/* The key only on the card the keyboard opened: Ctrl+↵
                    copies the selected row, and a hover card is another's */}
                {keyCard && <Keys combo="Ctrl ↵" />}
              </Button>
            </div>
          </div>
        )
      })()}

      {clipOpen && clipLines && clipBox && (
        // Floats over the list, so it has the menu's shadow (it is gone on
        // the next Esc), on the code ground the preview card reads prompts
        // on. Mono, because this is the text as it pastes: indentation,
        // blank lines and line breaks are the point. The gutter numbers
        // the lines (a trace says "line 12"); a single line needs none.
        <div
          id="popup-clipboard"
          role="region"
          aria-label="Clipboard"
          className="fixed inset-x-2 z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-(--code-ground) shadow-(--shadow-pop) duration-150 ease-out animate-in fade-in-0 slide-in-from-top-1"
          style={{ top: clipBox.top, maxHeight: clipBox.room }}
        >
          <div ref={clipBodyRef} className="min-h-0 flex-1 overflow-y-auto py-1.5 font-mono text-xs leading-4 text-foreground [tab-size:4]">
            {clipLines.lines.map((line, i) => (
              <div key={i} className="flex min-w-0">
                {clipLines.total > 1 && (
                  <span
                    aria-hidden
                    className="w-[calc(var(--gutter)*1ch+1rem)] shrink-0 select-none pl-2 pr-2 text-right tabular-nums text-muted-foreground"
                    style={{ "--gutter": String(clipLines.lines.length).length } as React.CSSProperties}
                  >
                    {i + 1}
                  </span>
                )}
                {/* One isolate per line: a right-to-left line reads in its
                    own direction and leaves the next one alone. The
                    controls core revealed (⟨RLO⟩, ⟨ESC⟩) are in Warn, the
                    colour the line's "hidden text" mark uses */}
                <bdi className={cn("min-w-0 flex-1 whitespace-pre-wrap break-words pr-2", clipLines.total === 1 && "pl-2")}>
                  {line
                    ? line.split(/(⟨(?:[A-Z]{2,3}|U\+[0-9A-F]{4})⟩)/).map((part, j) =>
                        j % 2 ? <span key={j} className="text-(--warn)">{part}</span> : part
                      )
                    : "​"}
                </bdi>
              </div>
            ))}
          </div>
          {clipLines.total > clipLines.lines.length && (
            <div className="shrink-0 border-t border-border px-2 py-1 text-xs text-muted-foreground">
              {`First ${clipLines.lines.length} of ${clipLines.total} lines shown; all of them paste`}
            </div>
          )}
        </div>
      )}

      {panelFor && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={`Actions for ${panelFor.title}`}
          // Capped to the window above the hint bar and scrolling: at the
          // minimum height with a larger UI scale its five items are taller
          // than the room, and the top ones were cut off
          className={cn("fixed inset-x-2 bottom-10 z-20 max-h-[calc(100dvh-3rem)] overflow-y-auto", MENU_PANEL)}
        >
          <SectionHeader name>{panelFor.title}</SectionHeader>
          {panelNote && <div role="alert" className="px-2 pb-1 text-xs text-destructive">{panelNote}</div>}
          {panelActions.map((a, i) => (
            <button
              // By position, not label: keyed by label, "Really delete?" was
              // a new button, and the focus it replaced fell to the body
              key={i}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={cn(
                MENU_ITEM,
                "justify-between",
                // Armed, the highlight is the danger's soft fill, not the
                // accent: the item is no longer one choice among five
                i === panelSel && cn(SELECTED_BAR, a.danger && deleteArmed ? "bg-destructive/10 font-medium dark:bg-destructive/15" : "bg-accent"),
                a.danger && "text-destructive"
              )}
              onClick={a.run}
              onMouseMove={() => {
                if (i === panelSel) return
                setDeleteArmed(false)
                setPanelSel(i)
              }}
            >
              <span>{a.label}</span>
              <Kbd>{i + 1}</Kbd>
            </button>
          ))}
        </div>
      )}
    </Shell>
  )
}

// Window chrome: 8px radius, 8px padding, a line-strong edge and the one shadow
function Shell({
  children,
  hint,
  notice,
  announce,
  onUndo,
  undoKeys,
}: {
  children: React.ReactNode
  hint: React.ReactNode
  notice: Notice | null
  /** Puts the last deleted prompt back; the strip's Undo button */
  onUndo?: () => void
  /** The keys that undo right now, drawn on the button; none while a view has the keyboard */
  undoKeys?: readonly string[]
  /** What a screen reader should hear about the current state (results, mode) */
  announce: string
}) {
  return (
    <div className="flex h-dvh flex-col gap-2 overflow-hidden rounded-2xl border border-input bg-background p-2 text-foreground shadow-(--shadow-shell)">
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      {/* The one landmark: the window's content, whichever mode it is in.
          `contents`, so the shell's column layout is unchanged */}
      <main className="contents">{children}</main>
      {/* Feedback strip: errors stay until Esc or the next summon (the hint
          bar says so), confirmations go with the popup. Two live regions: a
          confirmation is polite, an error on a window that has just
          reappeared is an alert. Two lines, not a truncation: the failed
          paste's message is the one that says where the prompt went, and it
          was cut at the default width (critique popup P1). */}
      <div role="status" aria-live="polite" className="shrink-0 empty:hidden">
        {notice?.kind === "info" && !notice.undo && (
          <div className="line-clamp-2 break-words rounded-md bg-primary/15 px-2 py-1 text-ui text-foreground" title={notice.text}>
            {notice.text}
          </div>
        )}
        {/* The undo offer: what was deleted, and a button that carries its
            keys as key caps. It was a sentence naming keys ("U or Ctrl+Z to
            undo") with nothing to click, and it went on naming U while a
            typed query had already taken that key. The title gives way; the
            button never does. */}
        {notice?.kind === "info" && notice.undo && (
          <div className="flex min-w-0 items-center gap-2 rounded-md bg-primary/15 py-1 pl-2 pr-1 text-ui text-foreground">
            <span className="min-w-0 flex-1 truncate" title={notice.text}>{notice.text}</span>
            <button
              type="button"
              tabIndex={-1}
              className="focus-ring flex shrink-0 cursor-pointer items-center gap-1.5 rounded-sm px-1 font-medium hover:bg-hover"
              onClick={onUndo}
            >
              Undo
              {undoKeys?.map((k) => <Keys key={k} combo={k} />)}
            </button>
          </div>
        )}
        {notice?.kind === "success" && (
          <div className="line-clamp-2 break-words px-2 py-1 text-ui font-medium text-(--success)" title={notice.text}>
            {notice.text}
          </div>
        )}
      </div>
      <div role="alert" className="shrink-0 empty:hidden">
        {notice?.kind === "error" && (
          // Three lines, where a confirmation gets two: the failed paste's
          // message ends with how to recover ("press Ctrl+V there…"), and at
          // the 320 px minimum two lines cut it off before that
          <div className="line-clamp-3 break-words rounded-md bg-destructive/15 px-2 py-1 text-ui text-destructive" title={notice.text}>
            {notice.text}
          </div>
        )}
      </div>
      {/* Wraps rather than clips: at 125% scale, or with the mono font, the
          list's five hints are wider than the window and the shell's
          overflow-hidden used to eat the last of them */}
      <div className="@container flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-border px-2 pt-2 font-mono text-micro text-muted-foreground">
        {hint}
      </div>
    </div>
  )
}
