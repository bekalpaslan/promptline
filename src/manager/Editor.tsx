import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiFileTextLine,
} from "@remixicon/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "./EmptyState"
import { Textarea } from "@/components/ui/textarea"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { DEFAULT_PACK, MAX_PINS, useManager } from "./state"
import { TOKEN_CHIP } from "@/lib/library"
import { say, sayErr } from "./status"

const BUILTIN_PARAMS = ["clipboard", "date", "time"]
// The stored form of the tags field, so a save and the refresh that follows it
// compare the same way
const storedTags = (raw: string) => raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
const SUGGESTED_PARAMS = ["goal", "feature", "task", "error", "file"]

// One card per parameter kind. The card's Edit toggle reveals delete badges
// on the pills inside (children render from the editing flag).
function ParamSection({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: (editing: boolean) => React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-secondary/50 p-3">
      <span className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
        <span className="font-semibold uppercase tracking-wide">{title}</span>
        <span>· {hint}</span>
        <button
          type="button"
          aria-pressed={editing}
          aria-label={editing ? `Done editing ${title}` : `Edit ${title}`}
          className={cn(
            "ml-auto cursor-pointer font-medium",
            editing ? "text-primary hover:text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </span>
      {children(editing)}
    </div>
  )
}

// Addable pill: a + segment on the left, separated by a divider that cuts
// the pill full-height. Spacing is tier-1 (6px) on every side of the + and
// between the divider and the label.
function AddPill({ label, title, onAdd }: { label: string; title: string; onAdd: () => void }) {
  return (
    <button
      tabIndex={0}
      title={title}
      className="flex shrink-0 cursor-pointer select-none overflow-hidden rounded-sm border border-transparent bg-secondary text-xs font-medium text-muted-foreground transition-colors hover:border-primary"
      onClick={onAdd}
    >
      <span className="flex items-center px-1.5">
        <RiAddLine className="size-3" />
      </span>
      <span className="w-px bg-border" />
      <span className="flex items-center py-1 pl-1.5 pr-2">{label}</span>
    </button>
  )
}

// Delete badge hovering on a pill's corner while its card is in edit mode
function DeleteBadge({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      type="button"
      title="Remove from this prompt"
      aria-label="Remove from this prompt"
      // 14 px badge, 30 px hit area (the ::after inset idiom from checkbox.tsx)
      className="absolute -right-1.5 -top-1.5 flex size-3.5 cursor-pointer items-center justify-center rounded-full bg-destructive text-white opacity-80 shadow-sm transition-transform duration-150 animate-in fade-in zoom-in after:absolute after:-inset-2 after:content-[''] hover:scale-110 hover:opacity-100"
      onClick={(e) => {
        e.stopPropagation()
        onDelete()
      }}
    >
      <RiCloseLine className="size-2.5" />
    </button>
  )
}

// A parameter name is lowercase letters and underscores (BEHAVIOR.md); what
// the user typed is folded into that, and the fold is shown before Enter
// rather than discovered in the chip afterwards
const paramName = (raw: string) => raw.trim().toLowerCase().replace(/[^a-z_]+/g, "_").replace(/^_+|_+$/g, "")

function ParamInput({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  const [raw, setRaw] = useState("")
  const name = paramName(raw)
  const differs = raw.trim() !== "" && name !== raw.trim()
  return (
    <span className="flex items-center gap-1.5">
      <input
        value={raw}
        placeholder={placeholder}
        aria-label={placeholder.replace(/^\+ /, "Add ").replace(/…$/, "")}
        spellCheck={false}
        className="w-28 rounded-sm bg-secondary px-3 py-0.5 text-xs text-foreground focus-ring placeholder:text-muted-foreground"
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          if (!name) return
          onAdd(name)
          setRaw("")
        }}
      />
      {differs && (
        <span className="text-xs text-muted-foreground" role="status">
          {name ? `will insert {${name}}` : "lowercase letters and _ only"}
        </span>
      )}
    </span>
  )
}

// Sized to mirror the prompt textarea exactly: same 4-line default, same
// grow-with-content (1lh spare via bottom padding), same 10-line cap, same
// text metrics — the transparent border offsets the textarea's real one
function TokenPreview({
  text,
  configValues,
  className,
}: {
  text: string
  configValues: Record<string, string>
  className?: string
}) {
  return (
    <div
      className={cn(
        "min-h-[calc(4lh+1.5rem)] max-h-[calc(10lh+1.5rem)] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-transparent bg-secondary/50 px-4 pt-3 pb-[calc(0.75rem+1lh)] text-sm leading-relaxed text-muted-foreground md:text-xs/relaxed",
        className
      )}
    >
      {C.tokenize(text).map((part, i) => {
        if (part.type === "text") return <span key={i}>{part.value}</span>
        let label: string
        const cls = TOKEN_CHIP[part.type]
        if (part.type === "bad") {
          label = `${part.name} — not a param (lowercase letters/_ only)`
        } else if (part.type === "config") {
          const v = (configValues[part.name] || "").replace(/\s+/g, " ")
          label = v ? (v.length > 40 ? v.slice(0, 40) + "…" : v) : `${part.name} — config (unset)`
        } else if (part.type === "builtin") {
          label = part.name
        } else {
          label = `${part.name} — fill-in`
        }
        return (
          <span key={i} className={cn("rounded-sm px-1 text-xs font-semibold", cls)}>
            {label}
          </span>
        )
      })}
    </div>
  )
}

export function Editor() {
  const m = useManager()
  const snippet = m.snippets.find((s) => s.id === m.activeId)

  if (!snippet) {
    if (m.selection.size > 1) {
      return (
        <EmptyState
          title={`${m.selection.size} prompts selected`}
          hint="Right-click (or press the Menu key) for actions on all of them · click a row to edit one"
        />
      )
    }
    return (
      <EmptyState
        icon={RiFileTextLine}
        title={m.snippets.length ? "Select a prompt to edit it" : "No prompts yet"}
        hint={
          m.snippets.length
            ? `Or press ${C.fmtHotkey(m.hotkey)} in any app to paste one`
            : "Write one, or let Claude draft a pack for a topic — every prompt is reviewed before it is added"
        }
        actions={[
          { label: "New prompt", onClick: () => void m.newPrompt(), primary: true },
          { label: "Generate pack with Claude…", onClick: () => m.openGenerate() },
        ]}
      />
    )
  }
  return <EditorInner snippet={snippet} />
}

function EditorInner({ snippet }: { snippet: Snippet }) {
  const m = useManager()
  const [title, setTitle] = useState(snippet.title)
  const [tags, setTags] = useState((snippet.tags || []).join(", "))
  const [pack, setPack] = useState(snippet.pack || DEFAULT_PACK)
  const [group, setGroup] = useState(snippet.group || "")
  const [newPackMode, setNewPackMode] = useState(false)
  const [text, setText] = useState(snippet.text)
  const [configValues, setConfigValues] = useState<Record<string, string>>({ ...(snippet.configValues || {}) })
  const [advOpen, setAdvOpen] = useState(localStorage.getItem("advancedOpen") === "1")
  const [deleteArmed, setDeleteArmed] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const isDraft = snippet.title === "New prompt" && !snippet.text && !snippet.uses

  // Autosave: edits persist on a short debounce — no Save button, no lost drafts
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ title, tags, pack, group, text, configValues })
  latest.current = { title, tags, pack, group, text, configValues }
  // Fields the user has edited since the last save. The sidebar can change
  // tags/pack/group underneath the editor (move-to, add-tag); those land
  // unless the user has a pending edit of that same field.
  const dirty = useRef(new Set<"tags" | "pack" | "group">())
  const mRef = useRef(m)
  mRef.current = m

  const commit = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const cur = latest.current
    const mgr = mRef.current
    mgr.pendingFlush.current = null
    dirty.current.clear()
    const existing = mgr.snippets.find((s) => s.id === snippet.id)
    if (!existing) return
    let targetPack = cur.pack.trim() || existing.pack || DEFAULT_PACK
    if (targetPack !== (existing.pack || DEFAULT_PACK) && mgr.isLocked(targetPack)) {
      sayErr(`Pack "${targetPack}" is locked — unlock it to add prompts`)
      targetPack = existing.pack || DEFAULT_PACK
      setPack(targetPack)
    }
    const names = C.configNames(cur.text)
    // Only the editor's own fields go to disk; uses/pinned/fieldValues are
    // merged there from whatever the popup wrote since this render
    await mgr.updateSnippet(snippet.id, {
      title: cur.title.trim() || "(untitled)",
      tags: storedTags(cur.tags),
      pack: targetPack,
      group: cur.group.trim(),
      text: cur.text,
      configValues: Object.fromEntries(
        Object.entries(cur.configValues).filter(([k, v]) => names.includes(k) && v !== "")
      ),
    })
    // New prompts default to the pack that last received one
    localStorage.setItem("lastPack", targetPack)
  }, [snippet.id])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    // A failed save has already been toasted by updateSnippet
    saveTimer.current = setTimeout(() => void commit().catch(() => {}), 600)
    // Park the flush so a quit request can run it before the process exits
    mRef.current.pendingFlush.current = () => commit().catch(() => {})
  }, [commit])

  // Flush pending edits when switching prompts / unmounting
  useEffect(() => {
    const flushRef = mRef.current.pendingFlush
    return () => {
      if (saveTimer.current) void commit().catch(() => {})
      flushRef.current = null
    }
  }, [commit])

  // External changes (move-to-pack, add-tag via context menu) refresh the
  // fields the user isn't mid-edit on. Skipping the whole refresh while a save
  // was pending let the save write the stale pack back, undoing the move.
  //
  // A field is also left alone when the store only holds what this editor's
  // own save just wrote: `dirty` is cleared on commit, and the saved value is
  // trimmed, so re-syncing from it ate the space in a half-typed "my group "
  // the moment the 600 ms autosave landed.
  useEffect(() => {
    const d = dirty.current
    const cur = latest.current
    const tagsInStore = (snippet.tags || []).join(", ")
    if (!d.has("tags") && tagsInStore !== storedTags(cur.tags).join(", ")) setTags(tagsInStore)
    if (!d.has("pack") && (snippet.pack || DEFAULT_PACK) !== (cur.pack.trim() || DEFAULT_PACK))
      setPack(snippet.pack || DEFAULT_PACK)
    if (!d.has("group") && (snippet.group || "") !== cur.group.trim()) setGroup(snippet.group || "")
  }, [snippet.tags, snippet.pack, snippet.group])

  const editTags = (next: string) => {
    dirty.current.add("tags")
    setTags(next)
    scheduleSave()
  }
  const editPack = (next: string) => {
    dirty.current.add("pack")
    setPack(next)
    scheduleSave()
  }
  const editGroup = (next: string) => {
    dirty.current.add("group")
    setGroup(next)
    scheduleSave()
  }

  // Groups already in use in the chosen pack, for the group field's suggestions
  const packGroups = useMemo(() => {
    const set = new Set<string>()
    for (const s of m.snippets) if ((s.pack || DEFAULT_PACK) === pack && s.group) set.add(s.group)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [m.snippets, pack])

  // ---- Params ----
  const libraryParams = useMemo(() => {
    const found = new Set<string>()
    for (const s of m.snippets)
      for (const part of C.tokenize(s.text))
        if (part.type === "field" || part.type === "config") found.add(part.name)
    return found
  }, [m.snippets])

  const { configInText, runtimeInText } = useMemo(() => {
    const config = new Set<string>()
    const runtime = new Set<string>()
    for (const part of C.tokenize(text)) {
      if (part.type === "config") config.add(part.name)
      else if (part.type === "field" || part.type === "builtin") runtime.add(part.name)
    }
    return { configInText: config, runtimeInText: runtime }
  }, [text])

  const setTextAnd = (next: string) => {
    setText(next)
    scheduleSave()
  }

  const insertParam = (name: string, asConfig: boolean) => {
    const token = asConfig ? `{{${name}}}` : `{${name}}`
    const el = textRef.current
    const pos = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? pos
    const next = text.slice(0, pos) + token + text.slice(end)
    setTextAnd(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos + token.length, pos + token.length)
    })
  }

  const removeParam = (name: string) => {
    setTextAnd(
      text
        .replaceAll(`{{${name}}}`, "")
        .replaceAll(`{${name}}`, "")
        .replace(/[^\S\n]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
    )
  }

  const paramChip = (name: string, isBuiltin: boolean, inText: boolean, editing: boolean) => {
    if (!inText)
      return (
        <AddPill
          key={name}
          label={`{${name}}`}
          title={`Insert {${name}}`}
          onAdd={() => insertParam(name, false)}
        />
      )
    return (
      <span
        key={name}
        title={`{${name}} is in the prompt — Edit to remove`}
        className={cn(
          "relative select-none rounded-sm border border-transparent px-2.5 py-0.5 text-xs font-medium",
          isBuiltin ? TOKEN_CHIP.builtin : TOKEN_CHIP.field
        )}
      >
        {`{${name}}`}
        {editing && <DeleteBadge onDelete={() => removeParam(name)} />}
      </span>
    )
  }

  // ---- Tags ----
  const tagList = tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
  const addTag = (t: string) => {
    if (tagList.includes(t)) return
    editTags([...tagList, t].join(", "))
  }
  const removeTag = (t: string) => {
    editTags(tagList.filter((x) => x !== t).join(", "))
  }
  const tagSuggestions = m.allTags().filter((t) => !tagList.includes(t)).slice(0, 12)

  const customParams = new Set([
    ...[...configInText, ...runtimeInText].filter((t) => !BUILTIN_PARAMS.includes(t)),
    ...libraryParams,
    ...SUGGESTED_PARAMS,
  ])
  const configNames = C.configNames(text)

  // ---- Actions ----
  const togglePin = async () => {
    if (!snippet.pinned && m.snippets.filter((x) => x.pinned).length >= MAX_PINS) {
      sayErr(`Max ${MAX_PINS} pins — unpin something first`)
      return
    }
    await m.persist(m.snippets.map((s) => (s.id === snippet.id ? C.withPin(s, !s.pinned) : s)))
    say(snippet.pinned ? "Unpinned" : "Pinned")
  }

  // Escape disarms the delete button (the 3 s timeout is in doDelete)
  useEffect(() => {
    if (!deleteArmed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setDeleteArmed(false)
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [deleteArmed])

  const doDelete = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true)
      setTimeout(() => setDeleteArmed(false), 3000)
      return
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    await m.deleteWithUndo([snippet.id], `Deleted "${snippet.title}"`)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          autoFocus={isDraft}
          onFocus={(e) => {
            if (isDraft) e.currentTarget.select()
          }}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            scheduleSave()
          }}
          placeholder="Title"
          aria-label="Title"
          spellCheck={false}
          className="min-w-50 flex-[2] bg-transparent py-1 text-base font-semibold text-foreground outline-none placeholder:text-muted-foreground focus:shadow-[0_1px_0_var(--focus)]"
        />
        {newPackMode ? (
          <input
            autoFocus
            placeholder="New pack name — Enter to confirm"
            aria-label="New pack name"
            spellCheck={false}
            className="min-w-32 flex-1 rounded-md bg-secondary px-3 py-1.5 text-xs text-foreground focus-ring placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                const name = e.currentTarget.value.trim()
                setNewPackMode(false)
                if (name && !m.isLocked(name)) {
                  editPack(name)
                } else if (name && m.isLocked(name)) {
                  sayErr(`Pack "${name}" is locked`)
                }
              }
              if (e.key === "Escape") setNewPackMode(false)
            }}
            // Enter confirms; leaving the field cancels (the select comes back)
            onBlur={() => setNewPackMode(false)}
          />
        ) : (
          <span className="relative min-w-32 flex-1">
            <select
              value={pack}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  setNewPackMode(true)
                  return
                }
                editPack(e.target.value)
              }}
              // Native select arrows hug the edge; the app's own chevron sits
              // inset by the tier-1 spacing (6px) and takes the theme's colour
              aria-label="Pack"
              className="w-full cursor-pointer appearance-none rounded-md bg-secondary py-1.5 pl-2 pr-7 text-xs text-foreground focus-ring"
            >
              {m.packNames(pack).map((p) => (
                <option key={p} value={p} disabled={m.isLocked(p) && p !== pack}>
                  {m.isLocked(p) ? `🔒 ${p}` : p}
                </option>
              ))}
              <option value="__new__">＋ New pack…</option>
            </select>
            <RiArrowDownSLine className="pointer-events-none absolute right-1.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          </span>
        )}
        {/* Group within the pack — a label, so free text with the pack's existing groups as suggestions */}
        <input
          value={group}
          list={`groups-${snippet.id}`}
          onChange={(e) => {
            editGroup(e.target.value)
          }}
          placeholder="Group (optional)"
          aria-label="Group"
          spellCheck={false}
          className="min-w-28 flex-1 rounded-md bg-secondary px-3 py-1.5 text-xs text-foreground focus-ring placeholder:text-muted-foreground"
        />
        <datalist id={`groups-${snippet.id}`}>
          {packGroups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <Button
          variant="secondary"
          size="sm"
          title="Delete prompt"
          aria-label={deleteArmed ? "Confirm delete" : "Delete prompt"}
          onClick={() => void doDelete()}
          className={cn("text-destructive hover:bg-destructive/15", deleteArmed && "bg-destructive/15")}
        >
          <span aria-live="assertive">
            {deleteArmed ? `Delete "${(snippet.title || "untitled").slice(0, 24)}"?` : <RiDeleteBinLine className="size-4" aria-hidden />}
          </span>
        </Button>
      </div>

      {/* Prompt panel: same header idiom as Advanced options and Preview.
          The field (textarea + one-line tag strip) fills the card below the
          header; the textarea is 4 lines by default, grows with content
          (1lh bottom padding keeps one line free), capped at 10 lines. */}
      <div className="flex flex-col gap-3 rounded-xl bg-card p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prompt</span>
        <div className="-mx-3 -mb-3 flex flex-col overflow-hidden rounded-b-xl border border-transparent bg-secondary/50 focus-within:border-(--focus)">
        <Textarea
          ref={textRef}
          value={text}
          onChange={(e) => setTextAnd(e.target.value)}
          aria-label="Prompt text"
          spellCheck={false}
          placeholder="Prompt text…  Use {clipboard}, {date}, {time}, any {lowercase_word} as a fill-in field, or {{lowercase_word}} as a saved config parameter."
          className="min-h-[calc(4lh+1.5rem)] max-h-[calc(10lh+1.5rem)] resize-none rounded-none border-0 bg-transparent px-4 pt-3 pb-[calc(0.75rem+1lh)] leading-relaxed placeholder:text-muted-foreground/80 focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
          {tagList.map((t) => {
            const c = C.tagColor(t)
            return (
              <button
                key={t}
                title={`Remove tag "${t}"`}
                aria-label={`Remove tag ${t}`}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-sm border bg-background/60 px-2 py-1 text-xs font-medium tag-text tag-border dark:tag-text-dark dark:tag-border-dark"
                style={{ "--tag": c } as React.CSSProperties}
                onClick={() => removeTag(t)}
              >
                <RiCheckLine className="size-3" />
                {t}
              </button>
            )
          })}
          {tagSuggestions.map((t) => (
            <AddPill key={t} label={t} title={`Add tag "${t}"`} onAdd={() => addTag(t)} />
          ))}
          <input
            placeholder="+ tag…"
            aria-label="Add a tag"
            spellCheck={false}
            className="w-24 shrink-0 rounded-sm bg-secondary px-3 py-0.5 text-xs text-foreground focus-ring placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return
              const name = e.currentTarget.value.trim().toLowerCase().replace(/,/g, "")
              if (name) addTag(name)
              e.currentTarget.value = ""
            }}
          />
        </div>
        </div>
      </div>

      {/* One containing card: the toggle is its header, the parameter cards
          sit inside it on the tinted background */}
      <div className="flex flex-col rounded-xl bg-card p-3">
        <button
          className="flex cursor-pointer items-center gap-1 self-start text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-primary"
          onClick={() => {
            const next = !advOpen
            setAdvOpen(next)
            localStorage.setItem("advancedOpen", next ? "1" : "0")
          }}
        >
          Advanced options
          {advOpen ? <RiArrowDownSLine className="size-3.5" /> : <RiArrowRightSLine className="size-3.5" />}
        </button>

        {advOpen && (
          <div className="mt-3 flex flex-col gap-3">
          <ParamSection title="Built-ins" hint="expand on their own when pasting — click to insert">
            {(editing) => (
              <div className="flex flex-wrap items-center gap-1.5">
                {BUILTIN_PARAMS.map((p) => paramChip(p, true, runtimeInText.has(p), editing))}
              </div>
            )}
          </ParamSection>

          <ParamSection
            title="Fill-in fields"
            hint={`{name} — you type the value each time you paste`}
          >
            {(editing) => (
              <div className="flex flex-wrap items-center gap-1.5">
                {[...customParams]
                  .filter((p) => !configInText.has(p))
                  .map((p) => paramChip(p, false, runtimeInText.has(p), editing))}
                <ParamInput placeholder="+ field…" onAdd={(name) => insertParam(name, false)} />
              </div>
            )}
          </ParamSection>

          <ParamSection
            title="Config parameters"
            hint={`{{name}} — uses the value saved here, pastes without asking`}
          >
            {(editing) => (
              <>
                {configNames.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {configNames.map((name) => (
                      <div key={name} className="flex items-center gap-3">
                        <span className="relative min-w-32 text-left text-xs font-semibold text-(--param-config)">
                          {`{{${name}}}`}
                          {editing && <DeleteBadge onDelete={() => removeParam(name)} />}
                        </span>
                        <input
                          value={configValues[name] || ""}
                          spellCheck={false}
                          placeholder="(unset — will ask as a fill-in field)"
                          aria-label={`Value for {{${name}}}`}
                          className="flex-1 rounded-md bg-secondary px-3 py-1 text-xs text-foreground focus-ring placeholder:text-muted-foreground"
                          onChange={(e) => {
                            setConfigValues((v) => ({ ...v, [name]: e.target.value }))
                            scheduleSave()
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <ParamInput placeholder="+ config…" onAdd={(name) => insertParam(name, true)} />
                </div>
              </>
            )}
          </ParamSection>

          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl bg-card p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</span>
        {/* The one line of syntax help that doesn't vanish once typing starts */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          <code>{"{clipboard}"}</code> <code>{"{date}"}</code> <code>{"{time}"}</code> fill themselves ·{" "}
          <code>{"{field}"}</code> asks each time · <code>{"{{config}}"}</code> uses the value saved under
          Advanced options · names are lowercase letters and _ only
        </p>
        {/* The field's gray fills the card below the header, edge to edge */}
        <TokenPreview text={text} configValues={configValues} className="-mx-3 -mb-3 rounded-none rounded-b-xl" />
      </div>

      <div className="mt-auto flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void togglePin()}
          className={cn("min-w-19", snippet.pinned && "bg-(--warn)/15 text-(--warn) hover:bg-(--warn)/25")}
        >
          {snippet.pinned ? "Unpin" : "Pin"}
        </Button>
        {snippet.uses > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">used {snippet.uses}×</span>
        )}
      </div>
    </div>
  )
}
