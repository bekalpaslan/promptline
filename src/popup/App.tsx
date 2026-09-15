import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { SizeDebug } from "@/lib/SizeDebug"
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiClipboardLine,
  RiCloseLine,
  RiEdit2Line,
  RiFileTextLine,
  RiPushpinFill,
  RiSearchLine,
} from "@remixicon/react"
import { C, type Library, type PackMeta, type Snippet, type SnippetPatch } from "@/lib/core"
import { applyPrefs, isCompact } from "@/lib/prefs"
import { type Config, DEFAULT_PACK, MAX_PINS, TOKEN_CHIP, defaultPackFor, isLockedIn, packNames as packNamesOf } from "@/lib/library"
import { cn } from "@/lib/utils"
import { Kbd as UiKbd } from "@/components/ui/kbd"


type Entry = { s: Snippet; indices: number[] | null }
type FormState = { snippet: Snippet; base: string; fields: string[]; paste: boolean }
type PanelAction = { label: string; danger?: boolean; run: () => void }
type CreateState = { title: string; pack: string; group: string; prefilled: string }
// One line of feedback above the hint bar: the popup's only channel for an
// error (a failed paste or save) or a confirmation (copied, saved)
type Notice = { text: string; kind: "error" | "info" }


// The shared Kbd in the kit's 16px bordered-square idiom
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <UiKbd className="h-4 min-w-4 shrink-0 rounded-sm border border-border bg-background px-0.5 text-xs font-normal text-muted-foreground">
      {children}
    </UiKbd>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-0.5 pt-1.5 text-xs font-medium tracking-[0.04em] text-muted-foreground">
      {children}
    </div>
  )
}

// Tokenized prompt text: placeholders render as typed chips
function Tokens({ text }: { text: string }) {
  return (
    <>
      {C.tokenize(text).map((part, i) => {
        if (part.type === "text") return <span key={i}>{part.value}</span>
        const label =
          part.type === "builtin" ? part.name :
          part.type === "field" ? `${part.name} — fill-in` :
          part.type === "config" ? `${part.name} — config` :
          `${part.name} — invalid`
        return (
          <span
            key={i}
            className={cn("rounded-sm px-1 text-xs font-semibold", TOKEN_CHIP[part.type])}
          >
            {label}
          </span>
        )
      })}
    </>
  )
}

// The kit highlights matched characters with an underline. Segments come
// from core so UTF-16 match indices line up with code points (emoji).
function HighlightedTitle({ title, indices }: { title: string; indices: number[] | null }) {
  if (!indices?.length) return <span className="truncate">{title}</span>
  return (
    <span className="truncate">
      {C.highlightSegments(title, indices).map((seg, i) => (
        <span key={i} className={seg.hit ? "underline decoration-solid underline-offset-2" : undefined}>
          {seg.text}
        </span>
      ))}
    </span>
  )
}

// Per-snippet facts that don't change between renders: computed once per
// library load, not once per row per keystroke
type Derived = { inputs: string[]; Icon: typeof RiFileTextLine }
function derive(s: Snippet): Derived {
  const inputs = C.requiredInputs(s)
  const Icon = s.pinned ? RiPushpinFill : inputs.length ? RiEdit2Line : s.text.includes("{clipboard}") ? RiClipboardLine : RiFileTextLine
  return { inputs, Icon }
}

// One list row. Memoized so an arrow key re-renders only the two rows whose
// `selected` changed, not every visible row.
const Row = memo(function Row({
  entry,
  index,
  selected,
  picked,
  compact,
  derived,
  onPick,
  onMove,
  onLeave,
  onTag,
  previewed,
  clipEmpty,
}: {
  entry: Entry
  index: number
  selected: boolean
  picked: boolean
  compact: boolean
  derived: Derived
  onPick: (s: Snippet, paste: boolean) => void
  onMove: (i: number, e: React.MouseEvent) => void
  onLeave: () => void
  onTag: (tag: string) => void
  /** The preview card is open for this row (it describes the row) */
  previewed: boolean
  /** Clipboard is empty, so a `{clipboard}` prompt would paste a hole */
  clipEmpty: boolean
}) {
  const { s, indices } = entry
  const tags = s.tags || []
  const { inputs, Icon } = derived
  const usesClip = clipEmpty && s.text.includes("{clipboard}")
  return (
    <div
      id={`row-${s.id}`}
      role="option"
      aria-selected={selected}
      aria-describedby={previewed ? "popup-preview" : undefined}
      title={usesClip ? "Clipboard is empty — {clipboard} will paste nothing" : s.title}
      data-selected={selected}
      className={cn(
        "flex min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-ui font-semibold",
        compact ? "py-1" : "py-1.5",
        selected ? "bg-accent text-foreground" : "text-muted-foreground hover:border-ring/40 hover:text-foreground",
        picked && "bg-primary/20"
      )}
      onClick={(e) => onPick(s, !e.ctrlKey)}
      onMouseMove={(e) => onMove(index, e)}
      onMouseLeave={onLeave}
    >
      <Icon className={cn("size-3.5 shrink-0", s.pinned ? "text-(--warn)" : "opacity-70")} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="flex min-w-0 items-center">
          <HighlightedTitle title={s.title} indices={indices} />
        </span>
        {!compact && (
          <span className="truncate text-xs font-normal text-muted-foreground">{s.text.replace(/\s+/g, " ")}</span>
        )}
      </div>
      {tags.slice(0, 1).map((tag) => {
        const c = C.tagColor(tag)
        return (
          <button
            key={tag}
            type="button"
            tabIndex={-1}
            className="flex h-4 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-sm border px-1 text-xs tag-text tag-border dark:tag-text-dark dark:tag-border-dark"
            style={{ "--tag": c } as React.CSSProperties}
            title={`Filter by #${tag}`}
            aria-label={`Filter by #${tag}`}
            onClick={(e) => {
              e.stopPropagation()
              onTag(tag)
            }}
          >
            {tag}
          </button>
        )
      })}
      {inputs.length > 0 && (
        <span
          className="flex h-4 shrink-0 items-center rounded-sm border border-(--warn)/40 px-1 text-xs tabular-nums text-(--warn)"
          title={`Asks for ${inputs.length} value${inputs.length === 1 ? "" : "s"} before pasting: ${inputs.join(", ")}`}
        >
          {"{"}{inputs.length}{"}"}
        </span>
      )}
      {index < 5 && (
        <span className="flex shrink-0 gap-1">
          <Kbd>Ctrl</Kbd>
          <Kbd>{index + 1}</Kbd>
        </span>
      )}
    </div>
  )
})

export function App() {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [clip, setClip] = useState("")
  const [query, setQuery] = useState("")
  const [sel, setSel] = useState(0)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [panelSel, setPanelSel] = useState(0)
  const [panelFor, setPanelFor] = useState<Snippet | null>(null)
  const [panelNote, setPanelNote] = useState<string | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)
  // Where the preview card anchors its top-left corner: the cursor on hover,
  // the selected row on keyboard →
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number } | null>(null)
  // The card's measured height, so a short card near the bottom is clamped by
  // what it takes up rather than by its max; null until the card is measured
  const previewCardRef = useRef<HTMLDivElement>(null)
  const [previewH, setPreviewH] = useState<number | null>(null)
  const [compact, setCompact] = useState(isCompact())
  const [packMeta, setPackMeta] = useState<PackMeta[]>([])
  const [create, setCreate] = useState<CreateState | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  // The popup's own undo: the last deleted prompt, offered for a few seconds
  // (D8: popup-local, so it works with the manager closed)
  const lastDeleted = useRef<{ snippet: Snippet; timer: ReturnType<typeof setTimeout> } | null>(null)
  // Escape in create mode with an edited title asks once before discarding
  const createEscArmed = useRef(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Keyboard/mouse arbitration: ignore hover-selection during keyboard nav and
  // when the list scrolls under a stationary cursor
  const suppressHoverUntil = useRef(0)
  const lastMouse = useRef({ x: -1, y: -1 })
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ranking is a pure core function (tested); this only memoizes it
  const filtered = useMemo<Entry[]>(() => C.rankSnippets(query, snippets), [snippets, query])
  const derived = useMemo(() => new Map(snippets.map((s) => [s.id, derive(s)])), [snippets])

  const hasQuery = !!C.parseQuery(query).text

  // Browsing groups by pack (collapsible); searching stays a flat ranked list.
  // `visible` is what the keyboard navigates — collapsed packs drop out of it.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("popupCollapsedPacks") || "[]"))
    } catch {
      return new Set()
    }
  })
  const toggleCollapsed = useCallback((name: string) => {
    const next = new Set(collapsed)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setCollapsed(next)
    localStorage.setItem("popupCollapsedPacks", JSON.stringify([...next]))
    setSel(0)
  }, [collapsed])

  type Section = { name: string; entries: Entry[]; collapsible: boolean; isCollapsed: boolean }
  const { sections, visible } = useMemo(() => {
    if (hasQuery) {
      const sections: Section[] =
        filtered.length > 0 ? [{ name: "Results", entries: filtered, collapsible: false, isCollapsed: false }] : []
      return { sections, visible: filtered }
    }
    const pinned = filtered.filter((e) => e.s.pinned)
    const rest = filtered.filter((e) => !e.s.pinned)
    const map = new Map<string, Entry[]>()
    for (const e of rest) {
      const key = e.s.pack || DEFAULT_PACK
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    // Within a pack: ungrouped prompts first, then groups alphabetically, so
    // the list can render a sub-header wherever the group changes. Sorted
    // here so keyboard order (visible) matches what is drawn (sections).
    const byGroup = (a: Entry, b: Entry) =>
      (a.s.group ? 1 : 0) - (b.s.group ? 1 : 0) || (a.s.group || "").localeCompare(b.s.group || "")
    const packs = [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([n, es]) => [n, [...es].sort(byGroup)] as [string, Entry[]])
    const sections: Section[] = []
    if (pinned.length) sections.push({ name: "Pinned", entries: pinned, collapsible: false, isCollapsed: false })
    for (const [name, entries] of packs)
      sections.push({ name, entries, collapsible: true, isCollapsed: collapsed.has(name) })
    const visible = [...pinned, ...packs.flatMap(([n, es]) => (collapsed.has(n) ? [] : es))]
    return { sections, visible }
  }, [filtered, hasQuery, collapsed])

  // Row index within `visible`, for selection/ordinals
  const rowIndex = useMemo(() => new Map(visible.map((e, i) => [e.s.id, i])), [visible])

  // Collapsing can strand the selection past the end
  useEffect(() => {
    if (sel >= visible.length && visible.length > 0) setSel(visible.length - 1)
  }, [sel, visible.length])

  const packNames = useMemo(() => packNamesOf(packMeta, snippets, { always: true }), [packMeta, snippets])
  const isLocked = useCallback((name: string) => isLockedIn(packMeta, name), [packMeta])

  const hidePreview = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setPreviewIdx(null)
  }, [])

  const closePanel = useCallback(() => {
    setPanelFor(null)
    setPanelNote(null)
    setDeleteArmed(false)
    setPanelSel(0)
  }, [])

  const fail = useCallback((what: string, e: unknown) => {
    setNotice({ text: `Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`, kind: "error" })
  }, [])

  const send = useCallback(async (snippet: Snippet, text: string, paste: boolean) => {
    try {
      await invoke("paste_snippet", { text, paste, id: snippet.id })
    } catch (e) {
      // Rust writes the clipboard before hiding, so on failure the popup is
      // still on screen to show this
      fail(paste ? "paste" : "copy", e)
      return
    }
    if (!paste) {
      // Copy-only: Rust leaves the popup up; confirm, then hide
      setNotice({ text: "Copied to clipboard", kind: "info" })
      setTimeout(() => void invoke("hide_popup"), 600)
    }
  }, [fail])

  // --- Create prompt from clipboard -------------------------------------------
  const openCreate = useCallback(() => {
    hidePreview()
    closePanel()
    const firstLine = clip.trim().split(/\r?\n/)[0] ?? ""
    // Prefer the pack that last received a prompt (one rule with the manager)
    const pack = defaultPackFor(packMeta, snippets)
    createEscArmed.current = false
    setCreate({
      title: firstLine.slice(0, 40) || "New prompt",
      pack,
      group: "",
      prefilled: firstLine.slice(0, 40) || "New prompt",
    })
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
      fieldValues: {},
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
    setNotice({ text: `Saved "${snip.title}" to ${create.pack}${create.group ? ` › ${create.group}` : ""}`, kind: "info" })
  }, [create, clip, fail])

  // One prompt's pin state or remembered fill-ins, merged on disk.
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

  const pick = useCallback((snippet: Snippet, paste: boolean) => {
    hidePreview()
    closePanel()
    let base = C.expandConfig(snippet.text, snippet.configValues)
    // Unset config params become fill-in fields instead of pasting holes
    base = C.downgradeUnsetConfig(base)
    const fields = C.customFields(base)
    if (fields.length) {
      const initial: Record<string, string> = {}
      for (const f of fields) initial[f] = (snippet.fieldValues || {})[f] || ""
      setFormValues(initial)
      setForm({ snippet, base, fields, paste })
      return
    }
    setPickedId(snippet.id)
    setTimeout(() => send(snippet, C.expandBuiltins(base), paste), 90)
  }, [hidePreview, closePanel, send])

  const submitForm = useCallback(async (forceCopy: boolean) => {
    if (!form) return
    // A function replacer in core: a value containing `$&` or `$$` must paste
    // as typed, not as a replacement pattern
    const text = C.fillFields(form.base, formValues)
    const { snippet } = form
    const paste = forceCopy ? false : form.paste
    setForm(null)
    // Remember entered values so next time the form is pre-filled.
    // Sequenced: paste_snippet re-reads the file to bump the use count. A
    // failed save is reported but must not stop the paste.
    await patch(snippet.id, { fieldValues: { ...formValues } })
    await send(snippet, C.expandBuiltins(text), paste)
  }, [form, formValues, patch, send])

  const togglePin = useCallback(async (s: Snippet) => {
    if (!s.pinned && snippets.filter((x) => x.pinned).length >= MAX_PINS) {
      setPanelNote(`Max ${MAX_PINS} pins — unpin something first`)
      return
    }
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
    if (lastDeleted.current) clearTimeout(lastDeleted.current.timer)
    lastDeleted.current = {
      snippet: s,
      timer: setTimeout(() => {
        lastDeleted.current = null
        setNotice((n) => (n?.text.startsWith("Deleted ") ? null : n))
      }, 8000),
    }
    setNotice({ text: `Deleted "${s.title}" — U to undo`, kind: "info" })
  }, [closePanel, fail])

  // Put the last deleted prompt back, with everything it had (same id, uses,
  // pins, remembered fill-ins): add_snippet replaces by id
  const undoDelete = useCallback(async () => {
    const last = lastDeleted.current
    if (!last) return
    clearTimeout(last.timer)
    lastDeleted.current = null
    try {
      const lib = await invoke<Library>("add_snippet", { snippet: last.snippet })
      setSnippets(lib.snippets)
      setNotice({ text: `Restored "${last.snippet.title}"`, kind: "info" })
    } catch (e) {
      fail("restore", e)
    }
  }, [fail])

  const panelActions = useMemo<PanelAction[]>(() => {
    if (!panelFor) return []
    return [
      { label: "Paste", run: () => pick(panelFor, true) },
      { label: "Copy only", run: () => pick(panelFor, false) },
      { label: panelFor.pinned ? "Unpin" : "Pin", run: () => void togglePin(panelFor) },
      { label: "Edit in manager", run: () => void invoke("edit_in_manager", { id: panelFor.id }) },
      {
        label: deleteArmed ? "Confirm delete?" : "Delete",
        danger: true,
        run: () => (deleteArmed ? void deleteSnippet(panelFor) : setDeleteArmed(true)),
      },
    ]
  }, [panelFor, deleteArmed, pick, togglePin, deleteSnippet])

  const reload = useCallback(async () => {
    applyPrefs()
    setCompact(isCompact())
    closePanel()
    setForm(null)
    setCreate(null)
    setNotice(null)
    if (lastDeleted.current) clearTimeout(lastDeleted.current.timer)
    lastDeleted.current = null
    hidePreview()
    setPickedId(null)
    setQuery("")
    setSel(0)
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
    } catch (e) {
      fail("load the library", e)
    }
  }, [closePanel, hidePreview, fail])

  useEffect(() => {
    const un = listen("popup-shown", () => void reload())
    void reload()
    return () => void un.then((f) => f())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { setSel(0) }, [query])

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

  // Keep the selected row in view
  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" })
  }, [sel, visible])

  // --- Keyboard ---------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (panelFor) {
        if (e.key === "Escape") { e.preventDefault(); closePanel() }
        else if (e.key === "ArrowDown") { e.preventDefault(); setPanelSel((p) => (p + 1) % panelActions.length) }
        else if (e.key === "ArrowUp") { e.preventDefault(); setPanelSel((p) => (p - 1 + panelActions.length) % panelActions.length) }
        else if (e.key === "Enter") { e.preventDefault(); panelActions[panelSel]?.run() }
        else if (/^[1-9]$/.test(e.key)) { e.preventDefault(); panelActions[Number(e.key) - 1]?.run() }
        else if (e.key === "Tab") { e.preventDefault(); closePanel() }
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
      if (e.key.toLowerCase() === "u" && !e.ctrlKey && !e.altKey && !e.metaKey && lastDeleted.current) {
        e.preventDefault()
        void undoDelete()
        return
      }
      if (e.ctrlKey && /^[1-5]$/.test(e.key)) {
        e.preventDefault()
        const entry = visible[Number(e.key) - 1]
        if (entry) pick(entry.s, true)
        return
      }
      if (e.ctrlKey && e.key.toLowerCase() === "n") {
        e.preventDefault()
        openCreate()
        return
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        hidePreview()
        suppressHoverUntil.current = Date.now() + 250
      }
      if (e.key === "ArrowRight" && e.ctrlKey && collapsed.size) {
        // Keyboard path for the pack headers (with ← below): Ctrl+→ expands
        // every collapsed pack, since collapsed rows leave `visible` and
        // there is no row to expand from
        e.preventDefault()
        setCollapsed(new Set())
        localStorage.setItem("popupCollapsedPacks", "[]")
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        if (visible.length) setSel((s) => (s + 1) % visible.length)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        if (visible.length) setSel((s) => (s - 1 + visible.length) % visible.length)
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
          setPreviewPos(rect ? { x: rect.left + 16, y: rect.bottom + 4 } : null)
          setPreviewIdx(sel)
        }
      } else if (e.key === "ArrowLeft" && previewIdx !== null) {
        e.preventDefault()
        hidePreview()
      } else if (e.key === "ArrowLeft" && !hasQuery && visible[sel] && !visible[sel].s.pinned) {
        // ← collapses the selected row's pack
        e.preventDefault()
        toggleCollapsed(visible[sel].s.pack || DEFAULT_PACK)
      } else if (e.key === "Tab") {
        e.preventDefault()
        if (visible[sel]) { hidePreview(); setPanelFor(visible[sel].s); setPanelSel(0) }
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (visible[sel]) pick(visible[sel].s, !e.ctrlKey)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [panelFor, panelActions, panelSel, form, create, notice, visible, sel, previewIdx, pick, openCreate, closePanel, hidePreview, undoDelete, hasQuery, collapsed, toggleCollapsed])

  // Stable handlers for the memoized rows: they read the live selection and
  // preview index through refs instead of closing over them
  const selRef = useRef(sel)
  selRef.current = sel
  const previewRef = useRef(previewIdx)
  previewRef.current = previewIdx
  const onItemMouseMove = useCallback((i: number, e: React.MouseEvent) => {
    const moved = e.clientX !== lastMouse.current.x || e.clientY !== lastMouse.current.y
    lastMouse.current = { x: e.clientX, y: e.clientY }
    if (!moved || Date.now() < suppressHoverUntil.current) return
    if (selRef.current !== i) setSel(i)
    if (previewRef.current !== i) {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hoverTimer.current = setTimeout(() => {
        setPreviewPos({ x: lastMouse.current.x + 12, y: lastMouse.current.y + 12 })
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
  }, [previewIdx, previewPos])
  const onTagClick = useCallback((tag: string) => {
    setQuery(`#${tag} `)
    inputRef.current?.focus()
  }, [])

  // --- Hint bar (kit kbd-chip idiom) -------------------------------------------
  const hint = panelFor ? (
    <><Kbd>↵</Kbd> run <Kbd>1-9</Kbd> pick <Kbd>Esc</Kbd> back</>
  ) : form ? (
    <><Kbd>↵</Kbd> paste <Kbd>Ctrl ↵</Kbd> copy <Kbd>⇧ ↵</Kbd> newline <Kbd>Esc</Kbd> back</>
  ) : create ? (
    <><Kbd>↵</Kbd> save <Kbd>Esc</Kbd> back</>
  ) : (
    <><Kbd>↵</Kbd> paste <Kbd>Ctrl ↵</Kbd> copy <Kbd>Tab</Kbd> actions <Kbd>→</Kbd> preview <Kbd>Esc</Kbd> close</>
  )

  // What a screen reader hears when the state changes (UM14)
  const announce = panelFor
    ? `Actions for ${panelFor.title}`
    : form
      ? `Fill in ${form.fields.length} field${form.fields.length === 1 ? "" : "s"} for ${form.snippet.title}`
      : create
        ? "New prompt from clipboard"
        : `${visible.length} prompt${visible.length === 1 ? "" : "s"}${hasQuery ? " match" : ""}`

  // --- Create-from-clipboard confirmation --------------------------------------
  if (create) {
    return (
      <Shell hint={hint} notice={notice} announce={announce}>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-1">
          <SectionHeader>New prompt from clipboard</SectionHeader>
          <div className="px-1">
            <label className="mb-1 block text-xs font-medium tracking-[0.04em] text-muted-foreground">Name</label>
            <input
              autoFocus
              value={create.title}
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setCreate((c) => c && { ...c, title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void saveCreate()
                }
              }}
              className="w-full rounded-lg border-2 border-input bg-background px-2 py-1.5 text-ui text-foreground outline-none focus:border-(--focus)"
            />
          </div>
          <div className="px-1">
            <label className="mb-1 block text-xs font-medium tracking-[0.04em] text-muted-foreground">Pack</label>
            <select
              value={create.pack}
              onChange={(e) => setCreate((c) => c && { ...c, pack: e.target.value, group: "" })}
              className="w-full cursor-pointer rounded-lg bg-secondary px-2 py-1.5 text-ui text-foreground focus-ring"
            >
              {packNames.map((p) => (
                <option key={p} value={p} disabled={isLocked(p)}>
                  {isLocked(p) ? `🔒 ${p}` : p}
                </option>
              ))}
            </select>
          </div>
          {(() => {
            // Groups already in the chosen pack; a group is a label so any is fine
            const gs = [...new Set(snippets.filter((s) => s.pack === create.pack && s.group).map((s) => s.group))].sort(
              (a, b) => a.localeCompare(b)
            )
            if (!gs.length) return null
            return (
              <div className="px-1">
                <label className="mb-1 block text-xs font-medium tracking-[0.04em] text-muted-foreground">Group</label>
                <select
                  value={create.group}
                  onChange={(e) => setCreate((c) => c && { ...c, group: e.target.value })}
                  className="w-full cursor-pointer rounded-lg bg-secondary px-2 py-1.5 text-ui text-foreground focus-ring"
                >
                  <option value="">No group</option>
                  {gs.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            )
          })()}
          <SectionHeader>Prompt body — current clipboard</SectionHeader>
          <div className="min-h-15 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-accent/50 p-2 text-xs leading-relaxed text-muted-foreground">
            {clip || "(clipboard is empty)"}
          </div>
          {/* The clipboard is the body: with nothing copied there is nothing
              to save, and an empty draft would only be swept by the manager */}
          {!clip && (
            <div className="px-1 text-xs text-destructive">Copy something first — the clipboard is the prompt body</div>
          )}
          <button
            onClick={() => void saveCreate()}
            disabled={!clip}
            className="h-8 cursor-pointer rounded-lg bg-primary text-ui font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save prompt
          </button>
        </div>
      </Shell>
    )
  }

  // --- Form mode ----------------------------------------------------------------
  if (form) {
    // An empty field pastes an empty hole — allowed (a deliberate blank is
    // legitimate) but never silent: the field is outlined and the button
    // says so
    const emptyCount = form.fields.filter((f) => !(formValues[f] ?? "").trim()).length
    const verb = form.paste ? "Paste" : "Copy"
    const submitLabel =
      emptyCount === 0 ? verb : `${verb} with ${emptyCount} field${emptyCount === 1 ? "" : "s"} empty`
    return (
      <Shell hint={hint} notice={notice} announce={announce}>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-1">
          <SectionHeader>{form.snippet.title}</SectionHeader>
          {form.fields.map((f, i) => {
            const remembered = (form.snippet.fieldValues || {})[f]
            const empty = !(formValues[f] ?? "").trim()
            return (
              <div key={f} className="px-1">
                <label htmlFor={`field-${f}`} className="mb-1 flex items-center gap-1.5 text-xs font-medium capitalize tracking-[0.04em] text-muted-foreground">
                  {f.replace(/_/g, " ")}
                  {remembered && <Kbd>last used</Kbd>}
                  {empty && <span className="normal-case text-destructive">empty — pastes nothing</span>}
                </label>
                <textarea
                  id={`field-${f}`}
                  aria-invalid={empty || undefined}
                  autoFocus={i === 0}
                  rows={remembered ? Math.min(4, remembered.split("\n").length) : 1}
                  value={formValues[f] ?? ""}
                  spellCheck={false}
                  onFocus={(e) => { if (remembered) e.currentTarget.select() }}
                  onChange={(e) => setFormValues((v) => ({ ...v, [f]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      void submitForm(e.ctrlKey)
                    }
                  }}
                  className={cn(
                    "min-h-8 w-full resize-none rounded-lg border-2 bg-background px-2 py-1.5 text-ui text-foreground outline-none placeholder:text-muted-foreground focus:border-(--focus)",
                    empty ? "border-destructive/60" : "border-input"
                  )}
                />
              </div>
            )
          })}
          <SectionHeader>Will paste</SectionHeader>
          <div className="min-h-15 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-accent/50 p-2 text-xs leading-relaxed text-muted-foreground">
            {C.tokenize(C.expandBuiltins(form.base)).map((part, i) => {
              if (part.type === "text") return <span key={i}>{part.value}</span>
              if (part.type === "field" && formValues[part.name]) {
                return <span key={i} className="rounded-sm bg-(--param-field-bg) px-0.5 text-foreground">{formValues[part.name]}</span>
              }
              if (part.type === "builtin" && part.name === "clipboard") {
                return <span key={i} className="rounded-sm bg-(--param-builtin-bg) px-0.5 text-foreground">{clip || "(clipboard is empty)"}</span>
              }
              if (part.type === "field") {
                return <span key={i} className={cn("rounded-sm px-1 text-xs font-semibold", TOKEN_CHIP.field)}>{part.name}</span>
              }
              return <span key={i}>{part.raw}</span>
            })}
          </div>
          <button
            onClick={(e) => void submitForm(e.ctrlKey)}
            className="h-8 cursor-pointer rounded-lg bg-primary text-ui font-medium text-primary-foreground hover:bg-primary/90"
          >
            {submitLabel}
          </button>
        </div>
      </Shell>
    )
  }

  // --- List mode ------------------------------------------------------------------
  const row = (entry: Entry, i: number) => (
    <Row
      key={entry.s.id}
      entry={entry}
      index={i}
      selected={i === sel}
      picked={pickedId === entry.s.id}
      compact={compact}
      derived={derived.get(entry.s.id) ?? derive(entry.s)}
      onPick={pick}
      onMove={onItemMouseMove}
      onLeave={onItemMouseLeave}
      onTag={onTagClick}
      previewed={previewIdx === i}
      clipEmpty={!clip}
    />
  )

  return (
    <Shell hint={hint} notice={notice} announce={announce}>
      {/* Search — kit "Active" state: 36px boxed input, 2px focus border */}
      <div
        role="search"
        className="flex h-8 shrink-0 items-center gap-1 rounded-lg border-2 border-input bg-background py-1.5 pl-2 pr-1.5 focus-within:border-(--focus)"
      >
        <RiSearchLine className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type to search…  (#tag, @pack, >group)"
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-label="Search prompts"
          aria-autocomplete="list"
          aria-expanded={visible.length > 0}
          aria-controls="popup-list"
          aria-activedescendant={visible[sel] ? `row-${visible[sel].s.id}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-ui text-foreground outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            className="cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => {
              setQuery("")
              inputRef.current?.focus()
            }}
          >
            <RiCloseLine className="size-4" />
          </button>
        )}
      </div>

      <div
        ref={listRef}
        id="popup-list"
        role="listbox"
        aria-label="Prompts"
        className="flex-1 overflow-y-auto px-0.5"
        onScroll={hidePreview}
      >
        {filtered.length === 0 && (
          <div className="px-4 py-4 text-center text-xs text-muted-foreground">
            {!snippets.length
              ? "No prompts yet — copy some text and press Ctrl+N to save it as one, or left-click the Promptline tray icon to open the manager"
              : C.parseQuery(query).tags.length || C.parseQuery(query).packs.length || C.parseQuery(query).groups.length
                ? "No matches — #tag, @pack and >group terms narrow the list; remove one to widen it"
                : "No matches"}
          </div>
        )}
        {sections.map((sec) => {
          // Rows split like the sidebar: the ungrouped run, then one block per
          // group. A search is drawn flat in rank order so the drawn order
          // matches `visible` (highlight, arrows, Ctrl+1..5).
          const ungrouped = hasQuery ? sec.entries : sec.entries.filter((e) => !e.s.group)
          const groups = new Map<string, Entry[]>()
          if (!hasQuery) {
            for (const e of sec.entries) {
              if (!e.s.group) continue
              if (!groups.has(e.s.group)) groups.set(e.s.group, [])
              groups.get(e.s.group)!.push(e)
            }
          }
          const rows = (es: Entry[]) => es.map((entry) => row(entry, rowIndex.get(entry.s.id)!))
          const Chev = sec.isCollapsed ? RiArrowRightSLine : RiArrowDownSLine
          const headerClass = cn(
            "flex w-full select-none items-center gap-1.5 rounded-lg px-1 py-2 text-left text-sm font-bold",
            sec.collapsible && "cursor-pointer",
            sec.isCollapsed ? "text-muted-foreground hover:text-foreground" : "text-foreground"
          )
          const headerBody = (
            <>
              <span className="min-w-0 flex-1 truncate">
                {sec.name} <span className="font-semibold text-muted-foreground">({sec.entries.length})</span>
              </span>
              {sec.collapsible && <Chev className="size-4 shrink-0 text-muted-foreground" />}
            </>
          )
          return (
            <div key={sec.name} className="mb-3" role="group" aria-label={sec.name}>
              {/* Pack title, as in the sidebar: a disclosure button (← / Ctrl+→
                  from a row do the same); Pinned / Results are plain headings */}
              {sec.collapsible ? (
                <button type="button" tabIndex={-1} aria-expanded={!sec.isCollapsed} className={headerClass} onClick={() => toggleCollapsed(sec.name)}>
                  {headerBody}
                </button>
              ) : (
                <div className={headerClass}>{headerBody}</div>
              )}
              {!sec.isCollapsed && (
                <div className="flex flex-col gap-1.5">
                  {rows(ungrouped)}
                  {[...groups.entries()].map(([g, es]) => (
                    <div key={g} className="flex flex-col gap-1.5 pl-2.5" role="group" aria-label={g}>
                      <div className="flex select-none items-center gap-1 rounded-md px-1 py-1 text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">
                          {g} <span className="font-medium">({es.length})</span>
                        </span>
                      </div>
                      {rows(es)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Fixed create action — pinned below the list, above the meta bars */}
      <button
        onClick={openCreate}
        className="flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-lg border-t border-border px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <RiAddLine className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left text-ui">New prompt from clipboard…</span>
        <span className="flex shrink-0 gap-1">
          <Kbd>Ctrl</Kbd>
          <Kbd>N</Kbd>
        </span>
      </button>

      {previewIdx !== null && visible[previewIdx] && (() => {
        // Corner-anchored to the trigger point, clamped inside the window
        const pad = 8
        const maxH = 220 // matches max-h-55
        const height = Math.min(previewH ?? maxH, maxH)
        const width = Math.min(320, window.innerWidth - pad * 2)
        const pos = previewPos ?? { x: 16, y: 56 }
        const left = Math.max(pad, Math.min(pos.x, window.innerWidth - width - pad))
        const top = Math.max(pad, Math.min(pos.y, window.innerHeight - height - pad))
        return (
          <div
            ref={previewCardRef}
            id="popup-preview"
            role="tooltip"
            className="fixed z-10 max-h-55 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-popover p-2 text-xs leading-relaxed text-muted-foreground shadow-(--shadow-pop)"
            style={{ left, top, width }}
            onMouseEnter={() => { if (hideTimer.current) clearTimeout(hideTimer.current) }}
            onMouseLeave={onItemMouseLeave}
          >
            <Tokens text={visible[previewIdx].s.text} />
          </div>
        )
      })()}

      {panelFor && (
        <div
          role="menu"
          aria-label={`Actions for ${panelFor.title}`}
          className="fixed inset-x-2 bottom-10 z-20 rounded-xl border border-border bg-popover p-2 shadow-(--shadow-pop)"
        >
          <SectionHeader>{panelFor.title}</SectionHeader>
          {panelNote && <div role="alert" className="px-2 pb-1 text-xs text-destructive">{panelNote}</div>}
          {panelActions.map((a, i) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-current={i === panelSel || undefined}
              className={cn(
                "flex h-[30px] w-full cursor-pointer select-none items-center justify-between rounded-lg px-2 text-ui",
                i === panelSel && "bg-accent",
                a.danger && "text-destructive"
              )}
              onClick={a.run}
              onMouseMove={() => setPanelSel(i)}
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

// Window chrome — the kit palette card: 12px radius, 8px padding, soft shadow
function Shell({
  children,
  hint,
  notice,
  announce,
}: {
  children: React.ReactNode
  hint: React.ReactNode
  notice: Notice | null
  /** What a screen reader should hear about the current state (results, mode) */
  announce: string
}) {
  return (
    <div className="flex h-dvh flex-col gap-2.5 overflow-hidden rounded-xl border border-border bg-background p-2.5 text-foreground shadow-(--shadow-shell)">
      {import.meta.env.DEV && <SizeDebug />}
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      {children}
      {/* Feedback strip: errors stay until Esc or the next summon, confirmations
          go with the popup. A live region, so it is announced. */}
      <div role="status" aria-live="polite" className="shrink-0 empty:hidden">
        {notice && (
          <div
            className={cn(
              "truncate rounded-md px-2 py-1 text-xs",
              notice.kind === "error" ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-foreground"
            )}
            title={notice.text}
          >
            {notice.kind === "error" ? `${notice.text} — Esc to dismiss` : notice.text}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-1 pt-2.5 text-xs text-muted-foreground">
        {hint}
      </div>
    </div>
  )
}
