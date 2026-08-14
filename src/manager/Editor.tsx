import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
} from "@remixicon/react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { DEFAULT_PACK, MAX_PINS, useManager } from "./state"
import { say, sayErr, sayUndo } from "./status"

const BUILTIN_PARAMS = ["clipboard", "date", "time"]
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
      <span className="flex items-center py-0.5 pl-1.5 pr-2">{label}</span>
    </button>
  )
}

// Delete badge hovering on a pill's corner while its card is in edit mode
function DeleteBadge({ onDelete }: { onDelete: () => void }) {
  return (
    <span
      role="button"
      title="Remove from this prompt"
      className="absolute -right-1.5 -top-1.5 flex size-3.5 cursor-pointer items-center justify-center rounded-full bg-destructive text-white opacity-80 shadow-sm transition-transform duration-150 animate-in fade-in zoom-in hover:scale-110 hover:opacity-100"
      onClick={(e) => {
        e.stopPropagation()
        onDelete()
      }}
    >
      <RiCloseLine className="size-2.5" />
    </span>
  )
}

function ParamInput({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  return (
    <input
      placeholder={placeholder}
      spellCheck={false}
      className="w-28 rounded-sm bg-secondary px-3 py-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground"
      onKeyDown={(e) => {
        if (e.key !== "Enter") return
        const name = e.currentTarget.value.trim().toLowerCase().replace(/[^a-z_]+/g, "_").replace(/^_+|_+$/g, "")
        if (!name) return
        onAdd(name)
        e.currentTarget.value = ""
      }}
    />
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
        let cls: string
        if (part.type === "bad") {
          label = `${part.name} — not a param (lowercase letters/_ only)`
          cls = "bg-destructive/15 text-destructive"
        } else if (part.type === "config") {
          const v = (configValues[part.name] || "").replace(/\s+/g, " ")
          label = v ? (v.length > 40 ? v.slice(0, 40) + "…" : v) : `${part.name} — config (unset)`
          cls = "bg-fuchsia-500/15 text-fuchsia-500"
        } else if (part.type === "builtin") {
          label = part.name
          cls = "bg-cyan-500/15 text-cyan-500"
        } else {
          label = `${part.name} — fill-in`
          cls = "bg-amber-500/15 text-amber-500"
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
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm leading-7 text-muted-foreground">
        {m.selection.size > 1 ? (
          <span>
            <b className="text-foreground">{m.selection.size} prompts selected</b>
            <br />
            right-click for actions · click a row to edit one
          </span>
        ) : (
          "Select or create a prompt"
        )}
      </div>
    )
  }
  return <EditorInner snippet={snippet} />
}

function EditorInner({ snippet }: { snippet: Snippet }) {
  const m = useManager()
  const [title, setTitle] = useState(snippet.title)
  const [tags, setTags] = useState((snippet.tags || []).join(", "))
  const [pack, setPack] = useState(snippet.pack || DEFAULT_PACK)
  const [newPackMode, setNewPackMode] = useState(false)
  const [text, setText] = useState(snippet.text)
  const [configValues, setConfigValues] = useState<Record<string, string>>({ ...(snippet.configValues || {}) })
  const [advOpen, setAdvOpen] = useState(localStorage.getItem("advancedOpen") === "1")
  const [deleteArmed, setDeleteArmed] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const isDraft = snippet.title === "New prompt" && !snippet.text && !snippet.uses

  // Autosave: edits persist on a short debounce — no Save button, no lost drafts
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ title, tags, pack, text, configValues })
  latest.current = { title, tags, pack, text, configValues }
  const mRef = useRef(m)
  mRef.current = m

  const commit = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const cur = latest.current
    const mgr = mRef.current
    const existing = mgr.snippets.find((s) => s.id === snippet.id)
    if (!existing) return
    let targetPack = cur.pack.trim() || existing.pack || DEFAULT_PACK
    if (targetPack !== (existing.pack || DEFAULT_PACK) && mgr.isLocked(targetPack)) {
      sayErr(`Pack "${targetPack}" is locked — unlock it to add prompts`)
      targetPack = existing.pack || DEFAULT_PACK
      setPack(targetPack)
    }
    const names = C.configNames(cur.text)
    const next: Snippet = {
      ...existing,
      title: cur.title.trim() || "(untitled)",
      tags: cur.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      pack: targetPack,
      text: cur.text,
      configValues: Object.fromEntries(
        Object.entries(cur.configValues).filter(([k, v]) => names.includes(k) && v !== "")
      ),
    }
    await mgr.persist(mgr.snippets.map((s) => (s.id === snippet.id ? next : s)))
    // New prompts default to the pack that last received one
    localStorage.setItem("lastPack", targetPack)
  }, [snippet.id])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void commit(), 600)
  }, [commit])

  // Flush pending edits when switching prompts / unmounting
  useEffect(() => {
    return () => {
      if (saveTimer.current) void commit()
    }
  }, [commit])

  // External changes (move-to-pack, add-tag via context menu) refresh the fields
  useEffect(() => {
    if (saveTimer.current) return // don't clobber in-flight edits
    setTags((snippet.tags || []).join(", "))
    setPack(snippet.pack || DEFAULT_PACK)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snippet.tags, snippet.pack])

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
          isBuiltin ? "bg-cyan-500/15 text-cyan-500" : "bg-amber-500/15 text-amber-500"
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
    setTags([...tagList, t].join(", "))
    scheduleSave()
  }
  const removeTag = (t: string) => {
    setTags(tagList.filter((x) => x !== t).join(", "))
    scheduleSave()
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
    await m.persist(m.snippets.map((s) => (s.id === snippet.id ? { ...s, pinned: !s.pinned } : s)))
    say(snippet.pinned ? "Unpinned" : "Pinned")
  }

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
    const removed = snippet
    const at = m.snippets.indexOf(snippet)
    await m.persist(m.snippets.filter((x) => x.id !== snippet.id))
    m.setSelection(new Set(), null)
    m.select(null)
    sayUndo(`Deleted "${removed.title}"`, () => {
      const cur = [...mRef.current.snippets]
      cur.splice(Math.min(at, cur.length), 0, removed)
      void mRef.current.persist(cur).then(() => say("Restored"))
    })
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
          spellCheck={false}
          className="min-w-50 flex-[2] bg-transparent py-1 text-base font-semibold text-foreground outline-none placeholder:text-muted-foreground focus:shadow-[0_1px_0_var(--color-primary)]"
        />
        {newPackMode ? (
          <input
            autoFocus
            placeholder="New pack name — Enter to confirm"
            spellCheck={false}
            className="min-w-32 flex-1 rounded-md bg-secondary px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                const name = e.currentTarget.value.trim()
                setNewPackMode(false)
                if (name && !m.isLocked(name)) {
                  setPack(name)
                  scheduleSave()
                } else if (name && m.isLocked(name)) {
                  sayErr(`Pack "${name}" is locked`)
                }
              }
              if (e.key === "Escape") setNewPackMode(false)
            }}
            onBlur={(e) => {
              const name = e.target.value.trim()
              setNewPackMode(false)
              if (name && !m.isLocked(name)) {
                setPack(name)
                scheduleSave()
              }
            }}
          />
        ) : (
          <select
            value={pack}
            onChange={(e) => {
              if (e.target.value === "__new__") {
                setNewPackMode(true)
                return
              }
              setPack(e.target.value)
              scheduleSave()
            }}
            // Native select arrows hug the edge; draw our own chevron inset
            // by the tier-1 spacing (6px)
            className="min-w-32 flex-1 cursor-pointer appearance-none rounded-md bg-secondary py-1.5 pl-2 pr-7 text-xs text-foreground outline-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888e98' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 6px center",
            }}
          >
            {m.packNames(pack).map((p) => (
              <option key={p} value={p} disabled={m.isLocked(p) && p !== pack}>
                {m.isLocked(p) ? `🔒 ${p}` : p}
              </option>
            ))}
            <option value="__new__">＋ New pack…</option>
          </select>
        )}
        <Button
          variant="secondary"
          size="sm"
          title="Delete prompt"
          onClick={() => void doDelete()}
          className={cn("text-destructive hover:bg-destructive/15", deleteArmed && "bg-destructive/15")}
        >
          {deleteArmed ? `Delete "${(snippet.title || "untitled").slice(0, 24)}"?` : <RiDeleteBinLine className="size-4" />}
        </Button>
      </div>

      {/* Prompt panel: same header idiom as Advanced options and Preview.
          The field (textarea + one-line tag strip) fills the card below the
          header; the textarea is 4 lines by default, grows with content
          (1lh bottom padding keeps one line free), capped at 10 lines. */}
      <div className="flex flex-col gap-3 rounded-xl bg-card p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prompt</span>
        <div className="-mx-3 -mb-3 flex flex-col overflow-hidden rounded-b-xl border border-transparent bg-secondary/50 focus-within:border-ring">
        <Textarea
          ref={textRef}
          value={text}
          onChange={(e) => setTextAnd(e.target.value)}
          spellCheck={false}
          placeholder="Prompt text…  Use {clipboard}, {date}, {time}, any {lowercase_word} as a fill-in field, or {{lowercase_word}} as a saved config parameter."
          className="min-h-[calc(4lh+1.5rem)] max-h-[calc(10lh+1.5rem)] resize-none rounded-none border-0 bg-transparent px-4 pt-3 pb-[calc(0.75rem+1lh)] leading-relaxed placeholder:text-muted-foreground/50 focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
          {tagList.map((t) => {
            const c = C.tagColor(t)
            return (
              <button
                key={t}
                title={`Remove tag "${t}"`}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-sm border bg-background/60 px-2 py-0.5 text-xs font-medium"
                style={{ color: c, borderColor: c + "55" }}
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
            spellCheck={false}
            className="w-24 shrink-0 rounded-sm bg-secondary px-3 py-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground"
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
                        <span className="relative min-w-32 text-left text-xs font-semibold text-fuchsia-500">
                          {`{{${name}}}`}
                          {editing && <DeleteBadge onDelete={() => removeParam(name)} />}
                        </span>
                        <input
                          value={configValues[name] || ""}
                          spellCheck={false}
                          placeholder="(unset — will ask as a fill-in field)"
                          className="flex-1 rounded-md bg-secondary px-3 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
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
        {/* The field's gray fills the card below the header, edge to edge */}
        <TokenPreview text={text} configValues={configValues} className="-mx-3 -mb-3 rounded-none rounded-b-xl" />
      </div>

      <div className="mt-auto flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void togglePin()}
          className={cn("min-w-19", snippet.pinned && "bg-amber-500/15 text-amber-500 hover:bg-amber-500/25")}
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
