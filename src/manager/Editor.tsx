import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { C, type Snippet } from "@/lib/core"
import { cn } from "@/lib/utils"
import { DEFAULT_PACK, MAX_PINS, useManager } from "./state"
import { say, sayErr, sayUndo } from "./status"

const BUILTIN_PARAMS = ["clipboard", "date", "time"]
const SUGGESTED_PARAMS = ["goal", "feature", "task", "error", "file"]

function TokenPreview({ text, configValues }: { text: string; configValues: Record<string, string> }) {
  return (
    <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-secondary/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
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
          <span key={i} className={cn("rounded px-1 text-xs font-semibold", cls)}>
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

  const paramChip = (name: string, isBuiltin: boolean, presence: "config" | "field" | null) => {
    const kind = presence === "config" ? "config" : isBuiltin ? "builtin" : "field"
    return (
      <button
        key={name}
        tabIndex={0}
        title={
          presence
            ? `Remove ${name} from this prompt`
            : isBuiltin
              ? `Insert {${name}} — expands automatically`
              : `Insert {${name}} — asks before pasting. Ctrl+click: insert {{${name}}} as a config parameter (saved value, no prompt).`
        }
        className={cn(
          "cursor-pointer select-none rounded-full border border-transparent bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary",
          presence && kind === "builtin" && "bg-cyan-500/15 text-cyan-500",
          presence && kind === "field" && "bg-amber-500/15 text-amber-500",
          presence && kind === "config" && "bg-fuchsia-500/15 text-fuchsia-500",
          presence && "hover:border-destructive hover:line-through"
        )}
        onClick={(e) =>
          presence ? removeParam(name) : insertParam(name, !isBuiltin && (e.ctrlKey || e.metaKey))
        }
      >
        {presence === "config" ? `{{${name}}}` : `{${name}}`}
      </button>
    )
  }

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
    <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 px-6">
      <div className="flex flex-wrap items-center gap-2">
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
        <input
          value={tags}
          onChange={(e) => {
            setTags(e.target.value)
            scheduleSave()
          }}
          placeholder="Tags, comma separated"
          spellCheck={false}
          className="min-w-40 flex-[2] rounded-md bg-secondary px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
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
            className="min-w-32 flex-1 cursor-pointer rounded-md bg-secondary px-2 py-1.5 text-xs text-foreground outline-none"
          >
            {m.packNames(pack).map((p) => (
              <option key={p} value={p} disabled={m.isLocked(p) && p !== pack}>
                {m.isLocked(p) ? `🔒 ${p}` : p}
              </option>
            ))}
            <option value="__new__">＋ New pack…</option>
          </select>
        )}
      </div>

      <Textarea
        ref={textRef}
        value={text}
        onChange={(e) => setTextAnd(e.target.value)}
        spellCheck={false}
        placeholder="Prompt text…  Use {clipboard}, {date}, {time}, any {lowercase_word} as a fill-in field, or {{lowercase_word}} as a saved config parameter."
        className="min-h-22 flex-1 resize-none rounded-xl bg-secondary/50 px-4 py-3 leading-relaxed"
      />

      <button
        className="cursor-pointer self-start text-xs text-muted-foreground hover:text-primary"
        onClick={() => {
          const next = !advOpen
          setAdvOpen(next)
          localStorage.setItem("advancedOpen", next ? "1" : "0")
        }}
      >
        Advanced options {advOpen ? "▾" : "▸"}
      </button>

      {advOpen && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Parameters — click: insert {"{field}"} · Ctrl+click: insert {"{{config}}"} · click again: remove
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {BUILTIN_PARAMS.map((p) => paramChip(p, true, runtimeInText.has(p) ? "field" : null))}
            {[...customParams].map((p) =>
              paramChip(p, false, configInText.has(p) ? "config" : runtimeInText.has(p) ? "field" : null)
            )}
            <input
              placeholder="+ custom…"
              spellCheck={false}
              className="w-28 rounded-full bg-secondary px-3 py-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return
                const name = e.currentTarget.value.trim().toLowerCase().replace(/[^a-z_]+/g, "_").replace(/^_+|_+$/g, "")
                if (!name) return
                insertParam(name, e.ctrlKey)
                e.currentTarget.value = ""
              }}
            />
          </div>

          {configNames.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Config values — saved with the prompt, pasted without asking
              </span>
              {configNames.map((name) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="min-w-32 text-xs font-semibold text-fuchsia-500">{`{{${name}}}`}</span>
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

          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Preview</span>
          <TokenPreview text={text} configValues={configValues} />
        </div>
      )}

      <div className="flex items-center gap-2">
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
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void doDelete()}
          className={cn("ml-auto text-destructive hover:bg-destructive/15", deleteArmed && "bg-destructive/15")}
        >
          {deleteArmed ? `Delete "${(snippet.title || "untitled").slice(0, 24)}"?` : "Delete"}
        </Button>
      </div>
    </div>
  )
}
