import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { cn } from "@/lib/utils"

const MAX_PINS = 5
// Command-palette kit accent (focus border) — same in both themes
const FOCUS_BORDER = "#00a6f4"

type Entry = { s: Snippet; indices: number[] | null }
type FormState = { snippet: Snippet; base: string; fields: string[]; paste: boolean }
type PanelAction = { label: string; danger?: boolean; run: () => void }
type CreateState = { title: string; pack: string; group: string }

const DEFAULT_PACK = "My prompts"

// 16px bordered square, the kit's shortcut-label idiom
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm border border-border bg-background px-0.5 text-xs text-muted-foreground">
      {children}
    </span>
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
            className={cn(
              "rounded-sm px-1 text-xs font-semibold",
              part.type === "builtin" && "bg-cyan-500/15 text-cyan-500",
              part.type === "field" && "bg-amber-500/15 text-amber-500",
              part.type === "config" && "bg-fuchsia-500/15 text-fuchsia-500",
              part.type === "bad" && "bg-destructive/15 text-destructive"
            )}
          >
            {label}
          </span>
        )
      })}
    </>
  )
}

// The kit highlights matched characters with an underline
function HighlightedTitle({ title, indices }: { title: string; indices: number[] | null }) {
  if (!indices?.length) return <span className="truncate">{title}</span>
  const set = new Set(indices)
  return (
    <span className="truncate">
      {[...title].map((ch, i) => (
        <span key={i} className={set.has(i) ? "underline decoration-solid underline-offset-2" : undefined}>
          {ch}
        </span>
      ))}
    </span>
  )
}

function rowIcon(s: Snippet) {
  if (s.pinned) return RiPushpinFill
  if (C.requiredInputs(s).length) return RiEdit2Line
  if (s.text.includes("{clipboard}")) return RiClipboardLine
  return RiFileTextLine
}

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
  const [compact, setCompact] = useState(isCompact())
  const [packMeta, setPackMeta] = useState<PackMeta[]>([])
  const [create, setCreate] = useState<CreateState | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Keyboard/mouse arbitration: ignore hover-selection during keyboard nav and
  // when the list scrolls under a stationary cursor
  const suppressHoverUntil = useRef(0)
  const lastMouse = useRef({ x: -1, y: -1 })
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filtered = useMemo<Entry[]>(() => {
    const q = C.parseQuery(query)
    const pool = snippets.filter((s) => C.matchesFilters(s, q))
    if (!q.text) {
      return pool
        .sort((a, b) => (+b.pinned - +a.pinned) || (b.uses - a.uses) || a.title.localeCompare(b.title))
        .map((s) => ({ s, indices: null }))
    }
    return pool
      .map((s) => {
        const title = C.fuzzyScore(q.text, s.title)
        if (title) return { s, score: title.score, indices: title.indices }
        const tag = C.fuzzyScore(q.text, (s.tags || []).join(" "))
        if (tag) return { s, score: 3000 + tag.score, indices: null }
        const body = C.fuzzyScore(q.text, s.text)
        if (body) return { s, score: 5000 + body.score, indices: null }
        return null
      })
      .filter((e): e is Entry & { score: number } => e !== null)
      .sort((a, b) => (a.score - b.score) || (b.s.uses - a.s.uses))
  }, [snippets, query])

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
  const toggleCollapsed = (name: string) => {
    const next = new Set(collapsed)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setCollapsed(next)
    localStorage.setItem("popupCollapsedPacks", JSON.stringify([...next]))
    setSel(0)
  }

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

  const packNames = useMemo(() => {
    const names = new Set([
      ...packMeta.map((p) => p.name),
      ...snippets.map((s) => s.pack || DEFAULT_PACK),
      DEFAULT_PACK,
    ])
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [packMeta, snippets])
  const isLocked = useCallback(
    (name: string) => !!packMeta.find((p) => p.name === name)?.locked,
    [packMeta]
  )

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

  const send = useCallback(async (snippet: Snippet, text: string, paste: boolean) => {
    await invoke("paste_snippet", { text, paste, id: snippet.id })
  }, [])

  // --- Create prompt from clipboard -------------------------------------------
  const openCreate = useCallback(() => {
    hidePreview()
    closePanel()
    const firstLine = clip.trim().split(/\r?\n/)[0] ?? ""
    // Prefer the pack that last received a prompt (shared with the manager)
    const usable = (p: string | null) => !!p && packNames.includes(p!) && !isLocked(p!)
    const last = localStorage.getItem("lastPack")
    const pack = usable(last)
      ? last!
      : usable(DEFAULT_PACK)
        ? DEFAULT_PACK
        : packNames.find((p) => !isLocked(p)) ?? DEFAULT_PACK
    setCreate({
      title: firstLine.slice(0, 40) || "New prompt",
      pack,
      group: "",
    })
  }, [clip, packNames, isLocked, hidePreview, closePanel])

  const saveCreate = useCallback(async () => {
    if (!create) return
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
    const lib = await invoke<Library>("add_snippet", { snippet: snip })
    setSnippets(lib.snippets)
    localStorage.setItem("lastPack", create.pack)
    setCreate(null)
    setQuery("")
  }, [create, clip])

  // One prompt's pin state or remembered fill-ins, merged on disk
  const patch = useCallback(async (id: string, patch: SnippetPatch) => {
    const lib = await invoke<Library>("patch_snippet", { id, patch })
    setSnippets(lib.snippets)
  }, [])

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
    // Sequenced: paste_snippet re-reads the file to bump the use count.
    await patch(snippet.id, { fieldValues: { ...formValues } })
    await send(snippet, C.expandBuiltins(text), paste)
  }, [form, formValues, patch, send])

  const togglePin = useCallback(async (s: Snippet) => {
    if (!s.pinned && snippets.filter((x) => x.pinned).length >= MAX_PINS) {
      setPanelNote(`Max ${MAX_PINS} pins — unpin something first`)
      return
    }
    await patch(s.id, { pinned: !s.pinned })
    closePanel()
  }, [snippets, patch, closePanel])

  const deleteSnippet = useCallback(async (s: Snippet) => {
    const lib = await invoke<Library>("delete_snippet", { id: s.id })
    setSnippets(lib.snippets)
    closePanel()
  }, [closePanel])

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
    hidePreview()
    setPickedId(null)
    const [lib, clipboard, config] = await Promise.all([
      invoke<Library>("get_snippets"),
      invoke<string>("get_clipboard_text"),
      invoke<{ packs?: PackMeta[] }>("get_config"),
    ])
    setQuery("")
    setSnippets(lib.snippets)
    setClip(clipboard)
    setPackMeta(Array.isArray(config.packs) ? config.packs : [])
    setSel(0)
    inputRef.current?.focus()
  }, [closePanel, hidePreview])

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
        else if (create) setCreate(null)
        else void invoke("hide_popup")
        return
      }
      if (form || create) return // form/create views handle their own keys
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
      if (e.key === "ArrowDown") {
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
  }, [panelFor, panelActions, panelSel, form, create, visible, sel, previewIdx, pick, openCreate, closePanel, hidePreview])

  const onItemMouseMove = (i: number, e: React.MouseEvent) => {
    const moved = e.clientX !== lastMouse.current.x || e.clientY !== lastMouse.current.y
    lastMouse.current = { x: e.clientX, y: e.clientY }
    if (!moved || Date.now() < suppressHoverUntil.current) return
    if (sel !== i) setSel(i)
    if (previewIdx !== i) {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hoverTimer.current = setTimeout(() => {
        setPreviewPos({ x: lastMouse.current.x + 12, y: lastMouse.current.y + 12 })
        setPreviewIdx(i)
      }, 350)
    }
  }
  const onItemMouseLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hideTimer.current = setTimeout(() => setPreviewIdx(null), 150)
  }

  // --- Hint bar (kit kbd-chip idiom) -------------------------------------------
  const hint = panelFor ? (
    <><Kbd>↵</Kbd> run <Kbd>1-9</Kbd> pick <Kbd>Esc</Kbd> back</>
  ) : form ? (
    <><Kbd>↵</Kbd> paste <Kbd>Ctrl ↵</Kbd> copy <Kbd>⇧ ↵</Kbd> newline <Kbd>Esc</Kbd> back</>
  ) : create ? (
    <><Kbd>↵</Kbd> save <Kbd>Esc</Kbd> back</>
  ) : (
    <><Kbd>↵</Kbd> paste <Kbd>Ctrl ↵</Kbd> copy <Kbd>Tab</Kbd> actions <Kbd>→</Kbd> preview</>
  )

  // --- Create-from-clipboard confirmation --------------------------------------
  if (create) {
    return (
      <Shell hint={hint}>
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
              className="w-full rounded-lg border-2 border-input bg-background px-2 py-1.5 text-[13px] text-foreground outline-none focus:border-(--palette-focus)"
              style={{ "--palette-focus": FOCUS_BORDER } as React.CSSProperties}
            />
          </div>
          <div className="px-1">
            <label className="mb-1 block text-xs font-medium tracking-[0.04em] text-muted-foreground">Pack</label>
            <select
              value={create.pack}
              onChange={(e) => setCreate((c) => c && { ...c, pack: e.target.value, group: "" })}
              className="w-full cursor-pointer rounded-lg bg-secondary px-2 py-1.5 text-[13px] text-foreground outline-none"
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
                  className="w-full cursor-pointer rounded-lg bg-secondary px-2 py-1.5 text-[13px] text-foreground outline-none"
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
          <button
            onClick={() => void saveCreate()}
            className="h-8 cursor-pointer rounded-lg bg-primary text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
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
      <Shell hint={hint}>
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
                    "min-h-8 w-full resize-none rounded-lg border-2 bg-background px-2 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-(--palette-focus)",
                    empty ? "border-destructive/60" : "border-input"
                  )}
                  style={{ "--palette-focus": FOCUS_BORDER } as React.CSSProperties}
                />
              </div>
            )
          })}
          <SectionHeader>Will paste</SectionHeader>
          <div className="min-h-15 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-accent/50 p-2 text-xs leading-relaxed text-muted-foreground">
            {C.tokenize(C.expandBuiltins(form.base)).map((part, i) => {
              if (part.type === "text") return <span key={i}>{part.value}</span>
              if (part.type === "field" && formValues[part.name]) {
                return <span key={i} className="rounded-sm bg-amber-500/15 px-0.5 text-foreground">{formValues[part.name]}</span>
              }
              if (part.type === "builtin" && part.name === "clipboard") {
                return <span key={i} className="rounded-sm bg-cyan-500/15 px-0.5 text-foreground">{clip || "(clipboard is empty)"}</span>
              }
              if (part.type === "field") {
                return <span key={i} className="rounded-sm bg-amber-500/15 px-1 text-xs font-semibold text-amber-500">{part.name}</span>
              }
              return <span key={i}>{part.raw}</span>
            })}
          </div>
          <button
            onClick={(e) => void submitForm(e.ctrlKey)}
            className="h-8 cursor-pointer rounded-lg bg-primary text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            {submitLabel}
          </button>
        </div>
      </Shell>
    )
  }

  // --- List mode ------------------------------------------------------------------
  const row = (entry: Entry, i: number) => {
    const { s, indices } = entry
    const tags = s.tags || []
    const inputs = C.requiredInputs(s)
    const Icon = rowIcon(s)
    return (
      <div
        key={s.id}
        data-selected={i === sel}
        className={cn(
          "flex min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[13px] font-semibold",
          compact ? "py-1" : "py-1.5",
          i === sel ? "bg-accent text-foreground" : "text-muted-foreground hover:border-ring/40 hover:text-foreground",
          pickedId === s.id && "bg-primary/20"
        )}
        onClick={(e) => pick(s, !e.ctrlKey)}
        onMouseMove={(e) => onItemMouseMove(i, e)}
        onMouseLeave={onItemMouseLeave}
      >
        <Icon className={cn("size-3.5 shrink-0", s.pinned ? "text-amber-500" : "opacity-70")} />
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
            <span
              key={tag}
              className="flex h-4 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-sm border px-1 text-xs"
              style={{ color: c, borderColor: c + "55" }}
              title={`Filter by #${tag}`}
              onClick={(e) => {
                e.stopPropagation()
                setQuery(`#${tag} `)
                inputRef.current?.focus()
              }}
            >
              {tag}
            </span>
          )
        })}
        {inputs.length > 0 && (
          <span
            className="flex h-4 shrink-0 items-center rounded-sm border border-amber-500/40 px-1 text-xs tabular-nums text-amber-500"
            title={`Asks for ${inputs.length} value${inputs.length === 1 ? "" : "s"} before pasting: ${inputs.join(", ")}`}
          >
            {"{"}{inputs.length}{"}"}
          </span>
        )}
        {i < 5 && (
          <span className="flex shrink-0 gap-1">
            <Kbd>Ctrl</Kbd>
            <Kbd>{i + 1}</Kbd>
          </span>
        )}
      </div>
    )
  }

  return (
    <Shell hint={hint}>
      {/* Search — kit "Active" state: 36px boxed input, 2px focus border */}
      <div
        className="flex h-8 shrink-0 items-center gap-1 rounded-lg border-2 border-input bg-background py-1.5 pl-2 pr-1.5 focus-within:border-(--palette-focus)"
        style={{ "--palette-focus": FOCUS_BORDER } as React.CSSProperties}
      >
        <RiSearchLine className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type to search…  (#tag, @pack, >group)"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button
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

      <div ref={listRef} className="flex-1 overflow-y-auto px-0.5" onScroll={hidePreview}>
        {filtered.length === 0 && (
          <div className="px-4 py-4 text-center text-xs text-muted-foreground">
            {snippets.length ? "No matches" : "No prompts yet — left-click the Promptline tray icon to add some"}
          </div>
        )}
        {sections.map((sec) => {
          // Rows split like the sidebar: the ungrouped run, then one block per group
          const ungrouped = sec.entries.filter((e) => !e.s.group)
          const groups = new Map<string, Entry[]>()
          for (const e of sec.entries) {
            if (!e.s.group) continue
            if (!groups.has(e.s.group)) groups.set(e.s.group, [])
            groups.get(e.s.group)!.push(e)
          }
          const rows = (es: Entry[]) => es.map((entry) => row(entry, rowIndex.get(entry.s.id)!))
          const Chev = sec.isCollapsed ? RiArrowRightSLine : RiArrowDownSLine
          return (
            <div key={sec.name} className="mb-3">
              {/* Pack title, as in the sidebar; Pinned / Results are not collapsible */}
              <div
                className={cn(
                  "flex select-none items-center gap-1.5 rounded-lg px-1 py-2 text-sm font-bold",
                  sec.collapsible && "cursor-pointer",
                  sec.isCollapsed ? "text-muted-foreground hover:text-foreground" : "text-foreground"
                )}
                onClick={sec.collapsible ? () => toggleCollapsed(sec.name) : undefined}
              >
                <span className="min-w-0 flex-1 truncate">
                  {sec.name} <span className="font-semibold text-muted-foreground">({sec.entries.length})</span>
                </span>
                {sec.collapsible && <Chev className="size-4 shrink-0 text-muted-foreground" />}
              </div>
              {!sec.isCollapsed && (
                <div className="flex flex-col gap-1.5">
                  {rows(ungrouped)}
                  {[...groups.entries()].map(([g, es]) => (
                    <div key={g} className="flex flex-col gap-1.5 pl-2.5">
                      <div className="flex select-none items-center gap-1 rounded-md px-1 py-1 text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">
                          {g} <span className="font-medium opacity-70">({es.length})</span>
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
        <span className="min-w-0 flex-1 truncate text-left text-[13px]">New prompt from clipboard…</span>
        <span className="flex shrink-0 gap-1">
          <Kbd>Ctrl</Kbd>
          <Kbd>N</Kbd>
        </span>
      </button>

      {previewIdx !== null && visible[previewIdx] && (() => {
        // Corner-anchored to the trigger point, clamped inside the window
        const pad = 8
        const maxH = 220 // matches max-h-55
        const width = Math.min(320, window.innerWidth - pad * 2)
        const pos = previewPos ?? { x: 16, y: 56 }
        const left = Math.max(pad, Math.min(pos.x, window.innerWidth - width - pad))
        const top = Math.max(pad, Math.min(pos.y, window.innerHeight - maxH - pad))
        return (
          <div
            className="fixed z-10 max-h-55 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-popover p-2 text-xs leading-relaxed text-muted-foreground shadow-[0px_0px_16px_rgba(18,45,88,0.24)]"
            style={{ left, top, width }}
            onMouseEnter={() => { if (hideTimer.current) clearTimeout(hideTimer.current) }}
            onMouseLeave={onItemMouseLeave}
          >
            <Tokens text={visible[previewIdx].s.text} />
          </div>
        )
      })()}

      {panelFor && (
        <div className="fixed inset-x-2 bottom-10 z-20 rounded-lg border border-border bg-popover p-2 shadow-[0px_0px_16px_rgba(18,45,88,0.24)]">
          <SectionHeader>{panelNote ?? panelFor.title}</SectionHeader>
          {panelActions.map((a, i) => (
            <div
              key={a.label}
              className={cn(
                "flex h-[30px] cursor-pointer select-none items-center justify-between rounded-lg px-2 text-[13px]",
                i === panelSel && "bg-accent",
                a.danger && "text-destructive"
              )}
              onClick={a.run}
              onMouseMove={() => setPanelSel(i)}
            >
              <span>{a.label}</span>
              <Kbd>{i + 1}</Kbd>
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}

// Window chrome — the kit palette card: 12px radius, 8px padding, soft shadow
function Shell({ children, hint }: { children: React.ReactNode; hint: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col gap-2.5 overflow-hidden rounded-lg border border-border bg-background p-2.5 text-foreground shadow-[0px_0px_16px_rgba(18,45,88,0.12)]">
      {import.meta.env.DEV && <SizeDebug />}
      {children}
      <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-1 pt-2.5 text-xs text-muted-foreground">
        {hint}
      </div>
    </div>
  )
}
